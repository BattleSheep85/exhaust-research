import { type Env, type ResearchRow, type ProductRow, type BuyersGuide, DEFAULT_AFFILIATE_TAG } from '../types';
import { layout, html, type LayoutMeta } from '../lib/html';
import { parseJsonSafe, isValidHttpUrl, escapeHtml, timeAgo } from '../lib/utils';
import { searchBar } from './home';

// Allowlist of retailer hostnames we recognize as "buy" destinations.
// Anything else (review sites, manufacturer pages, blogs) falls through to
// amazonSearchUrl so the user always lands on a real purchase page with our tag.
const BUY_HOSTS = [
  'amazon.com',
  'walmart.com',
  'bestbuy.com',
  'newegg.com',
  'target.com',
  'bhphotovideo.com',
  'adorama.com',
  'costco.com',
  'microcenter.com',
];

function buildAffiliateUrl(rawUrl: string, affiliateTag: string, walmartImpactId?: string): string {
  if (!rawUrl || !isValidHttpUrl(rawUrl)) return '';
  try {
    const host = new URL(rawUrl).hostname.replace(/^www\./, '');
    if (host === 'amazon.com' || host.endsWith('.amazon.com')) {
      const u = new URL(rawUrl);
      u.searchParams.set('tag', affiliateTag);
      return u.toString();
    }
    // Amazon short links (amzn.to, a.co) can't embed our tag — fall back to search.
    // Caller is expected to treat '' as "use amazonSearchUrl fallback".
    if (host === 'amzn.to' || host === 'a.co') {
      return '';
    }
    if (walmartImpactId && (host === 'walmart.com' || host.endsWith('.walmart.com'))) {
      return `https://goto.walmart.com/c/${encodeURIComponent(walmartImpactId)}/s/1?u=${encodeURIComponent(rawUrl)}`;
    }
    // Known retailer (non-affiliate) — keep the URL as-is; no tag to inject.
    if (BUY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
      return rawUrl;
    }
    // Unknown host (review site, blog, manufacturer) — reject so caller falls back to Amazon search.
    return '';
  } catch {
    return '';
  }
}

function amazonSearchUrl(productName: string, brand: string | null, affiliateTag: string): string {
  const q = [brand, productName].filter(Boolean).join(' ').trim();
  return `https://www.amazon.com/s?k=${encodeURIComponent(q)}&tag=${encodeURIComponent(affiliateTag)}`;
}

function googleSearchUrl(productName: string, brand: string | null): string {
  const q = [brand, productName].filter(Boolean).join(' ').trim();
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

// Categories where "Buy on Amazon" is nonsensical — services, local professionals,
// regional food, real estate, etc. These get a "Visit site" / "Search online" CTA
// instead of the Amazon-search fallback so the page doesn't look idiotic.
const NON_PRODUCT_CATEGORY_HINTS = [
  'real estate', 'realtor', 'realty', 'broker',
  'service', 'services', 'professional', 'professionals',
  'agent', 'agents', 'contractor', 'contractors',
  'plumber', 'plumbing', 'electrician', 'hvac',
  'attorney', 'lawyer', 'legal', 'law firm',
  'insurance', 'accountant', 'cpa', 'tax',
  'therapist', 'therapy', 'counselor', 'counseling',
  'doctor', 'dentist', 'clinic', 'hospital',
  'restaurant', 'bakery', 'cafe', 'food',
  'local', 'regional',
  'consultant', 'consulting', 'agency',
];

function isNonProductCategory(category: string | null): boolean {
  if (!category) return false;
  const c = category.toLowerCase();
  return NON_PRODUCT_CATEGORY_HINTS.some((h) => c.includes(h));
}

// User-generated content hosts get rel="ugc"; everything else gets plain nofollow.
// All outbound source links stay nofollow so we don't hand PageRank to competitors.
const UGC_HOSTS = ['reddit.com', 'stackoverflow.com', 'stackexchange.com', 'quora.com', 'news.ycombinator.com', 'medium.com', 'substack.com'];

function sourceRel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const isUgc = UGC_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
    return isUgc ? 'noopener noreferrer nofollow ugc' : 'noopener noreferrer nofollow';
  } catch {
    return 'noopener noreferrer nofollow';
  }
}

interface RelatedResearchRow {
  slug: string;
  query: string;
  category: string | null;
  canonical_query: string | null;
  view_count: number;
  created_at: number;
}

// Find up to 5 sibling research pages that share canonical tokens. Used to build
// the "Related research" block — internal links Google rewards for topical depth,
// and a browse nudge for users who land on a page from search.
async function getRelatedResearch(
  db: D1Database,
  currentSlug: string,
  canonical: string | null,
  category: string | null,
): Promise<Array<RelatedResearchRow & { score: number }>> {
  const tokens = (canonical ?? '').split(' ').filter((t) => t.length > 1).slice(0, 8);
  if (tokens.length === 0) return [];

  const likeClauses = tokens.map((_, i) => `canonical_query LIKE ?${i + 2}`).join(' OR ');
  const sql = `SELECT slug, query, category, canonical_query, view_count, created_at
               FROM research
               WHERE status = 'complete'
                 AND slug != ?1
                 AND canonical_query IS NOT NULL
                 AND canonical_query != ?${tokens.length + 2}
                 AND EXISTS (SELECT 1 FROM products p WHERE p.research_id = research.id)
                 AND (${likeClauses})
               ORDER BY view_count DESC
               LIMIT 50`;

  const binds: unknown[] = [currentSlug, ...tokens.map((t) => `%${t}%`), canonical ?? ''];
  const rows = await db.prepare(sql).bind(...binds).all<RelatedResearchRow>();
  const tokenSet = new Set(tokens);

  const scored = (rows.results ?? []).map((r) => {
    const otherTokens = new Set((r.canonical_query ?? '').split(' '));
    let shared = 0;
    for (const t of tokenSet) if (otherTokens.has(t)) shared++;
    const categoryBoost = category && r.category === category ? 1 : 0;
    return { ...r, score: shared * 2 + categoryBoost };
  });

  scored.sort((a, b) => (b.score - a.score) || (b.view_count - a.view_count));

  const seen = new Set<string>();
  const deduped: typeof scored = [];
  for (const s of scored) {
    const key = s.canonical_query ?? s.slug;
    if (seen.has(key)) continue;
    seen.add(key);
    if (s.score >= 2) deduped.push(s);
    if (deduped.length >= 5) break;
  }
  return deduped;
}

function retailerLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace('www.', '').replace('goto.', '');
    if (host.includes('amazon')) return 'Amazon';
    if (host.includes('walmart')) return 'Walmart';
    if (host.includes('bestbuy')) return 'Best Buy';
    if (host.includes('newegg')) return 'Newegg';
    if (host.includes('target')) return 'Target';
    if (host.includes('bhphoto') || host.includes('adorama')) return 'B&H Photo';
    return host.split('.')[0].charAt(0).toUpperCase() + host.split('.')[0].slice(1);
  } catch { return 'Retailer'; }
}

function renderProduct(p: ProductRow, affiliateTag: string, walmartImpactId: string | undefined, isService: boolean): string {
  const pros = parseJsonSafe<string[]>(p.pros, []);
  const cons = parseJsonSafe<string[]>(p.cons, []);
  const specs = parseJsonSafe<Record<string, string>>(p.specs, {});
  const rankClass = p.rank === 1 ? 'rank-1' : p.rank === 2 ? 'rank-2' : p.rank === 3 ? 'rank-3' : 'rank-n';

  // Manufacturer product page (non-affiliate, informational)
  const mfrUrl = p.manufacturer_url && isValidHttpUrl(p.manufacturer_url) ? p.manufacturer_url : '';

  // Buy/visit link. For product categories: try retailer, else fall back to Amazon
  // search with our affiliate tag. For service/professional categories: no Amazon
  // fallback — the LLM returned a named entity, not a SKU. Prefer mfr/site URL,
  // else a Google search for the name.
  const buyRaw = p.affiliate_url || p.product_url || '';
  let ctaUrl = '';
  let ctaLabel = '';
  let ctaRel = 'noopener noreferrer nofollow sponsored';
  let ctaIsSponsored = true;

  if (isService) {
    const serviceUrl = (mfrUrl || (buyRaw && isValidHttpUrl(buyRaw) ? buyRaw : ''));
    if (serviceUrl) {
      ctaUrl = serviceUrl;
      ctaLabel = 'Visit site';
    } else {
      ctaUrl = googleSearchUrl(p.name, p.brand);
      ctaLabel = 'Search online';
    }
    ctaRel = 'noopener noreferrer nofollow';
    ctaIsSponsored = false;
  } else {
    const affiliate = buildAffiliateUrl(buyRaw, affiliateTag, walmartImpactId);
    if (affiliate) {
      ctaUrl = affiliate;
      ctaLabel = `Buy on ${retailerLabel(affiliate)}`;
    } else {
      ctaUrl = amazonSearchUrl(p.name, p.brand, affiliateTag);
      ctaLabel = 'Buy on Amazon';
    }
  }

  const prosHtml = pros.map((pr) => html`<li>${pr}</li>`).join('');
  const consHtml = cons.map((c) => html`<li>${c}</li>`).join('');
  const specsHtml = Object.entries(specs).map(([k, v]) => html`<dt style="color:var(--text3)">${k}</dt><dd>${v}</dd>`).join('');

  // Build link section
  const links: string[] = [];
  if (mfrUrl && !(isService && ctaUrl === mfrUrl)) {
    links.push(`<a href="${escapeHtml(mfrUrl)}" target="_blank" rel="noopener noreferrer" class="product-link product-link-mfr">Product page <span aria-hidden="true">&#8599;</span></a>`);
  }
  if (ctaUrl && isValidHttpUrl(ctaUrl)) {
    const cls = ctaIsSponsored ? 'product-link product-link-buy' : 'product-link product-link-mfr';
    links.push(`<a href="${escapeHtml(ctaUrl)}" target="_blank" rel="${ctaRel}" class="${cls}">${escapeHtml(ctaLabel)} <span aria-hidden="true">&#8599;</span></a>`);
  }

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
${links.length > 0 ? `<div class="product-links">${links.join('')}</div>` : ''}
</article>`;
}

export interface RenderedResearch {
  html: string;
  lastModified: number; // Unix seconds — used for HTTP Last-Modified header
}

export async function renderResearchResult(slug: string, env: Env, fromQuery: string | null = null): Promise<Response | RenderedResearch> {
  const entry = await env.DB.prepare('SELECT * FROM research WHERE slug = ?').bind(slug).first<ResearchRow>();
  if (!entry) return new Response('Not found', { status: 404 });

  // Increment views only for completed research
  if (entry.status === 'complete') {
    await env.DB.prepare('UPDATE research SET view_count = view_count + 1 WHERE id = ?').bind(entry.id).run();
  }

  const productRows = await env.DB.prepare('SELECT * FROM products WHERE research_id = ? ORDER BY rank ASC').bind(entry.id).all<ProductRow>();
  const products = productRows.results ?? [];

  const related = entry.status === 'complete'
    ? await getRelatedResearch(env.DB, slug, entry.canonical_query, entry.category)
    : [];

  const isProcessing = entry.status === 'pending' || entry.status === 'processing';
  const isFailed = entry.status === 'failed';

  const resultData = parseJsonSafe<{ methodology?: string; buyersGuide?: BuyersGuide }>(entry.result, {});
  const buyersGuide = resultData.buyersGuide;
  const hasBuyersGuide = !!(buyersGuide && (buyersGuide.howToChoose || (buyersGuide.pitfalls?.length ?? 0) > 0 || (buyersGuide.marketingToIgnore?.length ?? 0) > 0));
  const isService = isNonProductCategory(entry.category);
  const sourceList = parseJsonSafe<string[]>(entry.sources, []).filter(isValidHttpUrl);

  const date = new Date(entry.created_at * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const lastModifiedTs = entry.completed_at ?? entry.created_at;
  const lastUpdatedLabel = new Date(lastModifiedTs * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const affiliateTag = env.AMAZON_AFFILIATE_TAG || DEFAULT_AFFILIATE_TAG;
  const walmartId = env.WALMART_IMPACT_ID;
  const pageUrl = `https://chrisputer.tech/research/${escapeHtml(slug)}`;
  const shareText = encodeURIComponent(entry.query);
  const shareUrl = encodeURIComponent(pageUrl);

  const body = `<div class="container" style="max-width:64rem;padding:3rem 1.5rem">
<nav aria-label="Breadcrumb" class="breadcrumb" style="font-size:.85rem;color:var(--text2);margin-bottom:1rem">
<a href="/" style="color:var(--text2)">Home</a>
<span aria-hidden="true" style="margin:0 .4rem;color:var(--text3)">/</span>
<a href="/research" style="color:var(--text2)">Research</a>
<span aria-hidden="true" style="margin:0 .4rem;color:var(--text3)">/</span>
<span style="color:var(--text)">${escapeHtml(entry.query)}</span>
</nav>
<div class="page-header">
<h1>${escapeHtml(entry.query)}</h1>
${entry.category ? `<span class="card-badge">${escapeHtml(entry.category)}</span>` : ''}
<div class="page-meta">
<span>Published ${date}</span>
${entry.completed_at && entry.completed_at !== entry.created_at ? `<span>Last updated ${lastUpdatedLabel}</span>` : ''}
<span>${entry.view_count} views</span>
<span>${products.length} products compared</span>
</div>
${entry.status === 'complete' ? `<div class="share-bar">
<span>Share:</span>
<a href="https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}" target="_blank" rel="noopener noreferrer" class="share-btn"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>Post</a>
<a href="https://reddit.com/submit?url=${shareUrl}&title=${shareText}" target="_blank" rel="noopener noreferrer" class="share-btn"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 01-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 01.042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 014.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 01.14-.197.35.35 0 01.238-.042l2.906.617a1.214 1.214 0 011.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 00-.231.094.33.33 0 000 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 000-.463.327.327 0 00-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 00-.232-.095z"/></svg>Reddit</a>
<button onclick="navigator.clipboard.writeText('${pageUrl}');this.textContent='Copied!';var b=this;setTimeout(function(){b.innerHTML='<svg viewBox=&quot;0 0 24 24&quot; fill=&quot;none&quot; stroke=&quot;currentColor&quot; style=&quot;width:14px;height:14px&quot;><path stroke-linecap=&quot;round&quot; stroke-linejoin=&quot;round&quot; stroke-width=&quot;2&quot; d=&quot;M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3&quot;/></svg>Copy link'},2000)" class="share-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>Copy link</button>
</div>` : ''}
</div>

${fromQuery && fromQuery !== entry.query ? `<div class="cluster-banner" style="padding:.9rem 1.15rem;background:rgba(37,99,235,.08);border:1px solid rgba(37,99,235,.3);border-radius:12px;margin:1.25rem 0;display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;justify-content:space-between">
<div style="font-size:.88rem;color:var(--text2);flex:1;min-width:0">
<strong style="color:var(--text)">Matched to existing research.</strong> You asked &ldquo;${escapeHtml(fromQuery)}&rdquo; — we already researched a very similar question (${date}).
</div>
<form action="/research/new" method="GET" style="margin:0"><input type="hidden" name="q" value="${escapeHtml(fromQuery)}"><input type="hidden" name="fresh" value="1"><button type="submit" class="btn" style="font-size:.82rem;padding:.5rem .85rem;white-space:nowrap">Re-research with fresh data</button></form>
</div>` : ''}

${isProcessing ? `<div id="processing" style="padding:1.5rem;background:var(--surface);border:1px solid rgba(37,99,235,.3);border-radius:var(--radius);margin:2rem 0">
<div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1rem">
<div class="spinner" style="width:1.5rem;height:1.5rem;border-width:2px;margin:0;flex-shrink:0"></div>
<div>
<h2 style="font-size:1.1rem;font-weight:600;margin-bottom:.15rem">Researching<span class="tier-badge">${escapeHtml(entry.tier ?? 'instant')}</span></h2>
<p style="color:var(--text3);font-size:.8rem" id="source-count">Starting...</p>
</div>
</div>
<div id="preview-box" style="display:none;padding:1rem 1.15rem;margin-bottom:1rem;background:linear-gradient(135deg,rgba(37,99,235,.08),rgba(167,139,250,.08));border:1px solid rgba(37,99,235,.25);border-radius:10px">
<div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);font-weight:600;margin-bottom:.5rem">Quick answer &middot; from prior knowledge</div>
<div id="preview-text" style="font-size:.92rem;line-height:1.55;color:var(--text2);white-space:pre-wrap"></div>
</div>
<div id="activity-feed" class="activity-feed"></div>
<div id="notify-form" style="margin-top:1rem;padding:1rem;background:rgba(37,99,235,.08);border-radius:8px">
<p style="font-size:.85rem;font-weight:500;margin-bottom:.5rem;color:var(--text2)">Get notified when this research is ready:</p>
<div style="display:flex;gap:.5rem">
<input type="email" id="notify-email" placeholder="your@email.com" style="flex:1;padding:.5rem .75rem;border-radius:8px;border:1px solid var(--surface2);background:var(--surface);color:var(--text);font-size:.85rem;font-family:var(--font);outline:none" aria-label="Email for notification">
<button id="notify-btn" onclick="var e=document.getElementById('notify-email'),b=this;if(!e.value||!e.value.includes('@'))return;b.disabled=true;b.textContent='...';fetch('/api/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e.value,researchId:'${escapeHtml(entry.id)}'})}).then(function(r){return r.json()}).then(function(d){if(d.ok){b.textContent='Subscribed!';e.disabled=true}else{b.textContent=d.error||'Error';b.disabled=false}}).catch(function(){b.textContent='Error';b.disabled=false})" class="btn" style="font-size:.85rem;padding:.5rem 1rem;white-space:nowrap">Notify me</button>
</div>
</div>
</div>` : ''}

${isFailed ? `<div style="padding:1.5rem;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:var(--radius);margin:2rem 0">
<h2 style="color:var(--danger);font-size:1.1rem;font-weight:600;margin-bottom:.5rem">Research failed</h2>
<p style="color:var(--text2)">Something went wrong during analysis. This could be due to insufficient source data.</p>
<a href="/research/new?q=${encodeURIComponent(entry.query)}" class="btn" style="margin-top:1rem">Try again</a>
</div>` : ''}

${entry.summary ? `<div class="summary-box"><h2>Summary</h2><p>${escapeHtml(entry.summary)}</p></div>` : ''}

${hasBuyersGuide && buyersGuide ? `<section class="buyers-guide" style="background:var(--surface);border:1px solid var(--surface2);border-radius:var(--radius);padding:1.5rem;margin-bottom:2rem">
<h2 style="font-size:1.1rem;font-weight:600;margin-bottom:1rem">Buyer's guide</h2>
${buyersGuide.howToChoose ? `<h3 style="font-size:.85rem;font-weight:600;color:var(--text);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.5rem">How to choose</h3>
<p style="color:var(--text2);font-size:.92rem;line-height:1.65;margin-bottom:1.25rem">${escapeHtml(buyersGuide.howToChoose)}</p>` : ''}
${(buyersGuide.pitfalls?.length ?? 0) > 0 ? `<h3 style="font-size:.85rem;font-weight:600;color:var(--warning);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.5rem">Common pitfalls</h3>
<ul style="color:var(--text2);font-size:.92rem;line-height:1.65;margin-bottom:1.25rem;padding-left:1.1rem">${buyersGuide.pitfalls.map((p) => `<li style="margin-bottom:.35rem">${escapeHtml(p)}</li>`).join('')}</ul>` : ''}
${(buyersGuide.marketingToIgnore?.length ?? 0) > 0 ? `<h3 style="font-size:.85rem;font-weight:600;color:var(--danger);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.5rem">Marketing to ignore</h3>
<ul style="color:var(--text2);font-size:.92rem;line-height:1.65;padding-left:1.1rem">${buyersGuide.marketingToIgnore.map((p) => `<li style="margin-bottom:.35rem">${escapeHtml(p)}</li>`).join('')}</ul>` : ''}
</section>` : ''}

${products.length > 0 ? `<h2 style="font-size:1.25rem;font-weight:700;margin-bottom:1.5rem">${isService ? 'Recommendations' : 'Products compared'}</h2>
<div class="product-grid">${products.map((p) => renderProduct(p, affiliateTag, walmartId, isService)).join('')}</div>` : ''}

${(resultData.methodology || sourceList.length > 0) ? `<div class="sources" style="margin-top:2rem">
${resultData.methodology ? `<h3>Methodology</h3><p style="font-size:.85rem;color:var(--text2);margin-bottom:1rem">${escapeHtml(resultData.methodology)}</p>` : ''}
${sourceList.length > 0 ? `<h3>Sources (${sourceList.length})</h3>${sourceList.map((u) => `<a href="${escapeHtml(u)}" target="_blank" rel="${sourceRel(u)}">${escapeHtml(u)}</a>`).join('')}` : ''}
</div>` : ''}

${related.length > 0 ? `<section class="related-research" style="margin-top:3rem;padding-top:2rem;border-top:1px solid var(--surface2)">
<h2 style="font-size:1.1rem;font-weight:600;margin-bottom:1rem">Related research</h2>
<div class="grid">${related.map((r) => `<a class="card" href="/research/${escapeHtml(r.slug)}">
${r.category ? `<div class="card-top"><span class="card-badge">${escapeHtml(r.category)}</span><span class="card-time">${timeAgo(r.created_at * 1000)}</span></div>` : `<div class="card-top"><span class="card-time">${timeAgo(r.created_at * 1000)}</span></div>`}
<h3>${escapeHtml(r.query)}</h3>
</a>`).join('')}</div>
</section>` : ''}

<div style="margin-top:3rem;padding-top:2rem;border-top:1px solid var(--surface2)">
<h2 style="font-size:1.1rem;font-weight:600;margin-bottom:1rem">Research something else</h2>
${searchBar('compact', env.TURNSTILE_SITE_KEY)}
</div>
</div>`;

  // JSON-LD structured data for SEO
  const isoDate = new Date(entry.created_at * 1000).toISOString();
  // priceValidUntil: 30 days from page's last completion (Google Product rich-snippet requirement)
  const priceValidUntil = new Date((lastModifiedTs + 30 * 86400) * 1000).toISOString().split('T')[0];
  const jsonLdProducts = products.map((p) => {
    const item: Record<string, unknown> = {
      '@type': 'Product',
      name: p.name,
    };
    if (p.brand) item.brand = { '@type': 'Brand', name: p.brand };
    const descSource = p.verdict || p.bestFor || (p.pros.length > 0 ? p.pros.slice(0, 3).join('. ') : '');
    if (descSource) item.description = descSource;
    if (p.price != null) {
      const offer: Record<string, unknown> = {
        '@type': 'Offer',
        price: p.price,
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
        priceValidUntil,
        url: pageUrl,
        seller: { '@type': 'Organization', name: 'Chrisputer Labs' },
      };
      item.offers = offer;
    }
    if (p.rating != null) item.aggregateRating = { '@type': 'AggregateRating', ratingValue: p.rating, bestRating: 5, worstRating: 0, reviewCount: 1 };
    if (p.verdict) {
      const review: Record<string, unknown> = {
        '@type': 'Review',
        reviewBody: p.verdict,
        author: { '@type': 'Organization', name: 'Chrisputer Labs' },
      };
      if (p.rating != null) review.reviewRating = { '@type': 'Rating', ratingValue: p.rating, bestRating: 5, worstRating: 0 };
      item.review = review;
    }
    return item;
  });

  const isoModified = new Date(lastModifiedTs * 1000).toISOString();
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: entry.query,
    description: entry.summary ?? '',
    datePublished: isoDate,
    dateModified: isoModified,
    author: { '@type': 'Organization', name: 'Chrisputer Labs', url: 'https://chrisputer.tech' },
    publisher: {
      '@type': 'Organization',
      name: 'Chrisputer Labs',
      url: 'https://chrisputer.tech',
      logo: { '@type': 'ImageObject', url: 'https://chrisputer.tech/og-image.svg' },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
    ...(jsonLdProducts.length > 0 ? { about: jsonLdProducts } : {}),
  });

  const breadcrumbLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://chrisputer.tech/' },
      { '@type': 'ListItem', position: 2, name: 'Research', item: 'https://chrisputer.tech/research' },
      { '@type': 'ListItem', position: 3, name: entry.query, item: pageUrl },
    ],
  });

  const structuredData = entry.status === 'complete'
    ? `<script type="application/ld+json">${jsonLd}</script><script type="application/ld+json">${breadcrumbLd}</script>`
    : '';

  const layoutMeta: LayoutMeta = {
    ogUrl: pageUrl,
    ogType: 'article',
    ogImage: `https://chrisputer.tech/research/${escapeHtml(slug)}/og.svg`,
    twitterCard: 'summary_large_image',
  };

  const turnstileScript = env.TURNSTILE_SITE_KEY
    ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
    : '';
  const activityFeedScript = `<noscript><meta http-equiv="refresh" content="10"></noscript>
<script>
document.addEventListener('DOMContentLoaded',function(){
  var feed=document.getElementById('activity-feed');
  var counter=document.getElementById('source-count');
  if(!feed)return;
  var slug='${escapeHtml(slug)}';
  var lastSeq=0;
  var sources=0;
  var pollCount=0;
  var icons={search:'\u{1F50D}',fetch:'\u{1F4D6}',note:'\u{1F4DD}',synthesize:'\u{2728}',status:'\u{2139}\uFE0F',error:'\u{26A0}\uFE0F'};
  function poll(){
    pollCount++;
    fetch('/api/research/'+slug+'/events?since='+lastSeq)
      .then(function(r){return r.json()})
      .then(function(d){
        if(d.preview){
          var box=document.getElementById('preview-box');
          var txt=document.getElementById('preview-text');
          if(box&&txt&&box.style.display==='none'){
            txt.textContent=d.preview;
            box.style.display='block';
          }
        }
        if(d.events&&d.events.length>0){
          d.events.forEach(function(e){
            var div=document.createElement('div');
            div.className='activity-item activity-'+e.event_type;
            div.textContent=(icons[e.event_type]||'\u{25CF}')+' '+e.message;
            feed.appendChild(div);
            feed.scrollTop=feed.scrollHeight;
            lastSeq=e.seq;
            if(e.event_type==='search')sources++;
          });
          if(counter)counter.textContent=sources+' searches completed';
        }
        if(d.status==='complete'){
          // In-place swap: fetch the now-rendered page, splice in .container content.
          // Falls back to reload if anything goes wrong.
          fetch(location.pathname,{cache:'no-store'})
            .then(function(r){return r.text()})
            .then(function(html){
              try{
                var parser=new DOMParser();
                var doc=parser.parseFromString(html,'text/html');
                var fresh=doc.querySelector('.container');
                var current=document.querySelector('.container');
                if(fresh&&current){
                  current.replaceWith(fresh);
                  document.title=doc.title;
                  window.scrollTo({top:0,behavior:'smooth'});
                }else{location.reload()}
              }catch(e){location.reload()}
            })
            .catch(function(){location.reload()});
        }else if(d.status==='failed'){
          var div=document.createElement('div');
          div.className='activity-item activity-error';
          div.textContent='\u{26A0}\uFE0F Research failed. Reloading...';
          feed.appendChild(div);
          setTimeout(function(){location.reload()},2000);
        }else{
          setTimeout(poll,pollCount<3?500:1000);
        }
      })
      .catch(function(){setTimeout(poll,3000)});
  }
  poll();
});
</script>`;
  const extra = isProcessing ? activityFeedScript : '';
  const canonical = `<link rel="canonical" href="https://chrisputer.tech/research/${escapeHtml(slug)}">`;
  const htmlOut = layout(entry.query, entry.summary ?? 'AI-powered product research', body, canonical + structuredData + turnstileScript + extra, layoutMeta);
  return { html: htmlOut, lastModified: lastModifiedTs };
}
