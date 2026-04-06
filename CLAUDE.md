# Exhaust Research

AI-powered product research platform at chrisputer.tech.

## Stack

- **Framework**: Astro 6 + TypeScript (strict)
- **Hosting**: Cloudflare Pages + Workers
- **Database**: Cloudflare D1 (SQLite) via Drizzle ORM
- **AI**: Claude API (Anthropic SDK)
- **Styling**: Tailwind CSS v4
- **Scraping**: fetch + HTMLRewriter for static pages

## Commands

```bash
npm run dev       # Local dev server (uses wrangler under the hood)
npm run build     # Production build
npm run preview   # Preview production build locally
```

## Project Structure

```
src/
├── layouts/Layout.astro          # Base layout with nav/footer
├── components/                   # Reusable UI components
│   ├── SearchBar.astro
│   ├── ResearchCard.astro
│   └── ProductCard.astro
├── pages/
│   ├── index.astro               # Landing page
│   ├── about.astro               # About page
│   ├── research/
│   │   ├── index.astro           # Browse/search research
│   │   ├── new.astro             # Trigger new research
│   │   └── [slug].astro          # Research result page
│   ├── blog/
│   │   └── index.astro           # Blog listing (pending migration)
│   └── api/
│       └── research.ts           # POST endpoint to start research
├── lib/
│   ├── db.ts                     # D1/Drizzle helpers
│   ├── scraper.ts                # Web scraping utilities
│   └── researcher.ts             # Claude API integration
└── styles/
    └── global.css                # Tailwind + custom theme
db/
├── schema.ts                     # Drizzle schema
└── migrations/                   # SQL migrations
```

## Environment Variables

- `ANTHROPIC_API_KEY` — Claude API key (set in `.dev.vars` locally, Cloudflare secrets in prod)

## Deployment

1. Create D1 database: `npx wrangler d1 create exhaust-research-db`
2. Update `database_id` in `wrangler.jsonc`
3. Run migration: `npx wrangler d1 execute exhaust-research-db --file=db/migrations/0000_init.sql`
4. Set secret: `npx wrangler secret put ANTHROPIC_API_KEY`
5. Deploy: `npx wrangler deploy` or push to GitHub for Cloudflare Pages auto-deploy

## Revenue

- Amazon Associates affiliate links (tag: `chrisputer-20`)
- Affiliate URL generation in `src/lib/researcher.ts`
- Disclosure on About page

## Rate Limiting

- Configure via Cloudflare WAF dashboard: 10 research requests/hour per IP on `/api/research`
