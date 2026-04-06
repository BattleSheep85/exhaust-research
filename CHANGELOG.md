# Changelog

## [1.0.0] - 2026-04-06

### Added
- Landing page with search bar, how-it-works section, recent/popular research
- Research engine: Reddit multi-query scraping + Claude API analysis
- Research results page with ranked product cards, pros/cons, specs, verdicts
- Browse/search page with pagination for past research
- About page with affiliate disclosure
- Blog placeholder (migration pending)
- Amazon Associates affiliate link generation
- Application-level rate limiting (10 requests/hour per IP)
- CSRF protection via Origin header validation
- Zod runtime validation for AI-generated JSON output
- URL sanitization for all rendered links
- D1 database schema with Drizzle ORM (research + products tables)
- 46 passing tests (db, scraper, researcher, validation, API)
- Cloudflare Pages + Workers deployment config
