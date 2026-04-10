import { type Env, DEFAULT_AFFILIATE_TAG } from '../types';
import { generateId, generateSlug, sanitizeUrl, generateAffiliateUrl } from '../lib/utils';
import { scrapeSearchResults } from '../lib/scraper';
import { runResearch } from '../lib/researcher';

export async function handleResearchPost(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // CSRF: verify Origin
  const origin = request.headers.get('Origin');
  const allowed = ['https://research.chrisputer.tech', 'https://chrisputer.tech', 'http://localhost:8787'];
  if (origin && !allowed.includes(origin)) {
    return json({ error: 'Forbidden' }, 403);
  }

  // Application-level rate limiting (10/hr per IP)
  const clientIp = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const oneHourAgo = Math.floor((Date.now() - 3_600_000) / 1000);
  const countResult = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM research WHERE created_at > ?1'
  ).bind(oneHourAgo).first<{ cnt: number }>();

  // Simple global rate limit for now (per-IP requires storing IPs)
  if ((countResult?.cnt ?? 0) >= 30) {
    return json({ error: 'Too many requests. Try again later.' }, 429);
  }

  let body: { query?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (query.length < 3 || query.length > 500) {
    return json({ error: 'Query must be 3-500 characters' }, 400);
  }

  const researchId = generateId();
  const slug = generateSlug(query);
  const now = Math.floor(Date.now() / 1000);

  try {
    await env.DB.prepare(
      'INSERT INTO research (id, slug, query, status, created_at, view_count) VALUES (?1, ?2, ?3, ?4, ?5, 0)'
    ).bind(researchId, slug, query, 'processing', now).run();
  } catch {
    // Slug collision — retry with fresh slug
    const slug2 = generateSlug(query);
    try {
      await env.DB.prepare(
        'INSERT INTO research (id, slug, query, status, created_at, view_count) VALUES (?1, ?2, ?3, ?4, ?5, 0)'
      ).bind(researchId, slug2, query, 'processing', now).run();
    } catch {
      return json({ error: 'Failed to create research. Please try again.' }, 500);
    }
    ctx.waitUntil(executeResearch(env, researchId, query));
    return json({ slug: slug2 }, 201);
  }

  ctx.waitUntil(executeResearch(env, researchId, query));
  return json({ slug }, 201);
}

async function executeResearch(env: Env, researchId: string, query: string): Promise<void> {
  try {
    const sources = await scrapeSearchResults(query, env.BRAVE_API_KEY);
    const result = await runResearch(env.OPENROUTER_API_KEY, query, sources);
    const affiliateTag = env.AMAZON_AFFILIATE_TAG || DEFAULT_AFFILIATE_TAG;
    const now = Math.floor(Date.now() / 1000);

    // Batch insert products
    const stmts = result.products.map((p) => {
      const aUrl = p.productUrl ? sanitizeUrl(generateAffiliateUrl(p.productUrl, affiliateTag)) : '';
      return env.DB.prepare(
        `INSERT INTO products (id, research_id, name, brand, price, currency, rating, product_url, affiliate_url, pros, cons, specs, verdict, rank, best_for)
         VALUES (?1, ?2, ?3, ?4, ?5, 'USD', ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`
      ).bind(
        generateId(), researchId, p.name, p.brand || null, p.price, p.rating,
        sanitizeUrl(p.productUrl), aUrl,
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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
