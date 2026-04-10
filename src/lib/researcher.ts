import type { ScrapedSource, ResearchResult, ProductResult } from '../types';

const MAX_SOURCE_CONTEXT = 30_000;

const SYSTEM_PROMPT = `You are an expert product researcher. Analyze scraped product data and produce honest, actionable research reports.

RULES:
- Be brutally honest. If a product has problems, say so.
- Never recommend a product you wouldn't buy yourself.
- Explain WHY something is the best pick.
- Include specific model numbers, prices, and specs when available.
- If data is insufficient, say so clearly.
- Rank products by overall recommendation, #1 being top pick.

OUTPUT: Respond ONLY with valid JSON matching this schema:
{
  "summary": "2-3 sentence overview",
  "category": "product category (e.g. NAS, Router, Monitor)",
  "products": [
    {
      "name": "Full product name",
      "brand": "Brand",
      "price": 299.99,
      "rating": 4.5,
      "productUrl": "URL or empty string",
      "pros": ["Pro 1", "Pro 2"],
      "cons": ["Con 1", "Con 2"],
      "specs": {"key": "value"},
      "verdict": "1-2 sentence verdict",
      "rank": 1,
      "bestFor": "budget or performance or value"
    }
  ],
  "methodology": "Sources analyzed and confidence level"
}`;

interface OpenRouterResponse {
  choices: Array<{ message: { content: string } }>;
}

export async function runResearch(
  apiKey: string,
  query: string,
  sources: ScrapedSource[],
): Promise<ResearchResult> {
  if (sources.length === 0) {
    throw new Error('No source data gathered');
  }

  // Build source context with budget
  let budget = MAX_SOURCE_CONTEXT;
  const lines: string[] = [];
  for (let i = 0; i < sources.length && budget > 0; i++) {
    const s = sources[i];
    const line = `--- Source ${i + 1}: ${s.title} (${s.source}) ---\nURL: ${s.url}\n${s.content}`;
    lines.push(line.slice(0, budget));
    budget -= line.length;
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(60_000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://research.chrisputer.tech',
      'X-Title': 'Exhaustive',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Research query: "${query}"\n\nSource data:\n\n${lines.join('\n\n')}\n\nAnalyze and produce a product research report. Respond ONLY with valid JSON.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data: OpenRouterResponse = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('No response from OpenRouter');
  }

  // Extract JSON (handle markdown code blocks)
  let jsonStr = content.trim();
  const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) jsonStr = match[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Invalid JSON from model: ${jsonStr.slice(0, 200)}`);
  }

  return validateResearchResult(parsed);
}

function validateResearchResult(data: unknown): ResearchResult {
  if (!data || typeof data !== 'object') throw new Error('Response is not an object');
  const obj = data as Record<string, unknown>;

  const summary = typeof obj.summary === 'string' ? obj.summary : '';
  const category = typeof obj.category === 'string' ? obj.category : 'General';
  const methodology = typeof obj.methodology === 'string' ? obj.methodology : '';

  if (!summary) throw new Error('Missing summary in response');

  const rawProducts = Array.isArray(obj.products) ? obj.products : [];
  const products: ProductResult[] = rawProducts.slice(0, 20).map((p: unknown, i: number) => {
    if (!p || typeof p !== 'object') {
      return { name: `Product ${i + 1}`, brand: '', price: null, rating: null, productUrl: '', pros: [], cons: [], specs: {}, verdict: '', rank: i + 1, bestFor: '' };
    }
    const prod = p as Record<string, unknown>;
    return {
      name: typeof prod.name === 'string' && prod.name ? prod.name : `Product ${i + 1}`,
      brand: typeof prod.brand === 'string' ? prod.brand : '',
      price: typeof prod.price === 'number' ? prod.price : null,
      rating: typeof prod.rating === 'number' && prod.rating >= 0 && prod.rating <= 5 ? prod.rating : null,
      productUrl: typeof prod.productUrl === 'string' ? prod.productUrl : '',
      pros: Array.isArray(prod.pros) ? prod.pros.filter((x: unknown) => typeof x === 'string') : [],
      cons: Array.isArray(prod.cons) ? prod.cons.filter((x: unknown) => typeof x === 'string') : [],
      specs: isStringRecord(prod.specs) ? prod.specs : {},
      verdict: typeof prod.verdict === 'string' ? prod.verdict : '',
      rank: typeof prod.rank === 'number' ? prod.rank : i + 1,
      bestFor: typeof prod.bestFor === 'string' ? prod.bestFor : '',
    };
  });

  return { summary, category, products, methodology };
}

function isStringRecord(val: unknown): val is Record<string, string> {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
  return Object.values(val as Record<string, unknown>).every((v) => typeof v === 'string');
}
