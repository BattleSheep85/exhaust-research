import type { Env, Tier, ResearchJobMessage } from './types';
import { renderHome } from './pages/home';
import { renderResearchResult } from './pages/research-result';
import { renderBrowse } from './pages/research-browse';
import { renderAbout } from './pages/about';
import { renderClarifyPage, extractClarifications } from './pages/research-clarify';
import { handleResearchPost, handleResearchEvents, handleSearchSuggest, handleSubscribe, verifyTurnstile, executeResearch } from './pages/api';
import { classifyQuery } from './lib/classifier';
import { canonicalizeQuery } from './lib/utils';
import { getTierConfig, isValidTier } from './lib/research-config';
import {
  FAVICON_SVG, OG_IMAGE_SVG, manifestJson, opensearchXml,
  HUMANS_TXT, BROWSERCONFIG_XML, adsTxt, robotsTxt,
  isBotUserAgent, isScannerProbe,
} from './lib/static-assets';
import { getLatestResearchLastmod, generateSitemap, generateAtomFeed, generateOgImage } from './lib/sitemap-feed';
import {
  renderNotFoundResearch, renderGeneric404, render500,
  renderVerificationFailed, renderRejected, renderRateLimited, renderResearchError,
} from './lib/error-pages';

// Bump when the page template/schema shape changes in a way that should
// invalidate every cached HTML blob. Old keys age out on their own TTL
// (home: 5m, research result: 1h) so bumping is a soft cutover, not a purge.
const CACHE_VERSION = 'v42';

// Update when /about page content materially changes. Signals freshness to
// crawlers so the page gets re-crawled after structured-data or copy edits.
const ABOUT_LASTMOD = '2026-04-14';

// Baseline security headers applied to every response (HTML, JSON, redirects,
// static assets). HTML pages add a stricter CSP on top in htmlResponse(); these
// are the universal defaults that should never be missing.
const BASELINE_SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function applyBaselineSecurityHeaders(response: Response): Response {
  let needsCopy = false;
  for (const k of Object.keys(BASELINE_SECURITY_HEADERS)) {
    if (!response.headers.has(k)) { needsCopy = true; break; }
  }
  if (!needsCopy) return response;
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(BASELINE_SECURITY_HEADERS)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const response = applyBaselineSecurityHeaders(await handleRequest(request, env, ctx));
    // HEAD: same headers/status as GET, body stripped. Done here (not per-route)
    // so link checkers, uptime monitors, and Googlebot prefetch all just work.
    if (request.method === 'HEAD') {
      return new Response(null, { status: response.status, headers: response.headers });
    }
    return response;
  },
  async queue(batch: MessageBatch<ResearchJobMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const { researchId, query, tier, facets, topicalCategory, clarifications } = msg.body;
      try {
        await executeResearch(env, researchId, query, tier, facets, topicalCategory ?? null, clarifications);
        msg.ack();
      } catch (err) {
        // Structured log so DLQ triage has query + tier context, not just the id.
        console.error(JSON.stringify({
          where: 'queue-consumer',
          researchId,
          query,
          tier,
          attempts: msg.attempts,
          error: err instanceof Error ? err.message : String(err),
        }));
        msg.retry();
      }
    }
  },
  // Scheduled: reap rows stuck in 'processing' longer than ~20 min. Covers the
  // edge case where the queue consumer crashed mid-pipeline AFTER flipping
  // status but BEFORE the final UPDATE — without this, the row stays
  // 'processing' forever and the public page shows a spinner that never
  // resolves. Wired to a cron_triggers entry in wrangler.jsonc (*/10 * * * *).
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const cutoff = Math.floor(Date.now() / 1000) - 20 * 60;
    try {
      const result = await env.DB.prepare(
        "UPDATE research SET status = 'failed' WHERE status = 'processing' AND created_at < ?1"
      ).bind(cutoff).run();
      const reaped = result.meta?.changes ?? 0;
      if (reaped > 0) console.log(JSON.stringify({ where: 'scheduled-reap', reaped, cutoff }));
    } catch (err) {
      console.error(JSON.stringify({ where: 'scheduled-reap', error: err instanceof Error ? err.message : String(err) }));
    }
  },
} satisfies ExportedHandler<Env>;

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const at = env.CF_ANALYTICS_TOKEN;
    const adPub = env.ADSENSE_PUBLISHER_ID;

    // Legacy subdomain / www redirects
    if (url.hostname === 'research.chrisputer.tech' || url.hostname === 'www.chrisputer.tech') {
      const dest = new URL(url.pathname + url.search, 'https://chrisputer.tech');
      return Response.redirect(dest.toString(), 301);
    }

    // Strip trailing slash (except root) to avoid duplicate-content URLs
    if (path.length > 1 && path.endsWith('/')) {
      const dest = new URL(path.replace(/\/+$/, '') + url.search, url.origin);
      return Response.redirect(dest.toString(), 301);
    }

    // Fast-fail for known scanner/bot probes. Saves ~20KB of HTML-404 rendering
    // per probe and reduces CF egress from drive-by vulnerability scanners.
    if (isScannerProbe(path)) {
      return new Response('Not Found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain;charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
      });
    }

    try {
      // ── Static assets ────────────────────────────────────────────────────
      if (path === '/favicon.svg') {
        return new Response(FAVICON_SVG, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
      }
      if (path === '/favicon.ico' || path === '/apple-touch-icon.png' || path === '/apple-touch-icon-precomposed.png') {
        return new Response(null, {
          status: 301,
          headers: { Location: '/favicon.svg', 'Cache-Control': 'public, max-age=2592000, immutable' },
        });
      }
      if (path === '/manifest.json' || path === '/site.webmanifest') {
        return new Response(null, {
          status: 301,
          headers: { Location: '/manifest.webmanifest', 'Cache-Control': 'public, max-age=2592000, immutable' },
        });
      }
      if (path === '/og-image.svg') {
        return new Response(OG_IMAGE_SVG, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
      }
      if (path === '/opensearch.xml') {
        return new Response(opensearchXml(url.origin), {
          headers: { 'Content-Type': 'application/opensearchdescription+xml', 'Cache-Control': 'public, max-age=86400' },
        });
      }
      if (path === '/manifest.webmanifest') {
        return new Response(manifestJson(), {
          headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=86400' },
        });
      }
      if (path === '/robots.txt') {
        return new Response(robotsTxt(url.origin), {
          headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=86400' },
        });
      }
      if (path === '/humans.txt') {
        return new Response(HUMANS_TXT, {
          headers: { 'Content-Type': 'text/plain;charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
        });
      }
      if (path === '/browserconfig.xml') {
        return new Response(BROWSERCONFIG_XML, {
          headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=86400' },
        });
      }
      if (path === '/ads.txt') {
        return new Response(adsTxt(env.ADSENSE_PUBLISHER_ID), {
          headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=86400' },
        });
      }
      if (path === '/sitemap.xml') {
        return generateSitemap(url.origin, env, request.headers.get('If-Modified-Since'), ABOUT_LASTMOD);
      }
      if (path === '/feed.xml') {
        return generateAtomFeed(url.origin, env, request.headers.get('If-Modified-Since'));
      }

      // ── API routes ───────────────────────────────────────────────────────
      const isGetLike = request.method === 'GET' || request.method === 'HEAD';
      if (path === '/api/research' && request.method === 'POST') {
        return handleResearchPost(request, env, ctx);
      }
      const eventsMatch = path.match(/^\/api\/research\/([a-z0-9-]+)\/events$/);
      if (eventsMatch && isGetLike) {
        return handleResearchEvents(eventsMatch[1], url, env);
      }
      if (path === '/api/search/suggest' && isGetLike) {
        return handleSearchSuggest(url, env);
      }
      if (path === '/api/subscribe' && request.method === 'POST') {
        return handleSubscribe(request, env);
      }
      if (path.startsWith('/api/')) {
        const knownRoutes: Array<{ pattern: RegExp; methods: string[] }> = [
          { pattern: /^\/api\/research$/, methods: ['POST'] },
          { pattern: /^\/api\/research\/[a-z0-9-]+\/events$/, methods: ['GET'] },
          { pattern: /^\/api\/search\/suggest$/, methods: ['GET'] },
          { pattern: /^\/api\/subscribe$/, methods: ['POST'] },
        ];
        const match = knownRoutes.find((r) => r.pattern.test(path));
        if (match) {
          return new Response(
            JSON.stringify({ error: 'Method Not Allowed', allow: match.methods }),
            { status: 405, headers: { 'Content-Type': 'application/json', Allow: match.methods.join(', ') } },
          );
        }
        return new Response(
          JSON.stringify({ error: 'Not Found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // ── Page routes: accept GET and HEAD ─────────────────────────────────
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405 });
      }

      // Home (cached 5 min)
      if (path === '/' || path === '') {
        const homeKey = `page:${CACHE_VERSION}:home`;
        const [cached, latestLm] = await Promise.all([
          env.CACHE.get(homeKey),
          getLatestResearchLastmod(env, CACHE_VERSION),
        ]);
        const listingCc = 'public, max-age=60, s-maxage=60, stale-while-revalidate=3600';
        const notModified = maybe304(request.headers.get('If-Modified-Since'), latestLm, listingCc);
        if (notModified) return notModified;
        if (cached) return htmlResponse(cached, 200, at, adPub, latestLm, listingCc);
        const html = await renderHome(env);
        ctx.waitUntil(env.CACHE.put(homeKey, html, { expirationTtl: 300 }));
        return htmlResponse(html, 200, at, adPub, latestLm, listingCc);
      }

      if (path === '/research/new') {
        return handleNewResearch(request, url, env, ctx, at, adPub);
      }

      if (path === '/research' || path === '/research/') {
        const [html, latestLm] = await Promise.all([
          renderBrowse(url, env),
          getLatestResearchLastmod(env, CACHE_VERSION),
        ]);
        const listingCc = 'public, max-age=60, s-maxage=60, stale-while-revalidate=3600';
        const notModified = maybe304(request.headers.get('If-Modified-Since'), latestLm, listingCc);
        if (notModified) return notModified;
        return htmlResponse(html, 200, at, adPub, latestLm, listingCc);
      }

      // Dynamic OG image for research results
      const ogMatch = path.match(/^\/research\/([a-z0-9-]+)\/og\.svg$/);
      if (ogMatch) {
        return generateOgImage(ogMatch[1], env);
      }

      // Research result (cached 1h for completed research)
      const slugMatch = path.match(/^\/research\/([a-z0-9-]+)$/);
      if (slugMatch) {
        const slug = slugMatch[1];
        const fromQuery = url.searchParams.get('from');
        const cacheKey = `page:${CACHE_VERSION}:${slug}`;
        const cacheMetaKey = `page:${CACHE_VERSION}:${slug}:lm`;
        const ifModifiedSince = request.headers.get('If-Modified-Since');
        if (!fromQuery) {
          const [cached, cachedLm] = await Promise.all([
            env.CACHE.get(cacheKey),
            env.CACHE.get(cacheMetaKey),
          ]);
          if (cached) {
            const lm = cachedLm ? parseInt(cachedLm, 10) || undefined : undefined;
            const notModified = maybe304(ifModifiedSince, lm);
            if (notModified) return notModified;
            return htmlResponse(cached, 200, at, adPub, lm);
          }
        }

        const result = await renderResearchResult(slug, env, fromQuery);
        if (result instanceof Response) {
          if (result.status === 404) {
            return htmlResponse(renderNotFoundResearch(slug), 404, at, adPub);
          }
          return result;
        }

        // Cache completed/failed pages (not actively processing, not banner variant)
        if (!fromQuery && !result.html.includes('id="processing"')) {
          ctx.waitUntil(env.CACHE.put(cacheKey, result.html, { expirationTtl: 3600 }));
          ctx.waitUntil(env.CACHE.put(cacheMetaKey, String(result.lastModified), { expirationTtl: 3600 }));
        }
        const notModified = maybe304(ifModifiedSince, result.lastModified);
        if (notModified) return notModified;
        return htmlResponse(result.html, 200, at, adPub, result.lastModified);
      }

      // About — static content, lastmod is ABOUT_LASTMOD. Honor
      // If-Modified-Since for 304s (Googlebot revisits, CF edge revalidation).
      if (path === '/about') {
        const aboutLastmodSec = Math.floor(Date.parse(`${ABOUT_LASTMOD}T00:00:00Z`) / 1000);
        const notModified = maybe304(request.headers.get('If-Modified-Since'), aboutLastmodSec);
        if (notModified) return notModified;
        return htmlResponse(renderAbout(), 200, at, adPub, aboutLastmodSec);
      }

      return htmlResponse(renderGeneric404(), 404, at, adPub);
    } catch (error) {
      console.error('Unhandled error:', error);
      return htmlResponse(render500(env.TURNSTILE_SITE_KEY), 500, at, adPub);
    }
}

async function handleNewResearch(request: Request, url: URL, env: Env, ctx: ExecutionContext, analyticsToken?: string, adsensePub?: string): Promise<Response> {
  const query = url.searchParams.get('q')?.trim();
  if (!query) return Response.redirect(new URL('/', url.origin).toString(), 302);

  // Bots (including well-behaved crawlers that ignore the robots.txt disallow)
  // shouldn't trigger LLM research runs. Route them to the browse page instead —
  // they can still index existing research without creating new side-effect
  // entries that would pollute the sitemap/feed/home.
  const ua = request.headers.get('User-Agent') ?? '';
  if (isBotUserAgent(ua)) {
    const dest = new URL(`/research?q=${encodeURIComponent(query)}`, url.origin);
    return Response.redirect(dest.toString(), 302);
  }

  const tier = url.searchParams.get('tier') ?? 'instant';
  const validTier: Tier = isValidTier(tier) ? tier : 'instant';
  const tierConfig = getTierConfig(validTier);

  // Clarifying-questions grill (Full/Exhaustive/Unbound only — Instant skips
  // for speed). Runs BEFORE Turnstile verification so the interstitial itself
  // is free to render; Turnstile fires on final submit from the chip form.
  // Skipped when the user already submitted answers (any clarify_* param
  // present) or hit the explicit "skip" button.
  const hasAnswers = Array.from(url.searchParams.keys()).some((k) => k.startsWith('clarify_'));
  const skipClarify = url.searchParams.get('skip_clarify') === '1';
  let clarifications: Record<string, string> = {};
  if (validTier !== 'instant' && !hasAnswers && !skipClarify) {
    try {
      const classification = await classifyQuery(env, query, canonicalizeQuery(query));
      if (classification.accept && classification.clarifying_questions.length > 0) {
        return htmlResponse(
          renderClarifyPage(query, validTier, classification.clarifying_questions, env.TURNSTILE_SITE_KEY),
          200, analyticsToken, adsensePub,
        );
      }
    } catch { /* classifier failure: fall open and proceed without grill */ }
  }
  if (hasAnswers) {
    // Extract directly from URL params. Works even if the classifier fails
    // open after the interstitial rendered — the user's answers still land.
    clarifications = extractClarifications(url);
  }

  // Verify Turnstile — required for exhaustive tier, optional bot-check for others
  if (env.TURNSTILE_SECRET_KEY && tierConfig.requireTurnstile) {
    const token = url.searchParams.get('cf-turnstile-response') ?? '';
    const clientIp = request.headers.get('CF-Connecting-IP') ?? '';
    if (!token || !(await verifyTurnstile(token, env.TURNSTILE_SECRET_KEY, clientIp))) {
      return htmlResponse(renderVerificationFailed(), 403, analyticsToken, adsensePub);
    }
  }
  const apiUrl = new URL('/api/research', url.origin);

  // Build a real request to our own handler (avoids internal fetch bypass)
  const result = await handleResearchPost(
    new Request(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': request.headers.get('CF-Connecting-IP') ?? '127.0.0.1',
      },
      body: JSON.stringify({
        query, tier, fresh: url.searchParams.get('fresh') === '1',
        clarifications: Object.keys(clarifications).length > 0 ? clarifications : undefined,
      }),
    }),
    env,
    ctx,
  );

  if (result.ok) {
    const data: { slug: string; clustered?: boolean } = await result.json();
    const dest = new URL(`/research/${data.slug}`, url.origin);
    if (data.clustered) {
      // Preserve the user's original phrasing so the result page can show a
      // "we matched your query to existing research" banner.
      dest.searchParams.set('from', query);
    }
    return Response.redirect(dest.toString(), 302);
  }

  // Error branches
  let errorMsg = 'Something went wrong. Please try again.';
  let rejected = false;
  let suggestedRefinement: string | null = null;
  try {
    const data: { error?: string; rejected?: boolean; reason?: string; suggested_refinement?: string | null } = await result.json();
    if (data.rejected) {
      rejected = true;
      if (data.reason && data.reason.length < 400) errorMsg = data.reason;
      if (typeof data.suggested_refinement === 'string' && data.suggested_refinement.length > 0) {
        suggestedRefinement = data.suggested_refinement.slice(0, 200);
      }
    } else if (data.error && data.error.length < 200) {
      errorMsg = data.error;
    }
  } catch { /* use default */ }

  if (rejected) {
    return htmlResponse(renderRejected(errorMsg, suggestedRefinement, env.TURNSTILE_SITE_KEY), 400, analyticsToken, adsensePub);
  }
  if (result.status === 429) {
    return htmlResponse(renderRateLimited(errorMsg), 429, analyticsToken, adsensePub);
  }
  return htmlResponse(renderResearchError(errorMsg), result.status, analyticsToken, adsensePub);
}

// Returns a 304 Not Modified if the client's If-Modified-Since covers the
// resource's last-modified timestamp.
function maybe304(ifModifiedSince: string | null, lastModifiedSec: number | undefined, cacheControl?: string): Response | null {
  if (!ifModifiedSince || !lastModifiedSec) return null;
  const since = Date.parse(ifModifiedSince);
  if (isNaN(since)) return null;
  if (Math.floor(since / 1000) < lastModifiedSec) return null;
  return new Response(null, {
    status: 304,
    headers: {
      'Last-Modified': new Date(lastModifiedSec * 1000).toUTCString(),
      'Cache-Control': cacheControl ?? 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

// Per-request CSP nonce. Pages emit inline <script> tags carrying the literal
// placeholder `__CSP_NONCE__`, which gets substituted here with a fresh
// crypto-random value. Browsers that see a nonce on script-src ignore
// 'unsafe-inline' entirely, so dropping 'unsafe-inline' only takes effect once
// every inline script actually carries a nonce. All `on*=` handlers had to go
// first (they can't accept a nonce) — see research-result.ts and html.ts for
// the addEventListener replacements.
function generateNonce(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

function htmlResponse(body: string, status = 200, analyticsToken?: string, adsensePublisherId?: string, lastModifiedSec?: number, cacheControl?: string): Response {
  const nonce = generateNonce();
  let out = body.replaceAll('__CSP_NONCE__', nonce);
  if (adsensePublisherId) {
    out = out.replace('</head>', `<script async nonce="${nonce}" src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-${adsensePublisherId}" crossorigin="anonymous"></script>\n</head>`);
  }
  if (analyticsToken) {
    out = out.replace('</body>', `<script defer nonce="${nonce}" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${analyticsToken}"}'></script></body>`);
  }
  const headers: Record<string, string> = {
    'Content-Type': 'text/html;charset=utf-8',
    'Content-Language': 'en',
    Vary: 'Accept-Encoding',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      // Scripts: nonce-based. AdSense/Turnstile/CF-Insights loaders are
      // injected above with the nonce, and 'strict-dynamic' lets the loaders
      // spawn their own child scripts (AdSense in particular) without each
      // child needing a nonce. The URL allowlist stays in place as a fallback
      // for CSP Level 2 browsers that don't understand 'strict-dynamic'. No
      // 'unsafe-inline' — any inline script missing the nonce is blocked.
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://pagead2.googlesyndication.com`,
      // Styles still allow 'unsafe-inline' — we use extensive style="..."
      // attribute styling in templates; converting every one to a class is a
      // separate lift and lower-ROI than the script tightening.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "connect-src 'self' https://challenges.cloudflare.com https://cloudflareinsights.com",
      "frame-src https://challenges.cloudflare.com https://googleads.g.doubleclick.net",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join('; '),
  };
  if (lastModifiedSec) {
    headers['Last-Modified'] = new Date(lastModifiedSec * 1000).toUTCString();
  }
  if (cacheControl) {
    headers['Cache-Control'] = cacheControl;
  } else if (lastModifiedSec) {
    headers['Cache-Control'] = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';
  } else if (status === 200) {
    headers['Cache-Control'] = 'public, max-age=60, s-maxage=60, stale-while-revalidate=3600';
  } else {
    headers['Cache-Control'] = 'no-store';
  }
  return new Response(out, { status, headers });
}

