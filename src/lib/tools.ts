import type { ScrapedSource, AgentState, ResearchConfig, ToolCallObj } from '../types';
import { braveWeb, braveNews, braveVideos, hackerNews, BRAVE_SPACING_MS, sleep } from './scraper';
import { duckduckgoSearch } from './duckduckgo';
import { rssSearch } from './rss';
import { fetchPageContent } from './jina';

// ─── Tool definitions (OpenAI-compatible format for OpenRouter) ──────────────

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
            enum: ['brave', 'news', 'video', 'hackernews', 'duckduckgo', 'rss'],
            description: 'Search provider. brave=general web, news=recent articles, video=YouTube reviews, hackernews=tech discussions, duckduckgo=alternative web results, rss=expert review sites (Wirecutter/RTINGS/etc).',
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

// ─── Tool execution ──────────────────────────────────────────────────────────

let lastBraveCallTime = 0;

async function enforceRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastBraveCallTime;
  if (elapsed < BRAVE_SPACING_MS) {
    await sleep(BRAVE_SPACING_MS - elapsed);
  }
  lastBraveCallTime = Date.now();
}

/** Returns [resultText, subrequestsUsed] */
export async function executeTool(
  toolCall: ToolCallObj,
  state: AgentState,
  config: ResearchConfig,
  braveApiKey: string,
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
      return executeSearch(args, state, config, braveApiKey);
    case 'read_page':
      return executeReadPage(args, state, config);
    case 'note':
      return [executeNote(args, state), 0];
    default:
      return [`Error: unknown tool "${name}"`, 0];
  }
}

async function executeSearch(
  args: Record<string, unknown>,
  state: AgentState,
  config: ResearchConfig,
  braveApiKey: string,
): Promise<[string, number]> {
  if (state.searchCount >= config.maxSearches) {
    return ['Search budget exhausted. Use note() to record findings or stop.', 0];
  }

  const query = typeof args.query === 'string' ? args.query : '';
  const provider = typeof args.provider === 'string' ? args.provider : 'brave';

  if (!query) return ['Error: query is required', 0];

  state.searchCount++;
  let results: ScrapedSource[];
  let subs = 0;

  switch (provider) {
    case 'brave': {
      await enforceRateLimit();
      results = await braveWeb(query, braveApiKey);
      subs = 1;
      break;
    }
    case 'news': {
      await enforceRateLimit();
      results = await braveNews(query, braveApiKey);
      subs = 1;
      break;
    }
    case 'video': {
      await enforceRateLimit();
      results = await braveVideos(query, braveApiKey);
      subs = 1;
      break;
    }
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
      results = await braveWeb(query, braveApiKey);
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
