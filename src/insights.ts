import type { Finding, Rag, Scorecard } from './types.js';

export interface Insight { kind: 'better' | 'worse' | 'chronic' | 'new' | 'good'; text: string; ruleId?: string; }

const fmt = (f: Finding) => (f.unit === '%' ? `${Math.round(f.value)}%` : f.unit === 'days' ? `${f.value}d` : String(f.value));

// Reads the last sprints and says, in a few sentences, what changed and what is stuck.
export function sprintInsights(history: Scorecard[]): Insight[] {
  const out: Insight[] = [];
  if (history.length < 2) return out;
  const cur = history[history.length - 1], prev = history[history.length - 2];
  const d = cur.score - prev.score;
  out.push({ kind: d > 0 ? 'better' : d < 0 ? 'worse' : 'good', text: d === 0 ? `Score unchanged at ${cur.score}.` : `Score ${d > 0 ? 'rose' : 'fell'} from ${prev.score} to ${cur.score} (${d > 0 ? '+' : ''}${d} points) since ${prev.sprintName}.` });
  const order: Record<Rag, number> = { red: 0, amber: 1, green: 2 };
  for (const f of cur.findings) {
    const p = prev.findings.find((x) => x.ruleId === f.ruleId);
    if (!p) { continue; }
    if (order[f.rag] > order[p.rag]) out.push({ kind: 'better', ruleId: f.ruleId, text: `${f.title} improved: ${fmt(p)} to ${fmt(f)}, now ${f.rag}.` });
    else if (order[f.rag] < order[p.rag]) out.push({ kind: 'worse', ruleId: f.ruleId, text: `${f.title} got worse: ${fmt(p)} to ${fmt(f)}, now ${f.rag}.` });
  }
  // chronic: red in each of the last 3
  const last3 = history.slice(-3);
  if (last3.length === 3) for (const f of cur.findings) {
    if (last3.every((h) => h.findings.find((x) => x.ruleId === f.ruleId)?.rag === 'red')) out.push({ kind: 'chronic', ruleId: f.ruleId, text: `${f.title} has been red for ${last3.length} sprints running. This is structural, not a bad sprint.` });
  }
  // streaks of improvement
  if (history.length >= 4) {
    const s = history.slice(-4).map((h) => h.score);
    if (s.every((v, i) => i === 0 || v > s[i - 1])) out.push({ kind: 'better', text: `Three sprints of improvement in a row (${s.join(' → ')}). Whatever changed, keep it.` });
    if (s.every((v, i) => i === 0 || v < s[i - 1])) out.push({ kind: 'worse', text: `Three sprints of decline in a row (${s.join(' → ')}).` });
  }
  const priority: Record<Insight['kind'], number> = { chronic: 0, worse: 1, better: 2, new: 3, good: 4 };
  return out.sort((a, b) => priority[a.kind] - priority[b.kind]).slice(0, 6);
}

// Grid: rule × sprint → rag, for the heatmap.
export function heatmap(history: Scorecard[]) {
  const rules = new Map<string, string>();
  for (const h of history) for (const f of h.findings) rules.set(f.ruleId, f.title);
  return {
    sprints: history.map((h) => h.sprintName.replace(/^.*Sprint /, 'S')),
    rows: [...rules.entries()].map(([id, title]) => ({ id, title, cells: history.map((h) => { const f = h.findings.find((x) => x.ruleId === id); return f ? { rag: f.rag, value: fmt(f) } : null; }) })),
  };
}

// One sentence per team for the overview cards.
export function headline(history: Scorecard[], extra: { flow?: number | null; quality?: number | null; features?: number | null }): string {
  const ins = sprintInsights(history);
  const chronic = ins.find((i) => i.kind === 'chronic');
  const worse = ins.find((i) => i.kind === 'worse' && i.ruleId);
  const better = ins.find((i) => i.kind === 'better' && i.ruleId);
  if (chronic) return chronic.text;
  if (worse) return worse.text;
  if (extra.quality != null && extra.quality < 50) return `Quality score ${extra.quality}. Rework is eating delivery.`;
  if (better) return better.text;
  if (extra.features != null && extra.features < 50) return `Features are slow to ship. Product will feel this before anything else.`;
  const cur = history[history.length - 1];
  return cur ? `${cur.findings.filter((f) => f.rag !== 'green').length} of ${cur.findings.length} sprint checks need attention.` : 'No data yet.';
}
