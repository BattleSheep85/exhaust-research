export interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  AMAZON_AFFILIATE_TAG: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export interface ResearchRow {
  id: string;
  slug: string;
  query: string;
  status: 'pending' | 'processing' | 'complete' | 'failed';
  category: string | null;
  summary: string | null;
  result: string | null;
  sources: string | null;
  created_at: number;
  completed_at: number | null;
  view_count: number;
}

export interface ProductRow {
  id: string;
  research_id: string;
  name: string;
  brand: string | null;
  price: number | null;
  currency: string;
  rating: number | null;
  image_url: string | null;
  product_url: string | null;
  affiliate_url: string | null;
  pros: string | null;
  cons: string | null;
  specs: string | null;
  verdict: string | null;
  rank: number | null;
  best_for: string | null;
}

export interface ScrapedSource {
  url: string;
  title: string;
  content: string;
  source: string;
}

export interface ResearchResult {
  summary: string;
  category: string;
  products: ProductResult[];
  methodology: string;
}

export const DEFAULT_AFFILIATE_TAG = 'chrisputer-20';

export interface ProductResult {
  name: string;
  brand: string;
  price: number | null;
  rating: number | null;
  productUrl: string;
  pros: string[];
  cons: string[];
  specs: Record<string, string>;
  verdict: string;
  rank: number;
  bestFor: string;
}
