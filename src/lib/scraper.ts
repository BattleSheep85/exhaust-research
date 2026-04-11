import type { ScrapedSource } from '../types';

const CURRENT_YEAR = new Date().getUTCFullYear();
const TIMEOUT_MS = 8000;

// ─────────────────────────────────────────────────────────────────────────────
// Brave Web Search
// ─────────────────────────────────────────────────────────────────────────────

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
  extra_snippets?: string[];
  age?: string;
  page_age?: string;
}

interface BraveWebResponse {
  web?: { results?: BraveWebResult[] };
}

async function braveWeb(query: string, apiKey: string, freshness = 'py'): Promise<ScrapedSource[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      count: '10',
      extra_snippets: '1',
      freshness,
    });
    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    });
    if (!response.ok) return [];

    const data: BraveWebResponse = await response.json();
    const results = data?.web?.results ?? [];

    return results.slice(0, 8).map((r) => ({
      url: r.url,
      title: r.title,
      content: [
        r.age ? `[${r.age}]` : '',
        r.description,
        ...(r.extra_snippets ?? []),
      ].filter(Boolean).join('\n\n'),
      source: 'web',
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Brave News Search — product launches, reviews, recent releases
// ─────────────────────────────────────────────────────────────────────────────

interface BraveNewsResult {
  title: string;
  url: string;
  description: string;
  age?: string;
  extra_snippets?: string[];
}

interface BraveNewsResponse {
  results?: BraveNewsResult[];
}

async function braveNews(query: string, apiKey: string): Promise<ScrapedSource[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      count: '10',
      extra_snippets: '1',
      freshness: 'py',
    });
    const response = await fetch(`https://api.search.brave.com/res/v1/news/search?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    });
    if (!response.ok) return [];

    const data: BraveNewsResponse = await response.json();
    const results = data?.results ?? [];

    return results.slice(0, 6).map((r) => ({
      url: r.url,
      title: r.title,
      content: [
        r.age ? `[${r.age}]` : '',
        r.description,
        ...(r.extra_snippets ?? []),
      ].filter(Boolean).join('\n\n'),
      source: 'news',
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Brave Video Search — YouTube reviews are product research gold
// ─────────────────────────────────────────────────────────────────────────────

interface BraveVideoResult {
  title: string;
  url: string;
  description?: string;
  age?: string;
  video?: { creator?: string; duration?: string };
}

interface BraveVideoResponse {
  results?: BraveVideoResult[];
}

async function braveVideos(query: string, apiKey: string): Promise<ScrapedSource[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      count: '10',
      freshness: 'py',
    });
    const response = await fetch(`https://api.search.brave.com/res/v1/videos/search?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    });
    if (!response.ok) return [];

    const data: BraveVideoResponse = await response.json();
    const results = data?.results ?? [];

    return results.slice(0, 6).map((r) => ({
      url: r.url,
      title: r.title,
      content: [
        r.age ? `[${r.age}]` : '',
        r.video?.creator ? `Channel: ${r.video.creator}` : '',
        r.video?.duration ? `Duration: ${r.video.duration}` : '',
        r.description ?? '',
      ].filter(Boolean).join('\n'),
      source: 'video',
    }));
  } catch {
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

async function hackerNews(query: string): Promise<ScrapedSource[]> {
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
    if (!response.ok) return [];

    const data: HNResponse = await response.json();
    const hits = data?.hits ?? [];

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
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator — fan out to every source in parallel
// ─────────────────────────────────────────────────────────────────────────────

export async function scrapeSearchResults(query: string, braveApiKey: string): Promise<ScrapedSource[]> {
  // Multiple query angles to get broad coverage
  const directQuery = query;
  const reviewQuery = `${query} review ${CURRENT_YEAR}`;
  const bestQuery = `best ${query} ${CURRENT_YEAR}`;
  const versusQuery = `${query} vs alternatives comparison`;

  const results = await Promise.allSettled([
    // Web search — 4 query angles
    braveWeb(directQuery, braveApiKey),
    braveWeb(reviewQuery, braveApiKey),
    braveWeb(bestQuery, braveApiKey, 'pm'), // past month for freshest picks
    braveWeb(versusQuery, braveApiKey),
    // News — recent releases and launches
    braveNews(`${query} ${CURRENT_YEAR}`, braveApiKey),
    // Videos — YouTube reviews
    braveVideos(`${query} review`, braveApiKey),
    // HackerNews — tech community discussions
    hackerNews(query),
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
