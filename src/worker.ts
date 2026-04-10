import type { Env } from './types';
import { renderHome } from './pages/home';
import { renderResearchResult } from './pages/research-result';
import { renderBrowse } from './pages/research-browse';
import { renderAbout } from './pages/about';
import { handleResearchPost, verifyTurnstile } from './pages/api';
import { escapeHtml } from './lib/utils';
import { layout } from './lib/html';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

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

      if (path === '/sitemap.xml') {
        return generateSitemap(url.origin, env);
      }

      // API routes
      if (path === '/api/research' && request.method === 'POST') {
        return handleResearchPost(request, env, ctx);
      }

      // Page routes (GET only)
      if (request.method !== 'GET') {
        return new Response('Method not allowed', { status: 405 });
      }

      // Home
      if (path === '/' || path === '') {
        return htmlResponse(await renderHome(env));
      }

      // Research new (triggers API then redirects)
      if (path === '/research/new') {
        return handleNewResearch(url, env, ctx);
      }

      // Research browse
      if (path === '/research' || path === '/research/') {
        return htmlResponse(await renderBrowse(url, env));
      }

      // Research result
      const slugMatch = path.match(/^\/research\/([a-z0-9-]+)$/);
      if (slugMatch) {
        const result = await renderResearchResult(slugMatch[1], env);
        if (result instanceof Response) return result;
        return htmlResponse(result);
      }

      // About
      if (path === '/about') {
        return htmlResponse(renderAbout());
      }

      // 404
      return htmlResponse(
        layout('Not Found', 'Page not found.', `<div class="container empty">
<h2>404 — Not Found</h2>
<p>The page you're looking for doesn't exist.</p>
<a href="/" class="btn" style="margin-top:1rem">Go home</a>
</div>`),
        404,
      );
    } catch (error) {
      console.error('Unhandled error:', error);
      return htmlResponse(
        layout('Error', 'Something went wrong.', `<div class="container empty">
<h2>Something went wrong</h2>
<p>Please try again.</p>
<a href="/" class="btn" style="margin-top:1rem">Go home</a>
</div>`),
        500,
      );
    }
  },
} satisfies ExportedHandler<Env>;

async function handleNewResearch(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const query = url.searchParams.get('q')?.trim();
  if (!query) return Response.redirect(new URL('/', url.origin).toString(), 302);

  // Verify Turnstile if configured
  if (env.TURNSTILE_SECRET_KEY) {
    const token = url.searchParams.get('cf-turnstile-response') ?? '';
    const ip = '127.0.0.1'; // Internal, Turnstile uses its own IP detection
    if (!token || !(await verifyTurnstile(token, env.TURNSTILE_SECRET_KEY, ip))) {
      return htmlResponse(
        layout('Verification Failed', 'CAPTCHA verification failed.', `<div class="container empty">
<h2>Verification failed</h2>
<p>Please go back and try again.</p>
<a href="/" class="btn" style="margin-top:1rem">Go home</a>
</div>`),
        403,
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
        'CF-Connecting-IP': '127.0.0.1', // Internal request
      },
      body: JSON.stringify({ query }),
    }),
    env,
    ctx,
  );

  if (result.ok) {
    const data: { slug: string } = await result.json();
    return Response.redirect(new URL(`/research/${data.slug}`, url.origin).toString(), 302);
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
    result.status,
  );
}

async function generateSitemap(origin: string, env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT slug, created_at FROM research WHERE status = 'complete' ORDER BY created_at DESC LIMIT 5000`
  ).all<{ slug: string; created_at: number }>();

  const entries = (rows.results ?? []).map((r) => {
    const date = new Date(r.created_at * 1000).toISOString().split('T')[0];
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

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html;charset=utf-8' },
  });
}

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#2563eb"/><text x="16" y="22" font-family="system-ui,sans-serif" font-size="16" font-weight="800" fill="#fff" text-anchor="middle">Ex</text></svg>`;

const OG_IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
<rect width="1200" height="630" fill="#020617"/>
<rect x="40" y="40" width="1120" height="550" rx="24" fill="#0f172a" stroke="#1e293b" stroke-width="2"/>
<rect x="80" y="100" width="80" height="80" rx="16" fill="#2563eb"/>
<text x="120" y="158" font-family="system-ui,sans-serif" font-size="40" font-weight="800" fill="#fff" text-anchor="middle">Ex</text>
<text x="180" y="155" font-family="system-ui,sans-serif" font-size="42" font-weight="700" fill="#f1f5f9">Exhaustive</text>
<text x="80" y="280" font-family="system-ui,sans-serif" font-size="52" font-weight="800" fill="#f1f5f9">AI-Powered Product Research</text>
<text x="80" y="350" font-family="system-ui,sans-serif" font-size="28" fill="#94a3b8">Brutally honest comparisons from real sources.</text>
<text x="80" y="400" font-family="system-ui,sans-serif" font-size="28" fill="#94a3b8">No fluff. No sponsored picks. Just the truth.</text>
<rect x="80" y="460" width="200" height="56" rx="12" fill="#2563eb"/>
<text x="180" y="496" font-family="system-ui,sans-serif" font-size="22" font-weight="600" fill="#fff" text-anchor="middle">Try it free</text>
</svg>`;
