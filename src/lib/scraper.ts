import type { ScrapedSource } from '../types';

// NOTE: Do NOT evaluate `new Date()` at module load. Cloudflare Workers freeze
// the clock at the Unix epoch (1970) during module initialization — real time
// is only available inside a request handler. Always compute year at call time.
const TIMEOUT_MS = 8000;

// ─────────────────────────────────────────────────────────────────────────────
// Tavily Search — https://docs.tavily.com/docs/rest-api/api-reference
// One provider, three flavors via topic + include_domains. Unlike Brave, no
// per-second rate limit — we can fire concurrent queries.
// ─────────────────────────────────────────────────────────────────────────────

interface TavilyResult {
  url: string;
  title: string;
  content: string;
  score?: number;
  published_date?: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
  answer?: string;
}

export interface TavilyOpts {
  topic?: 'general' | 'news';
  searchDepth?: 'basic' | 'advanced';
  includeDomains?: string[];
  timeRange?: 'd' | 'w' | 'm' | 'y';
  maxResults?: number;
  sourceLabel?: string;
}

export async function tavilySearch(
  query: string,
  apiKey: string,
  opts: TavilyOpts = {},
): Promise<ScrapedSource[]> {
  try {
    const body: Record<string, unknown> = {
      query,
      topic: opts.topic ?? 'general',
      search_depth: opts.searchDepth ?? 'basic',
      max_results: opts.maxResults ?? 10,
    };
    if (opts.includeDomains && opts.includeDomains.length > 0) body.include_domains = opts.includeDomains;
    if (opts.timeRange) body.time_range = opts.timeRange;

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.log(`[tavily] HTTP ${response.status} q="${query}" body=${text.slice(0, 200)}`);
      return [];
    }
    const data: TavilyResponse = await response.json();
    const results = data?.results ?? [];
    const label = opts.sourceLabel ?? (opts.topic === 'news' ? 'news' : 'web');
    console.log(`[tavily] q="${query}" label=${label} depth=${opts.searchDepth ?? 'basic'} → ${results.length}`);

    return results.map((r) => ({
      url: r.url,
      title: r.title,
      content: [
        r.published_date ? `[${r.published_date}]` : '',
        r.content,
      ].filter(Boolean).join('\n'),
      source: label,
    }));
  } catch (err) {
    console.log(`[tavily] ERROR q="${query}": ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HackerNews via Algolia — free, no auth, works from CF Workers
// ─────────────────────────────────────────────────────────────────────────────

interface HNHit {
  title?: string;
  url?: string;
  story_text?: string;
  points?: number;
  num_comments?: number;
  objectID: string;
  created_at?: string;
}

interface HNResponse {
  hits?: HNHit[];
}

export async function hackerNews(query: string): Promise<ScrapedSource[]> {
  try {
    const params = new URLSearchParams({
      query,
      tags: 'story',
      hitsPerPage: '10',
      // Stories from the past year (Unix timestamp)
      numericFilters: `created_at_i>${Math.floor(Date.now() / 1000) - 365 * 24 * 3600}`,
    });
    const response = await fetch(`https://hn.algolia.com/api/v1/search?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      console.log(`[hackerNews] HTTP ${response.status} q="${query}"`);
      return [];
    }

    const data: HNResponse = await response.json();
    const hits = data?.hits ?? [];
    console.log(`[hackerNews] q="${query}" → ${hits.length} hits (before filter)`);

    return hits
      .filter((h) => h.title && (h.points ?? 0) >= 10)
      .slice(0, 5)
      .map((h) => ({
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        title: h.title || '',
        content: [
          h.created_at ? `[${h.created_at}]` : '',
          `${h.points ?? 0} points, ${h.num_comments ?? 0} comments`,
          (h.story_text ?? '').slice(0, 2000),
          `Discussion: https://news.ycombinator.com/item?id=${h.objectID}`,
        ].filter(Boolean).join('\n'),
        source: 'hackernews',
      }));
  } catch (err) {
    console.log(`[hackerNews] ERROR q="${query}": ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
