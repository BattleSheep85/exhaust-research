export function generateId(): string {
  return crypto.randomUUID();
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export function generateSlug(query: string): string {
  const base = slugify(query);
  const suffix = generateId().slice(0, 8);
  return `${base}-${suffix}`;
}

export function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function sanitizeUrl(url: string): string {
  return isValidHttpUrl(url) ? url : '';
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

export function generateAffiliateUrl(productUrl: string, tag: string): string {
  try {
    const url = new URL(productUrl);
    if (url.hostname.includes('amazon.com')) {
      url.searchParams.set('tag', tag);
      return url.toString();
    }
    return productUrl;
  } catch {
    return productUrl;
  }
}
