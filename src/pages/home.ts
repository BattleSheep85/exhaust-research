import type { Env, ResearchRow } from '../types';
import { layout, html, raw } from '../lib/html';
import { timeAgo, escapeHtml } from '../lib/utils';

function searchBar(size: 'large' | 'compact' = 'large', turnstileSiteKey?: string): string {
  const ph = size === 'large'
    ? 'What product are you researching?'
    : 'Research a product...';
  const turnstileWidget = turnstileSiteKey
    ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(turnstileSiteKey)}" data-theme="dark" data-size="compact" style="margin:0.75rem auto 0"></div>`
    : '';
  return `<form action="/research/new" method="GET" class="search-form">
<div class="search-glow"></div>
<div class="search-box">
<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
<input type="text" name="q" placeholder="${ph}" required aria-label="Search query">
<button type="submit">Research</button>
</div>
${turnstileWidget}
</form>`;
}

export { searchBar };

function researchCard(r: ResearchRow & { product_count: number }): string {
  return html`<a href="/research/${r.slug}" class="card">
<div class="card-top">
${raw(r.category ? `<span class="card-badge">${escapeHtml(r.category)}</span>` : '<span></span>')}
<span class="card-time">${timeAgo(r.created_at * 1000)}</span>
</div>
<h3>${r.query}</h3>
${raw(r.summary ? html`<p>${r.summary}</p>` : '')}
<div class="card-meta">
<span>${r.product_count} products</span>
<span>${r.view_count} views</span>
</div>
</a>`;
}

export async function renderHome(env: Env): Promise<string> {
  const recent = await env.DB.prepare(
    `SELECT r.*, (SELECT COUNT(*) FROM products WHERE products.research_id = r.id) AS product_count
     FROM research r WHERE r.status = 'complete' ORDER BY r.created_at DESC LIMIT 6`
  ).all<ResearchRow & { product_count: number }>();

  const popular = await env.DB.prepare(
    `SELECT r.*, (SELECT COUNT(*) FROM products WHERE products.research_id = r.id) AS product_count
     FROM research r WHERE r.status = 'complete' ORDER BY r.view_count DESC LIMIT 6`
  ).all<ResearchRow & { product_count: number }>();

  const recentCards = (recent.results ?? []).map(researchCard).join('');
  const popularCards = (popular.results ?? []).map(researchCard).join('');
  const tsKey = env.TURNSTILE_SITE_KEY;

  const body = `
<section class="hero container">
<div class="badge">&#9889; Powered by AI</div>
<h1>Product research, <em>exhaustive.</em></h1>
<p>Every source. Every angle. Every detail. We scrape dozens of sources, feed it all to AI, and give you brutally honest product comparisons. Nothing left unturned.</p>
${searchBar('large', tsKey)}
<div class="try-links">
<span>Try:</span>
<a href="/research/new?q=best+mechanical+keyboard+under+100">mechanical keyboards</a>
<a href="/research/new?q=best+home+NAS+for+2026">home NAS</a>
<a href="/research/new?q=best+budget+4k+monitor">4K monitors</a>
<a href="/research/new?q=best+mesh+wifi+system+2026">mesh WiFi</a>
</div>
</section>

<section class="container">
<div class="steps">
<div class="step">
<div class="step-icon"><svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg></div>
<h3>1. Ask anything</h3>
<p>Type a product question in plain English.</p>
</div>
<div class="step">
<div class="step-icon"><svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/></svg></div>
<h3>2. We go deep</h3>
<p>AI scrapes Reddit, reviews, forums, and specs.</p>
</div>
<div class="step">
<div class="step-icon"><svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></div>
<h3>3. Get answers</h3>
<p>Ranked products, honest pros/cons, and a clear verdict.</p>
</div>
</div>
</section>

${recentCards ? `<section class="container" style="padding:3rem 1.5rem">
<div class="section-header"><h2>Recent research</h2><a href="/research">View all &rarr;</a></div>
<div class="grid">${recentCards}</div>
</section>` : ''}

${popularCards ? `<section class="container" style="padding:3rem 1.5rem">
<div class="section-header"><h2>Most popular</h2></div>
<div class="grid">${popularCards}</div>
</section>` : ''}

<section class="container">
<div class="cta">
<h2>Stop guessing. Start knowing.</h2>
<p>Every research result is saved and shareable.</p>
${searchBar('compact', tsKey)}
</div>
</section>`;

  const websiteJsonLd = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Exhaustive',
    url: 'https://research.chrisputer.tech',
    description: 'AI-powered product research that goes deeper than any search engine.',
    potentialAction: {
      '@type': 'SearchAction',
      target: 'https://research.chrisputer.tech/research/new?q={search_term_string}',
      'query-input': 'required name=search_term_string',
    },
  })}</script>`;

  const canonical = '<link rel="canonical" href="https://research.chrisputer.tech/">';
  const turnstileScript = tsKey
    ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
    : '';
  return layout('AI-Powered Product Research', 'AI-powered product research that goes deeper than any search engine.', body, canonical + websiteJsonLd + turnstileScript);
}
