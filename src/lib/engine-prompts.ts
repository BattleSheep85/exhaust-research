import type { AgentNote, Facets, ResearchConfig, ScrapedSource } from '../types';

// Facet-specific focus blocks. Multiple facets can activate simultaneously —
// "best pizza delivery in Austin" lights up is_buyable + needs_location +
// is_service, and all three blocks concatenate into one prompt.
function facetFocusBlocks(facets: Facets): string {
  const blocks: string[] = [];
  if (facets.is_buyable) {
    blocks.push(
      `BUYABLE PRODUCT focus:
- Capture: model numbers, current price (USD), specs, release date, retailer availability.
- Read expert reviews (Wirecutter, RTINGS, Tom's Hardware, PCMag) over listicles.
- Note known issues, firmware bugs, recalls, or common complaints.`
    );
  }
  if (facets.needs_location) {
    blocks.push(
      `LOCATION-AWARE focus:
- Capture: full address, neighborhood/city, hours of operation, phone, Google Maps URL, price tier.
- Use web search for "<name> reviews" and "<name> yelp" / "<name> tripadvisor" — cross-reference ratings.
- If the query names a city/region, keep every candidate inside that area; drop candidates from elsewhere.`
    );
  }
  if (facets.is_experience) {
    blocks.push(
      `EXPERIENCE/PLACE focus:
- Capture: location, best season, cost, tips, typical crowd level, duration, difficulty if applicable.
- Favor firsthand reports (blogs, forum threads, Reddit) over promotional content.`
    );
  }
  if (facets.is_content) {
    blocks.push(
      `CONTENT/MEDIA focus:
- Capture: platform/availability, creator/author, release date, content type, target audience.
- For apps: pricing model (free/freemium/paid), platform coverage, stand-out features.
- For media: runtime/length, genre, key themes, critical reception.`
    );
  }
  if (facets.is_service) {
    blocks.push(
      `SERVICE/PROFESSIONAL focus:
- Capture: service area, pricing model (hourly/fixed/subscription), credentials, response time, reviews.
- Prefer named providers with reviews over generic aggregator listings.`
    );
  }
  if (facets.is_comparative) {
    blocks.push(
      `COMPARATIVE focus:
- The user named two or more specific things to compare. Research each one thoroughly.
- Note the honest wins, losses, and ties. Reject false balance — if one clearly wins, say so.`
    );
  }
  return blocks.length > 0 ? '\n\nFOCUS AREAS (multiple may apply):\n' + blocks.join('\n\n') : '';
}

export function buildAgentPrompt(query: string, config: ResearchConfig, facets?: Facets): string {
  const currentYear = new Date().getUTCFullYear();
  const effectiveFacets: Facets = facets ?? {
    needs_location: false, is_buyable: true, is_experience: false,
    is_content: false, is_service: false, is_comparative: false,
  };
  return `You are an autonomous research agent. Your goal: thoroughly research "${query}" using your tools.

CURRENT YEAR: ${currentYear}. Prioritize recent data. Discount sources older than 18 months.

BUDGET: ${config.maxSearches} searches, ${config.maxFetches} page reads, ${config.maxToolCalls} total tool calls.${facetFocusBlocks(effectiveFacets)}

STRATEGY:
1. Start with 3-5 broad searches across different providers (web, news, video, duckduckgo, rss) to discover the landscape.
2. Identify the top candidates from initial results.
3. Search for each top candidate by name + "review" to find detailed evaluations.
4. Use read_page on the most promising expert sources and detailed comparison/review articles.
5. Search for known issues, complaints, or drawbacks for the top candidates.
6. For buyable products: search for price comparisons and deals. For local: search for recent reviews.
7. Call note() AGGRESSIVELY — at minimum one note per search that returned useful results, and one note per page you read. A rough target is 1 note per 3 sources gathered. Sparse notes starve the synthesis step. If a source had nothing useful, call note() anyway with the reason ("no relevant info in <source>").
8. When you've covered all angles or used most of your budget, stop calling tools.

PROVIDERS:
- web: General web search via Tavily (best for broad coverage, high-quality results)
- news: Recent news articles (best for new releases, announcements)
- video: YouTube reviews (best for hands-on evaluations)
- duckduckgo: Alternative web results (different index than Tavily)
- hackernews: Tech community discussions (best for technical opinions)
- rss: Expert review sites — Wirecutter, RTINGS, Tom's Hardware, etc. (best for curated expert picks)

NOTES ARE CRITICAL: Call note() frequently. The synthesis step ONLY sees your notes + source list, not this conversation. If you don't note it, it won't be in the report. Under-noting is the #1 cause of weak reports — always err on the side of more notes.

Be thorough. Be specific. Include names, prices, specs, addresses, and source attribution in your notes.`;
}

function metadataKeysHint(facets: Facets): string {
  const hints: string[] = [];
  if (facets.is_buyable) hints.push('"modelNumber", "releaseDate", "availability"');
  if (facets.needs_location) hints.push('"address", "hours", "phone", "mapsUrl", "priceRange"');
  if (facets.is_experience) hints.push('"location", "season", "cost", "duration", "difficulty"');
  if (facets.is_content) hints.push('"platform", "creator", "length", "contentType"');
  if (facets.is_service) hints.push('"serviceArea", "pricingModel", "credentials", "responseTime"');
  if (hints.length === 0) return '(empty object if nothing to add)';
  return hints.join(', ') + ' as applicable, plus any other relevant key-value pairs the user would want';
}

export function buildSynthesisPrompt(
  query: string,
  notes: AgentNote[],
  sources: ScrapedSource[],
  config: ResearchConfig,
  facets?: Facets,
  topicalCategory?: string | null,
): string {
  const currentYear = new Date().getUTCFullYear();
  const sections = config.reportSections;
  const effectiveFacets: Facets = facets ?? {
    needs_location: false, is_buyable: true, is_experience: false,
    is_content: false, is_service: false, is_comparative: false,
  };

  const notesByCategory: Record<string, string[]> = {};
  for (const note of notes) {
    const cat = note.category;
    if (!notesByCategory[cat]) notesByCategory[cat] = [];
    notesByCategory[cat].push(note.content);
  }

  const notesText = Object.entries(notesByCategory)
    .map(([cat, items]) => `## ${cat.toUpperCase()}\n${items.map((n, i) => `${i + 1}. ${n}`).join('\n')}`)
    .join('\n\n');

  const sourceText = sources
    .slice(0, 100) // cap for context window
    .map((s, i) => `${i + 1}. [${s.source}] ${s.title} — ${s.url}\n   ${s.content.slice(0, 200)}`)
    .join('\n');

  let sectionInstructions = '';
  if (sections.includes('comparison')) sectionInstructions += '\n- Include a "comparisonTable" array with objects {feature, ...productValues}';
  if (sections.includes('categories')) sectionInstructions += '\n- Include "categories" array: [{name: "Best for Budget", productName, reason}, ...]';
  if (sections.includes('pitfalls')) sectionInstructions += '\n- Include "pitfalls" array of common mistakes or things to avoid';

  const metadataHint = metadataKeysHint(effectiveFacets);
  const categoryHint = topicalCategory
    ? `The topical category is "${topicalCategory}" — use this (or something equivalent) as the "category" field.`
    : '';
  const priceNote = effectiveFacets.is_buyable
    ? '- Every item MUST have a numeric price (best USD estimate, never null).'
    : effectiveFacets.needs_location || effectiveFacets.is_service
      ? '- Price is optional — set null if not applicable (e.g., free attractions). For pricing tiers like "$$" put them in metadata.priceRange.'
      : '- Price is optional — null is fine when irrelevant.';
  const brandNote = effectiveFacets.is_buyable
    ? '- Every item MUST have a non-empty brand.'
    : '- Brand is optional — use an empty string when not applicable (a restaurant or hiking trail has no "brand"; leave it empty and put relevant info in metadata).';

  const todayIso = new Date().toISOString().slice(0, 10);
  return `You are an expert researcher writing a comprehensive report. Analyze the research notes and sources below.

TODAY'S DATE: ${todayIso}  (current year ${currentYear})
${categoryHint}

RULES:
- Be brutally honest. If an item has problems, say so.
- Never recommend something you wouldn't pick yourself.
- Include specific names, identifiers (model numbers, addresses), and data points.
- Rank items by overall recommendation, #1 being top pick.
- Note dates and availability. Avoid recommending discontinued/closed options.
- If data is insufficient for some items, say so.
- STALE-SOURCE RULE: sources carry a [YYYY-MM-DD] publish-date prefix when known. For fast-moving topics (consumer tech, software, apps, current media), DO NOT include any candidate whose newest cited source is more than 12 months older than TODAY'S DATE (${todayIso}). A review from 2023 cannot support a 2026 recommendation. If every source for a candidate is stale, OMIT it — thin results beat wrong results. For evergreen topics (restaurants, hiking trails, classical books, historical information), the rule is relaxed: older sources are fine if the subject itself hasn't changed.
${priceNote}
${brandNote}
- COMPLETENESS IS MANDATORY. Every item object MUST have: non-empty name; a numeric rating 0-5 (inferred if not explicit); AT LEAST 3 specific pros and AT LEAST 2 specific cons (nothing is flawless — if you can't name 2 honest cons it doesn't belong on the list); a verdict of 15+ words. Items missing any of these will be discarded before the user sees them.
- THE "buyersGuide" OBJECT IS REQUIRED AND NON-NEGOTIABLE. Every response MUST include a populated buyersGuide with: a 3-5 sentence "howToChoose" string, at least 3 concrete "pitfalls" strings, and at least 3 concrete "marketingToIgnore" strings. Do NOT omit this field. Do NOT return empty arrays. Output the buyersGuide BEFORE products in the JSON so it is never truncated. Responses missing buyersGuide will be rejected and regenerated.
- imageUrl: extract the single best representative image URL — a DIRECT IMAGE FILE URL, not a page URL. The URL path MUST end in .jpg, .jpeg, .png, .webp, .gif, or .avif (query strings are fine: .jpg?v=123). NEVER use YouTube/Vimeo URLs (those are video pages, not images). NEVER use review or listing pages (alltrails.com/trail/..., tripadvisor.com/Restaurant_Review..., guardian.com/books/...). NEVER use a restaurant's or manufacturer's homepage URL. If the only image URL you can find is a page URL, return empty string — an honest blank is MUCH better than a broken <img src>. When scanning sources for images, look for URLs containing /images/, /photos/, /cdn/, /uploads/, or hostnames like cdn.*, images.*, static.*, media.*.
- metadata: a flat object of string key/value pairs relevant to this item. Suggested keys for this query: ${metadataHint}. Keep values concise (under 120 chars each). Omit keys with no real data.

RESEARCH NOTES:
${notesText || '(No structured notes — work from source data)'}

SOURCES (${sources.length} total):
${sourceText}

OUTPUT: Valid JSON matching this schema:
{
  "summary": "2-4 sentence overview of findings",
  "category": "category label",
  "buyersGuide": {
    "howToChoose": "3-5 sentences on what ACTUALLY matters when picking in this category — the decision framework a savvy buyer uses. Be specific to the category, not generic. e.g. for NAS: bay count, CPU tier for transcoding, ECC RAM, drive compatibility list. For restaurants: cuisine authenticity, service, noise level, parking. For hiking: trail difficulty rating systems, seasonal access, permits.",
    "pitfalls": ["At least 3 specific pitfalls people fall into in this category — each 1-2 sentences, concrete not generic."],
    "marketingToIgnore": ["At least 3 claims/spec-sheet traps that don't matter in practice for this category — each 1-2 sentences, with the WHY."]
  },
  "products": [
    {
      "name": "Full name (include model number, location, or other identifier)",
      "brand": "Brand/chain/operator — empty string if not applicable",
      "price": 299.99,
      "rating": 4.5,
      "productUrl": "Retailer product/reservation/booking URL for this SPECIFIC item (must contain the item's own page path, e.g. amazon.com/dp/XXX or walmart.com/ip/YYY). DO NOT fabricate search-result URLs like amazon.com/s?k=... — if you don't know the SKU-specific URL, return empty string. Empty is infinitely better than a search URL.",
      "manufacturerUrl": "Official home URL (manufacturer for products, restaurant's own website, service provider's site). Empty string if unknown.",
      "imageUrl": "Single https:// image URL extracted from your sources. Empty string if none found.",
      "pros": ["Specific pro 1", "Specific pro 2", "Specific pro 3"],
      "cons": ["Specific con 1", "Specific con 2"],
      "specs": {"key": "value"},
      "metadata": {"key": "value"},
      "verdict": "2-3 sentence honest verdict",
      "rank": 1,
      "bestFor": "who this is best for"
    }
  ],
  "methodology": "N sources analyzed from N providers. Confidence level and data freshness assessment."${sectionInstructions}
}

Respond ONLY with valid JSON.`;
}
