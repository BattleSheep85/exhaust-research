export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  RESEARCH_QUEUE: Queue<ResearchJobMessage>;
  OPENROUTER_API_KEY: string;
  TAVILY_API_KEY: string;
  AMAZON_AFFILIATE_TAG: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  CF_ANALYTICS_TOKEN?: string;
  WALMART_IMPACT_ID?: string;
  ADSENSE_PUBLISHER_ID?: string;
}

export interface ResearchJobMessage {
  researchId: string;
  query: string;
  tier: Tier;
  facets?: Facets;
  topicalCategory?: string | null;
}

export const DEFAULT_AFFILIATE_TAG = 'battlesheep0a-20';

// ─── Tiers ───────────────────────────────────────────────────────────────────

export type Tier = 'instant' | 'full' | 'exhaustive' | 'unbound';

export interface ResearchConfig {
  maxToolCalls: number;
  maxSearches: number;
  maxFetches: number;
  timeoutMs: number;
  synthModel: string;
  plannerModel: string;
  synthReasoningEffort?: 'low' | 'medium' | 'high';
  reportSections: string[];
  requireTurnstile: boolean;
  requireSubscription: boolean;
}

// ─── Classifier ──────────────────────────────────────────────────────────────

// Facets describe what the query needs, not a rigid type. A query can light up
// multiple facets simultaneously (e.g. "best pizza delivery in Austin" is
// is_buyable + needs_location + is_service).
export interface Facets {
  needs_location: boolean;
  is_buyable: boolean;
  is_experience: boolean;
  is_content: boolean;
  is_service: boolean;
  is_comparative: boolean;
}

export interface ClassifierResult {
  accept: boolean;
  reject_reason:
    | 'jailbreak'
    | 'illegal'
    | 'medical'
    | 'legal'
    | 'adult'
    | 'nonsense'
    | 'self-harm'
    | 'harassment'
    | 'financial-picks'
    | null;
  topical_category: string | null;
  facets: Facets;
  suggested_refinement: string | null;
}

// ─── Database rows ───────────────────────────────────────────────────────────

export interface ResearchRow {
  id: string;
  slug: string;
  query: string;
  status: 'pending' | 'processing' | 'complete' | 'failed';
  tier: Tier;
  category: string | null;
  topical_category: string | null;
  facets: string | null;
  summary: string | null;
  result: string | null;
  sources: string | null;
  canonical_query: string | null;
  created_at: number;
  completed_at: number | null;
  view_count: number;
}

// Table name stays `products` for continuity with existing data, but the shape
// is now the universal "item" schema — product-specific columns coexist with
// freeform `metadata` JSON for non-product verticals (restaurants, trails, etc.)
export interface ItemRow {
  id: string;
  research_id: string;
  name: string;
  brand: string | null;
  price: number | null;
  currency: string;
  rating: number | null;
  image_url: string | null;
  product_url: string | null;
  manufacturer_url: string | null;
  affiliate_url: string | null;
  pros: string | null;
  cons: string | null;
  specs: string | null;
  verdict: string | null;
  rank: number | null;
  best_for: string | null;
  metadata: string | null;
}

// Legacy alias — existing code imports ProductRow; keep working.
export type ProductRow = ItemRow;

export interface ResearchEventRow {
  id: number;
  research_id: string;
  seq: number;
  event_type: string;
  message: string;
  detail: string | null;
  created_at: number;
}

// ─── Source data ─────────────────────────────────────────────────────────────

export interface ScrapedSource {
  url: string;
  title: string;
  content: string;
  source: string;
}

// ─── Agent / tool-use types ──────────────────────────────────────────────────

export interface ToolCallObj {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: ToolCallObj[];
  tool_call_id?: string;
}

export interface AgentNote {
  category: string;
  content: string;
}

export interface AgentState {
  searchCount: number;
  fetchCount: number;
  toolCallCount: number;
  sources: ScrapedSource[];
  notes: AgentNote[];
  eventSeq: number;
}

// ─── Research output ─────────────────────────────────────────────────────────

export interface BuyersGuide {
  howToChoose: string;
  pitfalls: string[];
  marketingToIgnore: string[];
}

export interface ResearchResult {
  summary: string;
  category: string;
  products: ItemResult[];
  methodology: string;
  buyersGuide?: BuyersGuide;
}

// Universal item result. Core fields (name/rating/verdict/pros/cons/bestFor/rank)
// apply to anything. Product-specific (brand/price/specs/productUrl) stay as
// nullable typed fields for backwards compat with the established pipeline.
// Anything that doesn't fit the typed fields goes into `metadata` — address,
// hours, cuisine, serviceArea, whatever the classifier's facets implied.
export interface ItemResult {
  name: string;
  brand: string;
  price: number | null;
  rating: number | null;
  productUrl: string;
  manufacturerUrl: string;
  imageUrl: string;
  pros: string[];
  cons: string[];
  specs: Record<string, string>;
  metadata: Record<string, string>;
  verdict: string;
  rank: number;
  bestFor: string;
}

// Legacy alias — existing code references ProductResult.
export type ProductResult = ItemResult;
