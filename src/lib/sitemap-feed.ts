import type { Env } from '../types';
import { displayQuery, escapeXml, publicResearchFilter } from './utils';
import { OG_IMAGE_SVG } from './static-assets';

// Newest completed research timestamp — shared lastmod signal for home, browse,
// sitemap, and feed. The SELECT MAX + EXISTS subquery cost scales with the
// research table; KV-cache for 60s so cold home/browse requests don't re-run
// the query on every cache-miss burst.
const LASTMOD_CACHE_TTL = 60;
export async function getLatestResearchLastmod(env: Env, cacheVersion: string): Promise<number | undefined> {
  const key = `lastmod:${cacheVersion}`;
  const cached = await env.CACHE.get(key);
  if (cached) {
    const n = parseInt(cached, 10);
    if (n > 0) return n;
  }
  const row = await env.DB.prepare(
    `SELECT MAX(COALESCE(research.completed_at, research.created_at)) AS lm
     FROM research
     WHERE ${publicResearchFilter('research')}`
  ).first<{ lm: number | null }>();
  const lm = row?.lm && row.lm > 0 ? row.lm : undefined;
  if (lm) await env.CACHE.put(key, String(lm), { expirationTtl: LASTMOD_CACHE_TTL });
  return lm;
}

export async function generateSitemap(origin: string, env: Env, ifModifiedSince: string | null, aboutLastmod: string): Promise<Response> {
  // Only expose research pages with actual product cards. Honest-no-data results
  // (garbage queries, insufficient source data) are thin content and will hurt
  // ranking if Google crawls them.
  const rows = await env.DB.prepare(
    `WITH ranked AS (
       SELECT r.slug, r.created_at, COALESCE(r.completed_at, r.created_at) AS lastmod,
              ROW_NUMBER() OVER (PARTITION BY COALESCE(r.canonical_query, r.slug) ORDER BY r.created_at DESC) AS rn
       FROM research r
       WHERE ${publicResearchFilter('r')}
     )
     SELECT slug, created_at, lastmod FROM ranked WHERE rn = 1
     ORDER BY created_at DESC
     LIMIT 5000`
  ).all<{ slug: string; created_at: number; lastmod: number }>();

  const results = rows.results ?? [];
  const newestLastmod = results[0]?.lastmod ?? 0;
  const lastModifiedHttp = new Date(newestLastmod * 1000).toUTCString();

  if (ifModifiedSince && newestLastmod > 0) {
    const since = Date.parse(ifModifiedSince);
    if (!isNaN(since) && Math.floor(since / 1000) >= newestLastmod) {
      return new Response(null, { status: 304, headers: { 'Last-Modified': lastModifiedHttp, 'Cache-Control': 'public, max-age=3600' } });
    }
  }

  const entries = results.map((r) => {
    const date = new Date(r.lastmod * 1000).toISOString().split('T')[0];
    return `<url><loc>${origin}/research/${r.slug}</loc><lastmod>${date}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`;
  }).join('\n');

  // Home and /research are dynamic indexes — their lastmod is the newest
  // research completion. Signals freshness to crawlers for recrawl scheduling.
  const dynamicLastmod = newestLastmod ? `<lastmod>${new Date(newestLastmod * 1000).toISOString().split('T')[0]}</lastmod>` : '';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${origin}/</loc>${dynamicLastmod}<changefreq>daily</changefreq><priority>1.0</priority></url>
<url><loc>${origin}/research</loc>${dynamicLastmod}<changefreq>daily</changefreq><priority>0.8</priority></url>
<url><loc>${origin}/about</loc><lastmod>${aboutLastmod}</lastmod><changefreq>monthly</changefreq><priority>0.3</priority></url>
${entries}
</urlset>`;

  const headers: Record<string, string> = { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' };
  if (newestLastmod > 0) headers['Last-Modified'] = lastModifiedHttp;
  return new Response(xml, { headers });
}

export async function generateAtomFeed(origin: string, env: Env, ifModifiedSince: string | null): Promise<Response> {
  const rows = await env.DB.prepare(
    `WITH ranked AS (
       SELECT r.slug, r.query, r.summary, r.category, r.created_at, COALESCE(r.completed_at, r.created_at) AS updated,
              ROW_NUMBER() OVER (PARTITION BY COALESCE(r.canonical_query, r.slug) ORDER BY r.created_at DESC) AS rn
       FROM research r
       WHERE ${publicResearchFilter('r')}
     )
     SELECT slug, query, summary, category, created_at, updated FROM ranked WHERE rn = 1
     ORDER BY updated DESC
     LIMIT 50`
  ).all<{ slug: string; query: string; summary: string | null; category: string | null; created_at: number; updated: number }>();

  const results = rows.results ?? [];
  const latestUpdated = results[0]?.updated ?? Math.floor(Date.now() / 1000);
  const feedUpdated = new Date(latestUpdated * 1000).toISOString();
  const lastModifiedHttp = new Date(latestUpdated * 1000).toUTCString();
  if (ifModifiedSince) {
    const since = Date.parse(ifModifiedSince);
    if (!isNaN(since) && Math.floor(since / 1000) >= latestUpdated) {
      return new Response(null, { status: 304, headers: { 'Last-Modified': lastModifiedHttp, 'Cache-Control': 'public, max-age=3600' } });
    }
  }

  const entries = results.map((r) => {
    const published = new Date(r.created_at * 1000).toISOString();
    const updated = new Date(r.updated * 1000).toISOString();
    const link = `${origin}/research/${r.slug}`;
    const summary = r.summary ? escapeXml(r.summary.slice(0, 500)) : '';
    const category = r.category ? `\n<category term="${escapeXml(r.category)}"/>` : '';
    return `<entry>
<id>${link}</id>
<title>${escapeXml(displayQuery(r.query))}</title>
<link href="${link}"/>
<published>${published}</published>
<updated>${updated}</updated>
<author><name>Chrisputer Labs</name><uri>${origin}/</uri></author>${category}
<summary>${summary}</summary>
</entry>`;
  }).join('\n');

  const currentYear = new Date(latestUpdated * 1000).getUTCFullYear();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Chrisputer Labs — Research Feed</title>
<link href="${origin}/feed.xml" rel="self"/>
<link href="${origin}/"/>
<id>${origin}/</id>
<updated>${feedUpdated}</updated>
<author><name>Chrisputer Labs</name><uri>${origin}/</uri></author>
<subtitle>Latest AI-powered product research</subtitle>
<icon>${origin}/favicon.svg</icon>
<logo>${origin}/og-image.svg</logo>
<rights>© ${currentYear} Chrisputer Labs. All rights reserved.</rights>
<generator uri="${origin}/">Chrisputer Labs</generator>
${entries}
</feed>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/atom+xml;charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Last-Modified': lastModifiedHttp,
    },
  });
}

// Per-research OG SVG generator. Reuses the default OG image when slug has no
// matching row, so social scrapers following stale links still get a valid image.
export async function generateOgImage(slug: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT r.query, r.category, r.summary,
       (SELECT COUNT(*) FROM products WHERE products.research_id = r.id) AS product_count
     FROM research r WHERE r.slug = ?`
  ).bind(slug).first<{ query: string; category: string | null; summary: string | null; product_count: number }>();

  if (!row) {
    return new Response(OG_IMAGE_SVG, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
  }

  const pretty = displayQuery(row.query);
  const title = escapeXml(pretty.length > 60 ? pretty.slice(0, 57) + '...' : pretty);
  const category = row.category ? escapeXml(row.category) : '';
  const subtitle = row.product_count > 0
    ? `${row.product_count} products compared`
    : 'AI-powered analysis';
  const summaryText = row.summary
    ? escapeXml(row.summary.length > 120 ? row.summary.slice(0, 117) + '...' : row.summary)
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
<rect width="1200" height="630" fill="#020617"/>
<rect x="40" y="40" width="1120" height="550" rx="24" fill="#0f172a" stroke="#1e293b" stroke-width="2"/>
<rect x="80" y="80" width="64" height="64" rx="14" fill="#2563eb"/>
<text x="112" y="124" font-family="system-ui,sans-serif" font-size="28" font-weight="800" fill="#fff" text-anchor="middle">CL</text>
<text x="160" y="120" font-family="system-ui,sans-serif" font-size="28" font-weight="700" fill="#f1f5f9">Chrisputer Labs</text>
${category ? `<rect x="80" y="180" width="${category.length * 11 + 24}" height="32" rx="16" fill="rgba(37,99,235,0.15)"/>
<text x="92" y="201" font-family="system-ui,sans-serif" font-size="16" font-weight="500" fill="#60a5fa">${category}</text>` : ''}
<text x="80" y="${category ? '260' : '220'}" font-family="system-ui,sans-serif" font-size="42" font-weight="800" fill="#f1f5f9">${title}</text>
${summaryText ? `<text x="80" y="${category ? '310' : '270'}" font-family="system-ui,sans-serif" font-size="22" fill="#94a3b8">${summaryText}</text>` : ''}
<rect x="80" y="460" width="240" height="52" rx="12" fill="#2563eb"/>
<text x="200" y="493" font-family="system-ui,sans-serif" font-size="20" font-weight="600" fill="#fff" text-anchor="middle">${escapeXml(subtitle)}</text>
<text x="1080" y="560" font-family="system-ui,sans-serif" font-size="16" fill="#64748b" text-anchor="end">chrisputer.tech</text>
</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
}
