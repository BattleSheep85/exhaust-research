import type { Tier, ClarifyingQuestion } from '../types';
// ClarifyingQuestion used below in renderClarifyPage; kept in the single import.
import { layout } from '../lib/html';
import { escapeHtml, displayQuery } from '../lib/utils';

// Interstitial page. After classifier accepts a Full/Exhaustive query and
// returns clarifying_questions, we render this instead of kicking off the
// pipeline. User picks chips (or types free-text), hits Run — form GETs
// /research/new with the original query + tier + one clarify_<key> param
// per question. Handler sees clarifications, skips this page, enqueues.

function renderQuestion(q: ClarifyingQuestion, idx: number): string {
  const inputName = `clarify_${escapeHtml(q.key)}`;
  const chips = q.suggested_answers.map((a, i) => {
    const id = `q${idx}_a${i}`;
    const escaped = escapeHtml(a);
    return `<label class="chip" for="${id}">
<input type="radio" id="${id}" name="${inputName}" value="${escaped}" data-chip>
<span>${escaped}</span>
</label>`;
  }).join('');
  return `<fieldset class="clarify-field" style="border:none;padding:0;margin:0 0 1.5rem">
<legend style="font-weight:600;color:var(--text);margin-bottom:.65rem">${escapeHtml(q.question)}</legend>
<div class="chip-row" style="display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.5rem">
${chips}
</div>
<input type="text" name="${inputName}_custom" placeholder="Or type your own answer" maxlength="80" data-custom aria-label="${escapeHtml(q.question)} — custom answer" style="width:100%;padding:.55rem .75rem;border-radius:8px;border:1px solid var(--surface2);background:var(--surface);color:var(--text);font-size:.9rem;font-family:var(--font);outline:none">
</fieldset>`;
}

export function renderClarifyPage(query: string, tier: Tier, questions: ClarifyingQuestion[], turnstileSiteKey?: string): string {
  const prettyQuery = displayQuery(query);
  const tierLabel = tier === 'full' ? 'Full' : tier === 'exhaustive' ? 'Deep Dive' : tier === 'unbound' ? 'Unbound' : 'Instant';
  const tierTime = tier === 'exhaustive' ? 'about 7 minutes' : tier === 'unbound' ? 'up to 30 minutes' : 'about 3 minutes';

  const body = `<div class="container" style="max-width:42rem;padding:3rem 1.5rem">
<nav aria-label="Breadcrumb" class="breadcrumb" style="font-size:.85rem;color:var(--text2);margin-bottom:1rem">
<a href="/" style="color:var(--text2)">Home</a>
<span aria-hidden="true" style="margin:0 .4rem;color:var(--text3)">/</span>
<span style="color:var(--text)">Quick questions</span>
</nav>

<h1 style="font-size:1.6rem;font-weight:800;margin-bottom:.6rem">A couple of questions first</h1>
<p style="color:var(--text2);margin-bottom:.35rem">Researching <strong style="color:var(--text)">&ldquo;${escapeHtml(prettyQuery)}&rdquo;</strong> as <strong style="color:var(--text)">${tierLabel}</strong> (${tierTime}).</p>
<p style="color:var(--text3);font-size:.88rem;margin-bottom:2rem">Your answers steer the pick. Skip any question to let the research engine choose defaults.</p>

<form action="/research/new" method="GET" class="clarify-form" id="clarify-form">
<input type="hidden" name="q" value="${escapeHtml(query)}">
<input type="hidden" name="tier" value="${escapeHtml(tier)}">
${questions.map(renderQuestion).join('')}

<div style="display:flex;gap:.5rem;margin-top:1rem;flex-wrap:wrap">
<button type="submit" class="btn" style="flex:1;min-width:10rem">Run ${escapeHtml(tierLabel)} research</button>
<button type="submit" name="skip_clarify" value="1" class="btn btn-ghost">Skip questions, use defaults</button>
</div>
</form>
</div>

<style>
.clarify-form .chip{display:inline-flex;align-items:center;padding:.45rem .85rem;border:1px solid var(--surface2);border-radius:999px;background:var(--surface);color:var(--text2);cursor:pointer;font-size:.85rem;font-weight:500;user-select:none;transition:border-color .15s,background .15s,color .15s}
.clarify-form .chip:hover{border-color:var(--surface3);color:var(--text)}
.clarify-form .chip input{position:absolute;opacity:0;pointer-events:none}
.clarify-form .chip:has(input:checked){border-color:var(--primary);background:var(--primary-dim);color:var(--primary-light)}
.clarify-form fieldset legend{font-size:.95rem}
</style>

<script nonce="__CSP_NONCE__">
(function(){
  // Custom-text override: typing in the free-text box clears the chip selection
  // for that question so the custom value wins on submit. Keeps form semantics
  // clean without needing JS-side value merging.
  document.querySelectorAll('.clarify-form fieldset').forEach(function(fs){
    var custom = fs.querySelector('input[data-custom]');
    if(!custom) return;
    custom.addEventListener('input', function(){
      if(custom.value.trim().length > 0){
        fs.querySelectorAll('input[data-chip]').forEach(function(r){ r.checked = false; });
      }
    });
    // If a chip is picked, clear any custom text so it doesn't accidentally
    // ride along to the server (server picks the _custom suffix over the chip
    // when both are present).
    fs.querySelectorAll('input[data-chip]').forEach(function(r){
      r.addEventListener('change', function(){
        if(r.checked && custom.value.trim().length > 0) custom.value = '';
      });
    });
  });
})();
</script>`;

  const turnstile = turnstileSiteKey
    ? '<script nonce="__CSP_NONCE__" src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
    : '';
  return layout(
    'Quick questions',
    `A few clarifying questions before we research "${prettyQuery}".`,
    body,
    '<meta name="robots" content="noindex, nofollow">' + turnstile,
    { ogUrl: `https://chrisputer.tech/research/new?q=${encodeURIComponent(query)}` },
  );
}

// Extract user-supplied clarifications from the URL searchParams. Scans the
// params directly for any clarify_<key> (or clarify_<key>_custom) — doesn't
// need the classifier to tell us the keys, which matters when the classifier
// fails open between the interstitial render and the form submit. The _custom
// suffix wins over the chip value when both are present.
export function extractClarifications(url: URL): Record<string, string> {
  const raw: Record<string, { chip?: string; custom?: string }> = {};
  for (const [name, value] of url.searchParams.entries()) {
    if (!name.startsWith('clarify_')) continue;
    const stripped = name.slice('clarify_'.length);
    const isCustom = stripped.endsWith('_custom');
    const key = (isCustom ? stripped.slice(0, -'_custom'.length) : stripped).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
    if (!key) continue;
    if (!raw[key]) raw[key] = {};
    const trimmed = value.trim().slice(0, 80);
    if (!trimmed) continue;
    if (isCustom) raw[key].custom = trimmed;
    else raw[key].chip = trimmed;
  }
  const out: Record<string, string> = {};
  let i = 0;
  for (const [key, { chip, custom }] of Object.entries(raw)) {
    if (i >= 5) break;
    const value = (custom && custom.length > 0) ? custom : chip;
    if (value && value.length > 0) {
      out[key] = value;
      i++;
    }
  }
  return out;
}

// Turn a clarifications map into a compact phrase appended to the raw query.
// "best mesh wifi" + {budget:"$200-500",household_size:"Large house"} →
// "best mesh wifi (budget: $200-500, household_size: Large house)"
// The synthesis prompt also receives the raw map as a structured block so the
// LLM sees the constraints in a cleaner format. The appended text is a belt
// for older pipeline layers (agent prompt building) that only see the query.
export function enrichQueryWithClarifications(query: string, clarifications: Record<string, string>): string {
  const entries = Object.entries(clarifications);
  if (entries.length === 0) return query;
  const suffix = entries.map(([k, v]) => `${k}: ${v}`).join(', ');
  return `${query} (${suffix})`;
}
