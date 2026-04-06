import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, generateId, generateSlug } from '../../lib/db';
import { research, products } from '../../../db/schema';
import { scrapeSearchResults } from '../../lib/scraper';
import { runResearch, generateAffiliateUrl } from '../../lib/researcher';

const AMAZON_AFFILIATE_TAG = 'chrisputer-20'; // Replace with your actual tag

export const POST: APIRoute = async ({ request, locals }) => {
  const db = getDb(locals.runtime.env.DB);
  const apiKey = locals.runtime.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { query?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const query = body.query?.trim();
  if (!query || query.length < 3 || query.length > 500) {
    return new Response(JSON.stringify({ error: 'Query must be 3-500 characters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const researchId = generateId();
  const slug = generateSlug(query);

  // Create the research entry as pending
  await db.insert(research).values({
    id: researchId,
    slug,
    query,
    status: 'processing',
    createdAt: new Date(),
  });

  // Run research in the background using waitUntil
  locals.runtime.ctx.waitUntil(
    executeResearch(db, researchId, query, apiKey)
  );

  return new Response(JSON.stringify({ slug, id: researchId }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};

async function executeResearch(
  db: ReturnType<typeof getDb>,
  researchId: string,
  query: string,
  apiKey: string,
) {
  try {
    // Step 1: Scrape sources
    const sources = await scrapeSearchResults(query);

    // Step 2: Run AI analysis
    const result = await runResearch(apiKey, query, sources);

    // Step 3: Store products
    for (const product of result.products) {
      const affiliateUrl = product.productUrl
        ? generateAffiliateUrl(product.productUrl, AMAZON_AFFILIATE_TAG)
        : '';

      await db.insert(products).values({
        id: generateId(),
        researchId,
        name: product.name,
        brand: product.brand ?? null,
        price: product.price,
        rating: product.rating,
        imageUrl: product.imageUrl,
        productUrl: product.productUrl,
        affiliateUrl,
        pros: JSON.stringify(product.pros),
        cons: JSON.stringify(product.cons),
        specs: JSON.stringify(product.specs),
        verdict: product.verdict,
        rank: product.rank,
        bestFor: product.bestFor,
      });
    }

    // Step 4: Update research entry
    await db
      .update(research)
      .set({
        status: 'complete',
        summary: result.summary,
        category: result.category,
        result: JSON.stringify(result),
        sources: JSON.stringify(sources.map((s) => s.url)),
        completedAt: new Date(),
      })
      .where(eq(research.id, researchId));
  } catch (error) {
    console.error('Research failed:', error);
    await db
      .update(research)
      .set({ status: 'failed' })
      .where(eq(research.id, researchId));
  }
}
