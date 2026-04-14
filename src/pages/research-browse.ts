import type { Env, ResearchRow } from '../types';
import { layout } from '../lib/html';
import { timeAgo, escapeHtml, escapeLikeWildcards } from '../lib/utils';
import { searchBar } from './home';

export async function renderBrowse(url: URL, env: Env): Promise<string> {
  const searchQuery = url.searchParams.get('q') ?? '';
  const page = Math.min(Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1), 1000);
  const perPage = 12;
  const offset = (page - 1) * perPage;

  let rows: (ResearchRow & { product_count: number })[];

  if (searchQuery) {
    const escaped = `%${escapeLikeWildcards(searchQuery)}%`;
    const stmt = env.DB.prepare(
      `WITH ranked AS (
         SELECT r.*, ROW_NUMBER() OVER (PARTITION BY COALESCE(r.canonical_query, r.slug) ORDER BY r.created_at DESC) AS rn
         FROM research r
         WHERE r.status = 'complete' AND r.query LIKE ?1
           AND EXISTS (SELECT 1 FROM products p WHERE p.research_id = r.id)
           AND LENGTH(r.query) >= 10 AND r.query LIKE '% %'
       )
       SELECT *, (SELECT COUNT(*) FROM products WHERE products.research_id = ranked.id) AS product_count
       FROM ranked WHERE rn = 1
       ORDER BY created_at DESC LIMIT ?2 OFFSET ?3`
    ).bind(escaped, perPage + 1, offset);
    rows = (await stmt.all<ResearchRow & { product_count: number }>()).results ?? [];
  } else {
    const stmt = env.DB.prepare(
      `WITH ranked AS (
         SELECT r.*, ROW_NUMBER() OVER (PARTITION BY COALESCE(r.canonical_query, r.slug) ORDER BY r.created_at DESC) AS rn
         FROM research r
         WHERE r.status = 'complete'
           AND EXISTS (SELECT 1 FROM products p WHERE p.research_id = r.id)
           AND LENGTH(r.query) >= 10 AND r.query LIKE '% %'
       )
       SELECT *, (SELECT COUNT(*) FROM products WHERE products.research_id = ranked.id) AS product_count
       FROM ranked WHERE rn = 1
       ORDER BY created_at DESC LIMIT ?1 OFFSET ?2`
    ).bind(perPage + 1, offset);
    rows = (await stmt.all<ResearchRow & { product_count: number }>()).results ?? [];
  }

  const hasMore = rows.length > perPage;
  const results = rows.slice(0, perPage);

  const cards = results.map((r) => `<a href="/research/${escapeHtml(r.slug)}" class="card">
<div class="card-top">
${r.category ? `<span class="card-badge">${escapeHtml(r.category)}</span>` : '<span></span>'}
<span class="card-time">${timeAgo(r.created_at * 1000)}</span>
</div>
<h3>${escapeHtml(r.query)}</h3>
${r.summary ? `<p>${escapeHtml(r.summary)}</p>` : ''}
<div class="card-meta"><span>${r.product_count} products</span><span>${r.view_count} views</span></div>
</a>`).join('');

  const qs = searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : '';

  const body = `<div class="container" style="padding:3rem 1.5rem">
<nav aria-label="Breadcrumb" class="breadcrumb" style="font-size:.85rem;color:var(--text2);margin-bottom:1rem">
<a href="/" style="color:var(--text2)">Home</a>
<span aria-hidden="true" style="margin:0 .4rem;color:var(--text3)">/</span>
<span style="color:var(--text)">Research</span>
</nav>
<div class="page-header" style="margin-bottom:2rem">
<h1>Browse research</h1>
<p style="color:var(--text2);margin-bottom:1.5rem">Explore past product research or start your own.</p>
${searchBar('compact', env.TURNSTILE_SITE_KEY)}
</div>

${searchQuery ? `<div style="margin-bottom:1.5rem;display:flex;align-items:center;gap:.5rem;font-size:.85rem">
<span style="color:var(--text2)">Results for:</span>
<span class="card-badge">${escapeHtml(searchQuery)}</span>
<a href="/research" style="color:var(--text3);margin-left:.5rem;font-size:.85rem">Clear</a>
</div>` : ''}

${cards ? `<div class="grid">${cards}</div>` : `<div class="empty">
<div class="empty-icon"><svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg></div>
<h2>No research yet</h2>
<p>Be the first to research a product!</p>
</div>`}

${(page > 1 || hasMore) ? `<div class="pagination">
${page > 1 ? `<a href="/research?page=${page - 1}${qs}" class="btn btn-ghost">Previous</a>` : ''}
${hasMore ? `<a href="/research?page=${page + 1}${qs}" class="btn btn-ghost">Next</a>` : ''}
</div>` : ''}
</div>`;

  const canonical = '<link rel="canonical" href="https://chrisputer.tech/research">';
  const noindex = (page > 1 || searchQuery) ? '<meta name="robots" content="noindex, follow">' : '';
  const turnstileScript = env.TURNSTILE_SITE_KEY
    ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
    : '';

  const breadcrumbLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://chrisputer.tech/' },
      { '@type': 'ListItem', position: 2, name: 'Research', item: 'https://chrisputer.tech/research' },
    ],
  });
  const itemListLd = results.length > 0 ? JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Browse Research',
    description: 'AI-powered product research archive.',
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: results.map((r, i) => ({
        '@type': 'ListItem',
        position: offset + i + 1,
        url: `https://chrisputer.tech/research/${r.slug}`,
        name: r.query,
      })),
    },
  }) : '';
  const structuredData = `<script type="application/ld+json">${breadcrumbLd}</script>` +
    (itemListLd ? `<script type="application/ld+json">${itemListLd}</script>` : '');

  return layout('Browse Research', 'Explore past AI-powered product research.', body, canonical + noindex + turnstileScript + structuredData);
}
