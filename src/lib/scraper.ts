import type { ScrapedSource } from '../types';

// NOTE: Do NOT evaluate `new Date()` at module load. Cloudflare Workers freeze
// the clock at the Unix epoch (1970) during module initialization — real time
// is only available inside a request handler. Always compute year at call time.
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

export async function braveWeb(query: string, apiKey: string, freshness = 'py'): Promise<ScrapedSource[]> {
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
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.log(`[braveWeb] HTTP ${response.status} q="${query}" body=${body.slice(0, 200)}`);
      return [];
    }

    const data: BraveWebResponse = await response.json();
    const results = data?.web?.results ?? [];
    console.log(`[braveWeb] q="${query}" freshness=${freshness} → ${results.length} results`);

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
  } catch (err) {
    console.log(`[braveWeb] ERROR q="${query}": ${err instanceof Error ? err.message : String(err)}`);
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

export async function braveNews(query: string, apiKey: string): Promise<ScrapedSource[]> {
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
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.log(`[braveNews] HTTP ${response.status} q="${query}" body=${body.slice(0, 200)}`);
      return [];
    }

    const data: BraveNewsResponse = await response.json();
    const results = data?.results ?? [];
    console.log(`[braveNews] q="${query}" → ${results.length} results`);

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
  } catch (err) {
    console.log(`[braveNews] ERROR q="${query}": ${err instanceof Error ? err.message : String(err)}`);
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

export async function braveVideos(query: string, apiKey: string): Promise<ScrapedSource[]> {
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
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.log(`[braveVideos] HTTP ${response.status} q="${query}" body=${body.slice(0, 200)}`);
      return [];
    }

    const data: BraveVideoResponse = await response.json();
    const results = data?.results ?? [];
    console.log(`[braveVideos] q="${query}" → ${results.length} results`);

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
  } catch (err) {
    console.log(`[braveVideos] ERROR q="${query}": ${err instanceof Error ? err.message : String(err)}`);
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

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator — fan out to every source in parallel
// ─────────────────────────────────────────────────────────────────────────────

// Brave free tier: 1 req/sec. Serialize calls with spacing so they don't 429.
export const BRAVE_SPACING_MS = 1100;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function scrapeSearchResults(query: string, braveApiKey: string): Promise<ScrapedSource[]> {
  // Compute current year inside the handler — module-level Date is frozen at epoch in CF Workers.
  const currentYear = new Date().getUTCFullYear();

  // Multiple query angles to get broad coverage
  const directQuery = query;
  const reviewQuery = `${query} review ${currentYear}`;
  const bestQuery = `best ${query} ${currentYear}`;
  const versusQuery = `${query} vs alternatives comparison`;

  // HN runs in parallel — different provider, no shared rate limit
  const hnPromise = hackerNews(query);

  // Brave calls must be SERIAL (free tier = 1 req/sec)
  // Order from most-likely-to-have-results to nice-to-have, so early ones
  // always run even if a later one somehow blocks.
  type BraveCall = { label: string; fn: () => Promise<ScrapedSource[]> };
  const braveCalls: BraveCall[] = [
    { label: 'web:best-pm', fn: () => braveWeb(bestQuery, braveApiKey, 'pm') }, // freshest
    { label: 'news', fn: () => braveNews(`${query} ${currentYear}`, braveApiKey) },
    { label: 'videos', fn: () => braveVideos(`${query} review`, braveApiKey) },
    { label: 'web:review', fn: () => braveWeb(reviewQuery, braveApiKey) },
    { label: 'web:direct', fn: () => braveWeb(directQuery, braveApiKey) },
    { label: 'web:versus', fn: () => braveWeb(versusQuery, braveApiKey) },
  ];

  const sources: ScrapedSource[] = [];
  for (let i = 0; i < braveCalls.length; i++) {
    const call = braveCalls[i];
    try {
      const result = await call.fn();
      console.log(`[scrape] ${call.label} → ${result.length}`);
      sources.push(...result);
    } catch (err) {
      console.log(`[scrape] ${call.label} FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Space out requests so Brave free tier (1 req/sec) is happy.
    if (i < braveCalls.length - 1) await sleep(BRAVE_SPACING_MS);
  }

  // Collect HN result (started at the beginning, should be done by now)
  try {
    const hnResults = await hnPromise;
    console.log(`[scrape] hn → ${hnResults.length}`);
    sources.push(...hnResults);
  } catch (err) {
    console.log(`[scrape] hn FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const deduped = sources.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
  const counts = deduped.reduce<Record<string, number>>((acc, s) => {
    acc[s.source] = (acc[s.source] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`[scrape] deduped total=${deduped.length} by-type=${JSON.stringify(counts)}`);
  return deduped;
}
