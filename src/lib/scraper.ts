import type { ScrapedSource } from '../types';

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

export async function scrapeSearchResults(query: string): Promise<ScrapedSource[]> {
  const results = await Promise.allSettled([
    scrapeReddit(query),
    scrapeReddit(`${query} review`),
    scrapeReddit(`${query} vs`),
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
