import type { Env, Tier } from './types';
import { renderHome } from './pages/home';
import { renderResearchResult } from './pages/research-result';
import { renderBrowse } from './pages/research-browse';
import { renderAbout } from './pages/about';
import { handleResearchPost, handleResearchEvents, handleSearchSuggest, handleSubscribe, verifyTurnstile } from './pages/api';
import { escapeHtml } from './lib/utils';
import { layout } from './lib/html';
import { getTierConfig, isValidTier } from './lib/research-config';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const response = await handleRequest(request, env, ctx);
    // HEAD: same headers/status as GET, body stripped. Done here (not per-route)
    // so link checkers, uptime monitors, and Googlebot prefetch all just work.
    if (request.method === 'HEAD') {
      return new Response(null, { status: response.status, headers: response.headers });
    }
    return response;
  },
} satisfies ExportedHandler<Env>;

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const at = env.CF_ANALYTICS_TOKEN;
    const adPub = env.ADSENSE_PUBLISHER_ID;

    // 301 redirect old subdomain to apex domain
    if (url.hostname === 'research.chrisputer.tech') {
      const dest = new URL(url.pathname + url.search, 'https://chrisputer.tech');
      return Response.redirect(dest.toString(), 301);
    }

    // www → apex redirect
    if (url.hostname === 'www.chrisputer.tech') {
      const dest = new URL(url.pathname + url.search, 'https://chrisputer.tech');
      return Response.redirect(dest.toString(), 301);
    }

    try {
      // Static files
      if (path === '/favicon.svg') {
        return new Response(FAVICON_SVG, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
      }

      if (path === '/og-image.svg') {
        return new Response(OG_IMAGE_SVG, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
      }

      if (path === '/robots.txt') {
        return new Response(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /research/new\n\nSitemap: ${url.origin}/sitemap.xml`, {
          headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=86400' },
        });
      }

      if (path === '/ads.txt') {
        const pubId = env.ADSENSE_PUBLISHER_ID;
        const body = pubId
          ? `google.com, ${pubId}, DIRECT, f08c47fec0942fa0`
          : '';
        return new Response(body, {
          headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=86400' },
        });
      }

      if (path === '/sitemap.xml') {
        return generateSitemap(url.origin, env);
      }

      if (path === '/feed.xml') {
        return generateAtomFeed(url.origin, env);
      }

      // API routes
      if (path === '/api/research' && request.method === 'POST') {
        return handleResearchPost(request, env, ctx);
      }

      // Events endpoint for activity feed polling
      const eventsMatch = path.match(/^\/api\/research\/([a-z0-9-]+)\/events$/);
      if (eventsMatch && request.method === 'GET') {
        return handleResearchEvents(eventsMatch[1], url, env);
      }

      // FTS5 autocomplete suggestions
      if (path === '/api/search/suggest' && request.method === 'GET') {
        return handleSearchSuggest(url, env);
      }

      // Email subscription for research notifications
      if (path === '/api/subscribe' && request.method === 'POST') {
        return handleSubscribe(request, env);
      }

      // Page routes: accept GET and HEAD. HEAD is transformed to a bodyless
      // response by the outer wrapper in `fetch`, so the handler can treat it
      // identically to GET.
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405 });
      }

      // Home (cached 5 min)
      if (path === '/' || path === '') {
        const cached = await env.CACHE.get('page:home');
        if (cached) return htmlResponse(cached, 200, at, adPub);
        const html = await renderHome(env);
        ctx.waitUntil(env.CACHE.put('page:home', html, { expirationTtl: 300 }));
        return htmlResponse(html, 200, at, adPub);
      }

      // Research new (triggers API then redirects)
      if (path === '/research/new') {
        return handleNewResearch(request, url, env, ctx, at, adPub);
      }

      // Research browse
      if (path === '/research' || path === '/research/') {
        return htmlResponse(await renderBrowse(url, env), 200, at, adPub);
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
        // ?from=<original query> marks a clustered hit — skip the KV cache so
        // the banner reflects the user's phrasing, not a prior visitor's.
        const fromQuery = url.searchParams.get('from');
        const cacheKey = `page:${slug}`;
        const cacheMetaKey = `page:${slug}:lm`;
        if (!fromQuery) {
          const [cached, cachedLm] = await Promise.all([
            env.CACHE.get(cacheKey),
            env.CACHE.get(cacheMetaKey),
          ]);
          if (cached) {
            const lm = cachedLm ? parseInt(cachedLm, 10) || undefined : undefined;
            return htmlResponse(cached, 200, at, adPub, lm);
          }
        }

        const result = await renderResearchResult(slug, env, fromQuery);
        if (result instanceof Response) return result;

        // Cache completed/failed pages (not actively processing, not banner variant)
        if (!fromQuery && !result.html.includes('id="processing"')) {
          ctx.waitUntil(env.CACHE.put(cacheKey, result.html, { expirationTtl: 3600 }));
          ctx.waitUntil(env.CACHE.put(cacheMetaKey, String(result.lastModified), { expirationTtl: 3600 }));
        }
        return htmlResponse(result.html, 200, at, adPub, result.lastModified);
      }

      // About
      if (path === '/about') {
        return htmlResponse(renderAbout(), 200, at, adPub);
      }

      // 404
      return htmlResponse(
        layout('Not Found', 'Page not found.', `<div class="container empty">
<h2>404 — Not Found</h2>
<p>The page you're looking for doesn't exist. Try browsing research or starting a new one.</p>
<div style="display:flex;gap:.5rem;margin-top:1.25rem;flex-wrap:wrap;justify-content:center">
<a href="/" class="btn">Go home</a>
<a href="/research" class="btn btn-ghost">Browse research</a>
</div>
</div>`, '<meta name="robots" content="noindex, follow">'),
        404, at, adPub,
      );
    } catch (error) {
      console.error('Unhandled error:', error);
      return htmlResponse(
        layout('Error', 'Something went wrong.', `<div class="container empty">
<h2>Something went wrong</h2>
<p>Please try again.</p>
<a href="/" class="btn" style="margin-top:1rem">Go home</a>
</div>`),
        500, at, adPub,
      );
    }
}

async function handleNewResearch(request: Request, url: URL, env: Env, ctx: ExecutionContext, analyticsToken?: string, adsensePub?: string): Promise<Response> {
  const query = url.searchParams.get('q')?.trim();
  if (!query) return Response.redirect(new URL('/', url.origin).toString(), 302);

  const tier = url.searchParams.get('tier') ?? 'instant';
  const validTier: Tier = isValidTier(tier) ? tier : 'instant';
  const tierConfig = getTierConfig(validTier);

  // Verify Turnstile — required for exhaustive tier, optional bot-check for others
  if (env.TURNSTILE_SECRET_KEY && tierConfig.requireTurnstile) {
    const token = url.searchParams.get('cf-turnstile-response') ?? '';
    if (!token || !(await verifyTurnstile(token, env.TURNSTILE_SECRET_KEY, '127.0.0.1'))) {
      return htmlResponse(
        layout('Verification Failed', 'CAPTCHA verification required for Deep Dive tier.', `<div class="container empty">
<h2>Verification failed</h2>
<p>Deep Dive research requires CAPTCHA verification. Please go back and try again.</p>
<a href="/" class="btn" style="margin-top:1rem">Go home</a>
</div>`),
        403, analyticsToken, adsensePub,
      );
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
      body: JSON.stringify({ query, tier, fresh: url.searchParams.get('fresh') === '1' }),
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

  // Error page
  let errorMsg = 'Something went wrong. Please try again.';
  try {
    const data: { error?: string } = await result.json();
    if (data.error && data.error.length < 200) errorMsg = data.error;
  } catch { /* use default */ }

  return htmlResponse(
    layout('Research Error', errorMsg, `<div class="container empty">
<h2>Something went wrong</h2>
<p>${escapeHtml(errorMsg)}</p>
<a href="/" class="btn" style="margin-top:1rem">Try again</a>
</div>`),
    result.status, analyticsToken, adsensePub,
  );
}

async function generateOgImage(slug: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT r.query, r.category, r.summary,
       (SELECT COUNT(*) FROM products WHERE products.research_id = r.id) AS product_count
     FROM research r WHERE r.slug = ?`
  ).bind(slug).first<{ query: string; category: string | null; summary: string | null; product_count: number }>();

  if (!row) {
    return new Response(OG_IMAGE_SVG, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
  }

  const title = escapeHtml(row.query.length > 60 ? row.query.slice(0, 57) + '...' : row.query);
  const category = row.category ? escapeHtml(row.category) : '';
  const subtitle = row.product_count > 0
    ? `${row.product_count} products compared`
    : 'AI-powered analysis';
  const summaryText = row.summary
    ? escapeHtml(row.summary.length > 120 ? row.summary.slice(0, 117) + '...' : row.summary)
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
<rect width="1200" height="630" fill="#020617"/>
<rect x="40" y="40" width="1120" height="550" rx="24" fill="#0f172a" stroke="#1e293b" stroke-width="2"/>
<rect x="80" y="80" width="64" height="64" rx="14" fill="#2563eb"/>
<text x="112" y="124" font-family="system-ui,sans-serif" font-size="28" font-weight="800" fill="#fff" text-anchor="middle">CL</text>
<text x="160" y="120" font-family="system-ui,sans-serif" font-size="28" font-weight="700" fill="#f1f5f9">Chrisputer Labs</text>
${category ? `<rect x="80" y="180" width="${category.length * 11 + 24}" height="32" rx="16" fill="rgba(37,99,235,0.15)"/>
<text x="92" y="201" font-family="system-ui,sans-serif" font-size="16" font-weight="500" fill="#60a5fa">${category}</text>` : ''}
<text x="80" y="${category ? '260' : '220'}" font-family="system-ui,sans-serif" font-size="42" font-weight="800" fill="#f1f5f9">${title}</text>
${summaryText ? `<text x="80" y="${category ? '310' : '270'}" font-family="system-ui,sans-serif" font-size="22" fill="#94a3b8">${summaryText}</text>` : ''}
<rect x="80" y="460" width="240" height="52" rx="12" fill="#2563eb"/>
<text x="200" y="493" font-family="system-ui,sans-serif" font-size="20" font-weight="600" fill="#fff" text-anchor="middle">${escapeHtml(subtitle)}</text>
<text x="1080" y="560" font-family="system-ui,sans-serif" font-size="16" fill="#64748b" text-anchor="end">chrisputer.tech</text>
</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

async function generateSitemap(origin: string, env: Env): Promise<Response> {
  // Only expose research pages with actual product cards. Honest-no-data results
  // (garbage queries, insufficient source data) are thin content and will hurt
  // ranking if Google crawls them.
  const rows = await env.DB.prepare(
    `WITH ranked AS (
       SELECT r.slug, r.created_at, COALESCE(r.completed_at, r.created_at) AS lastmod,
              ROW_NUMBER() OVER (PARTITION BY COALESCE(r.canonical_query, r.slug) ORDER BY r.created_at DESC) AS rn
       FROM research r
       WHERE r.status = 'complete'
         AND EXISTS (SELECT 1 FROM products p WHERE p.research_id = r.id)
         AND LENGTH(r.query) >= 10 AND r.query LIKE '% %'
     )
     SELECT slug, created_at, lastmod FROM ranked WHERE rn = 1
     ORDER BY created_at DESC
     LIMIT 5000`
  ).all<{ slug: string; created_at: number; lastmod: number }>();

  const entries = (rows.results ?? []).map((r) => {
    const date = new Date(r.lastmod * 1000).toISOString().split('T')[0];
    return `<url><loc>${origin}/research/${r.slug}</loc><lastmod>${date}</lastmod><changefreq>monthly</changefreq></url>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${origin}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
<url><loc>${origin}/research</loc><changefreq>daily</changefreq><priority>0.8</priority></url>
<url><loc>${origin}/about</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>
${entries}
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function generateAtomFeed(origin: string, env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `WITH ranked AS (
       SELECT r.slug, r.query, r.summary, r.created_at, COALESCE(r.completed_at, r.created_at) AS updated,
              ROW_NUMBER() OVER (PARTITION BY COALESCE(r.canonical_query, r.slug) ORDER BY r.created_at DESC) AS rn
       FROM research r
       WHERE r.status = 'complete'
         AND EXISTS (SELECT 1 FROM products p WHERE p.research_id = r.id)
         AND LENGTH(r.query) >= 10 AND r.query LIKE '% %'
     )
     SELECT slug, query, summary, created_at, updated FROM ranked WHERE rn = 1
     ORDER BY updated DESC
     LIMIT 50`
  ).all<{ slug: string; query: string; summary: string | null; created_at: number; updated: number }>();

  const results = rows.results ?? [];
  const latestUpdated = results[0]?.updated ?? Math.floor(Date.now() / 1000);
  const feedUpdated = new Date(latestUpdated * 1000).toISOString();

  const entries = results.map((r) => {
    const published = new Date(r.created_at * 1000).toISOString();
    const updated = new Date(r.updated * 1000).toISOString();
    const link = `${origin}/research/${r.slug}`;
    const summary = r.summary ? escapeXml(r.summary.slice(0, 500)) : '';
    return `<entry>
<id>${link}</id>
<title>${escapeXml(r.query)}</title>
<link href="${link}"/>
<published>${published}</published>
<updated>${updated}</updated>
<summary>${summary}</summary>
</entry>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Chrisputer Labs — Research Feed</title>
<link href="${origin}/feed.xml" rel="self"/>
<link href="${origin}/"/>
<id>${origin}/</id>
<updated>${feedUpdated}</updated>
<author><name>Chrisputer Labs</name></author>
<subtitle>Latest AI-powered product research</subtitle>
${entries}
</feed>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/atom+xml;charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}

function htmlResponse(body: string, status = 200, analyticsToken?: string, adsensePublisherId?: string, lastModifiedSec?: number): Response {
  let out = body;
  if (adsensePublisherId) {
    out = out.replace('</head>', `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-${adsensePublisherId}" crossorigin="anonymous"></script>\n</head>`);
  }
  if (analyticsToken) {
    out = out.replace('</body>', `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${analyticsToken}"}'></script></body>`);
  }
  const headers: Record<string, string> = {
    'Content-Type': 'text/html;charset=utf-8',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://pagead2.googlesyndication.com",
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
    headers['Cache-Control'] = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';
  } else if (status === 200) {
    headers['Cache-Control'] = 'public, max-age=60, s-maxage=60, stale-while-revalidate=3600';
  } else {
    headers['Cache-Control'] = 'no-store';
  }
  return new Response(out, { status, headers });
}

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#2563eb"/><text x="16" y="22" font-family="system-ui,sans-serif" font-size="14" font-weight="800" fill="#fff" text-anchor="middle">CL</text></svg>`;

const OG_IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
<rect width="1200" height="630" fill="#020617"/>
<rect x="40" y="40" width="1120" height="550" rx="24" fill="#0f172a" stroke="#1e293b" stroke-width="2"/>
<rect x="80" y="100" width="80" height="80" rx="16" fill="#2563eb"/>
<text x="120" y="158" font-family="system-ui,sans-serif" font-size="36" font-weight="800" fill="#fff" text-anchor="middle">CL</text>
<text x="180" y="155" font-family="system-ui,sans-serif" font-size="42" font-weight="700" fill="#f1f5f9">Chrisputer Labs</text>
<text x="80" y="280" font-family="system-ui,sans-serif" font-size="52" font-weight="800" fill="#f1f5f9">AI-Powered Product Research</text>
<text x="80" y="350" font-family="system-ui,sans-serif" font-size="28" fill="#94a3b8">20 years of IT expertise meets AI-driven analysis.</text>
<text x="80" y="400" font-family="system-ui,sans-serif" font-size="28" fill="#94a3b8">No fluff. No sponsored picks. Just the truth.</text>
<rect x="80" y="460" width="200" height="56" rx="12" fill="#2563eb"/>
<text x="180" y="496" font-family="system-ui,sans-serif" font-size="22" font-weight="600" fill="#fff" text-anchor="middle">Try it free</text>
</svg>`;
