import { layout } from './html';
import { escapeHtml } from './utils';
import { searchBar } from '../pages/home';

// All error pages emit noindex so transient failure HTML never pollutes Google's
// index, and carry Browse / Home CTAs so visitors have an off-ramp.

export function renderNotFoundResearch(slug: string): string {
  const guessQuery = slug.replace(/-[a-f0-9]{8,}$/, '').replace(/-/g, ' ').trim();
  return layout('Research Not Found', 'No research exists at this URL. Browse the archive or start a new research query.', `<div class="container empty" style="padding:4rem 1.5rem;max-width:40rem;margin:0 auto;text-align:center">
<h2 style="font-size:1.5rem;margin-bottom:.75rem">Research not found</h2>
<p style="color:var(--text2);margin-bottom:1.5rem">No research exists at <code style="background:var(--surface);padding:.15rem .4rem;border-radius:4px">${escapeHtml(slug)}</code>. It may have been a shared link that was never completed, or the slug may be mistyped.</p>
${guessQuery ? `<p style="color:var(--text2);margin-bottom:1rem;font-size:.92rem">Did you mean to research <strong style="color:var(--text)">&ldquo;${escapeHtml(guessQuery)}&rdquo;</strong>?</p>
<div style="display:flex;gap:.5rem;flex-wrap:wrap;justify-content:center;margin-bottom:2rem">
<a href="/research/new?q=${encodeURIComponent(guessQuery)}" class="btn">Research &ldquo;${escapeHtml(guessQuery)}&rdquo;</a>
<a href="/research?q=${encodeURIComponent(guessQuery)}" class="btn btn-ghost">Search existing research</a>
</div>` : ''}
<div style="margin-top:1.5rem;padding-top:1.5rem;border-top:1px solid var(--surface2)">
<p style="color:var(--text3);font-size:.85rem;margin-bottom:.75rem">Or try a different query:</p>
${searchBar('compact')}
</div>
<div style="display:flex;gap:.5rem;flex-wrap:wrap;justify-content:center;margin-top:1.5rem">
<a href="/research" class="btn btn-ghost">Browse all research</a>
<a href="/" class="btn btn-ghost">Home</a>
</div>
</div>`, '<meta name="robots" content="noindex, follow">');
}

export function renderGeneric404(): string {
  return layout('Not Found', 'Page not found.', `<div class="container empty">
<h2>404 — Not Found</h2>
<p>The page you're looking for doesn't exist. Try browsing research or starting a new one.</p>
<div style="display:flex;gap:.5rem;margin-top:1.25rem;flex-wrap:wrap;justify-content:center">
<a href="/" class="btn">Go home</a>
<a href="/research" class="btn btn-ghost">Browse research</a>
</div>
</div>`, '<meta name="robots" content="noindex, follow">');
}

export function render500(turnstileSiteKey?: string): string {
  return layout('Error', 'Something went wrong. Browse existing research or head back home.', `<div class="container empty" style="padding:4rem 1.5rem;max-width:40rem;margin:0 auto;text-align:center">
<div class="empty-icon" style="background:rgba(239,68,68,.15);color:var(--danger)"><svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg></div>
<h2>Something went wrong</h2>
<p style="color:var(--text2);margin-bottom:1.5rem">Our end hit a snag. It's probably transient — try again, or poke around while we recover.</p>
${searchBar('compact', turnstileSiteKey)}
<div style="display:flex;gap:.5rem;margin-top:1.5rem;flex-wrap:wrap;justify-content:center">
<a href="/research" class="btn btn-ghost">Browse research</a>
<a href="/" class="btn btn-ghost">Go home</a>
</div>
</div>`, '<meta name="robots" content="noindex, nofollow">');
}

export function renderVerificationFailed(): string {
  return layout('Verification Failed', 'CAPTCHA verification required for Deep Dive tier.', `<div class="container empty">
<h2>Verification failed</h2>
<p>Deep Dive research requires CAPTCHA verification. Please go back and try again.</p>
<a href="/" class="btn" style="margin-top:1rem">Go home</a>
</div>`);
}

export function renderRejected(errorMsg: string, suggestedRefinement: string | null, turnstileSiteKey?: string): string {
  const refinementBlock = suggestedRefinement
    ? `<p style="color:var(--text2);margin-top:1rem;font-size:.9rem"><strong style="color:var(--text)">Try this instead:</strong> ${escapeHtml(suggestedRefinement)}</p>
<div style="margin-top:.75rem"><a href="/research/new?q=${encodeURIComponent(suggestedRefinement)}" class="btn">Research &ldquo;${escapeHtml(suggestedRefinement.slice(0, 60))}${suggestedRefinement.length > 60 ? '…' : ''}&rdquo;</a></div>`
    : '';
  return layout('Query declined', errorMsg, `<div class="container empty" style="max-width:40rem;margin:0 auto;padding:4rem 1.5rem">
<div class="empty-icon"><svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z"/></svg></div>
<h2>We couldn't research that</h2>
<p style="color:var(--text2);line-height:1.6">${escapeHtml(errorMsg)}</p>
${refinementBlock}
<div style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--surface2)">
<p style="color:var(--text3);font-size:.85rem;margin-bottom:.75rem">Or try a different query:</p>
${searchBar('compact', turnstileSiteKey)}
</div>
<div style="display:flex;gap:.5rem;flex-wrap:wrap;justify-content:center;margin-top:1.5rem">
<a href="/research" class="btn btn-ghost">Browse existing research</a>
<a href="/" class="btn btn-ghost">Home</a>
</div>
</div>`, '<meta name="robots" content="noindex, nofollow">');
}

export function renderRateLimited(errorMsg: string): string {
  return layout('Please slow down', errorMsg, `<div class="container empty">
<div class="empty-icon"><svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></div>
<h2>You&rsquo;ve hit the rate limit</h2>
<p>${escapeHtml(errorMsg)}</p>
<p style="color:var(--text2);margin-top:.5rem">While you wait, browse existing research — chances are someone else already asked something similar.</p>
<div style="display:flex;gap:.75rem;justify-content:center;margin-top:1.5rem;flex-wrap:wrap">
<a href="/research" class="btn">Browse research</a>
<a href="/" class="btn btn-ghost">Home</a>
</div>
</div>`, '<meta name="robots" content="noindex, nofollow">');
}

export function renderResearchError(errorMsg: string): string {
  return layout('Research Error', errorMsg, `<div class="container empty" style="max-width:40rem;margin:0 auto">
<div class="empty-icon"><svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg></div>
<h2>Something went wrong</h2>
<p>${escapeHtml(errorMsg)}</p>
<div style="margin-top:1.5rem;padding-top:1.5rem;border-top:1px solid var(--surface2)">
<p style="color:var(--text3);font-size:.85rem;margin-bottom:.75rem">Try a different query:</p>
${searchBar('compact')}
</div>
<div style="display:flex;gap:.5rem;flex-wrap:wrap;justify-content:center;margin-top:1.5rem">
<a href="/research" class="btn btn-ghost">Browse all research</a>
<a href="/" class="btn btn-ghost">Home</a>
</div>
</div>`, '<meta name="robots" content="noindex, nofollow">');
}
