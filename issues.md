# Issues

Last updated: 2026-04-06

## Security

- [x] HIGH: API key was in wrangler vars block — moved to secrets only
- [x] HIGH: No CSRF protection on POST endpoint — added Origin header check
- [x] HIGH: No application-level rate limiting — added IP-based rate limiter in D1
- [x] HIGH: Unvalidated AI JSON output trusted blindly — added Zod schema validation
- [x] HIGH: Unvalidated URLs rendered as href links — added isValidHttpUrl checks
- [x] CRITICAL: Error handler could throw leaving research stuck — wrapped in try/catch
- [x] MEDIUM: Hardcoded affiliate tag in source — moved to env var
- [x] MEDIUM: Raw API errors leaked to users — show generic messages only
- [ ] MEDIUM: No CAPTCHA on research form — consider Cloudflare Turnstile for v2
- [ ] LOW: scrapeUrl export is unused SSRF vector — remove or add URL validation if used

## Bugs

- [x] HIGH: parseInt('abc') returns NaN, breaks pagination SQL — added || 1 fallback
- [x] HIGH: LIKE wildcard injection via search query — escaped % and _ characters
- [x] CRITICAL: Slug collision on insert throws unhandled error — added retry logic
- [x] HIGH: Empty sources still triggered Claude API (hallucinated data) — added guard
- [x] MEDIUM: View count inflated by auto-refresh during processing — skip increment when processing
- [x] MEDIUM: Mutation of parsed result object — use immutable spread
- [ ] MEDIUM: Pagination shows "Next" when last page has exactly perPage results
- [ ] LOW: Unicode queries produce empty slugs
- [ ] LOW: Reddit API may rate-limit without OAuth (degraded scraping)

## UX

- [x] HIGH: Search input missing aria-label — added
- [x] HIGH: Nav missing aria-label — added
- [ ] MEDIUM: No mobile hamburger menu (3 links fit but fragile)
- [ ] MEDIUM: No default OG image for social shares
- [ ] MEDIUM: Auto-refresh not accessible (no pause button)
- [ ] LOW: Decorative SVGs missing aria-hidden on some icons
- [ ] LOW: No focus ring on details/summary disclosure

## Code Quality

- [x] HIGH: AbortController timeout replaced with AbortSignal.timeout (Workers-native)
- [x] HIGH: Sequential product inserts replaced with batch insert
- [x] MEDIUM: Added total character budget for source context (30K limit)
- [ ] LOW: extractTextFromHtml uses regex instead of HTMLRewriter
