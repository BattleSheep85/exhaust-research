import type {
  ChatMessage,
  AgentState,
  ScrapedSource,
  ResearchConfig,
  ResearchResult,
  Facets,
} from '../types';
import { buildAgentTools, executeTool } from './tools';
import { buildAgentPrompt, buildSynthesisPrompt } from './engine-prompts';
import { callLLM, callLLMStreaming, pruneMessages, type OpenRouterResponse } from './engine-llm';
import { validateResearchResult } from './engine-validate';

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
  tavilyApiKey: string,
  db: D1Database,
  researchId: string,
  facets?: Facets,
  topicalCategory?: string | null,
  placesApiKey?: string,
): Promise<EngineResult> {
  const agentTools = buildAgentTools(facets, placesApiKey);
  const toolCtx = { tavilyApiKey, placesApiKey };
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
    { role: 'system', content: buildAgentPrompt(query, config, facets) },
    { role: 'user', content: `Research this thoroughly: "${query}"` },
  ];

  let turnsWithoutTools = 0;
  const MAX_TURNS = 30; // safety valve

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Check agent-loop budget (scrape/plan phase only; synth has its own timer).
    if (Date.now() - startTime > config.agentLoopBudgetMs - 15_000) {
      console.log(`[engine] approaching agent-loop budget, stopping`);
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
      response = await callLLM(openrouterKey, config.plannerModel, prunedMessages, agentTools);
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
      const [result, subs] = await executeTool(tc, state, config, toolCtx);
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

  const synthPrompt = buildSynthesisPrompt(query, state.notes, state.sources, config, facets, topicalCategory);

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

  // Use SSE streaming for synthesis. Rationale: OpenRouter's non-streaming mode
  // sends SSE-style `:` keep-alive comments every ~2s during upstream generation
  // (chunked transfer-encoding on an application/json body). A per-chunk timer
  // gets reset by those keep-alives, so a silent-upstream hang never aborts.
  // In SSE mode we parse keep-alives as non-data lines and rely on the hard-timer
  // backstop in callLLMStreaming to guarantee forward progress.
  const synthMessages: ChatMessage[] = [
    { role: 'system', content: synthPrompt },
    { role: 'user', content: `Write the research report for: "${query}". Respond ONLY with valid JSON.` },
  ];
  let synthContent = '';
  try {
    synthContent = await callLLMStreaming(
      openrouterKey,
      config.synthModel,
      synthMessages,
      (_delta, accumulated) => announceProduct(accumulated),
      config.synthReasoningEffort,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[engine] synth stream failed:', errMsg);
    await writeEvent(db, researchId, state.eventSeq++, 'status', 'Retrying report...');
    const retry = await callLLM(
      openrouterKey,
      config.synthModel,
      synthMessages,
      undefined,
      config.synthReasoningEffort,
    );
    synthContent = retry.choices?.[0]?.message?.content ?? '';
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
      undefined,
      config.synthReasoningEffort,
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
      return `Searching ${args.provider ?? 'web'}: "${args.query ?? ''}"`;
    case 'read_page':
      return `Reading: ${args.url ?? ''}`;
    case 'note':
      return `Found: ${String(args.content ?? '').slice(0, 80)}${String(args.content ?? '').length > 80 ? '...' : ''}`;
    default:
      return `${name}(${JSON.stringify(args).slice(0, 100)})`;
  }
}
