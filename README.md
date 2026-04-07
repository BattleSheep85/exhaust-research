# Exhaust Research

Zero-dependency, AI-powered product research. No npm. No node_modules. No supply chain risk.

**Live at**: [chrisputer.tech](https://chrisputer.tech)

## What it does

Ask a product question. We scrape real sources (Reddit, forums, reviews), feed everything to Claude, and give you brutally honest product comparisons with ranked picks, pros/cons, specs, and verdicts.

## Features

- AI-powered analysis via Claude API (raw fetch, no SDK)
- Multi-source scraping (Reddit discussions, extensible)
- Ranked product cards with pros/cons, specs, affiliate links
- Shareable permalink for every research result
- Application-level rate limiting
- CSRF protection
- Cloudflare Turnstile CAPTCHA (optional)
- Mobile-responsive with hamburger menu
- Accessible auto-refresh with pause control
- Open Graph meta tags for social sharing
- Zero runtime dependencies — ~48 KB deployed, pure TypeScript

## Stack

| Layer | Tech | Dependencies |
|-------|------|-------------|
| Runtime | Cloudflare Workers | 0 |
| Database | Cloudflare D1 (SQLite) | 0 |
| AI | Claude API via `fetch()` | 0 |
| Styling | Hand-written CSS | 0 |
| HTML | Tagged template literals | 0 |
| **Total** | | **0** |

## Quick Start

```bash
git clone https://github.com/BattleSheep85/exhaust-research.git
cd exhaust-research
wrangler dev
```

You need [wrangler](https://developers.cloudflare.com/workers/wrangler/) installed. It's a deploy tool, not a runtime dependency.

## Deploy

```bash
# 1. Create database
wrangler d1 create exhaust-research-db
# Update database_id in wrangler.jsonc

# 2. Run migration
wrangler d1 execute exhaust-research-db --file=db/migrations/0000_init.sql

# 3. Set API key (never stored in code)
wrangler secret put ANTHROPIC_API_KEY

# 4. (Optional) Enable CAPTCHA
# Create a Turnstile widget at https://dash.cloudflare.com/turnstile
# Set the site key in wrangler.jsonc TURNSTILE_SITE_KEY
wrangler secret put TURNSTILE_SECRET_KEY

# 5. Ship it
wrangler deploy
```

## Configuration

| Variable | Type | Required | Description |
|----------|------|----------|-------------|
| `ANTHROPIC_API_KEY` | secret | Yes | Claude API key |
| `AMAZON_AFFILIATE_TAG` | var | No | Amazon Associates tag (default: chrisputer-20) |
| `TURNSTILE_SITE_KEY` | var | No | Cloudflare Turnstile site key (empty = disabled) |
| `TURNSTILE_SECRET_KEY` | secret | No | Cloudflare Turnstile secret key |

## Project Structure

11 TypeScript files. ~1,200 lines. That's the whole thing.

```
src/
  worker.ts              Router + entry point
  types.ts               Type definitions + constants
  lib/html.ts            Template engine with XSS auto-escaping
  lib/utils.ts           ID generation, URL validation, helpers
  lib/scraper.ts         Reddit scraping
  lib/researcher.ts      Claude API integration + response validation
  pages/home.ts          Landing page
  pages/about.ts         About + affiliate disclosure
  pages/api.ts           POST /api/research + Turnstile verification
  pages/research-browse.ts  Browse/search
  pages/research-result.ts  Individual result page
```

## Development

```bash
wrangler dev                              # Local dev server (port 8787)
wrangler deploy --dry-run --outdir=dist   # Build check
```

## License

MIT
