import { layout } from '../lib/html';

export function renderAbout(): string {
  const canonical = '<link rel="canonical" href="https://chrisputer.tech/about">';
  const authorJsonLd = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    name: 'About Chrisputer Labs',
    url: 'https://chrisputer.tech/about',
    mainEntity: {
      '@type': 'Person',
      name: 'Chris',
      jobTitle: 'IT Professional & Homelab Enthusiast',
      description: '20+ years in IT, Army veteran, founder of Chrisputer Labs.',
      url: 'https://chrisputer.tech/about',
      worksFor: { '@id': 'https://chrisputer.tech/#organization' },
    },
  })}</script>`;
  return layout('About', 'About Chrisputer Labs — AI-powered product research backed by 20 years of IT expertise.', `
<div class="container prose" style="padding:4rem 1.5rem;max-width:48rem;margin:0 auto">
<h1 style="font-size:2rem;font-weight:800;color:var(--text);margin-bottom:2rem">About Chrisputer Labs</h1>

<p style="font-size:1.1rem">Product research sucks. You Google something, get 10 SEO-optimized listicles that all recommend the same Amazon bestsellers, and walk away knowing less than when you started.</p>

<p>Chrisputer Labs was built to fix that. When you ask a question here, we don't just check one source — we scrape Reddit discussions, review sites, manufacturer specs, forums, and more. Then we feed everything to AI and get a brutally honest analysis.</p>

<h2>What makes this different</h2>

<ul>
<li><strong>Real expertise.</strong> Built by someone with 20+ years in IT who actually uses this stuff daily — not a content farm.</li>
<li><strong>Real sources.</strong> We pull from actual user discussions and reviews, not just manufacturer claims.</li>
<li><strong>No sponsored picks.</strong> We don't get paid to recommend products. Affiliate links exist, but they don't influence rankings.</li>
<li><strong>Honest cons.</strong> Every product has drawbacks. We tell you what they are instead of burying them.</li>
<li><strong>Shareable results.</strong> Every research report gets a permanent link you can bookmark or share.</li>
</ul>

<h2>How the research works</h2>

<p>Every time you submit a query, Chrisputer Labs runs a multi-stage pipeline. First, a planner LLM decomposes your question into sub-queries — a request for "best budget mesh wifi" expands into separate searches for coverage, throughput, ease of setup, price, and common failure modes. Those sub-queries fan out across search engines, Reddit discussions, manufacturer spec sheets, RSS feeds from review sites, and (where available) YouTube descriptions.</p>

<p>The raw sources get scored and deduplicated. An agent loop takes notes as it reads, so the final synthesis has a grounded paper trail instead of a pile of fragments. The synthesis LLM is explicitly prompted to surface cons, call out marketing fluff, and skip products it can't verify from the sources — "we honestly don't have enough data" is a valid answer here. You'll see that outcome occasionally; it's intentional.</p>

<p>Results get cached so you don't pay for a re-run. If someone else has asked the same question (or a canonically equivalent one — "best keyboard under 100" and "budget keyboard recommendations" collapse to the same research) in the last 14 days, you get that existing report with a "Re-research with fresh data" button in case you want a fresh run anyway.</p>

<h2>Who built this</h2>

<p>I'm Chris — 20+ years in IT, Army veteran, homelab enthusiast. I've built and managed everything from enterprise networks to home server racks. I got tired of doing the same manual research dance every time I needed to buy tech gear. So I built Chrisputer Labs — combining my hands-on experience with AI-powered research to give you recommendations you can actually trust.</p>

<h2>What we don't do</h2>

<p>We don't fabricate product data. If the sources don't support a claim, it doesn't end up in the report. We don't rank products by commission rate. We don't republish manufacturer press releases as reviews. We don't submit queries without product-backed results to the sitemap — thin pages hurt everyone, so we filter them out of discovery.</p>

<h2>Transparency</h2>

<p>This site uses Amazon Associates affiliate links. When you buy a product through one of our links, we earn a small commission at no extra cost to you. This helps keep the site running. Affiliate relationships never influence our product rankings or recommendations.</p>

<p>Source code is intentionally zero-dependency — no npm, no package-lock, no node_modules. Every line is hand-written and auditable. That's a deliberate stance against supply-chain risk: you're reading a site where nothing was pulled from a registry that could be compromised.</p>
</div>`, canonical + authorJsonLd, { ogUrl: 'https://chrisputer.tech/about' });
}
