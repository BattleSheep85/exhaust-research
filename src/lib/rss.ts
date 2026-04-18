import type { ScrapedSource } from '../types';

const RSS_TIMEOUT_MS = 6000;

/** Known product-review RSS feeds — curated expert sources. */
const REVIEW_FEEDS: ReadonlyArray<{ name: string; url: string }> = [
  { name: 'Wirecutter', url: 'https://www.nytimes.com/wirecutter/feed/' },
  { name: 'RTINGS', url: 'https://www.rtings.com/latest-rss.xml' },
  { name: 'Tom\'s Hardware', url: 'https://www.tomshardware.com/feeds/all' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/reviews/index.xml' },
  { name: 'TechRadar', url: 'https://www.techradar.com/rss' },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
];

/**
 * Search RSS feeds from expert review sites for query-relevant articles.
 * Fetches all feeds in parallel, filters items by keyword relevance.
 */
export async function rssSearch(query: string): Promise<ScrapedSource[]> {
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  if (keywords.length === 0) return [];

  const results = await Promise.allSettled(
    REVIEW_FEEDS.map((feed) => fetchAndParseFeed(feed.name, feed.url, keywords)),
  );

  const sources: ScrapedSource[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      sources.push(...result.value);
    }
  }

  console.log(`[rss] q="${query}" → ${sources.length} relevant items from ${REVIEW_FEEDS.length} feeds`);
  return sources;
}

async function fetchAndParseFeed(
  name: string,
  feedUrl: string,
  keywords: string[],
): Promise<ScrapedSource[]> {
  try {
    const response = await fetch(feedUrl, {
      signal: AbortSignal.timeout(RSS_TIMEOUT_MS),
      headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
    });

    if (!response.ok) {
      console.log(`[rss] ${name} HTTP ${response.status}`);
      return [];
    }

    const xml = await response.text();
    const items = parseRssItems(xml);

    // Filter items by keyword relevance — require 2+ keyword matches to reduce noise
    const minMatches = keywords.length >= 3 ? 2 : 1;
    return items
      .filter((item) => {
        const text = `${item.title} ${item.description}`.toLowerCase();
        const matchCount = keywords.filter((kw) => text.includes(kw)).length;
        return matchCount >= minMatches;
      })
      .slice(0, 5)
      .map((item) => {
        // formatDate() already normalized to YYYY-MM-DD when parseable; fall back
        // to raw string parsing for anything non-standard.
        let publishedAt: number | undefined;
        if (item.pubDate) {
          const ms = Date.parse(item.pubDate);
          if (!Number.isNaN(ms)) publishedAt = Math.floor(ms / 1000);
        }
        return {
          url: item.link,
          title: `[${name}] ${item.title}`,
          content: [
            item.pubDate ? `[${item.pubDate}]` : '',
            item.description,
          ].filter(Boolean).join('\n'),
          source: 'rss',
          publishedAt,
        };
      });
  } catch (err) {
    console.log(`[rss] ${name} ERROR: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];

  // Handle both RSS <item> and Atom <entry>
  const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null && items.length < 20) {
    const block = match[1];

    const title = extractTag(block, 'title');
    const link = extractLink(block);
    const description = stripCdata(extractTag(block, 'description') || extractTag(block, 'summary') || extractTag(block, 'content'));
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated');

    if (title && link) {
      items.push({
        title: stripTags(title).trim(),
        link,
        description: stripTags(description).trim().slice(0, 500),
        pubDate: pubDate ? formatDate(pubDate) : '',
      });
    }
  }

  return items;
}

function extractTag(block: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = block.match(regex);
  return match ? match[1] : '';
}

function extractLink(block: string): string {
  // RSS: <link>url</link>
  const rssLink = extractTag(block, 'link');
  if (rssLink && rssLink.startsWith('http')) return rssLink.trim();

  // Atom: <link href="url"/>
  const atomMatch = block.match(/<link[^>]+href="([^"]+)"/i);
  if (atomMatch) return atomMatch[1];

  return '';
}

function stripCdata(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr.trim());
    if (isNaN(d.getTime())) return dateStr.trim();
    return d.toISOString().split('T')[0];
  } catch {
    return dateStr.trim();
  }
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'best', 'with',
  'this', 'that', 'from', 'they', 'will', 'what', 'when', 'make', 'like',
  'just', 'over', 'such', 'take', 'than', 'them', 'very', 'some', 'into',
  '2024', '2025', '2026', '2027',
]);
