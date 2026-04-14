import type {
  ChatMessage,
  ToolCallObj,
  AgentState,
  AgentNote,
  ScrapedSource,
  ResearchConfig,
  ResearchResult,
} from '../types';
import { AGENT_TOOLS, executeTool } from './tools';

// ─── OpenRouter API types ────────────────────────────────────────────────────

interface OpenRouterChoice {
  message: {
    role: string;
    content?: string | null;
    tool_calls?: ToolCallObj[];
  };
  finish_reason?: string;
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
}

// ─── Agent system prompt ─────────────────────────────────────────────────────

function buildAgentPrompt(query: string, config: ResearchConfig): string {
  const currentYear = new Date().getUTCFullYear();
  return `You are an autonomous product research agent. Your goal: thoroughly research "${query}" using your tools.

CURRENT YEAR: ${currentYear}. Prioritize recent data. Discount sources older than 18 months.

BUDGET: ${config.maxSearches} searches, ${config.maxFetches} page reads, ${config.maxToolCalls} total tool calls.

STRATEGY:
1. Start with 3-5 broad searches across different providers (brave, news, video, duckduckgo, rss) to discover the landscape.
2. Identify the top candidate products from initial results.
3. Search for each top candidate by name + "review" to find detailed evaluations.
4. Use read_page on the most promising expert reviews (PCMag, Wirecutter, RTINGS, Tom's Hardware, etc.) and detailed comparison articles.
5. Search for known issues/complaints for the top candidates.
6. Search for price comparisons and deals.
7. Call note() AGGRESSIVELY — at minimum one note per search that returned useful results, and one note per page you read. A rough target is 1 note per 3 sources gathered. Sparse notes starve the synthesis step. If a source had nothing useful, call note() anyway with the reason ("no relevant info in <source>").
8. When you've covered all angles or used most of your budget, stop calling tools.

PROVIDERS:
- brave: General web search (best for broad coverage)
- news: Recent news articles (best for new releases, announcements)
- video: YouTube reviews (best for hands-on evaluations)
- duckduckgo: Alternative web results (different index than Brave)
- hackernews: Tech community discussions (best for technical opinions)
- rss: Expert review sites — Wirecutter, RTINGS, Tom's Hardware, etc. (best for curated expert picks)

NOTES ARE CRITICAL: Call note() frequently. The synthesis step ONLY sees your notes + source list, not this conversation. If you don't note it, it won't be in the report. Under-noting is the #1 cause of weak reports — always err on the side of more notes.

Be thorough. Be specific. Include model numbers, prices, specs, and source attribution in your notes.`;
}

// ─── Synthesis prompt ────────────────────────────────────────────────────────

function buildSynthesisPrompt(
  query: string,
  notes: AgentNote[],
  sources: ScrapedSource[],
  config: ResearchConfig,
): string {
  const currentYear = new Date().getUTCFullYear();
  const sections = config.reportSections;

  const notesByCategory: Record<string, string[]> = {};
  for (const note of notes) {
    const cat = note.category;
    if (!notesByCategory[cat]) notesByCategory[cat] = [];
    notesByCategory[cat].push(note.content);
  }

  const notesText = Object.entries(notesByCategory)
    .map(([cat, items]) => `## ${cat.toUpperCase()}\n${items.map((n, i) => `${i + 1}. ${n}`).join('\n')}`)
    .join('\n\n');

  const sourceText = sources
    .slice(0, 100) // cap for context window
    .map((s, i) => `${i + 1}. [${s.source}] ${s.title} — ${s.url}\n   ${s.content.slice(0, 200)}`)
    .join('\n');

  let sectionInstructions = '';
  if (sections.includes('comparison')) sectionInstructions += '\n- Include a "comparisonTable" array with objects {feature, ...productValues}';
  if (sections.includes('categories')) sectionInstructions += '\n- Include "categories" array: [{name: "Best for Budget", productName, reason}, ...]';
  if (sections.includes('pitfalls')) sectionInstructions += '\n- Include "pitfalls" array of common mistakes or things to avoid';

  return `You are an expert product researcher writing a comprehensive report. Analyze the research notes and sources below.

CURRENT YEAR: ${currentYear}.

RULES:
- Be brutally honest. If a product has problems, say so.
- Never recommend a product you wouldn't buy yourself.
- Include specific model numbers, prices, and specs.
- Rank products by overall recommendation, #1 being top pick.
- Note release dates and availability. Avoid recommending discontinued products.
- If data is insufficient for some products, say so.
- COMPLETENESS IS MANDATORY. Every product object MUST have: non-empty name and brand; a numeric price (your best USD estimate, never null); a numeric rating 0-5 (inferred if not explicit); AT LEAST 3 specific pros and AT LEAST 2 specific cons (no product is flawless — if you can't name 2 honest cons it doesn't belong on the list); a verdict of 15+ words. Products missing any of these will be discarded before the user sees them.
- THE "buyersGuide" OBJECT IS REQUIRED AND NON-NEGOTIABLE. Every response MUST include a populated buyersGuide with: a 3-5 sentence "howToChoose" string, at least 3 concrete "pitfalls" strings, and at least 3 concrete "marketingToIgnore" strings. Do NOT omit this field. Do NOT return empty arrays. Output the buyersGuide BEFORE products in the JSON so it is never truncated. Responses missing buyersGuide will be rejected and regenerated.

RESEARCH NOTES:
${notesText || '(No structured notes — work from source data)'}

SOURCES (${sources.length} total):
${sourceText}

OUTPUT: Valid JSON matching this schema:
{
  "summary": "2-4 sentence overview of findings",
  "category": "product category",
  "buyersGuide": {
    "howToChoose": "3-5 sentences on what ACTUALLY matters when picking in this category — the decision framework a savvy buyer uses. Be specific to the category, not generic. e.g. for NAS: bay count, CPU tier for transcoding, ECC RAM, drive compatibility list.",
    "pitfalls": ["At least 3 specific pitfalls shoppers fall into in this category — each 1-2 sentences, concrete not generic."],
    "marketingToIgnore": ["At least 3 marketing claims/spec-sheet traps that don't matter in practice for this category — each 1-2 sentences, with the WHY."]
  },
  "products": [
    {
      "name": "Full product name with model number",
      "brand": "Brand",
      "price": 299.99,
      "rating": 4.5,
      "productUrl": "Amazon.com or retailer product page URL for buying. Empty string if unknown.",
      "manufacturerUrl": "Official manufacturer product page URL (e.g. anker.com/products/...). Empty string if unknown.",
      "pros": ["Specific pro 1", "Specific pro 2"],
      "cons": ["Specific con 1", "Specific con 2"],
      "specs": {"key": "value"},
      "verdict": "2-3 sentence honest verdict",
      "rank": 1,
      "bestFor": "who this is best for"
    }
  ],
  "methodology": "N sources analyzed from N providers. Confidence level and data freshness assessment."${sectionInstructions}
}

Respond ONLY with valid JSON.`;
}

// ─── LLM call ────────────────────────────────────────────────────────────────

// Stream an OpenRouter completion and surface incremental content via onToken.
// Uses a per-chunk watchdog (not just overall timeout) so a stuck stream aborts
// promptly — the historical hang that motivated `await response.text()` came
// from no per-chunk deadline.
async function callLLMStreaming(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  onToken: (delta: string, accumulated: string) => void,
): Promise<string> {
  const controller = new AbortController();
  const hardTimer = setTimeout(() => controller.abort('hard'), 60_000);
  let chunkTimer: ReturnType<typeof setTimeout> | null = null;
  const armChunk = () => {
    if (chunkTimer) clearTimeout(chunkTimer);
    chunkTimer = setTimeout(() => controller.abort('chunk'), 25_000);
  };

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://chrisputer.tech',
        'X-Title': 'Chrisputer Labs',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ model, messages, stream: true }),
    });

    if (!response.ok || !response.body) {
      const errText = await response.text().catch(() => '');
      throw new Error(`OpenRouter ${response.status}: ${errText.slice(0, 200)}`);
    }
    armChunk();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      armChunk();
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return content;
        try {
          const obj = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = obj.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta.length > 0) {
            content += delta;
            onToken(delta, content);
          }
        } catch { /* skip non-JSON heartbeats */ }
      }
    }
    return content;
  } finally {
    clearTimeout(hardTimer);
    if (chunkTimer) clearTimeout(chunkTimer);
  }
}

async function callLLM(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools?: typeof AGENT_TOOLS,
): Promise<OpenRouterResponse> {
  const body: Record<string, unknown> = {
    model,
    messages,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  // Use a single AbortController for both fetch + body read
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://chrisputer.tech',
        'X-Title': 'Chrisputer Labs',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`OpenRouter ${response.status}: ${errText.slice(0, 200)}`);
    }

    // Read body as text first (avoids hanging on slow streaming responses)
    const text = await response.text();
    return JSON.parse(text) as OpenRouterResponse;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Context management ──────────────────────────────────────────────────────

const MAX_CONTEXT_CHARS = 120_000; // keep context lean for fast LLM responses

function pruneMessages(messages: ChatMessage[]): ChatMessage[] {
  // Calculate total size
  let totalChars = 0;
  for (const msg of messages) {
    totalChars += (msg.content ?? '').length;
  }

  if (totalChars <= MAX_CONTEXT_CHARS) return messages;

  // Keep system + first user + last 10 messages. Truncate middle tool results.
  const pruned = [...messages];
  const keepHead = 2; // system + user
  const keepTail = 10;
  const middle = pruned.slice(keepHead, pruned.length - keepTail);

  for (const msg of middle) {
    if (msg.role === 'tool' && msg.content && msg.content.length > 500) {
      msg.content = msg.content.slice(0, 200) + '\n[...truncated for context management]';
    }
  }

  return pruned;
}

// ─── Event writing ───────────────────────────────────────────────────────────

async function writeEvent(
  db: D1Database,
  researchId: string,
  seq: number,
  eventType: string,
  message: string,
  detail?: string,
): Promise<void> {
  try {
    await db.prepare(
      'INSERT INTO research_events (research_id, seq, event_type, message, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
    ).bind(researchId, seq, eventType, message, detail ?? null, Math.floor(Date.now() / 1000)).run();
  } catch (err) {
    console.log(`[event] write failed seq=${seq}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Main engine ─────────────────────────────────────────────────────────────

export interface EngineResult {
  result: ResearchResult;
  sources: ScrapedSource[];
}

// CF Workers paid plan: 1000 subrequests per invocation.
// Reserve some for synthesis + event writes. Each search = 1 subrequest.
// Each LLM call = 1 subrequest. Each Jina fetch = 1 subrequest.
// Event writes to D1 don't count as subrequests (D1 is a binding, not fetch).
const SUBREQUEST_BUDGET = 950; // paid plan = 1000, leave headroom for synthesis + retries
const SUBREQUEST_RESERVE_FOR_SYNTHESIS = 5; // synthesis LLM + possible retries

export async function runEngine(
  query: string,
  config: ResearchConfig,
  openrouterKey: string,
  braveApiKey: string,
  db: D1Database,
  researchId: string,
): Promise<EngineResult> {
  const startTime = Date.now();
  let subrequestsUsed = 0;
  const state: AgentState = {
    searchCount: 0,
    fetchCount: 0,
    toolCallCount: 0,
    sources: [],
    notes: [],
    eventSeq: 0,
  };

  await writeEvent(db, researchId, state.eventSeq++, 'status', `Starting ${config.maxSearches}-search research...`);

  // ── Phase 1: Agent loop (tool use) ──────────────────────────────────────

  const messages: ChatMessage[] = [
    { role: 'system', content: buildAgentPrompt(query, config) },
    { role: 'user', content: `Research this thoroughly: "${query}"` },
  ];

  let turnsWithoutTools = 0;
  const MAX_TURNS = 30; // safety valve

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Check timeout
    if (Date.now() - startTime > config.timeoutMs - 15_000) {
      console.log(`[engine] approaching timeout, stopping agent loop`);
      await writeEvent(db, researchId, state.eventSeq++, 'status', 'Approaching time limit, finishing up...');
      break;
    }

    // Check tool budget
    if (state.toolCallCount >= config.maxToolCalls) {
      console.log(`[engine] tool budget exhausted (${state.toolCallCount}/${config.maxToolCalls})`);
      await writeEvent(db, researchId, state.eventSeq++, 'status', 'Tool budget used, synthesizing...');
      break;
    }

    // Check subrequest budget (CF Workers limit)
    if (subrequestsUsed >= SUBREQUEST_BUDGET - SUBREQUEST_RESERVE_FOR_SYNTHESIS) {
      console.log(`[engine] subrequest budget exhausted (${subrequestsUsed}/${SUBREQUEST_BUDGET})`);
      await writeEvent(db, researchId, state.eventSeq++, 'status', 'Platform limit reached, synthesizing...');
      break;
    }

    // Prune context if needed
    const prunedMessages = pruneMessages(messages);
    const contextSize = prunedMessages.reduce((acc, m) => acc + (m.content ?? '').length, 0);
    console.log(`[engine] turn ${turn}: ${prunedMessages.length} messages, ${Math.round(contextSize / 1024)}KB context`);

    let response: OpenRouterResponse;
    try {
      subrequestsUsed++; // LLM call = 1 subrequest
      console.log(`[engine] LLM call turn ${turn} (${subrequestsUsed} subs, ${state.toolCallCount} tools)`);
      response = await callLLM(openrouterKey, config.plannerModel, prunedMessages, AGENT_TOOLS);
      console.log(`[engine] LLM call turn ${turn} returned`);
    } catch (err) {
      console.log(`[engine] LLM error turn ${turn}: ${err instanceof Error ? err.message : String(err)}`);
      await writeEvent(db, researchId, state.eventSeq++, 'error', 'AI service temporarily unavailable — retrying');
      // Retry once after a short delay
      if (turn > 0) break;
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    const choice = response.choices?.[0];
    if (!choice) {
      console.log(`[engine] no choice in response`);
      break;
    }

    const toolCalls = choice.message.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      // LLM stopped calling tools
      turnsWithoutTools++;
      if (turnsWithoutTools >= 2 || choice.message.content) {
        console.log(`[engine] agent finished (turn ${turn}, ${state.toolCallCount} tool calls)`);
        break;
      }
      // Nudge: remind the agent it has budget left
      messages.push({
        role: 'assistant',
        content: choice.message.content ?? '',
      });
      messages.push({
        role: 'user',
        content: `You still have ${config.maxToolCalls - state.toolCallCount} tool calls and ${config.maxSearches - state.searchCount} searches remaining. Continue researching or stop if satisfied.`,
      });
      continue;
    }

    turnsWithoutTools = 0;

    // Add assistant message with tool_calls to history
    messages.push({
      role: 'assistant',
      content: choice.message.content ?? null,
      tool_calls: toolCalls,
    });

    // Execute each tool call
    for (const tc of toolCalls) {
      if (state.toolCallCount >= config.maxToolCalls) {
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: 'Tool budget exhausted.',
        });
        continue;
      }

      // Check subrequest budget BETWEEN individual tool calls (not just between LLM turns)
      // This prevents a single batch of 5 RSS calls (30 subs) from blowing the limit.
      if (subrequestsUsed >= SUBREQUEST_BUDGET - SUBREQUEST_RESERVE_FOR_SYNTHESIS) {
        console.log(`[engine] subrequest budget hit mid-batch (${subrequestsUsed}/${SUBREQUEST_BUDGET}), skipping remaining tools`);
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: 'Platform subrequest limit reached. Synthesize from what you have.',
        });
        continue;
      }

      state.toolCallCount++;

      // Write event for the activity feed
      const toolArgs = safeParseArgs(tc.function.arguments);
      const eventMsg = formatToolEvent(tc.function.name, toolArgs);
      await writeEvent(db, researchId, state.eventSeq++, tc.function.name === 'note' ? 'note' : tc.function.name === 'read_page' ? 'fetch' : 'search', eventMsg, tc.function.arguments);

      // Execute the tool
      const [result, subs] = await executeTool(tc, state, config, braveApiKey);
      subrequestsUsed += subs;

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  console.log(`[engine] agent loop done: ${state.toolCallCount} calls, ${state.sources.length} sources, ${state.notes.length} notes`);
  await writeEvent(db, researchId, state.eventSeq++, 'status', `Gathered ${state.sources.length} sources with ${state.notes.length} findings. Synthesizing report...`);

  // ── Phase 2: Synthesis ──────────────────────────────────────────────────

  await writeEvent(db, researchId, state.eventSeq++, 'synthesize', 'Writing final report...');

  const synthPrompt = buildSynthesisPrompt(query, state.notes, state.sources, config);

  // Stream the synthesis so we can surface progress beats (product names as they
  // appear in the JSON) instead of a 6s black-box wait. Falls back to non-streaming
  // callLLM if the stream fails so research never dies on a transport blip.
  const announced = new Set<string>();
  const announceProduct = (fullText: string) => {
    // Cheap scan: pull all completed `"name":"..."` pairs seen so far.
    const re = /"name"\s*:\s*"([^"\\]{3,120}?)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fullText)) !== null) {
      const name = m[1].trim();
      if (name && !announced.has(name)) {
        announced.add(name);
        // Fire-and-forget event write; don't await (would stall the stream loop).
        void writeEvent(db, researchId, state.eventSeq++, 'synthesize', `Writing section: ${name}`);
      }
    }
  };

  let synthContent = '';
  try {
    let firstToken = true;
    synthContent = await callLLMStreaming(
      openrouterKey,
      config.synthModel,
      [
        { role: 'system', content: synthPrompt },
        { role: 'user', content: `Write the research report for: "${query}". Respond ONLY with valid JSON.` },
      ],
      (_delta, accumulated) => {
        if (firstToken) {
          firstToken = false;
          void writeEvent(db, researchId, state.eventSeq++, 'synthesize', 'Drafting report...');
        }
        announceProduct(accumulated);
      },
    );
  } catch (err) {
    console.error('[engine] synthesis stream failed, falling back to non-streaming:', err);
    const synthResponse = await callLLM(
      openrouterKey,
      config.synthModel,
      [
        { role: 'system', content: synthPrompt },
        { role: 'user', content: `Write the research report for: "${query}". Respond ONLY with valid JSON.` },
      ],
    );
    synthContent = synthResponse.choices?.[0]?.message?.content ?? '';
  }

  if (!synthContent) {
    throw new Error('No synthesis response from LLM');
  }

  // Extract JSON — first pass on streamed content.
  const extractJson = (raw: string): unknown | null => {
    let jsonStr = raw.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();
    try { return JSON.parse(jsonStr); } catch { return null; }
  };

  let parsed: unknown = extractJson(synthContent);

  // If the streamed content didn't parse (stream truncation, early close), retry
  // with the non-streaming path which buffers the full response. This keeps the
  // happy-path UX wins of streaming without sacrificing reliability.
  if (parsed === null) {
    console.warn('[engine] streamed JSON unparseable, retrying non-streaming');
    await writeEvent(db, researchId, state.eventSeq++, 'status', 'Finalizing report...');
    const retryResponse = await callLLM(
      openrouterKey,
      config.synthModel,
      [
        { role: 'system', content: synthPrompt },
        { role: 'user', content: `Write the research report for: "${query}". Respond ONLY with valid JSON.` },
      ],
    );
    const retryContent = retryResponse.choices?.[0]?.message?.content ?? '';
    parsed = extractJson(retryContent);
    if (parsed === null) {
      throw new Error(`Invalid JSON from synthesis: ${retryContent.slice(0, 200)}`);
    }
  }

  const result = validateResearchResult(parsed);

  await writeEvent(db, researchId, state.eventSeq++, 'status', `Report complete: ${result.products.length} products ranked.`);

  return { result, sources: state.sources };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeParseArgs(argsStr: string): Record<string, unknown> {
  try {
    return JSON.parse(argsStr);
  } catch {
    return {};
  }
}

function formatToolEvent(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'web_search':
      return `Searching ${args.provider ?? 'brave'}: "${args.query ?? ''}"`;
    case 'read_page':
      return `Reading: ${args.url ?? ''}`;
    case 'note':
      return `Found: ${String(args.content ?? '').slice(0, 80)}${String(args.content ?? '').length > 80 ? '...' : ''}`;
    default:
      return `${name}(${JSON.stringify(args).slice(0, 100)})`;
  }
}

// ─── Validation (shared with old researcher.ts) ──────────────────────────────

import type { ProductResult } from '../types';

function validateResearchResult(data: unknown): ResearchResult {
  if (!data || typeof data !== 'object') throw new Error('Response is not an object');
  const obj = data as Record<string, unknown>;

  const summary = typeof obj.summary === 'string' ? obj.summary : '';
  const category = typeof obj.category === 'string' ? obj.category : 'General';
  const methodology = typeof obj.methodology === 'string' ? obj.methodology : '';

  if (!summary) throw new Error('Missing summary in response');

  const rawProducts = Array.isArray(obj.products) ? obj.products : [];
  const products: ProductResult[] = rawProducts.slice(0, 20).map((p: unknown, i: number) => {
    // Drop products the LLM left under-specified — honest cards need pros AND cons.
    if (!p || typeof p !== 'object') {
      return { name: `Product ${i + 1}`, brand: '', price: null, rating: null, productUrl: '', manufacturerUrl: '', pros: [], cons: [], specs: {}, verdict: '', rank: i + 1, bestFor: '' };
    }
    const prod = p as Record<string, unknown>;
    return {
      name: typeof prod.name === 'string' && prod.name ? prod.name : `Product ${i + 1}`,
      brand: typeof prod.brand === 'string' ? prod.brand : '',
      price: typeof prod.price === 'number' ? prod.price : null,
      rating: typeof prod.rating === 'number' && prod.rating >= 0 && prod.rating <= 5 ? prod.rating : null,
      productUrl: typeof prod.productUrl === 'string' ? prod.productUrl : '',
      manufacturerUrl: typeof prod.manufacturerUrl === 'string' ? prod.manufacturerUrl : '',
      pros: Array.isArray(prod.pros) ? prod.pros.filter((x: unknown) => typeof x === 'string') : [],
      cons: Array.isArray(prod.cons) ? prod.cons.filter((x: unknown) => typeof x === 'string') : [],
      specs: isStringRecord(prod.specs) ? prod.specs : {},
      verdict: typeof prod.verdict === 'string' ? prod.verdict : '',
      rank: typeof prod.rank === 'number' ? prod.rank : i + 1,
      bestFor: typeof prod.bestFor === 'string' ? prod.bestFor : '',
    };
  });

  // Drop products missing essential fields (name+brand, ≥1 pro, ≥1 con, verdict).
  // Never drop below 3 products to preserve the comparison experience.
  const complete = products.filter(
    (p) => p.name && p.brand && p.pros.length >= 1 && p.cons.length >= 1 && p.verdict.length >= 10,
  );
  const filtered = complete.length >= 3 ? complete : products;

  const buyersGuide = extractBuyersGuide(obj.buyersGuide);

  return { summary, category, products: filtered, methodology, ...(buyersGuide ? { buyersGuide } : {}) };
}

function extractBuyersGuide(val: unknown): import('../types').BuyersGuide | undefined {
  if (!val || typeof val !== 'object') return undefined;
  const g = val as Record<string, unknown>;
  const howToChoose = typeof g.howToChoose === 'string' ? g.howToChoose.trim() : '';
  const pitfalls = Array.isArray(g.pitfalls) ? g.pitfalls.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
  const marketingToIgnore = Array.isArray(g.marketingToIgnore) ? g.marketingToIgnore.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
  if (!howToChoose && pitfalls.length === 0 && marketingToIgnore.length === 0) return undefined;
  return { howToChoose, pitfalls, marketingToIgnore };
}

function isStringRecord(val: unknown): val is Record<string, string> {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
  return Object.values(val as Record<string, unknown>).every((v) => typeof v === 'string');
}
