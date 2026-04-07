# Exhaust Research

Zero-dependency AI-powered product research platform on Cloudflare Workers.

## Stack

- **Runtime**: Cloudflare Workers (V8 isolate, TypeScript)
- **Database**: Cloudflare D1 (SQLite, raw SQL)
- **AI**: Claude API via raw `fetch()` (no SDK)
- **Styling**: Hand-written CSS (no frameworks, no build step)
- **Dependencies**: ZERO. No package.json, no node_modules, nothing.

## Commands

```bash
wrangler dev           # Local dev server (port 8787)
wrangler deploy        # Deploy to Cloudflare
wrangler deploy --dry-run --outdir=dist  # Build check
```

## Project Structure

```
src/
├── worker.ts              # Entry point, router
├── types.ts               # All type definitions
├── lib/
│   ├── html.ts            # Template engine (tagged template literals, auto-escaping)
│   ├── utils.ts           # Pure utility functions (slug, ID, URL validation, escaping)
│   ├── scraper.ts         # Reddit scraping via raw fetch
│   └── researcher.ts      # Claude API via raw fetch, response validation
├── pages/
│   ├── home.ts            # Landing page
│   ├── about.ts           # About page
│   ├── api.ts             # POST /api/research handler
│   ├── research-browse.ts # Browse/search page
│   └── research-result.ts # Individual research result
db/
└── migrations/0000_init.sql  # Database schema
```

## Secrets

- `ANTHROPIC_API_KEY` — set via `wrangler secret put` only, NEVER in wrangler.jsonc
- `TURNSTILE_SECRET_KEY` — optional, set via `wrangler secret put` to enable CAPTCHA
- `TURNSTILE_SITE_KEY` — optional, set in wrangler.jsonc vars (public key)

## Key Design Decisions

- No npm, no package managers — supply chain risk is unacceptable
- All HTML rendered server-side as strings with auto-escaping
- Claude API called with raw fetch, response validated manually (no Zod, no SDK)
- D1 queries use parameterized SQL (no ORM)
- URLs validated before rendering as <a href> (reject non-HTTPS schemes)
- Application-level rate limiting via D1 query count
