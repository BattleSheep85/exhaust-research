# Exhaust Research

AI-powered product research platform. Ask a question, get a brutally honest product comparison backed by real data.

**Live at**: [chrisputer.tech](https://chrisputer.tech)

## Features

- **AI-powered analysis** -- Claude analyzes scraped data from multiple sources and produces ranked product comparisons
- **Real sources** -- Pulls from Reddit discussions, review sites, and more (not just manufacturer claims)
- **Honest pros/cons** -- Every product gets real drawbacks listed, not just marketing highlights
- **Shareable results** -- Every research report gets a permanent, SEO-friendly permalink
- **Affiliate revenue** -- Amazon Associates links on product recommendations
- **Rate-limited public access** -- Application-level + WAF rate limiting (10 research requests/hour per IP)

## Tech Stack

- **Framework**: [Astro 6](https://astro.build) (SSR on Cloudflare Workers)
- **Hosting**: [Cloudflare Pages](https://pages.cloudflare.com) + Workers
- **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite) via [Drizzle ORM](https://orm.drizzle.team)
- **AI**: [Claude API](https://docs.anthropic.com) via `@anthropic-ai/sdk`
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com)
- **Validation**: [Zod](https://zod.dev)
- **Testing**: [Vitest](https://vitest.dev)

## Quick Start

```bash
git clone https://github.com/BattleSheep85/exhaust-research.git
cd exhaust-research
npm install
cp .dev.vars.example .dev.vars  # Add your ANTHROPIC_API_KEY
npm run dev
```

## Deployment

### 1. Create D1 database

```bash
npx wrangler d1 create exhaust-research-db
```

Copy the `database_id` from the output into `wrangler.jsonc`.

### 2. Run database migration

```bash
npx wrangler d1 execute exhaust-research-db --file=db/migrations/0000_init.sql
```

### 3. Set secrets

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

### 4. Deploy

```bash
npx wrangler deploy
```

Or connect to GitHub for automatic deploys on push to `main`.

## Development

```bash
npm run dev        # Start local dev server (port 4321)
npm run build      # Production build
npm run preview    # Preview production build locally
npm test           # Run tests
npm run test:watch # Run tests in watch mode
```

## Project Structure

```
src/
  layouts/Layout.astro       -- Base layout (nav, footer, meta tags)
  components/                -- SearchBar, ProductCard, ResearchCard
  pages/
    index.astro              -- Landing page
    about.astro              -- About + affiliate disclosure
    research/index.astro     -- Browse/search past research
    research/new.astro       -- Trigger new research
    research/[slug].astro    -- Research result page
    blog/index.astro         -- Blog placeholder
    api/research.ts          -- POST endpoint (scrape + analyze + store)
  lib/
    db.ts                    -- D1/Drizzle helpers
    scraper.ts               -- Reddit scraping
    researcher.ts            -- Claude API integration
    validation.ts            -- Zod schemas, URL validation
db/
  schema.ts                  -- Drizzle table definitions
  migrations/                -- SQL migrations
```

## Configuration

| Variable | Where | Description |
|----------|-------|-------------|
| `ANTHROPIC_API_KEY` | Wrangler secret | Claude API key |
| `AMAZON_AFFILIATE_TAG` | wrangler.jsonc vars | Amazon Associates tag (default: `chrisputer-20`) |

## License

MIT
