export function generateId(): string {
  return crypto.randomUUID();
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return slug || 'research';
}

export function generateSlug(query: string): string {
  const base = slugify(query);
  const suffix = generateId().slice(0, 8);
  return `${base}-${suffix}`;
}

// https-only URL validator. Callers render these as <a href>, <img src>, or
// persist them — mixed-content risk on every surface, so reject http:// up
// front. CLAUDE.md's URL validation contract. CSP's upgrade-insecure-requests
// is a belt; this is the suspenders.
export function isValidHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function sanitizeUrl(url: string): string {
  return isValidHttpsUrl(url) ? url : '';
}

export function escapeLikeWildcards(input: string): string {
  return input.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const LOWERCASE_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'for', 'of', 'in', 'on', 'to', 'vs', 'at', 'by', 'with', 'from', 'as', 'is']);

export function displayQuery(query: string): string {
  const tokens = query.trim().split(/\s+/);
  return tokens.map((tok, i) => {
    if (/[A-Z]/.test(tok)) return tok;
    if (/^\d/.test(tok)) return tok.toUpperCase();
    const lower = tok.toLowerCase();
    if (i > 0 && i < tokens.length - 1 && LOWERCASE_WORDS.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ');
}

export function timeAgo(epochMs: number): string {
  const seconds = Math.floor((Date.now() - epochMs) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function parseJsonSafe<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

// Canonical query form for clustering. Two queries that normalize to the same
// string are treated as equivalent — we serve prior research instead of running
// a fresh pipeline. Conservative on purpose: false positives (clustering different
// intents) are worse than false negatives (missing a cluster).
const CANONICAL_STOPWORDS = new Set([
  'the','a','an','of','for','in','on','at','to','and','or','but','with','under',
  'over','best','top','cheapest','good','great','recommended','recommendations',
  'review','reviews','comparison','vs','versus','guide','buying',
  'affordable','budget','cheap','premium','high-end','entry-level',
  'today','now','current','latest','new','modern',
  'my','your','our','i','you','me',
]);

function stripFiller(token: string): string {
  // Strip trailing price/year tokens: "$100", "under-100", "2025", "2026"
  if (/^\$?\d{2,4}$/.test(token)) return '';
  if (/^\d{4}s?$/.test(token)) return '';
  return token;
}

// Shared WHERE clause for rows that may be exposed to crawlers, sitemaps, or
// browse/home listings. Previously copy-pasted across ~7 call sites — each new
// filter rule (bot-UA probe cleanup, thin-page exclusion) had to be threaded
// through every query. Pass the alias used in the caller's FROM clause
// (e.g. 'r' for `FROM research r`, 'research' for unaliased queries). The
// correlated EXISTS subquery always qualifies the outer id to avoid ambiguity.
// Alias is never user-provided; callers pass a literal string.
export function publicResearchFilter(alias: 'r' | 'research'): string {
  return `${alias}.status = 'complete'
    AND EXISTS (SELECT 1 FROM products p WHERE p.research_id = ${alias}.id)
    AND LENGTH(${alias}.query) >= 10 AND ${alias}.query LIKE '% %'
    AND ${alias}.query NOT LIKE 'test %' AND ${alias}.query NOT LIKE 'verify %'`;
}

export function canonicalizeQuery(query: string, clarifications?: Record<string, string>): string {
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9$\- ]+/g, ' ')
    .split(/\s+/)
    .map(stripFiller)
    .filter((t) => t.length > 1 && !CANONICAL_STOPWORDS.has(t));
  // Sort for order-insensitivity. "best keyboard budget" == "budget keyboard best".
  const unique = Array.from(new Set(tokens)).sort();
  const base = unique.join(' ');
  if (!clarifications || Object.keys(clarifications).length === 0) return base;
  // Clarifications shift intent enough that "best mesh wifi $200" and
  // "best mesh wifi $500" must cluster separately. Append sorted key:value
  // pairs (slugified) to the canonical form.
  const suffix = Object.entries(clarifications)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9:$.-]/g, '')}`)
    .join(' ');
  return suffix ? `${base} ${suffix}` : base;
}
