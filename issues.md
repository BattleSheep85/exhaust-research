# Issues

Last updated: 2026-04-14 (keep-improving R33)

## SEO / Affiliate Surface (from discovery loop #2, 2026-04-14)

Audited 4 live research pages (keyboard, NAS, realtor, candy). Every single page
has zero internal links to other research pages. All 30+ "Sources" are followed
(no `nofollow`) and many point to direct SERP competitors (PCMag, Wirecutter,
RTINGS, fastexpert, remax). Realtor/candy pages prove the system handles local
service queries — but with nonsensical "Buy on Amazon" CTAs.

- [x] HIGH: Zero internal research→research links on result pages — added "Related research" block computed from `canonical_query` token overlap (top 5 sibling pages, scored by shared tokens + category match). `getRelatedResearch` in research-result.ts
- [x] HIGH: `<a>` tags in Sources list missing `rel="nofollow"` — added `sourceRel(url)` helper that emits `nofollow ugc` for Reddit/StackExchange/Quora/HN/Medium/Substack and plain `nofollow` elsewhere
- [x] MEDIUM: Non-product queries triggered Amazon search fallback — added `isNonProductCategory` heuristic (realtor/service/professional/local keyword match); service pages now show "Visit site" (mfr URL) or "Search online" (Google) instead of affiliate CTA
- [x] MEDIUM: Meta descriptions up to 464 chars — added `capDescription` in html.ts that trims at last word boundary under 155 chars and appends ellipsis
- [x] MEDIUM: ~900-word pages vs 2000-3500 competitor reviews — synthesis prompt now requires a `buyersGuide` object (howToChoose + pitfalls + marketingToIgnore); rendered between summary and products
- [x] LOW: No "Last refreshed" signal — added visible "Last updated" line in page meta (when different from created_at) and `Last-Modified` HTTP header derived from `completed_at`
- [x] LOW: Local-service queries — **decision: lean in.** Service categories (realtor/contractor/professional/local) now render a dedicated CTA via `isNonProductCategory` + "Visit site"/"Search online" fallback in research-result.ts. No input validation added — the surface is a free acquisition channel for long-tail SEO, and adding a category gate would reject queries the pipeline handles well. If service pages start ranking, productize per-category CTAs (quote request, directory links) as a follow-up.

## Perceived Speed (from discovery loop, 2026-04-14)

Observed on the instant-tier run `best-budget-mechanical-keyboard-under-100-2acfbd26`:
total submit→result = 21s. Scrape phase has healthy ~1s event beats; synthesis phase has
one unexplained 6s black-box gap ("Writing final report..." → "Report complete").
Plus 1500ms post-complete delay + full page reload at the end.

- [x] HIGH: Synthesis is a 6s black box — added SSE streaming in `callLLMStreaming` with per-chunk watchdog, emits per-product "Writing section: X" events as JSON arrives; falls back to non-streaming if parse fails
- [x] HIGH: Post-complete reload is 1500ms + full HTML fetch — replaced with in-place DOM swap via DOMParser in `src/pages/research-result.ts`; reload preserved as error fallback
- [x] MEDIUM: Agent note-taking is sparse — strengthened prompt to require `note()` per source with "1 note per 3 sources" target; observed run jumped from 3 notes to 5 notes and from 3 products to 5 products
- [x] MEDIUM: 1s polling interval dominates first-event latency — first 2 polls now 500ms, subsequent 1000ms; first-event observed dropped ~2226ms → ~1168ms
- [x] LOW: Parallel quick-answer preview — `generatePreview()` fires a 3s LLM call from prior knowledge in parallel with the scrape; shown above activity feed once available
- [x] LOW: Query-clustering cache — canonical form (stopwords/years/prices stripped, sorted) in new `research.canonical_query` column; matching canonical within 14d serves existing slug with "Re-research with fresh data" CTA

## Security

- [x] HIGH: API key was in wrangler vars block — moved to secrets only
- [x] HIGH: No CSRF protection on POST endpoint — added Origin header check
- [x] HIGH: No application-level rate limiting — added IP-based rate limiter in D1
- [x] HIGH: Unvalidated AI JSON output trusted blindly — added manual schema validation
- [x] HIGH: Unvalidated URLs rendered as href links — added isValidHttpUrl checks
- [x] CRITICAL: Error handler could throw leaving research stuck — wrapped in try/catch
- [x] MEDIUM: Hardcoded affiliate tag in source — moved to env var
- [x] MEDIUM: Raw API errors leaked to users — show generic messages only
- [x] MEDIUM: No CAPTCHA on research form — added Cloudflare Turnstile (optional, enable via wrangler secret)
- [x] MEDIUM: Unescaped AI category in home.ts card — added escapeHtml
- [x] MEDIUM: Turnstile site key not escaped in data attribute — added escapeHtml

## Bugs

- [x] HIGH: parseInt('abc') returns NaN, breaks pagination SQL — added || 1 fallback
- [x] HIGH: LIKE wildcard injection via search query — escaped % and _ characters
- [x] CRITICAL: Slug collision on insert throws unhandled error — added retry logic
- [x] CRITICAL: Slug collision retry could throw unhandled — wrapped in nested try/catch returning JSON
- [x] HIGH: Empty sources still triggered Claude API (hallucinated data) — added guard
- [x] HIGH: No timeout on Claude API fetch — added AbortSignal.timeout(60s)
- [x] MEDIUM: View count inflated by auto-refresh during processing — skip increment when processing
- [x] MEDIUM: Mutation of parsed result object — use immutable spread
- [x] MEDIUM: Pagination shows "Next" when last page has exactly perPage results — fetch perPage+1
- [x] MEDIUM: Duplicate affiliate tag fallback hardcoded in two files — extracted to shared constant
- [x] LOW: Unicode queries produce empty slugs — slugify falls back to "research"
- [x] LOW: Reddit API may rate-limit without OAuth — added User-Agent header
- [x] LOW: Unused imports in research-result.ts and research-browse.ts — removed

## UX

- [x] HIGH: Search input missing aria-label — added
- [x] HIGH: Nav missing aria-label — added
- [x] MEDIUM: No mobile hamburger menu — added CSS toggle for small screens
- [x] MEDIUM: No default OG image for social shares — added OG meta tags and SVG image endpoint
- [x] MEDIUM: Auto-refresh not accessible — replaced meta refresh with JS polling + pause button
- [x] LOW: Decorative SVGs missing aria-hidden on some icons — added aria-hidden to star ratings and decorative entities
- [x] LOW: No focus ring on details/summary disclosure — added focus-visible outline

## Code Quality

- [x] HIGH: AbortController timeout replaced with AbortSignal.timeout (Workers-native)
- [x] HIGH: Sequential product inserts replaced with batch insert
- [x] MEDIUM: Added total character budget for source context (30K limit)
- [x] LOW: scrapeUrl export removed in zero-dep refactor (no longer an SSRF vector)
- [x] LOW: extractTextFromHtml removed in zero-dep refactor (regex concern eliminated)

## Infrastructure

- [x] HIGH: CI pipeline references npm but no package.json exists — updated to use npx wrangler

## Generator Findings (2026-04-14)

- [x] HIGH: Stored XSS in autocomplete dropdown — client-side script concatenated `i.query` / `i.category` (both user-submitted, stored in D1) into `dd.innerHTML` with no escaping. A query like `<img src=x onerror=...>` would execute on any visitor who typed a matching prefix. Added inline `esc()` helper and wrapped slug in `encodeURIComponent`. `src/pages/home.ts:61`
- [x] MEDIUM: Zero security headers on HTML responses — added HSTS, X-Content-Type-Options: nosniff, Referrer-Policy: strict-origin-when-cross-origin, X-Frame-Options: DENY, Permissions-Policy gating geolocation/microphone/camera/payment. Emitted from `htmlResponse` so every HTML route gets them. Verified live.
- [x] HIGH: `canonical_query` column added in migration 0003 but never backfilled — all 88 existing rows had NULL, so "Related research" block never rendered on any live page. Backfilled via Python script replicating `canonicalizeQuery` logic, applied via `wrangler d1 execute --file=backfill.sql` to remote D1. All 88 rows now populated; related research block rendering live.
- [x] MEDIUM: Browse page had no structured data. Added BreadcrumbList + CollectionPage/ItemList JSON-LD so Google understands the archive listing.
- [x] MEDIUM: Result pages had only Article + Product schema. Added BreadcrumbList JSON-LD (Home > Research > query) and matching visible breadcrumb UI for SERP sitelinks.
- [x] MEDIUM: HEAD requests return 405 on every route — wrapped the worker `fetch` so HEAD runs the GET handler and the body is stripped at the outer layer; router accepts both methods. Verified live: HEAD returns 200 with headers + 0 bytes.
- [x] MEDIUM: Sitemap exposes thin-content slugs (honest-no-data results, garbage queries). Filtered `generateSitemap` to only include research with at least 1 product via `EXISTS` subquery; verified live sitemap no longer contains garbage-query slugs.
- [x] HIGH: Second stored XSS in activity feed — `div.innerHTML=(icons[e.event_type]||'\u{25CF}')+' '+e.message` at `src/pages/research-result.ts:443`. `engine.ts:588` interpolates user query into event messages (e.g. `Searching brave: "<query>"`), which render raw during research processing. Any visitor watching the live feed of a maliciously-crafted query would execute the payload. Switched to `textContent` so icon + message are treated as literal text.
- [x] LOW: KV cache invalidation was manual whack-a-mole per slug after template changes — deploys with shape changes (e.g. R31's new Offer fields) left stale HTML in KV for up to 1h per page unless each slug was individually purged. Added `CACHE_VERSION = 'v2'` constant and prefixed all KV keys with it (`page:v2:home`, `page:v2:<slug>`, `page:v2:<slug>:lm`). Old `page:*` keys age out on their own TTL; future shape changes just bump the version string. Verified: a previously-stale NAS page served R31's new Offer schema on next fetch without a manual purge.
- [x] MEDIUM: Product Offer schema missing fields required for Google rich snippets — `priceValidUntil`, `url`, and `seller` were absent, and AggregateRating had no `reviewCount` (Google requires a count). Missing these typically suppresses Product rich results. Added all four: priceValidUntil = lastModified + 30d, url = page canonical, seller = Chrisputer Labs Organization, reviewCount = 1 (matches the single editorial Review emitted alongside). Verified live JSON-LD now includes each field.
- [x] MEDIUM: `/research/<unknown-slug>` returned a 9-byte `Not found` plaintext — the routing-level 404 already had a branded HTML page with CTAs, but the research-slug 404 short-circuited inside `renderResearchResult` and skipped layout. Caught the `instanceof Response && status === 404` case in the worker router and rendered a proper branded 404 with the slug echoed back (safely escaped), browse/home CTAs, and `noindex, follow`. Verified live: response is now HTTP 404 + full HTML + styled chrome.
- [x] LOW: `/research?q=<anything>` search-result pages were indexable — they all canonicalized to `/research` but lacked a noindex, so Google could still surface them as duplicate entry points. Added `noindex, follow` to any browse view where `searchQuery` is set (in addition to the existing `page > 1` case). Canonical unchanged.
- [x] MEDIUM: Social share meta tags were incomplete — og:image was relative (`/og-image.svg`), social crawlers need absolute URLs; twitter:card was `summary` (small thumbnail) despite having a 1200×630 image; missing og:site_name, og:image dimensions/alt, and twitter:image. Resolved relative og:image to `https://chrisputer.tech` base, switched twitter:card default to `summary_large_image`, added og:site_name/og:image:width/height/alt + twitter:image. Verified live on /about.
- [x] LOW: Static HTML pages (home, about, browse) emitted no Cache-Control header — browsers revalidated every navigation. Result pages already had Cache-Control via the Last-Modified branch. Added default `public, max-age=60, s-maxage=600, stale-while-revalidate=3600` for any 200 response without lastModifiedSec, and `no-store` for non-200 HTML responses. Verified `/about` now returns Cache-Control.
- [x] MEDIUM: Related research block showed 5 copies of the same canonical query — live NAS page linked 5 rows all with `canonical_query = "best home nas 2026"`. Added SQL filter `canonical_query != current` so same-topic siblings are excluded entirely, added `EXISTS (products)` so thin pages can't appear in related, and added client-side dedup-by-canonical before the top-5 slice. Verified: now shows 3 distinct topics (Plex-focused NAS, light bulbs, smart home), no repeats.
- [x] MEDIUM: Duplicate research rows (same canonical_query, different slugs) surfacing on listings — live browse showed "best home NAS for 2026" 4 times and "best budget mechanical keyboard under $100" 4 times. R39 query-clustering prevents new duplicates but pre-backfill rows still exist. Rewrote the 6 listing queries (home recent/popular, browse default/search, sitemap, Atom feed) to `ROW_NUMBER() OVER (PARTITION BY COALESCE(canonical_query, slug) ORDER BY created_at DESC)` + filter `rn = 1`. Verified: all 10 browse entries now distinct. Individual slugs still resolve directly.
- [x] MEDIUM: Garbage queries surfacing on public listings — live browse page showed a `<h1>test</h1>` result card. Sitemap filter only covered one surface. Added `LENGTH(r.query) >= 10 AND r.query LIKE '% %'` (at least two tokens, 10+ chars) to every public listing query: sitemap, Atom feed, home recent/popular, browse default + search. Direct `/research/<slug>` URLs remain accessible (preserves shared links) but garbage queries no longer pollute discovery surfaces.
- [x] LOW: og:url missing on home, browse, and about — only research result pages emitted `og:url` (via explicit `ogUrl` in `layoutMeta`); other surfaces had no canonical OG URL, so Facebook/LinkedIn/Slack unfurls couldn't dedupe shares of the same page across querystring variants. Passed explicit `{ ogUrl: ... }` to `layout()` from `home.ts`, `about.ts`, and `research-browse.ts`. Verified live on all three.
- [x] HIGH: buyersGuide section missing from 9/10 recent research results — R45 added the schema slot, but the LLM was silently omitting the field: out of the 10 most recent `status=complete` rows, only 1 had `buyersGuide` in its persisted JSON (checked via `instr(result, 'buyersGuide')`). None of the 4 sampled live pages rendered a "How to choose / Pitfalls / Marketing to ignore" block. Root cause: the synthesis prompt described buyersGuide inside the schema example, but the `COMPLETENESS IS MANDATORY` enforcement rule only covered products. Added an explicit non-negotiable rule demanding a populated buyersGuide (howToChoose 3-5 sentences, ≥3 pitfalls, ≥3 marketingToIgnore) at the prompt's RULES section in `engine.ts:103`. Rendering code was already correct — this was purely a prompt-compliance gap. Effect will surface on the next research runs; existing rows remain thin until resynthesized.
- [x] MEDIUM: Article JSON-LD missing Google-required fields — `dateModified`, `publisher` (Organization with logo), and `mainEntityOfPage` were absent from the Article schema. Google's Article rich-snippet docs require publisher + dateModified; mainEntityOfPage is recommended. Added all three to `research-result.ts:406-423` using `lastModifiedTs` already in scope. Bumped `CACHE_VERSION` to `v3` to cut over cached pages without manual purge. Verified live on NAS page — all three fields present in JSON-LD.
- [x] MEDIUM: No Content-Security-Policy header — the two XSS bugs above would have been defense-in-depth blocked by a CSP. Added CSP from `htmlResponse()` covering script-src/style-src/font-src/img-src/connect-src/frame-src plus lockdowns (`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `upgrade-insecure-requests`). Allowlist covers Turnstile, CF analytics beacon, AdSense, Google Fonts. `'unsafe-inline'` kept for scripts/styles since the app embeds JSON-LD and small inline scripts and KV caching rules out per-request nonces — tracked as known limitation.

## Known Limitations (accepted)

- MEDIUM: Rate limiting is global (30/hr), not per-IP — single actor can exhaust quota
- MEDIUM: CSRF Origin check has hardcoded domain (chrisputer.tech) — update if domain changes
- LOW: View count has no deduplication (bots inflate counts)
- LOW: Hamburger menu does not close on outside click
- LOW: CSP uses `'unsafe-inline'` for script-src/style-src — required for JSON-LD + small inline scripts under KV caching (nonces would need per-request rendering). Other CSP directives still provide defense in depth.
