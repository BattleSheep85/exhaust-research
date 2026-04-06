import type { APIRoute } from 'astro';
import { eq, sql } from 'drizzle-orm';
import { getDb, generateId, generateSlug } from '../../lib/db';
import { research, products } from '../../../db/schema';
import { scrapeSearchResults } from '../../lib/scraper';
import { runResearch, generateAffiliateUrl } from '../../lib/researcher';
import { sanitizeUrl } from '../../lib/validation';

export const POST: APIRoute = async ({ request, locals }) => {
  const db = getDb(locals.runtime.env.DB);
  const apiKey = locals.runtime.env.ANTHROPIC_API_KEY;
  const affiliateTag = locals.runtime.env.AMAZON_AFFILIATE_TAG ?? 'chrisputer-20';

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // CSRF: verify Origin header matches our domain
  const origin = request.headers.get('Origin');
  const allowedOrigins = ['https://chrisputer.tech', 'http://localhost:4321'];
  if (origin && !allowedOrigins.includes(origin)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Application-level rate limiting (per IP, 10/hour)
  const clientIp = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? 'unknown';
  const oneHourAgo = new Date(Date.now() - 3600_000);

  const recentRequests = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(research)
    .where(sql`${research.createdAt} > ${oneHourAgo} AND json_extract(${research.result}, '$.clientIp') = ${clientIp}`)
    .then((rows) => rows[0]?.count ?? 0)
    .catch(() => 0);

  if (recentRequests >= 10) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again in an hour.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '3600' },
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

  // Create research entry — retry slug on collision
  try {
    await db.insert(research).values({
      id: researchId,
      slug,
      query,
      status: 'processing',
      createdAt: new Date(),
    });
  } catch {
    // Slug collision — generate a new one
    const retrySlug = generateSlug(query);
    await db.insert(research).values({
      id: researchId,
      slug: retrySlug,
      query,
      status: 'processing',
      createdAt: new Date(),
    });
    return new Response(JSON.stringify({ slug: retrySlug }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Run research in the background using waitUntil
  locals.runtime.ctx.waitUntil(
    executeResearch(db, researchId, query, apiKey, affiliateTag),
  );

  return new Response(JSON.stringify({ slug }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
};

async function executeResearch(
  db: ReturnType<typeof getDb>,
  researchId: string,
  query: string,
  apiKey: string,
  affiliateTag: string,
) {
  try {
    // Step 1: Scrape sources
    const sources = await scrapeSearchResults(query);

    // Step 2: Run AI analysis (throws if no sources)
    const result = await runResearch(apiKey, query, sources);

    // Step 3: Store products (batch to avoid partial state)
    const productValues = result.products.map((product) => ({
      id: generateId(),
      researchId,
      name: product.name,
      brand: product.brand || null,
      price: product.price,
      rating: product.rating,
      imageUrl: product.imageUrl,
      productUrl: sanitizeUrl(product.productUrl),
      affiliateUrl: product.productUrl
        ? sanitizeUrl(generateAffiliateUrl(product.productUrl, affiliateTag))
        : '',
      pros: JSON.stringify(product.pros),
      cons: JSON.stringify(product.cons),
      specs: JSON.stringify(product.specs),
      verdict: product.verdict,
      rank: product.rank,
      bestFor: product.bestFor,
    }));

    if (productValues.length > 0) {
      // Batch insert all products
      await db.insert(products).values(productValues);
    }

    // Step 4: Update research entry as complete
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
    try {
      await db
        .update(research)
        .set({ status: 'failed' })
        .where(eq(research.id, researchId));
    } catch (updateError) {
      console.error('Failed to mark research as failed:', updateError);
    }
  }
}
