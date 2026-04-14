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
- [x] MEDIUM: Completed-but-zero-product research pages were indexable — pre-R39 garbage queries like "Gpu", "Stuff", and "turbo charger for 2015 Buick regal" completed with 0 products and still served HTTP 200 with no `noindex`. R3's sitemap filter kept them off discovery surfaces but direct links remained crawlable thin content. Added a `noindex, follow` meta on any result page where `status === 'complete' && products.length === 0` (also covers processing and failed states). Bumped `CACHE_VERSION` to v6. Verified live: thin page emits noindex, healthy page does not.
- [x] LOW: Related research cards displayed ungrammatical "1 views" in the `card-time` slot — wrong data in the wrong class; browse/home cards use `timeAgo` there. Added `created_at` to `RelatedResearchRow`, selected it in the SQL, swapped `${r.view_count} views` for `timeAgo(r.created_at * 1000)` at `research-result.ts:369`. Bumped `CACHE_VERSION` to v5. Verified live: "3d ago" now renders instead of "1 views".
- [x] HIGH: `/api/research` accepted garbage intake (single-token + Schema.org template literals) — DB audit showed recent rows for `test`, `Gpu`, `Stuff`, `fdsjklfdsjkl` (multiple copies), and `{search_term_string}` (the WebSite/SearchAction URL template — bots were literally POSTing the placeholder). Each burns a paid LLM call and pollutes FTS indexes. Existing listing surfaces filtered these out at read time, but intake was wide open. Added token-count ≥ 2 and `\{...\}` placeholder rejection in `api.ts:40-47` before cluster lookup or DB insert. Verified live: `test`, `Gpu`, `fdsjklfdsjkl`, `{search_term_string}` → 400; `best home nas` → 200.
- [x] MEDIUM: Autocomplete dropdown returned duplicate canonical topics — typing "nas" surfaced 6 results, 5 of them the same canonical `home nas` (different slugs from pre-R39 era). R25/R26 deduped listing and related surfaces but the FTS5 suggest endpoint was untouched. Wrapped both FTS and LIKE-fallback queries in `api.ts:283-306` with the same ROW_NUMBER() OVER (PARTITION BY COALESCE(canonical_query, slug) ...) pattern. Verified live: "nas" now returns 2 distinct topics (Home NAS, Home NAS for Plex).
- [x] MEDIUM: Product JSON-LD missing `description` and Review missing `reviewRating` — Google's Product/Review rich-snippet docs treat `description` as recommended and `reviewRating` as required for rating stars on Review nodes. Added `description` (falls back `verdict → bestFor → first 3 pros joined`) and `reviewRating` mirroring the aggregate rating. Bumped `CACHE_VERSION` to v4 so existing KV pages get the new shape on next fetch. Verified live on NAS page — both fields now present.
- [x] MEDIUM: Home "Recent" and "Popular" sections cross-duplicated — each SQL query deduped within itself via the R25 window function, but the two queries weren't coordinated. A research with high view_count + recent creation date could surface in both blocks under different slugs (observed: `best-mesh-wifi-system-2026-8fa055f7` and `-ba006b1e`, both `canonical_query='mesh system wifi'`, appeared once in Recent and once in Popular). Filter popular rows in TS against a `Set<canonical_query | slug>` of recent rows after both queries run. Verified live: home now shows 9 distinct slugs instead of 10 with a duplicate.
- [x] LOW: og:url missing on home, browse, and about — only research result pages emitted `og:url` (via explicit `ogUrl` in `layoutMeta`); other surfaces had no canonical OG URL, so Facebook/LinkedIn/Slack unfurls couldn't dedupe shares of the same page across querystring variants. Passed explicit `{ ogUrl: ... }` to `layout()` from `home.ts`, `about.ts`, and `research-browse.ts`. Verified live on all three.
- [x] HIGH: buyersGuide section missing from 9/10 recent research results — R45 added the schema slot, but the LLM was silently omitting the field: out of the 10 most recent `status=complete` rows, only 1 had `buyersGuide` in its persisted JSON (checked via `instr(result, 'buyersGuide')`). None of the 4 sampled live pages rendered a "How to choose / Pitfalls / Marketing to ignore" block. Root cause: the synthesis prompt described buyersGuide inside the schema example, but the `COMPLETENESS IS MANDATORY` enforcement rule only covered products. Added an explicit non-negotiable rule demanding a populated buyersGuide (howToChoose 3-5 sentences, ≥3 pitfalls, ≥3 marketingToIgnore) at the prompt's RULES section in `engine.ts:103`. Rendering code was already correct — this was purely a prompt-compliance gap. Effect will surface on the next research runs; existing rows remain thin until resynthesized.
- [x] MEDIUM: Article JSON-LD missing Google-required fields — `dateModified`, `publisher` (Organization with logo), and `mainEntityOfPage` were absent from the Article schema. Google's Article rich-snippet docs require publisher + dateModified; mainEntityOfPage is recommended. Added all three to `research-result.ts:406-423` using `lastModifiedTs` already in scope. Bumped `CACHE_VERSION` to `v3` to cut over cached pages without manual purge. Verified live on NAS page — all three fields present in JSON-LD.
- [x] LOW: "Published" and "Last updated" dates were plain text without semantic `<time datetime>` markup — machine-readable dates help screen readers, search engines, and any browser automation. Wrapped both in `<time datetime="YYYY-MM-DD">` in `research-result.ts:316-317`. Bumped `CACHE_VERSION` to v13. Verified live on IEM page: `<time datetime="2026-04-13">April 13, 2026</time>` for both.
- [x] MEDIUM: Footer affiliate disclosure didn't use Amazon Associates Program Policies' required phrasing — it said "Affiliate links may earn commission at no cost to you" (general FTC-style) but Amazon's Operating Agreement specifically requires "As an Amazon Associate I earn from qualifying purchases" or substantially similar. Using a non-conforming disclosure is an account-termination risk. Updated footer note in `html.ts:105` to "As an Amazon Associate, Chrisputer Labs earns from qualifying purchases. Product data compiled from public sources." Bumped `CACHE_VERSION` to v12. Verified live on home.
- [x] MEDIUM: Browse empty-state messaging wrong for pagination overflow and search miss — `/research?page=999` and `/research?q=zzzzz` both rendered the generic "No research yet / Be the first to research a product!" which is a lie (lots of research exists) and confusing. Split the empty state into three cases in `research-browse.ts:78`: search-miss (shows the query + CTA to start new research for it), page-overflow (shows "You've reached the end" + back link), and the genuine empty case (original copy). Verified both live.
- [x] LOW: `og:image:alt` was the same static string site-wide ("Chrisputer Labs — AI-powered product research") regardless of page. Social previews with alt text use it as accessibility fallback + CTR signal; a per-page alt is markedly better. Also added `og:image:type` = `image/svg+xml` so crawlers know what they're receiving (explicit > inference). Changed the alt to `${escapedTitle} — Chrisputer Labs` in `html.ts:69`. Bumped `CACHE_VERSION` to v11. Verified live NAS page: `og:image:alt = "Best Mesh Wifi — Chrisputer Labs"`, `og:image:type = "image/svg+xml"`.
- [x] MEDIUM: Amazon search-URL affiliate fallback duplicated the brand when the product name already included it — e.g. `amazon.com/s?k=TP-Link+TP-Link+Deco+BE63+BE10000+...` (the LLM returns `brand: "TP-Link"` and `name: "TP-Link Deco BE63 ..."`, then `amazonSearchUrl` prepended brand unconditionally). Messy URL for users and likely hurts Amazon's search relevance. Added `joinBrandAndName` helper at `research-result.ts:49` that skips the prefix if `name` already starts with `brand` (case-insensitive). Applied to both amazonSearchUrl and googleSearchUrl. Bumped `CACHE_VERSION` to v10. Verified live: `k=TP-Link+Deco+BE63...` (single occurrence).
- [x] LOW: Autocomplete dropdown still returned raw lowercase queries after R44 (server emits JSON rendered client-side). Applied `displayQuery` in the suggest endpoint at `api.ts:301-303` + fallback path so dropdown results match the rest of the site. Verified live: "best m" → "Best Budget Mechanical Keyboard Under $100", "Best Budget 4K Monitor" (4K all-caps preserved).
- [x] MEDIUM: Card titles on home/browse/related + Atom feed titles + OG image titles all rendered raw-lowercase (prior R43 only covered the result page itself). Home showed `Best Mesh Wifi` next to `best home NAS for 2026` — mixed. Applied `displayQuery` everywhere r.query is rendered as a title: home.ts:97, research-browse.ts:53+115, research-result.ts:379 (related cards), worker.ts:287 (OG SVG) + worker.ts:390 (Atom feed). Bumped `CACHE_VERSION` to v9. Verified live: every card on home and every Atom feed entry now title-cased.
- [x] MEDIUM: Page titles, H1s, and JSON-LD headlines rendered in all-lowercase because the raw query was echoed verbatim (e.g. `<title>best mesh wifi`, `<h1>best mesh wifi`). Sloppy in SERPs and social previews. Added `displayQuery(query)` in `utils.ts` that title-cases while preserving already-capitalized tokens (NAS, WiFi remain intact if user types them) and lowercasing small connectors (of/for/in/the/etc.). Applied to breadcrumb, H1, JSON-LD headline, BreadcrumbList name, layout title, and share text in `research-result.ts`. Bumped `CACHE_VERSION` to v8. Verified live: NAS page now shows `Best Mesh Wifi` in title/H1/headline.
- [x] LOW: Sources list rendered full URLs as visible link text (e.g. `https://dongknows.com/best-nas-servers/...`) — ugly and pushes actual content off-screen on mobile. Added `sourceLabel(url)` helper in `research-result.ts:96` returning the hostname with leading `www.` stripped; applied to the link text at line 371. URL stays in `href`. Bumped `CACHE_VERSION` to v7. Verified live: Wirecutter link now reads `nytimes.com` instead of the full URL.
- [x] MEDIUM: No Content-Security-Policy header — the two XSS bugs above would have been defense-in-depth blocked by a CSP. Added CSP from `htmlResponse()` covering script-src/style-src/font-src/img-src/connect-src/frame-src plus lockdowns (`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `upgrade-insecure-requests`). Allowlist covers Turnstile, CF analytics beacon, AdSense, Google Fonts. `'unsafe-inline'` kept for scripts/styles since the app embeds JSON-LD and small inline scripts and KV caching rules out per-request nonces — tracked as known limitation.

## Known Limitations (accepted)

- MEDIUM: Rate limiting is global (30/hr), not per-IP — single actor can exhaust quota
- MEDIUM: CSRF Origin check has hardcoded domain (chrisputer.tech) — update if domain changes
- LOW: View count has no deduplication (bots inflate counts)
- LOW: Hamburger menu does not close on outside click
- LOW: CSP uses `'unsafe-inline'` for script-src/style-src — required for JSON-LD + small inline scripts under KV caching (nonces would need per-request rendering). Other CSP directives still provide defense in depth.
