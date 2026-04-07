import { type Env, type ResearchRow, type ProductRow, DEFAULT_AFFILIATE_TAG } from '../types';
import { layout, html } from '../lib/html';
import { parseJsonSafe, isValidHttpUrl, escapeHtml } from '../lib/utils';
import { searchBar } from './home';

function renderProduct(p: ProductRow, affiliateTag: string): string {
  const pros = parseJsonSafe<string[]>(p.pros, []);
  const cons = parseJsonSafe<string[]>(p.cons, []);
  const specs = parseJsonSafe<Record<string, string>>(p.specs, {});
  const rankClass = p.rank === 1 ? 'rank-1' : p.rank === 2 ? 'rank-2' : p.rank === 3 ? 'rank-3' : 'rank-n';

  let url = p.affiliate_url || p.product_url || '';
  if (url && isValidHttpUrl(url) && url.includes('amazon.com')) {
    try {
      const u = new URL(url);
      u.searchParams.set('tag', affiliateTag);
      url = u.toString();
    } catch { /* keep original */ }
  }

  const prosHtml = pros.map((pr) => html`<li>${pr}</li>`).join('');
  const consHtml = cons.map((c) => html`<li>${c}</li>`).join('');
  const specsHtml = Object.entries(specs).map(([k, v]) => html`<dt style="color:var(--text3)">${k}</dt><dd>${v}</dd>`).join('');

  return `<article class="product">
<div class="product-header">
<div>
${p.rank != null ? `<span class="product-rank ${rankClass}">#${p.rank}</span>` : ''}
<h3 style="font-size:1.15rem;font-weight:700;color:var(--text);margin-top:.3rem">${escapeHtml(p.name)}</h3>
${p.brand ? `<p style="color:var(--text2);font-size:.85rem">${escapeHtml(p.brand)}</p>` : ''}
</div>
<div style="text-align:right;flex-shrink:0">
${p.price != null ? `<p class="product-price">$${p.price.toLocaleString()}</p>` : ''}
${p.rating != null ? `<p class="product-rating"><span aria-hidden="true">${'★'.repeat(Math.floor(p.rating))}${'☆'.repeat(5 - Math.floor(p.rating))}</span> <span>${p.rating}/5</span></p>` : ''}
</div>
</div>
${p.best_for ? `<div class="product-bestfor">Best for: ${escapeHtml(p.best_for)}</div>` : ''}
${p.verdict ? `<p class="product-verdict">${escapeHtml(p.verdict)}</p>` : ''}
${(pros.length > 0 || cons.length > 0) ? `<div class="pros-cons">
${pros.length > 0 ? `<div><h4 class="pro">Pros</h4><ul class="pro-list">${prosHtml}</ul></div>` : ''}
${cons.length > 0 ? `<div><h4 class="con">Cons</h4><ul class="con-list">${consHtml}</ul></div>` : ''}
</div>` : ''}
${specsHtml ? `<details><summary style="cursor:pointer;font-size:.85rem;color:var(--text3);font-weight:500">Specifications</summary>
<dl style="display:grid;grid-template-columns:1fr 1fr;gap:.3rem .75rem;font-size:.85rem;margin-top:.75rem;background:rgba(30,41,59,.5);padding:.75rem;border-radius:8px">${specsHtml}</dl></details>` : ''}
${url && isValidHttpUrl(url) ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow" class="btn" style="margin-top:1rem">View Deal <span aria-hidden="true">&#8599;</span></a>` : ''}
</article>`;
}

export async function renderResearchResult(slug: string, env: Env): Promise<Response | string> {
  const entry = await env.DB.prepare('SELECT * FROM research WHERE slug = ?').bind(slug).first<ResearchRow>();
  if (!entry) return new Response('Not found', { status: 404 });

  // Increment views only for completed research
  if (entry.status === 'complete') {
    await env.DB.prepare('UPDATE research SET view_count = view_count + 1 WHERE id = ?').bind(entry.id).run();
  }

  const productRows = await env.DB.prepare('SELECT * FROM products WHERE research_id = ? ORDER BY rank ASC').bind(entry.id).all<ProductRow>();
  const products = productRows.results ?? [];

  const isProcessing = entry.status === 'pending' || entry.status === 'processing';
  const isFailed = entry.status === 'failed';

  const resultData = parseJsonSafe<{ methodology?: string }>(entry.result, {});
  const sourceList = parseJsonSafe<string[]>(entry.sources, []).filter(isValidHttpUrl);

  const date = new Date(entry.created_at * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const affiliateTag = env.AMAZON_AFFILIATE_TAG || DEFAULT_AFFILIATE_TAG;

  const body = `<div class="container" style="max-width:64rem;padding:3rem 1.5rem">
<a href="/research" class="back-link">&larr; All research</a>
<div class="page-header">
<h1>${escapeHtml(entry.query)}</h1>
${entry.category ? `<span class="card-badge">${escapeHtml(entry.category)}</span>` : ''}
<div class="page-meta">
<span>${date}</span>
<span>${entry.view_count} views</span>
<span>${products.length} products compared</span>
</div>
</div>

${isProcessing ? `<div id="processing" style="text-align:center;padding:3rem;background:var(--surface);border:1px solid rgba(37,99,235,.3);border-radius:var(--radius);margin:2rem 0">
<div class="spinner"></div>
<h2 style="font-size:1.25rem;font-weight:600;margin-bottom:.5rem">Researching...</h2>
<p style="color:var(--text2)">Scraping sources and analyzing products. Usually 15-30 seconds.</p>
<button id="pause-refresh" class="pause-btn" type="button">Pause auto-refresh</button>
</div>` : ''}

${isFailed ? `<div style="padding:1.5rem;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:var(--radius);margin:2rem 0">
<h2 style="color:var(--danger);font-size:1.1rem;font-weight:600;margin-bottom:.5rem">Research failed</h2>
<p style="color:var(--text2)">Something went wrong during analysis. This could be due to insufficient source data.</p>
<a href="/research/new?q=${encodeURIComponent(entry.query)}" class="btn" style="margin-top:1rem">Try again</a>
</div>` : ''}

${entry.summary ? `<div class="summary-box"><h2>Summary</h2><p>${escapeHtml(entry.summary)}</p></div>` : ''}

${products.length > 0 ? `<h2 style="font-size:1.25rem;font-weight:700;margin-bottom:1.5rem">Products compared</h2>
<div class="product-grid">${products.map((p) => renderProduct(p, affiliateTag)).join('')}</div>` : ''}

${(resultData.methodology || sourceList.length > 0) ? `<div class="sources" style="margin-top:2rem">
${resultData.methodology ? `<h3>Methodology</h3><p style="font-size:.85rem;color:var(--text2);margin-bottom:1rem">${escapeHtml(resultData.methodology)}</p>` : ''}
${sourceList.length > 0 ? `<h3>Sources (${sourceList.length})</h3>${sourceList.map((u) => `<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">${escapeHtml(u)}</a>`).join('')}` : ''}
</div>` : ''}

<div style="margin-top:3rem;padding-top:2rem;border-top:1px solid var(--surface2)">
<h2 style="font-size:1.1rem;font-weight:600;margin-bottom:1rem">Research something else</h2>
${searchBar('compact', env.TURNSTILE_SITE_KEY)}
</div>
</div>`;

  const turnstileScript = env.TURNSTILE_SITE_KEY
    ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
    : '';
  const extra = isProcessing ? `<noscript><meta http-equiv="refresh" content="5"></noscript>
<script>
(function(){
  var t=setInterval(function(){location.reload()},5000);
  var btn=document.getElementById('pause-refresh');
  if(!btn)return;
  var paused=false;
  btn.addEventListener('click',function(){
    paused=!paused;
    if(paused){clearInterval(t);btn.textContent='Resume auto-refresh'}
    else{t=setInterval(function(){location.reload()},5000);btn.textContent='Pause auto-refresh'}
  });
})();
</script>` : '';
  return layout(entry.query, entry.summary ?? 'AI-powered product research', body, turnstileScript + extra);
}
