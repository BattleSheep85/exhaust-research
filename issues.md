# Issues

Last updated: 2026-04-06

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

## Known Limitations (accepted)

- MEDIUM: Rate limiting is global (30/hr), not per-IP — single actor can exhaust quota
- MEDIUM: CSRF Origin check has hardcoded domain (chrisputer.tech) — update if domain changes
- LOW: View count has no deduplication (bots inflate counts)
- LOW: Hamburger menu does not close on outside click
