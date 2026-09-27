import type { Epic, Finding, Rag } from '../types.js';
import { median } from '../cycle.js';

const days = (a: string, b = new Date().toISOString()) => (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;

export function scoreFeatures(epics: Epic[]): { score: number; rag: Rag; findings: Finding[] } {
  const findings: Finding[] = [];
  const done = epics.filter((e) => e.resolved);
  const open = epics.filter((e) => !e.resolved);
  const pts: Record<Rag, number> = { green: 1, amber: 0.5, red: 0 };
  let earned = 0, possible = 0;
  const add = (id: string, title: string, unit: Finding['unit'], value: number, rag: Rag, weight: number, message: string, action: string, evidence: string[]) => {
    findings.push({ ruleId: id, title, area: 'features', unit, value, rag, message, action, evidence, weight }); earned += pts[rag] * weight; possible += weight;
  };
  if (done.length >= 3) {
    const lead = median(done.map((e) => days(e.created, e.resolved!)));
    const work = median(done.filter((e) => e.started).map((e) => days(e.started!, e.resolved!)));
    const rag: Rag = lead <= 45 ? 'green' : lead <= 90 ? 'amber' : 'red';
    add('feature_lead_time', 'Feature lead time (epic created to done)', 'days', Math.round(lead), rag, 20,
      `Median ${Math.round(lead)} days from an epic being created to done, ${Math.round(work)} days once work started, across ${done.length} features in 6 months. The gap between the two is waiting.`,
      'This is the number product feels. Cut it by starting fewer features at once and finishing them.',
      done.map((e) => `${e.key} ${Math.round(days(e.created, e.resolved!))}d`));
  }
  if (open.length) {
    const wip = open.filter((e) => e.statusCategory === 'inprogress');
    const oldest = Math.max(...open.map((e) => days(e.created)));
    const rag: Rag = wip.length <= 3 ? 'green' : wip.length <= 5 ? 'amber' : 'red';
    add('feature_wip', 'Features in progress at once', 'count', wip.length, rag, 10,
      `${wip.length} features in progress at the same time, oldest open for ${Math.round(oldest)} days. ${open.reduce((t, e) => t + e.childDone, 0)} of ${open.reduce((t, e) => t + e.childCount, 0)} child tickets done.`,
      'More than three features in flight for a team this size means none of them finish. Stop starting, start finishing.',
      open.map((e) => `${e.key} ${e.childDone}/${e.childCount}`));
  }
  const score = possible ? Math.round((earned / possible) * 100) : 0;
  return { score, rag: score >= 75 ? 'green' : score >= 50 ? 'amber' : 'red', findings };
}
