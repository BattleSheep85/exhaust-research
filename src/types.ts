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

// ─── Database rows ───────────────────────────────────────────────────────────

export interface ResearchRow {
  id: string;
  slug: string;
  query: string;
  status: 'pending' | 'processing' | 'complete' | 'failed';
  tier: Tier;
  category: string | null;
  summary: string | null;
  result: string | null;
  sources: string | null;
  canonical_query: string | null;
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
  manufacturer_url: string | null;
  affiliate_url: string | null;
  pros: string | null;
  cons: string | null;
  specs: string | null;
  verdict: string | null;
  rank: number | null;
  best_for: string | null;
}

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
  products: ProductResult[];
  methodology: string;
  buyersGuide?: BuyersGuide;
}

export interface ProductResult {
  name: string;
  brand: string;
  price: number | null;
  rating: number | null;
  productUrl: string;
  manufacturerUrl: string;
  pros: string[];
  cons: string[];
  specs: Record<string, string>;
  verdict: string;
  rank: number;
  bestFor: string;
}
