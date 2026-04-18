import type { BuyersGuide, ItemResult, ResearchResult } from '../types';

// Hosts that only serve pages (never direct images) — if the LLM hands us one
// of these, it's a review/video/listing URL, not an image.
const NON_IMAGE_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be',
  'vimeo.com', 'www.vimeo.com',
  'tiktok.com', 'www.tiktok.com',
  'instagram.com', 'www.instagram.com',
  'twitter.com', 'x.com', 'facebook.com', 'www.facebook.com',
  'reddit.com', 'www.reddit.com',
]);

const IMAGE_EXT_RE = /\.(jpg|jpeg|png|webp|gif|avif)(\?|#|$)/i;

function sanitizeImageUrl(val: unknown): string {
  if (typeof val !== 'string') return '';
  const trimmed = val.trim();
  if (!trimmed) return '';
  if (!/^https:\/\//i.test(trimmed)) return '';
  if (trimmed.length > 2000) return '';
  // Path must end in a recognized image extension (query/fragment allowed after).
  // Rejects page URLs the LLM occasionally returns (alltrails trail pages,
  // tripadvisor review pages, manufacturer homepages, article URLs).
  if (!IMAGE_EXT_RE.test(trimmed)) return '';
  try {
    const host = new URL(trimmed).hostname.toLowerCase();
    if (NON_IMAGE_HOSTS.has(host)) return '';
    if (host.endsWith('.youtube.com') || host.endsWith('.vimeo.com')) return '';
  } catch {
    return '';
  }
  return trimmed;
}

function sanitizeMetadata(val: unknown): Record<string, string> {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    if (typeof k !== 'string') continue;
    if (typeof v !== 'string') continue;
    const key = k.trim().slice(0, 40);
    const value = v.trim().slice(0, 240);
    if (key && value) out[key] = value;
  }
  return out;
}

// Accept any flat object whose values can be coerced to strings. The synthesis
// LLM sometimes returns mixed-type specs like `{weight: 2.5, color: "black"}` —
// dropping the entire specs map because one value is numeric loses useful data.
function coerceStringRecord(val: unknown): Record<string, string> {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    if (v == null) continue;
    if (typeof v === 'string') { out[k] = v; continue; }
    if (typeof v === 'number' || typeof v === 'boolean') { out[k] = String(v); continue; }
    // Skip nested objects/arrays.
  }
  return out;
}

function extractBuyersGuide(val: unknown): BuyersGuide | undefined {
  if (!val || typeof val !== 'object') return undefined;
  const g = val as Record<string, unknown>;
  const howToChoose = typeof g.howToChoose === 'string' ? g.howToChoose.trim() : '';
  const pitfalls = Array.isArray(g.pitfalls) ? g.pitfalls.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
  const marketingToIgnore = Array.isArray(g.marketingToIgnore) ? g.marketingToIgnore.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
  if (!howToChoose && pitfalls.length === 0 && marketingToIgnore.length === 0) return undefined;
  return { howToChoose, pitfalls, marketingToIgnore };
}

export function validateResearchResult(data: unknown): ResearchResult {
  if (!data || typeof data !== 'object') throw new Error('Response is not an object');
  const obj = data as Record<string, unknown>;

  const summary = typeof obj.summary === 'string' ? obj.summary : '';
  const category = typeof obj.category === 'string' ? obj.category : 'General';
  const methodology = typeof obj.methodology === 'string' ? obj.methodology : '';

  if (!summary) throw new Error('Missing summary in response');

  const rawProducts = Array.isArray(obj.products) ? obj.products : [];
  const products: ItemResult[] = rawProducts.slice(0, 20).map((p: unknown, i: number) => {
    // Drop items the LLM left under-specified — honest cards need pros AND cons.
    if (!p || typeof p !== 'object') {
      return { name: `Item ${i + 1}`, brand: '', price: null, rating: null, productUrl: '', manufacturerUrl: '', imageUrl: '', pros: [], cons: [], specs: {}, metadata: {}, verdict: '', rank: i + 1, bestFor: '' };
    }
    const prod = p as Record<string, unknown>;
    return {
      name: typeof prod.name === 'string' && prod.name ? prod.name : `Item ${i + 1}`,
      brand: typeof prod.brand === 'string' ? prod.brand : '',
      price: typeof prod.price === 'number' ? prod.price : null,
      rating: typeof prod.rating === 'number' && prod.rating >= 0 && prod.rating <= 5 ? prod.rating : null,
      productUrl: typeof prod.productUrl === 'string' ? prod.productUrl : '',
      manufacturerUrl: typeof prod.manufacturerUrl === 'string' ? prod.manufacturerUrl : '',
      imageUrl: sanitizeImageUrl(prod.imageUrl),
      pros: Array.isArray(prod.pros) ? prod.pros.filter((x: unknown) => typeof x === 'string') : [],
      cons: Array.isArray(prod.cons) ? prod.cons.filter((x: unknown) => typeof x === 'string') : [],
      specs: coerceStringRecord(prod.specs),
      metadata: sanitizeMetadata(prod.metadata),
      verdict: typeof prod.verdict === 'string' ? prod.verdict : '',
      rank: typeof prod.rank === 'number' ? prod.rank : i + 1,
      bestFor: typeof prod.bestFor === 'string' ? prod.bestFor : '',
    };
  });

  // Drop items missing essential fields. Brand is optional (restaurants, trails,
  // services often have no "brand") — require name + ≥1 pro + ≥1 con + 10+ char verdict.
  // Never drop below 3 items to preserve the comparison experience.
  const complete = products.filter(
    (p) => p.name && p.pros.length >= 1 && p.cons.length >= 1 && p.verdict.length >= 10,
  );
  const filtered = complete.length >= 3 ? complete : products;

  const buyersGuide = extractBuyersGuide(obj.buyersGuide);

  return { summary, category, products: filtered, methodology, ...(buyersGuide ? { buyersGuide } : {}) };
}
