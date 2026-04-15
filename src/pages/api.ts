import { type Env, type Tier, DEFAULT_AFFILIATE_TAG } from '../types';
import { generateId, generateSlug, sanitizeUrl, generateAffiliateUrl, canonicalizeQuery, displayQuery } from '../lib/utils';
import { runEngine } from '../lib/engine';
import { getTierConfig, isValidTier } from '../lib/research-config';

// Clustering: a completed research with the same canonical form from within this
// window is served directly instead of re-running the pipeline.
const CLUSTER_MAX_AGE_SECONDS = 14 * 24 * 3600; // 14 days

async function findClusterMatch(db: D1Database, canonical: string): Promise<string | null> {
  if (!canonical) return null;
  const minAge = Math.floor(Date.now() / 1000) - CLUSTER_MAX_AGE_SECONDS;
  const row = await db.prepare(
    'SELECT slug FROM research WHERE canonical_query = ?1 AND status = ?2 AND created_at > ?3 ORDER BY created_at DESC LIMIT 1'
  ).bind(canonical, 'complete', minAge).first<{ slug: string }>();
  return row?.slug ?? null;
}

// ─── POST /api/research ──────────────────────────────────────────────────────

export async function handleResearchPost(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // CSRF: verify Origin
  const origin = request.headers.get('Origin');
  const allowed = ['https://chrisputer.tech', 'http://localhost:8787'];
  if (origin && !allowed.includes(origin)) {
    return json({ error: 'Forbidden' }, 403);
  }

  let body: { query?: string; tier?: string; turnstileToken?: string; fresh?: boolean };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (query.length < 3 || query.length > 500) {
    return json({ error: 'Query must be 3-500 characters' }, 400);
  }
  // Reject obvious bot / spam / test patterns
  const tokenCount = query.split(/\s+/).filter((t) => t.length > 0).length;
  if (tokenCount < 2) {
    return json({ error: 'Please describe what you want to research (at least two words).' }, 400);
  }
  if (/\{[^}]+\}/.test(query)) {
    return json({ error: 'Query contains an unresolved template placeholder.' }, 400);
  }

  const tier: Tier = (typeof body.tier === 'string' && isValidTier(body.tier)) ? body.tier : 'instant';
  const config = getTierConfig(tier);

  // Check subscription requirement (future — currently blocks unbound)
  if (config.requireSubscription) {
    return json({ error: 'This tier requires a subscription. Coming soon!' }, 403);
  }

  // Turnstile verification for tiers that require it
  if (config.requireTurnstile && env.TURNSTILE_SECRET_KEY) {
    const token = typeof body.turnstileToken === 'string' ? body.turnstileToken : '';
    if (!token || !(await verifyTurnstile(token, env.TURNSTILE_SECRET_KEY, '127.0.0.1'))) {
      return json({ error: 'CAPTCHA verification required for this tier.' }, 403);
    }
  }

  // Per-tier rate limiting
  const clientIp = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const rateLimitError = await checkRateLimit(env.DB, tier, clientIp);
  if (rateLimitError) {
    return json({ error: rateLimitError }, 429);
  }

  const canonical = canonicalizeQuery(query);

  // Cluster lookup: if a recent completed research matches this query's canonical
  // form, serve the existing slug. User can force a fresh run with ?fresh=1.
  const forceFresh = typeof body.fresh === 'boolean' ? body.fresh : false;
  if (!forceFresh) {
    const match = await findClusterMatch(env.DB, canonical);
    if (match) {
      return json({ slug: match, clustered: true }, 200);
    }
  }

  const researchId = generateId();
  const slug = generateSlug(query);
  const now = Math.floor(Date.now() / 1000);

  try {
    await env.DB.prepare(
      'INSERT INTO research (id, slug, query, status, tier, canonical_query, created_at, view_count) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)'
    ).bind(researchId, slug, query, 'pending', tier, canonical, now).run();
  } catch {
    // Slug collision — retry with fresh slug
    const slug2 = generateSlug(query);
    try {
      await env.DB.prepare(
        'INSERT INTO research (id, slug, query, status, tier, canonical_query, created_at, view_count) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)'
      ).bind(researchId, slug2, query, 'pending', tier, canonical, now).run();
    } catch {
      return json({ error: 'Failed to create research. Please try again.' }, 500);
    }
    await env.RESEARCH_QUEUE.send({ researchId, query, tier });
    return json({ slug: slug2 }, 201);
  }

  await env.RESEARCH_QUEUE.send({ researchId, query, tier });
  return json({ slug }, 201);
}

// Fire-and-forget quick answer from the LLM's prior knowledge. Runs in parallel
// with the full research pipeline so the processing page has something useful
// to show within ~3s instead of a pure spinner. Errors are swallowed — the main
// pipeline is the source of truth, preview is just UX lipstick.
async function generatePreview(env: Env, researchId: string, query: string): Promise<void> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://chrisputer.tech',
        'X-Title': 'Chrisputer Labs',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4.5',
        messages: [
          {
            role: 'system',
            content: 'You give a 120-word "quick answer" to product research questions from your own knowledge — NO sources, NO disclaimers, no "as an AI". Just name 3-5 likely top products with a one-line reason each. End with: "Full research with fresh sources is loading below." This is a preview shown while real research runs.',
          },
          { role: 'user', content: query },
        ],
      }),
    });
    if (!response.ok) return;
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return;
    await env.DB.prepare('UPDATE research SET preview = ?1 WHERE id = ?2').bind(text, researchId).run();
  } catch (e) {
    console.warn('[preview] generation failed:', e);
  }
}

export async function executeResearch(env: Env, researchId: string, query: string, tier: Tier): Promise<void> {
  const config = getTierConfig(tier);

  await env.DB.prepare("UPDATE research SET status = 'processing' WHERE id = ?1").bind(researchId).run();

  // Kick off quick-answer preview in parallel with the full research.
  const previewPromise = generatePreview(env, researchId, query);

  try {
    const { result, sources } = await runEngine(
      query,
      config,
      env.OPENROUTER_API_KEY,
      env.TAVILY_API_KEY,
      env.DB,
      researchId,
    );
    // Don't let a hung preview block the main flow, but don't leak it either.
    previewPromise.catch(() => {});

    const affiliateTag = env.AMAZON_AFFILIATE_TAG || DEFAULT_AFFILIATE_TAG;
    const walmartId = env.WALMART_IMPACT_ID;
    const now = Math.floor(Date.now() / 1000);

    // Batch insert products
    const stmts = result.products.map((p) => {
      const aUrl = p.productUrl ? sanitizeUrl(generateAffiliateUrl(p.productUrl, affiliateTag, walmartId)) : '';
      return env.DB.prepare(
        `INSERT INTO products (id, research_id, name, brand, price, currency, rating, product_url, manufacturer_url, affiliate_url, pros, cons, specs, verdict, rank, best_for)
         VALUES (?1, ?2, ?3, ?4, ?5, 'USD', ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`
      ).bind(
        generateId(), researchId, p.name, p.brand || null, p.price, p.rating,
        sanitizeUrl(p.productUrl), sanitizeUrl(p.manufacturerUrl), aUrl,
        JSON.stringify(p.pros), JSON.stringify(p.cons), JSON.stringify(p.specs),
        p.verdict, p.rank, p.bestFor || null,
      );
    });

    const updateStmt = env.DB.prepare(
      `UPDATE research SET status = 'complete', summary = ?1, category = ?2, result = ?3, sources = ?4, completed_at = ?5 WHERE id = ?6`
    ).bind(
      result.summary, result.category, JSON.stringify(result),
      JSON.stringify(sources.map((s) => s.url)), now, researchId,
    );

    await env.DB.batch([...stmts, updateStmt]);
  } catch (error) {
    console.error('Research failed:', error);
    try {
      await env.DB.prepare("UPDATE research SET status = 'failed' WHERE id = ?1").bind(researchId).run();
    } catch (e) {
      console.error('Failed to mark research failed:', e);
    }
  }
}

// ─── Rate limiting (per-tier, per-IP via rate_limits table) ─────────────────

const RATE_LIMITS: Record<string, { windowSec: number; limit: number }> = {
  instant:    { windowSec: 3600,  limit: 20 },  // 20/hour per IP
  full:       { windowSec: 3600,  limit: 10 },  // 10/hour per IP
  exhaustive: { windowSec: 86400, limit: 5 },   // 5/day per IP
};

async function checkRateLimit(db: D1Database, tier: Tier, ip: string): Promise<string | null> {
  // Global safety valve: 60 researches/hour total
  const oneHourAgo = Math.floor((Date.now() - 3_600_000) / 1000);
  const globalCount = await db.prepare(
    'SELECT COUNT(*) as cnt FROM research WHERE created_at > ?1'
  ).bind(oneHourAgo).first<{ cnt: number }>();

  if ((globalCount?.cnt ?? 0) >= 60) {
    return 'Server is busy. Please try again in a few minutes.';
  }

  if (tier === 'unbound') return null;

  const cfg = RATE_LIMITS[tier];
  if (!cfg) return null;

  const endpoint = `research:${tier}`;
  const windowKey = Math.floor(Date.now() / 1000 / cfg.windowSec) * cfg.windowSec;

  // Upsert: increment counter for this IP + window
  await db.prepare(
    `INSERT INTO rate_limits (ip, endpoint, window_start, request_count)
     VALUES (?1, ?2, ?3, 1)
     ON CONFLICT(ip, endpoint, window_start)
     DO UPDATE SET request_count = request_count + 1`
  ).bind(ip, endpoint, windowKey).run();

  // Check if over limit
  const row = await db.prepare(
    'SELECT request_count FROM rate_limits WHERE ip = ?1 AND endpoint = ?2 AND window_start = ?3'
  ).bind(ip, endpoint, windowKey).first<{ request_count: number }>();

  if ((row?.request_count ?? 0) > cfg.limit) {
    const unit = cfg.windowSec >= 86400 ? 'day' : 'hour';
    return `Rate limit reached: ${cfg.limit} ${tier} researches per ${unit}. Try again later.`;
  }

  // Lazy cleanup: ~1% of requests, clear entries older than 48h
  if (Math.random() < 0.01) {
    const cutoff = Math.floor(Date.now() / 1000) - 172800;
    db.prepare('DELETE FROM rate_limits WHERE window_start < ?1').bind(cutoff).run().catch(() => {});
  }

  return null;
}

// ─── GET /api/research/:slug/events ──────────────────────────────────────────

export async function handleResearchEvents(slug: string, url: URL, env: Env): Promise<Response> {
  const since = parseInt(url.searchParams.get('since') ?? '0', 10) || 0;

  // Get research ID from slug
  const research = await env.DB.prepare(
    'SELECT id, status, preview FROM research WHERE slug = ?1'
  ).bind(slug).first<{ id: string; status: string; preview: string | null }>();

  if (!research) {
    return json({ error: 'Not found' }, 404);
  }

  const events = await env.DB.prepare(
    'SELECT seq, event_type, message, created_at FROM research_events WHERE research_id = ?1 AND seq > ?2 ORDER BY seq ASC LIMIT 50'
  ).bind(research.id, since).all<{ seq: number; event_type: string; message: string; created_at: number }>();

  return json({
    status: research.status,
    events: events.results ?? [],
    preview: research.preview ?? null,
  });
}

// ─── GET /api/search/suggest ─────────────────────────────────────────────────

export async function handleSearchSuggest(url: URL, env: Env): Promise<Response> {
  const q = url.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return suggestJson([]);

  // Sanitize FTS5 query: strip special chars, add prefix match
  const sanitized = q.replace(/[^\w\s-]/g, '').trim();
  if (!sanitized) return suggestJson([]);
  const ftsQuery = sanitized.split(/\s+/).map((w) => `"${w}"*`).join(' ');

  try {
    const rows = await env.DB.prepare(
      `WITH ranked AS (
         SELECT r.slug, r.query, r.category, r.view_count,
                ROW_NUMBER() OVER (PARTITION BY COALESCE(r.canonical_query, r.slug) ORDER BY r.view_count DESC, r.created_at DESC) AS rn
         FROM research_fts f
         JOIN research r ON r.rowid = f.rowid
         WHERE research_fts MATCH ?1 AND r.status = 'complete'
       )
       SELECT slug, query, category, view_count FROM ranked WHERE rn = 1
       ORDER BY view_count DESC LIMIT 6`
    ).bind(ftsQuery).all<{ slug: string; query: string; category: string | null; view_count: number }>();

    const pretty = (rows.results ?? []).map((r) => ({ ...r, query: displayQuery(r.query) }));
    return suggestJson(pretty);
  } catch {
    // FTS query syntax error — fall back to LIKE
    const rows = await env.DB.prepare(
      `WITH ranked AS (
         SELECT slug, query, category, view_count,
                ROW_NUMBER() OVER (PARTITION BY COALESCE(canonical_query, slug) ORDER BY view_count DESC, created_at DESC) AS rn
         FROM research WHERE status = 'complete' AND query LIKE ?1
       )
       SELECT slug, query, category, view_count FROM ranked WHERE rn = 1
       ORDER BY view_count DESC LIMIT 6`
    ).bind(`%${sanitized}%`).all<{ slug: string; query: string; category: string | null; view_count: number }>();

    const pretty = (rows.results ?? []).map((r) => ({ ...r, query: displayQuery(r.query) }));
    return suggestJson(pretty);
  }
}

// Suggestions are public, idempotent, and tolerable of small staleness.
// Cache for 5min at the edge + browser so popular prefixes ("best", "wifi")
// don't hit D1 FTS5 on every keystroke. New research entries take up to
// 5 min to surface in autocomplete — same window as the home page cache.
function suggestJson(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=600',
      Vary: 'Accept-Encoding',
    },
  });
}

// ─── POST /api/subscribe ────────────────────────────────────────────────────

export async function handleSubscribe(request: Request, env: Env): Promise<Response> {
  let body: { email?: string; researchId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const researchId = typeof body.researchId === 'string' ? body.researchId.trim() : '';

  // Basic email validation
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return json({ error: 'Valid email required' }, 400);
  }
  if (!researchId) {
    return json({ error: 'Research ID required' }, 400);
  }

  // Verify research exists
  const research = await env.DB.prepare(
    'SELECT id, status FROM research WHERE id = ?1'
  ).bind(researchId).first<{ id: string; status: string }>();

  if (!research) return json({ error: 'Research not found' }, 404);
  if (research.status === 'complete') return json({ error: 'Research already complete' }, 400);

  const now = Math.floor(Date.now() / 1000);
  try {
    await env.DB.prepare(
      `INSERT INTO subscribers (email, research_id, created_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(email, research_id) DO NOTHING`
    ).bind(email, researchId, now).run();
  } catch {
    return json({ error: 'Failed to subscribe' }, 500);
  }

  return json({ ok: true });
}

// ─── Turnstile verification ──────────────────────────────────────────────────

interface TurnstileResponse {
  success: boolean;
}

export async function verifyTurnstile(token: string, secretKey: string, ip: string): Promise<boolean> {
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: secretKey, response: token, remoteip: ip }),
    });
    const data: TurnstileResponse = await response.json();
    return data.success === true;
  } catch {
    return false;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
