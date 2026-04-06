export interface ScrapedSource {
  url: string;
  title: string;
  content: string;
  source: string;
}

const SEARCH_SOURCES = [
  { name: 'reddit', template: (q: string) => `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=relevance&t=year&limit=10` },
];

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  return fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'Accept': 'text/html,application/json',
    },
  });
}

function extractTextFromHtml(html: string): string {
  // Strip tags, scripts, styles — keep text content
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 5000); // Cap per source
}

export async function scrapeReddit(query: string): Promise<ScrapedSource[]> {
  try {
    const url = SEARCH_SOURCES[0].template(query);
    const response = await fetchWithTimeout(url);
    if (!response.ok) return [];

    const data = await response.json() as { data?: { children?: Array<{ data: { title: string; selftext: string; permalink: string; score: number; num_comments: number } }> } };
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

export async function scrapeUrl(url: string): Promise<ScrapedSource | null> {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) return null;

    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.trim() ?? url;
    const content = extractTextFromHtml(html);

    return { url, title, content, source: new URL(url).hostname };
  } catch {
    return null;
  }
}

export async function scrapeSearchResults(query: string): Promise<ScrapedSource[]> {
  // Fan out to multiple sources in parallel
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
