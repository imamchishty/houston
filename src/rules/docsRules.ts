import type { DocsSnapshot, Finding, Rag } from '../types.js';

const days = (a: string, b = new Date().toISOString()) => (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
const pct = (n: number, d: number) => (d ? (n / d) * 100 : 0);

interface DRule { id: string; title: string; unit: Finding['unit']; amber: number; red: number; direction: 'high_bad' | 'low_bad'; weight: number;
  evaluate: (s: DocsSnapshot, repos: number) => { value: number; message: string; action: string; evidence: string[] } | null; }
const rag = (r: DRule, v: number): Rag =>
  r.direction === 'high_bad' ? (v >= r.red ? 'red' : v >= r.amber ? 'amber' : 'green') : (v <= r.red ? 'red' : v <= r.amber ? 'amber' : 'green');

export const docsRules: DRule[] = [
  { id: 'stale_docs', title: 'Pages untouched for 90+ days', unit: '%', amber: 40, red: 70, direction: 'high_bad', weight: 10,
    evaluate(s) {
      if (!s.pages.length) return null;
      const stale = s.pages.filter((p) => days(p.updatedAt) > 90);
      return { value: Math.round(pct(stale.length, s.pages.length)), message: `${stale.length} of ${s.pages.length} pages (${Math.round(pct(stale.length, s.pages.length))}%) have not been edited in 90 days.`,
        action: 'Every page gets an owner. Owners review their pages quarterly or archive them.', evidence: stale.map((p) => p.title) };
    } },
  { id: 'runbook_coverage', title: 'Runbooks per repo', unit: 'ratio', amber: 1, red: 0.5, direction: 'low_bad', weight: 10,
    evaluate(s, repos) {
      const rb = s.pages.filter((p) => p.type === 'runbook');
      const fresh = rb.filter((p) => days(p.updatedAt) <= 180);
      return { value: repos ? Math.round((rb.length / repos) * 10) / 10 : rb.length, message: `${rb.length} runbooks for ${repos} repos, ${fresh.length} updated in the last 6 months.`,
        action: 'One runbook per deployable service, reviewed after every incident. Missing runbooks are a compliance finding in healthcare.', evidence: rb.map((p) => p.title) };
    } },
  { id: 'adr_activity', title: 'Architecture decisions recorded, last 90 days', unit: 'count', amber: 2, red: 0.5, direction: 'low_bad', weight: 0, // information only: counting ADRs rewards writing more of them, not better decisions
    evaluate(s) {
      const recent = s.pages.filter((p) => p.type === 'adr' && days(p.createdAt) <= 90);
      const all = s.pages.filter((p) => p.type === 'adr');
      return { value: recent.length, message: `${recent.length} ADRs written in the last 90 days, ${all.length} in total.${all.length ? ` Newest is ${Math.round(Math.min(...all.map((p) => days(p.createdAt))))} days old.` : ''}`,
        action: 'Any decision that changes an interface, a data model or a dependency gets a one page ADR. That is the architect role, written down.', evidence: recent.map((p) => p.title) };
    } },
];

export function scoreDocs(s: DocsSnapshot, repos: number): { score: number; rag: Rag; findings: Finding[] } {
  const findings: Finding[] = []; let earned = 0, possible = 0;
  const pts: Record<Rag, number> = { green: 1, amber: 0.5, red: 0 };
  for (const r of docsRules) {
    const res = r.evaluate(s, repos); if (!res) continue;
    const g = rag(r, res.value); earned += pts[g] * r.weight; possible += r.weight;
    findings.push({ ruleId: r.id, title: r.title, area: 'docs', unit: r.unit, value: res.value, rag: g, message: res.message, action: res.action, evidence: res.evidence.slice(0, 10) , weight: r.weight });
  }
  const score = possible ? Math.round((earned / possible) * 100) : 0;
  const order: Record<Rag, number> = { red: 0, amber: 1, green: 2 };
  findings.sort((a, b) => order[a.rag] - order[b.rag]);
  return { score, rag: score >= 75 ? 'green' : score >= 50 ? 'amber' : 'red', findings };
}

// Per person docs output, last 90 days. This is where an architect's work should show if it exists.
export function docsPeople(s: DocsSnapshot) {
  const by = new Map<string, { name: string; created: number; edited: number; adrs: number; runbooks: number; last: string | null }>();
  for (const p of s.pages) {
    for (const [who, when, isCreate] of [[p.createdBy, p.createdAt, true], [p.updatedBy, p.updatedAt, false]] as const) {
      if (days(when) > 90) continue;
      const e = by.get(who) ?? { name: who, created: 0, edited: 0, adrs: 0, runbooks: 0, last: null };
      if (isCreate) { e.created++; if (p.type === 'adr') e.adrs++; if (p.type === 'runbook') e.runbooks++; } else e.edited++;
      if (!e.last || when > e.last) e.last = when;
      by.set(who, e);
    }
  }
  return [...by.values()].sort((a, b) => (b.created + b.edited) - (a.created + a.edited));
}
