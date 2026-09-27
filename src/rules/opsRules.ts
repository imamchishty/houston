import type { AzureSnapshot, Finding, Rag } from '../types.js';

export function scoreOps(a: AzureSnapshot): { score: number; rag: Rag; findings: Finding[] } {
  const findings: Finding[] = []; const pts: Record<Rag, number> = { green: 1, amber: 0.5, red: 0 }; let earned = 0, possible = 0;
  const add = (id: string, title: string, unit: Finding['unit'], value: number, rag: Rag, weight: number, message: string, action: string) => {
    findings.push({ ruleId: id, title, area: 'ops', unit, value, rag, message, action, evidence: [] }); earned += pts[rag] * weight; possible += weight;
  };
  const o = a.ops;
  if (o) {
    add('failed_requests', 'Failed requests, 30 days', '%', o.failedRate, o.failedRate < 1 ? 'green' : o.failedRate < 3 ? 'amber' : 'red', 15,
      `${o.failedRate}% of ${o.requests30d.toLocaleString()} requests failed in 30 days. p95 latency ${o.p95LatencyMs} ms.`, 'Failures above 1% are visible to users. Top three failing endpoints go into the next sprint as bugs.');
    add('availability', 'Availability, 30 days', '%', o.availability, o.availability >= 99.9 ? 'green' : o.availability >= 99.5 ? 'amber' : 'red', 10,
      `${o.availability}% availability from synthetic tests.`, 'Agree an SLO with the product team and report against it monthly.');
    add('incidents', 'Incidents (Sev0 to Sev2), 30 days', 'count', o.incidents30d, o.incidents30d <= 1 ? 'green' : o.incidents30d <= 4 ? 'amber' : 'red', 10,
      `${o.incidents30d} incidents in 30 days.`, 'Every incident gets a 30 minute review and one action. Recurring causes go to the top of the backlog.');
    if (o.medianRestoreMin != null) {
      const h = o.medianRestoreMin / 60;
      add('time_to_restore', 'Time to restore (DORA), hours', 'count', Math.round(h * 10) / 10, h < 1 ? 'green' : h < 24 ? 'amber' : 'red', 15,
        `Median ${Math.round(o.medianRestoreMin)} minutes from alert to resolved. DORA: elite under an hour, high under a day.`, 'Restore time is a runbook and on-call problem, not a coding problem. Check runbook coverage in the docs score.');
    }
  }
  const c = a.cost;
  if (c) {
    add('cloud_cost', 'Cloud cost, last month', 'count', c.cloudMonthAed, 'green', 0, `AED ${c.cloudMonthAed.toLocaleString()} cloud spend last month for the team's resources.`, 'Informational.');
    if (c.costPerFeatureAed != null) {
      add('cost_per_feature', 'Cost per shipped feature, last quarter', 'count', c.costPerFeatureAed,
        c.costPerFeatureAed < 300_000 ? 'green' : c.costPerFeatureAed < 800_000 ? 'amber' : 'red', 10,
        `AED ${c.costPerFeatureAed.toLocaleString()} per feature: (cloud AED ${c.cloudMonthAed.toLocaleString()}${c.teamMonthAed ? ` + team AED ${c.teamMonthAed.toLocaleString()}` : ''}) per month × 3, over ${c.featuresShipped90d} features shipped in 90 days.`,
        'This is the P&L number. It falls when feature lead time falls, not when headcount rises.');
    } else {
      add('cost_per_feature', 'Cost per shipped feature, last quarter', 'count', 0, 'red', 10, `No features shipped in 90 days, so cost per feature is undefined. Spend was AED ${((c.cloudMonthAed + (c.teamMonthAed ?? 0)) * 3).toLocaleString()} for the quarter.`, 'Ship one feature.');
    }
  }
  const score = possible ? Math.round((earned / possible) * 100) : 0;
  const order: Record<Rag, number> = { red: 0, amber: 1, green: 2 };
  findings.sort((x, y) => order[x.rag] - order[y.rag]);
  return { score, rag: score >= 75 ? 'green' : score >= 50 ? 'amber' : 'red', findings };
}
