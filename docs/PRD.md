# PRD: Exhaust Research

## Problem Statement

Product research is broken. When you Google "best NAS under $500" you get 10 SEO-optimized listicles that all recommend the same Amazon bestsellers, provide shallow analysis, and are often sponsored without disclosure. The user spends hours cross-referencing Reddit threads, manufacturer specs, and review sites to form their own opinion. This is tedious, time-consuming, and most people give up and buy whatever has the most Amazon reviews.

## Solution

Exhaust Research is an AI-powered product research platform. Users type a product question in plain English. The system scrapes multiple real sources (Reddit discussions, review sites, manufacturer pages), feeds everything to Claude for analysis, and produces a comprehensive, honest product comparison with ranked recommendations, pros/cons, specs, and verdicts. Results are saved as SEO-friendly permalinks that generate affiliate revenue through product links.

## Target User

**Primary**: Tech-savvy consumers researching products before purchase. Homelab builders, IT professionals, gamers, and anyone who wants depth over SEO fluff. Comfortable reading technical specs but doesn't want to spend 3 hours doing manual research.

**Secondary**: Casual shoppers who arrive via Google search on a specific product query. They get a well-structured answer and potentially click an affiliate link.

## User Stories

1. As a homelab builder, I want to ask "best NAS under $500 for 2026" and get a ranked comparison so I can make an informed purchase decision.
2. As a user, I want to see pros and cons for each product so I can weigh trade-offs.
3. As a user, I want to see specification tables so I can compare technical details side by side.
4. As a user, I want each product to have a clear "best for" label (budget, performance, value) so I can find the right pick for my situation.
5. As a user, I want to see a "verdict" summary for each product so I get the bottom line quickly.
6. As a user, I want to share a research result URL with a friend so they can see the same analysis.
7. As a user, I want to browse past research by other users so I can find answers without waiting.
8. As a user, I want to search past research so I can find relevant existing results.
9. As a user, I want to see how many products were compared and sources used so I can trust the analysis.
10. As a user, I want the page to auto-refresh while research is processing so I don't have to manually reload.
11. As a user, I want to click a "View Deal" button that takes me to the product page so I can purchase.
12. As the site owner, I want affiliate links on product recommendations so the site generates revenue.
13. As the site owner, I want rate limiting so the Claude API costs don't explode.
14. As a search engine, I want SSR-rendered research pages with proper meta tags so they get indexed.

## MVP Feature Set

1. **Landing page** — Hero with search bar, how-it-works section, recent/popular research, CTA
2. **Research API** — POST endpoint that accepts a query, scrapes sources, calls Claude, stores results
3. **Multi-source scraping** — Reddit (multiple query variations), extensible for future sources
4. **Claude analysis** — Structured JSON output with ranked products, pros/cons, specs, verdicts
5. **Research results page** — SSR page at /research/[slug] with product cards, specs, sources
6. **Browse/search page** — Paginated listing of past research at /research
7. **Auto-refresh** — Processing indicator with meta refresh while research is running
8. **Affiliate links** — Amazon Associates URL generation on product links
9. **About page** — Product description and affiliate disclosure
10. **Rate limiting** — Cloudflare WAF rule on /api/research (10/hour per IP)

## Out of Scope (v1)

- User accounts / authentication — public tool, no login needed
- Price tracking / alerts — future feature
- Saved research lists / favorites
- Blog content migration (93 posts from old Hugo site — post-launch task)
- Email notifications
- Browser Rendering (Puppeteer) for JS-heavy sites — start with fetch-based scraping
- Multiple AI model choices
- Comparison mode (side-by-side two research results)

## Implementation Decisions

### Architecture overview
- Astro 6 SSR on Cloudflare Pages + Workers
- All pages server-rendered for SEO
- API routes handled by Cloudflare Workers
- Background processing via `waitUntil()` for async research execution
- D1 SQLite database for persistence

### Module breakdown
- `src/lib/db.ts` — Database helpers, ID generation, slug creation
- `src/lib/scraper.ts` — Source scraping (Reddit, generic URL fetch)
- `src/lib/researcher.ts` — Claude API integration, prompt engineering, affiliate URL generation
- `src/pages/api/research.ts` — API endpoint orchestrating scrape → analyze → store
- `src/components/` — Reusable Astro components (SearchBar, ProductCard, ResearchCard)
- `src/layouts/Layout.astro` — Base layout with nav, footer, meta tags
- `src/pages/` — Route pages (index, research/*, about, blog)
- `db/schema.ts` — Drizzle ORM schema definitions

### Tech stack
- **Runtime**: Cloudflare Workers (V8 isolate)
- **Framework**: Astro 6 with `@astrojs/cloudflare` adapter
- **Database**: Cloudflare D1 (SQLite) via Drizzle ORM
- **AI**: Anthropic Claude API via `@anthropic-ai/sdk`
- **Styling**: Tailwind CSS v4 with custom theme
- **Fonts**: Inter + JetBrains Mono (Google Fonts)

### Data model
- `research` — id, slug, query, status, category, summary, result (JSON), sources (JSON), timestamps, view_count
- `products` — id, research_id (FK), name, brand, price, rating, pros/cons/specs (JSON), verdict, rank, best_for, affiliate_url

## Testing Strategy

- **Unit tests**: `vitest` for lib modules (db helpers, scraper parsing, affiliate URL generation, slug generation)
- **Integration tests**: API endpoint tests using Astro's test utilities
- **Coverage target**: 80%+ on lib modules
- **What makes a good test**: Tests that verify behavior through public interfaces — given input X, expect output Y. No mocking of internal implementation details.

## Deployment & Distribution

- **Hosting**: Cloudflare Pages (auto-deploy from GitHub push to main)
- **Database**: Cloudflare D1 (created via wrangler CLI)
- **Secrets**: `ANTHROPIC_API_KEY` via `wrangler secret put`
- **Domain**: chrisputer.tech (Cloudflare DNS, already managed)
- **CI/CD**: GitHub Actions — build + test on PR, deploy on merge to main

## Success Metrics

- Research flow completes end-to-end (query → scrape → analyze → display) in under 60 seconds
- Research results pages are fully SSR (viewable with JS disabled)
- Google indexes research result pages within 2 weeks of launch
- First affiliate click within 30 days
- Build passes with zero errors, all tests green
