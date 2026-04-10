import { layout } from '../lib/html';

export function renderAbout(): string {
  const canonical = '<link rel="canonical" href="https://chrisputer.tech/about">';
  return layout('About', 'About Exhaust Research — AI-powered product research.', `
<div class="container prose" style="padding:4rem 1.5rem;max-width:48rem;margin:0 auto">
<h1 style="font-size:2rem;font-weight:800;color:var(--text);margin-bottom:2rem">About Exhaust Research</h1>

<p style="font-size:1.1rem">Product research sucks. You Google something, get 10 SEO-optimized listicles that all recommend the same Amazon bestsellers, and walk away knowing less than when you started.</p>

<p>Exhaust Research was built to fix that. When you ask a question here, we don't just check one source — we scrape Reddit discussions, review sites, manufacturer specs, forums, and more. Then we feed everything to AI and get a brutally honest analysis.</p>

<h2>What makes this different</h2>

<ul>
<li><strong>Real sources.</strong> We pull from actual user discussions and reviews, not just manufacturer claims.</li>
<li><strong>No sponsored picks.</strong> We don't get paid to recommend products. Affiliate links exist, but they don't influence rankings.</li>
<li><strong>Honest cons.</strong> Every product has drawbacks. We tell you what they are instead of burying them.</li>
<li><strong>Shareable results.</strong> Every research report gets a permanent link you can bookmark or share.</li>
</ul>

<h2>Who built this</h2>

<p>I'm Chris — 20+ years in IT, Army veteran, homelab enthusiast. I got tired of doing the same manual research dance every time I needed to buy tech gear. So I built this tool for myself, then figured everyone else might want it too.</p>

<h2>Transparency</h2>

<p>This site uses Amazon Associates affiliate links. When you buy a product through one of our links, we earn a small commission at no extra cost to you. This helps keep the site running. Affiliate relationships never influence our product rankings or recommendations.</p>
</div>`, canonical);
}
