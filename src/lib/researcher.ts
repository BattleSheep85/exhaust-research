import Anthropic from '@anthropic-ai/sdk';
import type { ScrapedSource } from './scraper';

export interface ResearchResult {
  summary: string;
  category: string;
  products: ProductResult[];
  methodology: string;
  lastUpdated: string;
}

export interface ProductResult {
  name: string;
  brand: string;
  price: number | null;
  rating: number | null;
  imageUrl: string | null;
  productUrl: string;
  affiliateUrl: string;
  pros: string[];
  cons: string[];
  specs: Record<string, string>;
  verdict: string;
  rank: number;
  bestFor: string;
}

const RESEARCH_SYSTEM_PROMPT = `You are an expert product researcher. Your job is to analyze scraped product data and produce comprehensive, honest, and actionable product research reports.

IMPORTANT RULES:
- Be brutally honest. If a product has problems, say so.
- Never recommend a product you wouldn't buy yourself.
- Always explain WHY something is the best pick, not just THAT it is.
- Include specific model numbers, prices, and specs when available.
- If data is insufficient to make a recommendation, say so clearly.
- Identify the "best for" category for each product (budget, performance, value, beginners, etc.)
- Rank products by overall recommendation, #1 being your top pick.

OUTPUT FORMAT: You MUST respond with valid JSON matching this schema:
{
  "summary": "2-3 sentence overview of the research findings",
  "category": "product category (e.g. 'NAS', 'Router', 'Monitor')",
  "products": [
    {
      "name": "Full product name with model number",
      "brand": "Brand name",
      "price": 299.99,
      "rating": 4.5,
      "imageUrl": null,
      "productUrl": "URL to product page",
      "affiliateUrl": "",
      "pros": ["Pro 1", "Pro 2", "Pro 3"],
      "cons": ["Con 1", "Con 2"],
      "specs": {"key": "value"},
      "verdict": "1-2 sentence verdict on this specific product",
      "rank": 1,
      "bestFor": "category like 'budget' or 'performance'"
    }
  ],
  "methodology": "Brief description of sources analyzed and confidence level"
}`;

export async function runResearch(
  apiKey: string,
  query: string,
  sources: ScrapedSource[],
): Promise<ResearchResult> {
  const client = new Anthropic({ apiKey });

  const sourceContext = sources
    .map((s, i) => `--- Source ${i + 1}: ${s.title} (${s.source}) ---\nURL: ${s.url}\n${s.content}`)
    .join('\n\n');

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: RESEARCH_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Research query: "${query}"

Here is the data I've gathered from various sources:

${sourceContext}

Analyze this data and produce a comprehensive product research report. If the sources don't contain enough data for certain products, note that in your methodology section. Focus on giving actionable, honest recommendations.

Respond ONLY with valid JSON.`,
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  // Extract JSON from response (handle markdown code blocks)
  let jsonStr = textBlock.text.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  const result = JSON.parse(jsonStr) as ResearchResult;
  result.lastUpdated = new Date().toISOString();
  return result;
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
