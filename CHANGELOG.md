# Changelog

## [1.1.0] - 2026-04-06

### Added
- Cloudflare Turnstile CAPTCHA integration (optional, enable via env vars)
- Mobile hamburger menu for small screens
- Open Graph and Twitter Card meta tags for social sharing
- OG image SVG endpoint (/og-image.svg)
- Accessible auto-refresh with pause/resume button and noscript fallback
- Focus-visible outline on details/summary elements
- 60-second timeout on Claude API requests

### Fixed
- Pagination "Next" button shown on last page when exactly perPage results returned
- Unicode-only queries producing empty slugs (now falls back to "research")
- Slug collision retry could throw unhandled error (wrapped in nested try/catch)
- Unescaped AI-generated category in home page cards (XSS vector)
- Missing aria-hidden on decorative star ratings and arrow entities
- Reddit scraper missing User-Agent header (caused silent rate-limiting)
- Unused imports in research-result.ts and research-browse.ts
- Duplicate hardcoded affiliate tag fallback (extracted to shared constant)
- Turnstile site key not escaped in HTML attribute

### Changed
- CI pipeline updated from npm to npx wrangler (no package.json needed)
- Auto-refresh uses JavaScript setInterval instead of meta refresh tag

## [1.0.0] - 2026-04-06

### Added
- Landing page with search bar, how-it-works section, recent/popular research
- Research engine: Reddit multi-query scraping + Claude API analysis
- Research results page with ranked product cards, pros/cons, specs, verdicts
- Browse/search page with pagination
- About page with affiliate disclosure
- Amazon Associates affiliate link generation
- Application-level rate limiting (30 requests/hour)
- CSRF protection via Origin header validation
- Manual JSON schema validation for AI output
- URL sanitization for all rendered links
- XSS auto-escaping via tagged template literals
- D1 database with parameterized SQL (no ORM)

### Changed
- Rebuilt as zero-dependency Cloudflare Workers (removed Astro, npm, Drizzle, Vitest)
