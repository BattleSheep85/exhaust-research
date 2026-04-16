import type { Env } from '../types';
import { escapeHtml } from './utils';

type SlotKey = 'top' | 'mid' | 'bottom';

// Render a manual AdSense display ad unit. Returns empty string when either the
// publisher ID or the specific slot ID is missing — auto ads (loaded via the
// script tag in worker.ts:htmlResponse) continue to work either way. Manual
// slots are rendered with responsive auto-sizing; Google decides format.
export function adSlot(env: Env, key: SlotKey, label: string): string {
  const pub = env.ADSENSE_PUBLISHER_ID;
  if (!pub) return '';
  const slotId = key === 'top' ? env.ADSENSE_SLOT_TOP
    : key === 'mid' ? env.ADSENSE_SLOT_MID
    : env.ADSENSE_SLOT_BOTTOM;
  if (!slotId) return '';

  // min-height reserves layout space so cumulative layout shift stays zero
  // while the ad loads. "Advertisement" label is an AdSense policy requirement
  // adjacent to ad units on content sites.
  return `<aside class="ad-slot ad-slot-${key}" aria-label="Advertisement" style="margin:2rem 0;min-height:100px">
<div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);margin-bottom:.35rem;text-align:center">${escapeHtml(label)}</div>
<ins class="adsbygoogle" style="display:block" data-ad-client="ca-${escapeHtml(pub)}" data-ad-slot="${escapeHtml(slotId)}" data-ad-format="auto" data-full-width-responsive="true"></ins>
<script>(adsbygoogle=window.adsbygoogle||[]).push({})</script>
</aside>`;
}
