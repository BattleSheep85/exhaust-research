import { escapeXml } from './utils';

// Inline SVG constants. Kept tiny so bundle size stays low; served directly
// from the router with long cache TTLs.

export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#2563eb"/><text x="16" y="22" font-family="system-ui,sans-serif" font-size="14" font-weight="800" fill="#fff" text-anchor="middle">CL</text></svg>`;

export const OG_IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
<rect width="1200" height="630" fill="#020617"/>
<rect x="40" y="40" width="1120" height="550" rx="24" fill="#0f172a" stroke="#1e293b" stroke-width="2"/>
<rect x="80" y="100" width="80" height="80" rx="16" fill="#2563eb"/>
<text x="120" y="158" font-family="system-ui,sans-serif" font-size="36" font-weight="800" fill="#fff" text-anchor="middle">CL</text>
<text x="180" y="155" font-family="system-ui,sans-serif" font-size="42" font-weight="700" fill="#f1f5f9">Chrisputer Labs</text>
<text x="80" y="280" font-family="system-ui,sans-serif" font-size="52" font-weight="800" fill="#f1f5f9">AI-Powered Product Research</text>
<text x="80" y="350" font-family="system-ui,sans-serif" font-size="28" fill="#94a3b8">Every source, every angle, every detail.</text>
<text x="80" y="400" font-family="system-ui,sans-serif" font-size="28" fill="#94a3b8">No fluff. No sponsored picks. Just the truth.</text>
<rect x="80" y="460" width="200" height="56" rx="12" fill="#2563eb"/>
<text x="180" y="496" font-family="system-ui,sans-serif" font-size="22" font-weight="600" fill="#fff" text-anchor="middle">Try it free</text>
</svg>`;

export function manifestJson(): string {
  return JSON.stringify({
    id: '/',
    name: 'Chrisputer Labs',
    short_name: 'Chrisputer',
    description: 'Brutally honest product research. Real sources, no sponsored picks.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    lang: 'en-US',
    dir: 'ltr',
    categories: ['productivity', 'shopping', 'utilities'],
    background_color: '#020617',
    theme_color: '#2563eb',
    icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  });
}

export function opensearchXml(origin: string): string {
  // Origin is escaped because XML allows the URL to sit in attribute values
  // and element bodies. URL.origin is highly constrained, but defense in depth.
  const o = escapeXml(origin);
  return `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
<ShortName>Chrisputer</ShortName>
<LongName>Chrisputer Labs</LongName>
<Description>AI-powered product research by Chrisputer Labs.</Description>
<InputEncoding>UTF-8</InputEncoding>
<Image width="32" height="32" type="image/svg+xml">${o}/favicon.svg</Image>
<Url type="text/html" method="get" template="${o}/research?q={searchTerms}"/>
<Url type="application/opensearchdescription+xml" rel="self" template="${o}/opensearch.xml"/>
<Query role="example" searchTerms="best mesh wifi"/>
<Developer>Chrisputer Labs</Developer>
<moz:SearchForm xmlns:moz="http://www.mozilla.org/2006/browser/search/">${o}/research</moz:SearchForm>
</OpenSearchDescription>`;
}

export const HUMANS_TXT = `/* TEAM */
Chris
Title: Creator
Site: https://chrisputer.tech/about

/* SITE */
Language: English
Doctype: HTML5
Built on: Cloudflare Workers, D1, OpenRouter
Built with: Pure TypeScript, zero npm dependencies
`;

export const BROWSERCONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<browserconfig><msapplication><tile><square150x150logo src="/favicon.svg"/><TileColor>#2563eb</TileColor></tile></msapplication></browserconfig>`;

export function adsTxt(publisherId: string | undefined): string {
  return publisherId ? `google.com, ${publisherId}, DIRECT, f08c47fec0942fa0` : '';
}

export function robotsTxt(origin: string): string {
  return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /research/new\n\nSitemap: ${origin}/sitemap.xml`;
}

// ── Bot & scanner detection (pre-router fast-fail) ───────────────────────────

const SCANNER_PATH_PREFIXES: ReadonlyArray<string> = [
  '/wp-', '/wordpress', '/phpmyadmin', '/pma/', '/xmlrpc',
  '/.env', '/.git', '/.svn', '/.DS_Store', '/.aws',
  '/_ignition', '/vendor/phpunit', '/actuator',
  '/cgi-bin/', '/admin/', '/administrator/', '/webdav/',
  '/server-status', '/HNAP1', '/solr/', '/boaform/',
];
const SCANNER_PATH_EXTS = /\.(php|asp|aspx|jsp|cgi|do|action|cfm|rb)$/i;

const BOT_UA_PATTERN = /\b(googlebot|bingbot|yandex|baiduspider|duckduckbot|applebot|facebookexternalhit|facebookbot|twitterbot|linkedinbot|slackbot|discordbot|whatsapp|telegrambot|pinterest|redditbot|msnbot|petalbot|semrushbot|ahrefsbot|mj12bot|dotbot|seznambot|screaming\s*frog|bytespider|claudebot|gptbot|ccbot|anthropic-ai|cohere-ai|perplexitybot|crawler|spider)\b/i;

export function isBotUserAgent(ua: string): boolean {
  if (!ua) return true;
  return BOT_UA_PATTERN.test(ua);
}

export function isScannerProbe(path: string): boolean {
  if (SCANNER_PATH_EXTS.test(path)) return true;
  for (const p of SCANNER_PATH_PREFIXES) {
    if (path.startsWith(p)) return true;
  }
  return false;
}
