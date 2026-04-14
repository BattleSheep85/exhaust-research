import type { Env, ResearchRow } from '../types';
import { layout, html, raw } from '../lib/html';
import { timeAgo, escapeHtml, displayQuery } from '../lib/utils';

function searchBar(size: 'large' | 'compact' = 'large', turnstileSiteKey?: string): string {
  const ph = size === 'large'
    ? 'What product are you researching?'
    : 'Research a product...';
  const turnstileWidget = turnstileSiteKey
    ? `<div id="turnstile-wrap" class="cf-turnstile" data-sitekey="${escapeHtml(turnstileSiteKey)}" data-theme="dark" data-size="compact" style="margin:0.75rem auto 0;display:none"></div>`
    : '';
  const tierSelector = size === 'large' ? `<div class="tier-selector" role="radiogroup" aria-label="Research depth">
<label class="tier-option">
<input type="radio" name="tier" value="instant" checked>
<div class="tier-card">
<span class="tier-name">Instant</span>
<span class="tier-desc">~30s &middot; 50 sources</span>
</div>
</label>
<label class="tier-option">
<input type="radio" name="tier" value="full">
<div class="tier-card">
<span class="tier-name">Full</span>
<span class="tier-desc">~30s &middot; 75+ sources</span>
</div>
</label>
<label class="tier-option">
<input type="radio" name="tier" value="exhaustive">
<div class="tier-card tier-featured">
<span class="tier-name">Deep Dive</span>
<span class="tier-desc">~5min &middot; 400+ sources</span>
<span class="tier-limit">5 free/day</span>
</div>
</label>
</div>` : '<input type="hidden" name="tier" value="instant">';

  const turnstileToggle = (size === 'large' && turnstileSiteKey)
    ? `<script>document.querySelectorAll('input[name="tier"]').forEach(function(r){r.addEventListener('change',function(){var w=document.getElementById('turnstile-wrap');if(w)w.style.display=this.value==='exhaustive'?'':'none'})})</script>`
    : '';

  const autocompleteScript = `<script>
(function(){
if(window.__acInit)return;window.__acInit=true;
var inputs=document.querySelectorAll('input[name="q"]');
inputs.forEach(function(input){
var box=input.closest('.search-box');
if(!box)return;
box.style.position='relative';
var dd=document.createElement('div');
dd.className='ac-dropdown';
box.appendChild(dd);
var t;
input.addEventListener('input',function(){
clearTimeout(t);
var q=input.value.trim();
if(q.length<2){dd.style.display='none';return}
t=setTimeout(function(){
fetch('/api/search/suggest?q='+encodeURIComponent(q))
.then(function(r){return r.json()})
.then(function(items){
if(!items.length){dd.style.display='none';return}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
dd.innerHTML=items.map(function(i){
return '<a class="ac-item" href="/research/'+encodeURIComponent(i.slug)+'"><span>'+esc(i.query)+'</span>'+(i.category?'<span class="ac-cat">'+esc(i.category)+'</span>':'')+'</a>'
}).join('');
dd.style.display='block'
}).catch(function(){dd.style.display='none'})
},200)
});
input.addEventListener('blur',function(){setTimeout(function(){dd.style.display='none'},200)});
input.addEventListener('focus',function(){if(dd.innerHTML&&input.value.trim().length>=2)dd.style.display='block'});
})
})();
</script>`;

  return `<form action="/research/new" method="GET" class="search-form">
<div class="search-glow"></div>
<div class="search-box">
<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
<input type="text" name="q" placeholder="${ph}" required aria-label="Search query" autocomplete="off">
<button type="submit">Research</button>
</div>
${tierSelector}
${turnstileWidget}
${turnstileToggle}
${autocompleteScript}
</form>`;
}

export { searchBar };

function researchCard(r: ResearchRow & { product_count: number }): string {
  return html`<a href="/research/${r.slug}" class="card">
<div class="card-top">
${raw(r.category ? `<span class="card-badge">${escapeHtml(r.category)}</span>` : '<span></span>')}
<span class="card-time">${timeAgo(r.created_at * 1000)}</span>
</div>
<h3>${displayQuery(r.query)}</h3>
${raw(r.summary ? html`<p>${r.summary}</p>` : '')}
<div class="card-meta">
<span>${r.product_count} products</span>
<span>${r.view_count} views</span>
</div>
</a>`;
}

export async function renderHome(env: Env): Promise<string> {
  const recent = await env.DB.prepare(
    `WITH ranked AS (
       SELECT r.*, ROW_NUMBER() OVER (PARTITION BY COALESCE(r.canonical_query, r.slug) ORDER BY r.created_at DESC) AS rn
       FROM research r
       WHERE r.status = 'complete'
         AND EXISTS (SELECT 1 FROM products p WHERE p.research_id = r.id)
         AND LENGTH(r.query) >= 10 AND r.query LIKE '% %'
     )
     SELECT *, (SELECT COUNT(*) FROM products WHERE products.research_id = ranked.id) AS product_count
     FROM ranked WHERE rn = 1
     ORDER BY created_at DESC LIMIT 6`
  ).all<ResearchRow & { product_count: number }>();

  const popular = await env.DB.prepare(
    `WITH ranked AS (
       SELECT r.*, ROW_NUMBER() OVER (PARTITION BY COALESCE(r.canonical_query, r.slug) ORDER BY r.view_count DESC, r.created_at DESC) AS rn
       FROM research r
       WHERE r.status = 'complete'
         AND EXISTS (SELECT 1 FROM products p WHERE p.research_id = r.id)
         AND LENGTH(r.query) >= 10 AND r.query LIKE '% %'
     )
     SELECT *, (SELECT COUNT(*) FROM products WHERE products.research_id = ranked.id) AS product_count
     FROM ranked WHERE rn = 1
     ORDER BY view_count DESC LIMIT 6`
  ).all<ResearchRow & { product_count: number }>();

  const recentRows = recent.results ?? [];
  const recentKeys = new Set(recentRows.map((r) => r.canonical_query ?? r.slug));
  const popularRows = (popular.results ?? []).filter((r) => !recentKeys.has(r.canonical_query ?? r.slug));
  const recentCards = recentRows.map(researchCard).join('');
  const popularCards = popularRows.map(researchCard).join('');
  const tsKey = env.TURNSTILE_SITE_KEY;

  const body = `
<section class="hero container">
<div class="badge">&#9889; Powered by AI</div>
<h1>Product research by <em>Chrisputer Labs</em></h1>
<p>20 years of IT expertise meets AI. We scrape dozens of sources, feed it all to AI, and give you brutally honest product comparisons backed by real-world experience.</p>
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
<h2>1. Ask anything</h2>
<p>Type a product question in plain English.</p>
</div>
<div class="step">
<div class="step-icon"><svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"/></svg></div>
<h2>2. We go deep</h2>
<p>AI scrapes Reddit, reviews, forums, and specs.</p>
</div>
<div class="step">
<div class="step-icon"><svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></div>
<h2>3. Get answers</h2>
<p>Ranked products, honest pros/cons, and a clear verdict.</p>
</div>
</div>
</section>

${recentCards ? `<section class="container" style="padding:3rem 1.5rem">
<div class="section-header"><h2>Recent research</h2><a href="/research">View all &rarr;</a></div>
<div class="grid">${recentCards}</div>
</section>` : ''}

${popularCards ? `<section class="container" style="padding:3rem 1.5rem">
<div class="section-header"><h2>Most popular</h2><a href="/research">View all &rarr;</a></div>
<div class="grid">${popularCards}</div>
</section>` : ''}

<section class="container" style="text-align:center;padding:2rem 1.5rem">
<a href="/research" class="btn" style="display:inline-flex;align-items:center;gap:.5rem">Browse all research <span aria-hidden="true">&rarr;</span></a>
</section>

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
    name: 'Chrisputer Labs',
    url: 'https://chrisputer.tech',
    description: 'AI-powered product research backed by 20 years of IT expertise.',
    publisher: { '@id': 'https://chrisputer.tech/#organization' },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: 'https://chrisputer.tech/research?q={search_term_string}',
      },
      'query-input': 'required name=search_term_string',
    },
  })}</script>`;
  const organizationJsonLd = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': 'https://chrisputer.tech/#organization',
    name: 'Chrisputer Labs',
    alternateName: 'Chrisputer',
    url: 'https://chrisputer.tech',
    logo: {
      '@type': 'ImageObject',
      url: 'https://chrisputer.tech/favicon.svg',
      width: 512,
      height: 512,
    },
    image: 'https://chrisputer.tech/og-image.svg',
    description: 'Zero-dependency AI-powered product research platform.',
    slogan: 'Product research by a human who cares, powered by AI.',
    foundingDate: '2025',
    knowsAbout: ['Product Research', 'Consumer Electronics', 'Homelab', 'Networking', 'IT Infrastructure'],
    founder: {
      '@type': 'Person',
      '@id': 'https://chrisputer.tech/about#chris',
      name: 'Chris',
      jobTitle: 'IT Professional & Homelab Enthusiast',
      url: 'https://chrisputer.tech/about',
    },
  })}</script>`;

  const canonical = '<link rel="canonical" href="https://chrisputer.tech/">';
  const turnstileScript = tsKey
    ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
    : '';
  return layout('AI-Powered Product Research', 'AI-powered product research backed by 20 years of IT expertise.', body, canonical + websiteJsonLd + organizationJsonLd + turnstileScript, { ogUrl: 'https://chrisputer.tech/' });
}
