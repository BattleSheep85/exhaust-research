import { escapeHtml } from './utils';

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

export function layout(title: string, description: string, body: string, extra_head = ''): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} | Exhaust Research</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style>
${extra_head}
</head>
<body>
<nav aria-label="Main navigation">
<div class="nav-inner">
<a href="/" class="logo"><span class="logo-mark">ER</span> Exhaust Research</a>
<div class="nav-links">
<a href="/research">Browse</a>
<a href="/about">About</a>
</div>
</div>
</nav>
<main>${body}</main>
<footer>
<div class="footer-inner">
<span class="footer-brand"><span class="logo-mark sm">ER</span> Exhaust Research — AI-powered product intelligence</span>
<p class="footer-note">Product data from public sources. Affiliate links may earn commission at no cost to you.</p>
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
.nav-links{display:flex;gap:1.5rem}
.nav-links a{color:var(--text2);font-size:.9rem;font-weight:500}
.nav-links a:hover{color:var(--text)}

main{min-height:calc(100vh - 8rem)}
footer{border-top:1px solid var(--surface2);padding:3rem 0;margin-top:auto}
.footer-inner{max-width:72rem;margin:0 auto;padding:0 1.5rem;text-align:center}
.footer-brand{color:var(--text3);font-size:.9rem;display:flex;align-items:center;justify-content:center;gap:.5rem}
.footer-note{color:var(--surface3);font-size:.75rem;margin-top:1.5rem}

.container{max-width:72rem;margin:0 auto;padding:0 1.5rem}
.hero{text-align:center;padding:5rem 0 3rem;position:relative}
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
.search-box input{flex:1;background:none;border:none;outline:none;color:var(--text);font-size:1.1rem;padding:1.15rem 1rem;font-family:var(--font)}
.search-box input::placeholder{color:var(--text3)}
.search-box button{margin-right:.75rem;padding:.65rem 1.5rem;background:var(--primary);color:#fff;font-weight:600;border:none;border-radius:.75rem;cursor:pointer;font-size:.95rem;font-family:var(--font);white-space:nowrap}
.search-box button:hover{background:#1d4ed8}

.try-links{display:flex;flex-wrap:wrap;justify-content:center;gap:.5rem;margin-top:1.25rem;font-size:.85rem}
.try-links span{color:var(--text3)}
.try-links a{padding:.25rem .75rem;border-radius:99px;background:var(--surface2);color:var(--text2)}
.try-links a:hover{background:var(--surface3);color:var(--text)}

.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:2rem;padding:4rem 0;max-width:52rem;margin:0 auto}
.step{text-align:center}
.step-icon{width:3rem;height:3rem;border-radius:.75rem;background:var(--primary-dim);display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;color:var(--primary-light)}
.step h3{font-size:1rem;font-weight:600;margin-bottom:.4rem}
.step p{color:var(--text2);font-size:.9rem}

.section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:2rem}
.section-header h2{font-size:1.5rem;font-weight:700}
.section-header a{color:var(--primary-light);font-size:.9rem;font-weight:500}

.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(20rem,1fr));gap:1rem}

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

.product-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(24rem,1fr));gap:1rem}
@media(max-width:600px){.product-grid{grid-template-columns:1fr}}

.sources{background:var(--surface);border:1px solid var(--surface2);border-radius:var(--radius);padding:1.5rem;margin-bottom:2rem}
.sources h3{font-size:.8rem;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.75rem}
.sources a{font-size:.85rem;word-break:break-all;display:block;margin-bottom:.3rem}
`;
