import { config } from './config.js';
import type { Note } from './note.js';

// Optional: Compass (Core42), or any OpenAI-compatible chat API, rewrites the weekly note into smoother prose.
// Off unless COMPASS_URL and COMPASS_KEY are set. The rewrite may only rephrase: every number in the rules note must
// appear in the result, nothing may be added, and it must keep the three parts. Anything else, or any failure, and the
// rules note is used as it is. The note holds team-level numbers and measure names only, never people; that is all
// that is sent. Results are kept for a day per team, so a page view does not call the API.

const cache = new Map<string, { day: string; lines: string[] }>();
const numbers = (text: string) => (text.match(/\d+(?:\.\d+)?%?/g) ?? []).sort();

export const polishConfigured = () => !!(config.compass.url && config.compass.key);

// True when the rewrite keeps every number and every bold heading of the original, and adds no new number.
export function faithful(original: string[], rewritten: string[]): boolean {
  const a = numbers(original.join('\n')), b = numbers(rewritten.join('\n'));
  if (a.length !== b.length || a.some((n, i) => n !== b[i])) return false;
  const heads = original.flatMap((l) => l.match(/\*\*[^*]+\*\*/g) ?? []).filter((h) => !/\d/.test(h));
  return heads.every((h) => rewritten.some((l) => l.includes(h))) && rewritten.length === original.length && rewritten.every((l) => l.trim().length > 0);
}

export async function polish(note: Note, now = Date.now()): Promise<{ lines: string[]; polished: boolean }> {
  const rules = { lines: note.lines, polished: false };
  if (!polishConfigured()) return rules;
  const day = new Date(now).toISOString().slice(0, 10), hit = cache.get(note.team);
  if (hit && hit.day === day) return { lines: hit.lines, polished: true };
  try {
    const res = await fetch(`${config.compass.url.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.compass.key}` }, signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ model: config.compass.model, temperature: 0.2, messages: [
        { role: 'system', content: 'You edit short engineering status notes for clarity. Rewrite the note in plain English for a busy manager. Keep every number exactly as written, keep every **bold** heading exactly as written and in the same order, keep the same number of paragraphs (one per line, separated by blank lines), add no facts, no advice, no names, no judgement of people. Output only the rewritten note.' },
        { role: 'user', content: note.lines.join('\n\n') },
      ] }),
    });
    if (!res.ok) { await res.body?.cancel(); return rules; }
    const body = await res.json() as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content?.trim() ?? '';
    const lines = text.split(/\n\s*\n/).map((l) => l.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
    if (!faithful(note.lines, lines)) return rules;
    cache.set(note.team, { day, lines });
    return { lines, polished: true };
  } catch { return rules; }
}
export const clearPolishCache = () => cache.clear();
