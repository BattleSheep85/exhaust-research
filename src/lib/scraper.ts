import type { ScrapedSource } from '../types';

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
  extra_snippets?: string[];
}

interface BraveSearchResponse {
  web?: { results?: BraveWebResult[] };
}

async function scrapeBraveSearch(query: string, apiKey: string): Promise<ScrapedSource[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      count: '10',
      extra_snippets: '1',
    });
    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      signal: AbortSignal.timeout(8000),
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    });
    if (!response.ok) return [];

    const data: BraveSearchResponse = await response.json();
    const results = data?.web?.results ?? [];

    return results.slice(0, 8).map((r) => ({
      url: r.url,
      title: r.title,
      content: [r.description, ...(r.extra_snippets ?? [])].join('\n\n'),
      source: 'brave',
    }));
  } catch {
    return [];
  }
}

interface RedditResponse {
  data?: {
    children?: Array<{
      data: {
        title: string;
        selftext: string;
        permalink: string;
        score: number;
      };
    }>;
  };
}

async function scrapeReddit(query: string): Promise<ScrapedSource[]> {
  try {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&t=year&limit=10`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Exhaustive/1.0 (product research bot)',
      },
    });
    if (!response.ok) return [];

    const data: RedditResponse = await response.json();
    const posts = data?.data?.children ?? [];

    return posts
      .filter((p) => p.data.score > 5)
      .slice(0, 5)
      .map((p) => ({
        url: `https://www.reddit.com${p.data.permalink}`,
        title: p.data.title,
        content: p.data.selftext.slice(0, 3000),
        source: 'reddit',
      }));
  } catch {
    return [];
  }
}

export async function scrapeSearchResults(query: string, braveApiKey: string): Promise<ScrapedSource[]> {
  const results = await Promise.allSettled([
    scrapeBraveSearch(query, braveApiKey),
    scrapeBraveSearch(`${query} review reddit`, braveApiKey),
    scrapeReddit(query),
  ]);

  const sources: ScrapedSource[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      sources.push(...result.value);
    }
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  return sources.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}
