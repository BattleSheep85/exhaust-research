import type { Env } from './types';
import { renderHome } from './pages/home';
import { renderResearchResult } from './pages/research-result';
import { renderBrowse } from './pages/research-browse';
import { renderAbout } from './pages/about';
import { handleResearchPost } from './pages/api';
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

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html;charset=utf-8' },
  });
}

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#2563eb"/><text x="16" y="22" font-family="system-ui,sans-serif" font-size="16" font-weight="800" fill="#fff" text-anchor="middle">ER</text></svg>`;
