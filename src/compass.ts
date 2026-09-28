import { config } from './config.js';

// Compass (Core42), or any OpenAI-compatible chat API. Used by the weekly note's rewording and by chat. Off unless
// COMPASS_URL and COMPASS_KEY are set. What is sent is always team-level text Houston composed: measure names, numbers,
// and the person's question. Nothing is stored on the Compass side by Houston, and nothing per person is ever sent.
export type Message = { role: 'system' | 'user' | 'assistant'; content: string };
export const compassConfigured = () => !!(config.compass.url && config.compass.key);

// One chat completion; the text of the answer, or null on any failure (the caller falls back to Houston's own text).
export async function compassChat(messages: Message[], opts: { json?: boolean; timeoutMs?: number; maxTokens?: number } = {}): Promise<string | null> {
  if (!compassConfigured()) return null;
  try {
    const res = await fetch(`${config.compass.url.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.compass.key}` }, signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      body: JSON.stringify({ model: config.compass.model, temperature: 0.2, max_tokens: opts.maxTokens ?? 800, messages, ...(opts.json ? { response_format: { type: 'json_object' } } : {}) }),
    });
    if (!res.ok) { await res.body?.cancel(); return null; }
    const body = await res.json() as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch { return null; }
}

// The numbers in a text, normalised (8% and 08 and 8.0 are the same), for checking that an answer invents nothing.
export const numberSet = (text: string) => new Set((text.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n))));
export const numbersOnlyFrom = (answer: string, facts: string) => { const ok = numberSet(facts); return [...numberSet(answer)].every((n) => ok.has(n)); };
