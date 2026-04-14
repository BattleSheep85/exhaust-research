import { escapeHtml } from './utils';

export interface LayoutMeta {
  ogUrl?: string;
  ogType?: string;
  ogImage?: string;
  twitterCard?: string;
}

// Tagged template literal for safe HTML — auto-escapes interpolated values
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let result = '';
  for (let i = 0; i < strings.length; i++) {
    result += strings[i];
    if (i < values.length) {
      const val = values[i];
      // Allow raw HTML from other html`` calls (marked with __html brand)
      if (val && typeof val === 'object' && '__html' in val) {
        result += (val as { __html: string }).__html;
      } else if (Array.isArray(val)) {
        // Join arrays (for .map() results that are already html-branded or strings)
        result += val
          .map((v) => (v && typeof v === 'object' && '__html' in v ? (v as { __html: string }).__html : escapeHtml(String(v ?? ''))))
          .join('');
      } else {
        result += escapeHtml(String(val ?? ''));
      }
    }
  }
  return result;
}

// Mark a string as safe raw HTML (use sparingly)
export function raw(s: string): { __html: string } {
  return { __html: s };
}

// Google truncates meta descriptions at ~160 chars. Cap at 155 to leave room for ellipsis.
function capDescription(desc: string): string {
  if (desc.length <= 155) return desc;
  const clipped = desc.slice(0, 155);
  const lastSpace = clipped.lastIndexOf(' ');
  const base = lastSpace > 100 ? clipped.slice(0, lastSpace) : clipped;
  return base.replace(/[\s.,;:!?-]+$/, '') + '…';
}

export function layout(title: string, description: string, body: string, extra_head = '', meta?: LayoutMeta): string {
  const escapedTitle = escapeHtml(title);
  const escapedDesc = escapeHtml(capDescription(description));
  const ogType = meta?.ogType ?? 'website';
  const ogUrl = meta?.ogUrl ? `\n<meta property="og:url" content="${escapeHtml(meta.ogUrl)}">` : '';
  const rawOgImage = meta?.ogImage ?? '/og-image.svg';
  const ogImage = rawOgImage.startsWith('http') ? rawOgImage : `https://chrisputer.tech${rawOgImage}`;
  const twitterCard = meta?.twitterCard ?? 'summary_large_image';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapedTitle} | Chrisputer Labs</title>
<meta name="description" content="${escapedDesc}">
<meta property="og:title" content="${escapedTitle} | Chrisputer Labs">
<meta property="og:description" content="${escapedDesc}">
<meta property="og:type" content="${ogType}">${ogUrl}
<meta property="og:site_name" content="Chrisputer Labs">
<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Chrisputer Labs — AI-powered product research">
<meta name="twitter:card" content="${twitterCard}">
<meta name="twitter:title" content="${escapedTitle} | Chrisputer Labs">
<meta name="twitter:description" content="${escapedDesc}">
<meta name="twitter:image" content="${escapeHtml(ogImage)}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/favicon.svg">
<meta name="theme-color" content="#2563eb">
<link rel="alternate" type="application/atom+xml" title="Chrisputer Labs — Research Feed" href="/feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"></noscript>
<style>${CSS}</style>
${extra_head}
</head>
<body>
<a href="#main" class="skip-link">Skip to main content</a>
<nav aria-label="Main navigation">
<div class="nav-inner">
<a href="/" class="logo"><span class="logo-mark">CL</span> Chrisputer Labs</a>
<button class="nav-toggle" aria-label="Toggle menu" aria-expanded="false" onclick="const n=this.nextElementSibling;const o=n.classList.toggle('open');this.setAttribute('aria-expanded',o)">
<span></span><span></span><span></span>
</button>
<div class="nav-links">
<a href="/research">Browse</a>
<a href="/about">About</a>
</div>
</div>
</nav>
<main id="main">${body}</main>
<footer>
<div class="footer-inner">
<span class="footer-brand"><span class="logo-mark sm">CL</span> Chrisputer Labs — every source, every angle, every detail</span>
<p class="footer-note">Product data from public sources. Affiliate links may earn commission at no cost to you.</p>
<p class="footer-note"><a href="/about">About</a> · <a href="/research">Browse</a> · <a href="/feed.xml" rel="alternate" type="application/atom+xml">Atom feed</a> · <a href="/sitemap.xml">Sitemap</a></p>
</div>
</footer>
</body>
</html>`;
}

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#020617;--surface:#0f172a;--surface2:#1e293b;--surface3:#334155;
  --text:#f1f5f9;--text2:#94a3b8;--text3:#64748b;
  --primary:#2563eb;--primary-light:#60a5fa;--primary-dim:rgba(37,99,235,.15);
  --success:#10b981;--danger:#ef4444;--warning:#f59e0b;
  --radius:12px;--font:'Inter',system-ui,sans-serif;
}
body{background:var(--bg);color:var(--text);font-family:var(--font);line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--primary-light);text-decoration:none}
a:hover{color:var(--text)}

nav{border-bottom:1px solid var(--surface2);background:rgba(2,6,23,.85);backdrop-filter:blur(16px);position:sticky;top:0;z-index:50}
.nav-inner{max-width:72rem;margin:0 auto;padding:0 1.5rem;display:flex;align-items:center;justify-content:space-between;height:4rem}
.logo{display:flex;align-items:center;gap:.75rem;font-weight:700;font-size:1.1rem;color:var(--text)}
.logo-mark{display:inline-flex;align-items:center;justify-content:center;width:2rem;height:2rem;border-radius:8px;background:var(--primary);color:#fff;font-size:.8rem;font-weight:800}
.logo-mark.sm{width:1.5rem;height:1.5rem;font-size:.6rem;border-radius:6px}
.nav-toggle{display:none;background:none;border:none;cursor:pointer;padding:.75rem;flex-direction:column;gap:5px;min-width:44px;min-height:44px;align-items:center;justify-content:center}
.nav-toggle span{display:block;width:22px;height:2px;background:var(--text2);border-radius:1px;transition:transform .2s,opacity .2s}
.nav-links{display:flex;gap:1.5rem}
.nav-links a{color:var(--text2);font-size:.9rem;font-weight:500}
.nav-links a:hover{color:var(--text)}
@media(max-width:480px){
.nav-toggle{display:flex}
.nav-links{display:none;position:absolute;top:4rem;right:0;left:0;background:var(--surface);border-bottom:1px solid var(--surface2);flex-direction:column;padding:1rem 1.5rem;gap:1rem}
.nav-links.open{display:flex}
}

main{min-height:calc(100vh - 8rem)}
footer{border-top:1px solid var(--surface2);padding:3rem 0;margin-top:auto}
.footer-inner{max-width:72rem;margin:0 auto;padding:0 1.5rem;text-align:center}
.footer-brand{color:var(--text3);font-size:.9rem;display:flex;align-items:center;justify-content:center;gap:.5rem}
.footer-note{color:var(--surface3);font-size:.75rem;margin-top:1.5rem}

.container{max-width:72rem;margin:0 auto;padding:0 1.5rem}
.hero{text-align:center;padding:5rem 1.5rem 3rem;position:relative}
.hero::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at top,rgba(37,99,235,.12),transparent 70%);pointer-events:none}
.hero h1{font-size:clamp(2rem,5vw,3.5rem);font-weight:800;letter-spacing:-.02em;margin-bottom:1rem}
.hero h1 em{font-style:normal;background:linear-gradient(135deg,var(--primary-light),var(--primary));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.hero p{color:var(--text2);font-size:1.15rem;max-width:38rem;margin:0 auto 2.5rem}
.badge{display:inline-flex;align-items:center;gap:.4rem;padding:.25rem .75rem;border-radius:99px;font-size:.8rem;font-weight:500;border:1px solid rgba(37,99,235,.25);color:var(--primary-light);background:var(--primary-dim);margin-bottom:1.5rem}

.search-form{max-width:42rem;margin:0 auto;position:relative}
.search-glow{position:absolute;inset:0;border-radius:1rem;background:rgba(37,99,235,.15);filter:blur(20px);pointer-events:none}
.search-box{position:relative;display:flex;align-items:center;background:var(--surface);border:1px solid var(--surface2);border-radius:1rem;transition:border-color .2s}
.search-box:focus-within{border-color:var(--primary)}
.search-box svg{margin-left:1.25rem;width:1.25rem;height:1.25rem;color:var(--text3);flex-shrink:0}
.search-box input{flex:1;min-width:0;background:none;border:none;outline:none;color:var(--text);font-size:1.1rem;padding:1.15rem 1rem;font-family:var(--font)}
.search-box input::placeholder{color:var(--text3)}
.search-box button{margin-right:.75rem;padding:.65rem 1.5rem;background:var(--primary);color:#fff;font-weight:600;border:none;border-radius:.75rem;cursor:pointer;font-size:.95rem;font-family:var(--font);white-space:nowrap}
.search-box button:hover{background:#1d4ed8}

.try-links{display:flex;flex-wrap:wrap;justify-content:center;gap:.5rem;margin-top:1.25rem;font-size:.85rem}
.try-links span{color:var(--text3)}
.try-links a{padding:.25rem .75rem;border-radius:99px;background:var(--surface2);color:var(--text2)}
.try-links a:hover{background:var(--surface3);color:var(--text)}

.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr));gap:2rem;padding:4rem 0;max-width:52rem;margin:0 auto}
.step{text-align:center}
.step-icon{width:3rem;height:3rem;border-radius:.75rem;background:var(--primary-dim);display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;color:var(--primary-light)}
.step h2{font-size:1rem;font-weight:600;margin-bottom:.4rem}
.step p{color:var(--text2);font-size:.9rem}

.section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:2rem}
.section-header h2{font-size:1.5rem;font-weight:700}
.section-header a{color:var(--primary-light);font-size:.9rem;font-weight:500}

.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,20rem),1fr));gap:1rem}

.card{background:var(--surface);border:1px solid var(--surface2);border-radius:var(--radius);padding:1.25rem;transition:border-color .2s,background .2s;display:block;color:inherit}
.card:hover{border-color:var(--surface3);background:rgba(30,41,59,.5)}
.card-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:.75rem}
.card-badge{font-size:.75rem;font-weight:500;padding:.15rem .6rem;border-radius:99px;background:var(--primary-dim);color:var(--primary-light)}
.card-time{font-size:.75rem;color:var(--text3)}
.card h3{font-size:1.1rem;font-weight:600;margin-bottom:.4rem;color:var(--text)}
.card p{color:var(--text2);font-size:.9rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-meta{display:flex;gap:1rem;margin-top:.75rem;font-size:.75rem;color:var(--text3)}

.product{background:var(--surface);border:1px solid var(--surface2);border-radius:var(--radius);padding:1.5rem;transition:border-color .2s}
.product:hover{border-color:var(--surface3)}
.product-header{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;margin-bottom:1rem}
.product-rank{font-size:.75rem;font-weight:700;padding:.15rem .5rem;border-radius:99px;border:1px solid}
.rank-1{background:rgba(234,179,8,.15);color:#facc15;border-color:rgba(234,179,8,.3)}
.rank-2{background:rgba(148,163,184,.15);color:#cbd5e1;border-color:rgba(148,163,184,.3)}
.rank-3{background:rgba(180,83,9,.15);color:#f59e0b;border-color:rgba(180,83,9,.3)}
.rank-n{background:rgba(51,65,85,.15);color:var(--text2);border-color:rgba(51,65,85,.3)}
.product-price{font-size:1.5rem;font-weight:700}
.product-rating{color:var(--warning);font-size:.85rem;margin-top:.25rem}
.product-bestfor{display:inline-block;margin-bottom:1rem;font-size:.8rem;font-weight:600;padding:.3rem .75rem;border-radius:8px;background:var(--primary-dim);color:var(--primary-light);border:1px solid rgba(37,99,235,.2)}
.product-verdict{color:var(--text2);font-size:.9rem;font-style:italic;border-left:2px solid var(--primary);padding-left:.75rem;margin-bottom:1rem}
.pros-cons{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem}
@media(max-width:600px){.pros-cons{grid-template-columns:1fr}}
.pros-cons h4{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.5rem}
.pros-cons h4.pro{color:var(--success)}
.pros-cons h4.con{color:var(--danger)}
.pros-cons li{font-size:.85rem;color:var(--text2);margin-bottom:.25rem;list-style:none;padding-left:1.2rem;position:relative}
.pros-cons li::before{position:absolute;left:0;font-weight:700}
.pros-cons .pro-list li::before{content:'✓';color:var(--success)}
.pros-cons .con-list li::before{content:'✕';color:var(--danger)}

.product-links{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1rem}
.product-link{display:inline-flex;align-items:center;gap:.35rem;padding:.5rem 1rem;font-weight:600;font-size:.85rem;border-radius:8px;border:none;cursor:pointer;font-family:var(--font);text-decoration:none}
.product-link-mfr{background:var(--surface2);color:var(--text2)}
.product-link-mfr:hover{background:var(--surface3);color:var(--text)}
.product-link-buy{background:var(--primary);color:#fff}
.product-link-buy:hover{background:#1d4ed8;color:#fff}

.btn{display:inline-flex;align-items:center;gap:.4rem;padding:.5rem 1rem;background:var(--primary);color:#fff;font-weight:600;font-size:.9rem;border-radius:8px;border:none;cursor:pointer;font-family:var(--font)}
.btn:hover{background:#1d4ed8;color:#fff}
.btn-ghost{background:var(--surface2);color:var(--text2)}
.btn-ghost:hover{background:var(--surface3);color:var(--text)}

.cta{background:linear-gradient(135deg,rgba(30,58,138,.8),rgba(37,99,235,.4));border:1px solid rgba(37,99,235,.3);border-radius:1rem;padding:3rem;text-align:center;margin:4rem 0}
.cta h2{font-size:1.5rem;font-weight:700;margin-bottom:.75rem}
.cta p{color:var(--primary-light);margin-bottom:1.5rem}

.spinner{width:2.5rem;height:2.5rem;border:3px solid var(--primary);border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 1rem}
@keyframes spin{to{transform:rotate(360deg)}}

.prose{max-width:48rem;color:var(--text2);line-height:1.8}
.prose h2{color:var(--text);font-size:1.25rem;font-weight:700;margin:2.5rem 0 1rem}
.prose p{margin-bottom:1rem}
.prose ul{margin-bottom:1rem}
.prose li{margin-bottom:.5rem;padding-left:.5rem}
.prose strong{color:var(--text)}

.empty{text-align:center;padding:5rem 0}
.empty-icon{width:4rem;height:4rem;border-radius:50%;background:var(--surface2);display:flex;align-items:center;justify-content:center;margin:0 auto 1.5rem;color:var(--text3)}
.empty h2{font-size:1.25rem;font-weight:600;margin-bottom:.5rem}
.empty p{color:var(--text2);margin-bottom:1.5rem}

.pagination{display:flex;justify-content:center;gap:.5rem;margin-top:2rem}

.back-link{color:var(--text3);font-size:.9rem;display:inline-flex;align-items:center;gap:.3rem;margin-bottom:1rem}
.back-link:hover{color:var(--text2)}

.summary-box{background:var(--surface);border:1px solid var(--surface2);border-radius:var(--radius);padding:1.5rem;margin-bottom:2rem}
.summary-box h2{font-size:1.1rem;font-weight:600;margin-bottom:.75rem}
.summary-box p{color:var(--text2)}

.page-header h1{font-size:clamp(1.5rem,4vw,2.5rem);font-weight:800;letter-spacing:-.02em;margin-bottom:.5rem}
.page-meta{display:flex;flex-wrap:wrap;gap:1rem;font-size:.85rem;color:var(--text3);margin-top:1rem}

.product-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,24rem),1fr));gap:1rem}
@media(max-width:600px){.product-grid{grid-template-columns:1fr}}

.sources{background:var(--surface);border:1px solid var(--surface2);border-radius:var(--radius);padding:1.5rem;margin-bottom:2rem}
.sources h3{font-size:.8rem;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.75rem}
.sources a{font-size:.85rem;word-break:break-all;display:block;margin-bottom:.3rem}

details>summary:focus-visible{outline:2px solid var(--primary);outline-offset:2px;border-radius:4px}

.skip-link{position:absolute;top:-40px;left:.5rem;background:var(--primary);color:#fff;padding:.5rem 1rem;border-radius:6px;text-decoration:none;font-weight:600;z-index:1000;transition:top .15s}
.skip-link:focus{top:.5rem;outline:2px solid #fff;outline-offset:2px}

.share-bar{display:flex;align-items:center;gap:.5rem;margin-top:1rem;flex-wrap:wrap}
.share-bar span{color:var(--text3);font-size:.85rem;font-weight:500}
.share-btn{display:inline-flex;align-items:center;gap:.35rem;padding:.35rem .75rem;border-radius:8px;font-size:.8rem;font-weight:500;border:1px solid var(--surface2);background:var(--surface);color:var(--text2);cursor:pointer;font-family:var(--font);transition:border-color .2s,color .2s}
.share-btn:hover{border-color:var(--surface3);color:var(--text)}
.share-btn svg{width:14px;height:14px;flex-shrink:0}

.ac-dropdown{display:none;position:absolute;top:100%;left:0;right:0;z-index:60;background:var(--surface);border:1px solid var(--surface2);border-radius:0 0 var(--radius) var(--radius);max-height:20rem;overflow-y:auto;margin-top:-1px}
.ac-item{display:flex;justify-content:space-between;align-items:center;padding:.65rem 1rem;color:var(--text);font-size:.9rem;border-bottom:1px solid rgba(30,41,59,.5);cursor:pointer;text-decoration:none}
.ac-item:last-child{border-bottom:none}
.ac-item:hover,.ac-item:focus{background:var(--surface2);color:var(--text)}
.ac-item .ac-cat{font-size:.7rem;padding:.1rem .5rem;border-radius:99px;background:var(--primary-dim);color:var(--primary-light);flex-shrink:0;margin-left:.5rem}

.tier-selector{display:flex;gap:.5rem;justify-content:center;margin-top:1rem;flex-wrap:wrap}
.tier-option{cursor:pointer}
.tier-option input{display:none}
.tier-card{display:flex;flex-direction:column;align-items:center;padding:.6rem 1.2rem;border-radius:.75rem;border:1px solid var(--surface2);background:var(--surface);transition:all .2s;min-width:7rem}
.tier-option input:checked+.tier-card{border-color:var(--primary);background:var(--primary-dim);box-shadow:0 0 12px rgba(37,99,235,.2)}
.tier-card:hover{border-color:var(--surface3)}
.tier-name{font-weight:600;font-size:.9rem;color:var(--text)}
.tier-desc{font-size:.7rem;color:var(--text3);margin-top:.15rem}
.tier-limit{font-size:.65rem;color:var(--warning);margin-top:.2rem;font-weight:500}
.tier-featured{border-color:rgba(37,99,235,.3)}
.tier-badge{display:inline-block;margin-left:.5rem;padding:.1rem .5rem;border-radius:99px;font-size:.7rem;font-weight:500;background:var(--primary-dim);color:var(--primary-light);vertical-align:middle}

.activity-feed{max-height:20rem;overflow-y:auto;font-size:.8rem;font-family:'Courier New',monospace;padding:.75rem;background:rgba(0,0,0,.3);border-radius:8px;border:1px solid var(--surface2)}
.activity-item{padding:.25rem 0;color:var(--text2);border-bottom:1px solid rgba(30,41,59,.5);line-height:1.5;word-break:break-word}
.activity-item:last-child{border-bottom:none}
.activity-search{color:var(--primary-light)}
.activity-fetch{color:var(--success)}
.activity-note{color:var(--warning)}
.activity-synthesize{color:var(--text)}
.activity-status{color:var(--text3)}
.activity-error{color:var(--danger)}
`;
