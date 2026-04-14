const JINA_TIMEOUT_MS = 8000;
const MAX_CONTENT_LENGTH = 15_000;

/**
 * Fetch full page content as markdown via Jina Reader.
 * Free tier: ~20 req/min. Returns clean markdown with headings, lists, tables preserved.
 * Falls back to empty string on any error — caller keeps the original snippet.
 */
export async function fetchPageContent(url: string): Promise<string> {
  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
      headers: {
        Accept: 'text/markdown',
        'X-Return-Format': 'markdown',
      },
    });

    if (!response.ok) {
      console.log(`[jina] HTTP ${response.status} for ${url}`);
      return '';
    }

    const text = await response.text();
    // Jina sometimes returns boilerplate for blocked/empty pages
    if (text.length < 100) return '';
    return text.slice(0, MAX_CONTENT_LENGTH);
  } catch (err) {
    console.log(`[jina] ERROR ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}
