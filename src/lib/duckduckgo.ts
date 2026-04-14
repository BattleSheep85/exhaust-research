import type { ScrapedSource } from '../types';

const DDG_TIMEOUT_MS = 8000;

/**
 * Scrape DuckDuckGo HTML search results.
 * No auth required, no API key, uses Bing's index.
 * May be blocked from CF Worker IPs — returns [] on failure.
 */
export async function duckduckgoSearch(query: string): Promise<ScrapedSource[]> {
  try {
    const params = new URLSearchParams({ q: query });
    const response = await fetch(`https://html.duckduckgo.com/html/?${params}`, {
      signal: AbortSignal.timeout(DDG_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ChrisputerLabs/1.0)',
        Accept: 'text/html',
      },
    });

    if (!response.ok) {
      console.log(`[ddg] HTTP ${response.status} q="${query}"`);
      return [];
    }

    const html = await response.text();
    return parseResults(html);
  } catch (err) {
    console.log(`[ddg] ERROR q="${query}": ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

function parseResults(html: string): ScrapedSource[] {
  const results: ScrapedSource[] = [];

  // DDG HTML results are in <div class="result"> blocks
  // Each has <a class="result__a"> for title+URL and <a class="result__snippet"> for description
  const resultBlocks = html.split(/class="result\s/);

  for (let i = 1; i < resultBlocks.length && results.length < 10; i++) {
    const block = resultBlocks[i];

    // Extract URL from result__url or result__a href
    const urlMatch = block.match(/href="\/\/duckduckgo\.com\/l\/\?uddg=([^&"]+)/);
    const directUrlMatch = block.match(/href="(https?:\/\/[^"]+)"/);
    const rawUrl = urlMatch ? decodeURIComponent(urlMatch[1]) : directUrlMatch?.[1] ?? '';
    if (!rawUrl || !rawUrl.startsWith('http')) continue;

    // Extract title
    const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)/);
    const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : '';
    if (!title) continue;

    // Extract snippet
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\//);
    const snippet = snippetMatch ? decodeEntities(stripTags(snippetMatch[1]).trim()) : '';

    results.push({
      url: rawUrl,
      title,
      content: snippet,
      source: 'duckduckgo',
    });
  }

  console.log(`[ddg] q parsed → ${results.length} results`);
  return results;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}
