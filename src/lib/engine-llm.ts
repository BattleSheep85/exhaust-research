import type { ChatMessage, ToolCallObj } from '../types';

// OpenRouter API response shape (subset we actually consume).

interface OpenRouterChoice {
  message: {
    role: string;
    content?: string | null;
    tool_calls?: ToolCallObj[];
  };
  finish_reason?: string;
}

export interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
}

// Budget for OpenRouter calls, scaled to reasoning effort. Extended thinking
// adds a silent pre-generation phase (30-90s for 'medium', 60-180s for 'high'),
// so a fixed 120s ceiling is too tight for exhaustive/unbound tiers.
export function llmBudgetMs(effort?: 'low' | 'medium' | 'high'): { hardMs: number; chunkMs: number } {
  switch (effort) {
    case 'high': return { hardMs: 360_000, chunkMs: 180_000 };
    case 'medium': return { hardMs: 240_000, chunkMs: 120_000 };
    case 'low': return { hardMs: 180_000, chunkMs: 90_000 };
    default: return { hardMs: 120_000, chunkMs: 75_000 };
  }
}

// Stream an OpenRouter completion and surface incremental content via onToken.
// Uses a per-chunk watchdog (not just overall timeout) so a stuck stream aborts
// promptly — the historical hang that motivated `await response.text()` came
// from no per-chunk deadline.
export async function callLLMStreaming(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  onToken: (delta: string, accumulated: string) => void,
  reasoningEffort?: 'low' | 'medium' | 'high',
): Promise<string> {
  const { hardMs, chunkMs } = llmBudgetMs(reasoningEffort);
  const controller = new AbortController();
  const hardTimer = setTimeout(() => controller.abort('hard'), hardMs);
  let chunkTimer: ReturnType<typeof setTimeout> | null = null;
  const armChunk = () => {
    if (chunkTimer) clearTimeout(chunkTimer);
    chunkTimer = setTimeout(() => controller.abort('chunk'), chunkMs);
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
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        max_tokens: 8192,
        ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
      }),
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

export async function callLLM(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  tools?: ReadonlyArray<unknown>,
  reasoningEffort?: 'low' | 'medium' | 'high',
): Promise<OpenRouterResponse> {
  const body: Record<string, unknown> = {
    model,
    messages,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  if (reasoningEffort) {
    body.reasoning = { effort: reasoningEffort };
  }

  // Scale timeout to reasoning effort — medium/high thinking phases alone can run 60-180s.
  const { hardMs } = llmBudgetMs(reasoningEffort);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), hardMs);

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
const KEEP_HEAD = 2;  // system + first user
const KEEP_TAIL = 10; // most recent turns carry the most signal
const MIDDLE_TOOL_TRUNCATE = 200;

function charCount(messages: ChatMessage[]): number {
  let n = 0;
  for (const msg of messages) n += (msg.content ?? '').length;
  return n;
}

// Returns a NEW message array under MAX_CONTEXT_CHARS. Head/tail references are
// reused unchanged; middle messages are either truncated (tool results only) or
// dropped oldest-first until the budget is met. Never mutates input messages —
// the agent loop keeps the authoritative history in the caller's array.
export function pruneMessages(messages: ChatMessage[]): ChatMessage[] {
  if (charCount(messages) <= MAX_CONTEXT_CHARS) return messages;
  if (messages.length <= KEEP_HEAD + KEEP_TAIL) return messages;

  const head = messages.slice(0, KEEP_HEAD);
  const tail = messages.slice(messages.length - KEEP_TAIL);
  const middleRaw = messages.slice(KEEP_HEAD, messages.length - KEEP_TAIL);

  // Step 1: truncate tool outputs in the middle via copy (don't mutate).
  const middleTruncated: ChatMessage[] = middleRaw.map((msg) => {
    if (msg.role === 'tool' && msg.content && msg.content.length > 500) {
      return { ...msg, content: msg.content.slice(0, MIDDLE_TOOL_TRUNCATE) + '\n[...truncated for context management]' };
    }
    return msg;
  });

  // Step 2: if still over budget, drop oldest middle messages until under.
  let current = [...head, ...middleTruncated, ...tail];
  while (charCount(current) > MAX_CONTEXT_CHARS && middleTruncated.length > 0) {
    middleTruncated.shift();
    current = [...head, ...middleTruncated, ...tail];
  }
  return current;
}
