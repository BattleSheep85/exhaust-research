import type { ScrapedSource, AgentState, ResearchConfig, ToolCallObj, Facets } from '../types';
import { tavilySearch, hackerNews } from './scraper';
import { duckduckgoSearch } from './duckduckgo';
import { rssSearch } from './rss';
import { fetchPageContent } from './jina';
import { placesTextSearch, placesToScrapedSources } from './places';

// ─── Tool definitions (OpenAI-compatible format for OpenRouter) ──────────────

const PLACES_TOOL = {
  type: 'function' as const,
  function: {
    name: 'places_search',
    description: 'Google Places Text Search — returns structured real-world business/location data with verified addresses, phone numbers, opening hours, ratings, and Maps URLs. STRONGLY preferred over web_search for any location-bound query (restaurants, shops, venues, services with a physical address). Call this FIRST when researching places, then enrich with web_search for reviews and depth.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Places text query. Include a city or region. Examples: "best italian restaurant in Austin TX", "coffee shops near Williamsburg Brooklyn".' },
      },
      required: ['query'],
    },
  },
};

export const AGENT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'web_search',
      description: 'Search the web for product information, reviews, comparisons, and discussions. Call multiple times with different queries and providers for broad coverage.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query. Be specific — include product names, model numbers, years.' },
          provider: {
            type: 'string',
            enum: ['web', 'news', 'video', 'hackernews', 'duckduckgo', 'rss'],
            description: 'Search provider. web=general web (Tavily), news=recent articles, video=YouTube reviews, hackernews=tech discussions, duckduckgo=alternative web results, rss=expert review sites (Wirecutter/RTINGS/etc).',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_page',
      description: 'Read the full content of a web page. Use on the most promising sources — expert reviews, detailed comparisons, hands-on tests. Skip listicles and thin SEO content.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL to read' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'note',
      description: 'Record a research finding. Use this to build structured knowledge about products as you discover information. The synthesis step will use these notes to write the final report.',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['product', 'comparison', 'issue', 'pricing', 'recommendation'],
            description: 'product=specs/features, comparison=vs other products, issue=known problems/complaints, pricing=price/deal info, recommendation=expert picks/verdicts',
          },
          content: { type: 'string', description: 'The finding. Be specific — include model numbers, prices, specs, source attribution.' },
        },
        required: ['category', 'content'],
      },
    },
  },
];

// Builds the tool set exposed to the agent for this research. Places tool is
// gated: only included when we have both a Places API key AND the classifier
// flagged the query as needs_location. That keeps the tool catalog shorter for
// non-local queries (fewer spurious calls) and guarantees zero Places API cost
// when the key is unset.
export function buildAgentTools(facets?: Facets, placesApiKey?: string): typeof AGENT_TOOLS {
  if (placesApiKey && facets?.needs_location) {
    return [PLACES_TOOL, ...AGENT_TOOLS];
  }
  return AGENT_TOOLS;
}

// ─── Tool execution ──────────────────────────────────────────────────────────

export interface ToolContext {
  tavilyApiKey: string;
  placesApiKey?: string;
}

/** Returns [resultText, subrequestsUsed] */
export async function executeTool(
  toolCall: ToolCallObj,
  state: AgentState,
  config: ResearchConfig,
  ctx: ToolContext,
): Promise<[string, number]> {
  const name = toolCall.function.name;
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    return ['Error: invalid JSON in tool arguments', 0];
  }

  switch (name) {
    case 'web_search':
      return executeSearch(args, state, config, ctx.tavilyApiKey);
    case 'read_page':
      return executeReadPage(args, state, config);
    case 'note':
      return [executeNote(args, state), 0];
    case 'places_search':
      return executePlacesSearch(args, state, config, ctx.placesApiKey);
    default:
      return [`Error: unknown tool "${name}"`, 0];
  }
}

async function executePlacesSearch(
  args: Record<string, unknown>,
  state: AgentState,
  config: ResearchConfig,
  placesApiKey?: string,
): Promise<[string, number]> {
  if (!placesApiKey) return ['Error: places_search is not available (no API key)', 0];
  if (state.searchCount >= config.maxSearches) {
    return ['Search budget exhausted. Use note() to record findings or stop.', 0];
  }
  const query = typeof args.query === 'string' ? args.query : '';
  if (!query) return ['Error: query is required', 0];

  state.searchCount++;
  const places = await placesTextSearch(query, placesApiKey, 10);
  if (places.length === 0) {
    return [`places_search "${query}": 0 results. Fall back to web_search.`, 1];
  }

  const sources = placesToScrapedSources(places);
  const seenUrls = new Set(state.sources.map((s) => s.url));
  const newSources = sources.filter((s) => !s.url || !seenUrls.has(s.url));
  state.sources.push(...newSources);

  // Format for the LLM — condensed preview of each place. Full structured
  // content is in state.sources for synthesis.
  const preview = places.map((p, i) => {
    const bits = [`${i + 1}. ${p.name}`];
    if (p.address) bits.push(`   ${p.address}`);
    if (p.rating != null) bits.push(`   ⭐ ${p.rating} (${p.ratingCount ?? '?'} reviews)${p.priceLevel ? ` · ${p.priceLevel}` : ''}`);
    if (p.hours) bits.push(`   Hours: ${p.hours.slice(0, 120)}`);
    if (p.phone) bits.push(`   ☎ ${p.phone}`);
    if (p.summary) bits.push(`   "${p.summary.slice(0, 150)}"`);
    return bits.join('\n');
  }).join('\n\n');

  return [`places_search "${query}": ${places.length} structured results:\n\n${preview}`, 1];
}

async function executeSearch(
  args: Record<string, unknown>,
  state: AgentState,
  config: ResearchConfig,
  tavilyApiKey: string,
): Promise<[string, number]> {
  if (state.searchCount >= config.maxSearches) {
    return ['Search budget exhausted. Use note() to record findings or stop.', 0];
  }

  const query = typeof args.query === 'string' ? args.query : '';
  const provider = typeof args.provider === 'string' ? args.provider : 'web';

  if (!query) return ['Error: query is required', 0];

  state.searchCount++;
  let results: ScrapedSource[];
  let subs = 0;

  switch (provider) {
    case 'web':
      results = await tavilySearch(query, tavilyApiKey, { searchDepth: 'basic', sourceLabel: 'web' });
      subs = 1;
      break;
    case 'news':
      results = await tavilySearch(query, tavilyApiKey, { topic: 'news', timeRange: 'y', sourceLabel: 'news' });
      subs = 1;
      break;
    case 'video':
      results = await tavilySearch(query, tavilyApiKey, {
        includeDomains: ['youtube.com', 'youtu.be'],
        sourceLabel: 'video',
      });
      subs = 1;
      break;
    case 'hackernews':
      results = await hackerNews(query);
      subs = 1;
      break;
    case 'duckduckgo':
      results = await duckduckgoSearch(query);
      subs = 1;
      break;
    case 'rss':
      results = await rssSearch(query);
      subs = 6; // up to 6 RSS feeds fetched in parallel
      break;
    default:
      results = await tavilySearch(query, tavilyApiKey, { searchDepth: 'basic', sourceLabel: 'web' });
      subs = 1;
      break;
  }

  // Deduplicate against existing sources
  const seenUrls = new Set(state.sources.map((s) => s.url));
  const newResults = results.filter((r) => !seenUrls.has(r.url));
  state.sources.push(...newResults);

  if (newResults.length === 0) {
    return [`Search "${query}" (${provider}): 0 new results (${results.length} duplicates filtered). Try a different query or provider.`, subs];
  }

  // Format results for the LLM — keep snippets short to reduce context bloat
  const formatted = newResults
    .map((r, i) => `${i + 1}. [${r.source}] ${r.title}\n   ${r.url}\n   ${r.content.slice(0, 150)}`)
    .join('\n\n');

  return [`Search "${query}" (${provider}): ${newResults.length} new results (${state.sources.length} total):\n\n${formatted}`, subs];
}

async function executeReadPage(
  args: Record<string, unknown>,
  state: AgentState,
  config: ResearchConfig,
): Promise<[string, number]> {
  if (state.fetchCount >= config.maxFetches) {
    return ['Page-read budget exhausted. Use note() to record findings from snippets or stop.', 0];
  }

  const url = typeof args.url === 'string' ? args.url : '';
  if (!url || !url.startsWith('http')) return ['Error: valid URL is required', 0];

  state.fetchCount++;
  const content = await fetchPageContent(url);

  if (!content) {
    return [`Could not read ${url} — page may be paywalled, JS-only, or blocked. Use the snippet instead.`, 1];
  }

  // Update the source entry if we have it, so synthesis gets the full text
  const existing = state.sources.find((s) => s.url === url);
  if (existing) {
    existing.content = content;
  } else {
    state.sources.push({ url, title: url, content, source: 'fetched' });
  }

  // Return truncated for conversation context (full text is stored in sources for synthesis)
  const preview = content.length > 1500 ? content.slice(0, 1500) + '\n\n[...truncated, full text stored for synthesis]' : content;
  return [`Page content from ${url} (${content.length} chars):\n\n${preview}`, 1];
}

function executeNote(
  args: Record<string, unknown>,
  state: AgentState,
): string {
  const category = typeof args.category === 'string' ? args.category : 'product';
  const content = typeof args.content === 'string' ? args.content : '';

  if (!content) return 'Error: content is required';

  state.notes.push({ category, content });
  return `Noted (${category}): ${content.slice(0, 100)}${content.length > 100 ? '...' : ''} [${state.notes.length} total notes]`;
}
