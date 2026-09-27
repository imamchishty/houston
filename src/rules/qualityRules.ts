import type { QualitySnapshot, Finding, Rag } from '../types.js';

// Quality checks. Same finding shape as sprint rules so the UI and digest treat them identically.
interface QRule {
  id: string; title: string; unit: Finding['unit']; amber: number; red: number; direction: 'high_bad' | 'low_bad'; weight: number;
  evaluate: (q: QualitySnapshot) => { value: number; message: string; action: string } | null;
}

const rag = (r: QRule, v: number): Rag =>
  r.direction === 'high_bad' ? (v >= r.red ? 'red' : v >= r.amber ? 'amber' : 'green') : (v <= r.red ? 'red' : v <= r.amber ? 'amber' : 'green');

export const qualityRules: QRule[] = [
  { id: 'quality_gate', title: 'SonarQube quality gate', unit: 'count', amber: 0.5, red: 0, direction: 'low_bad', weight: 15,
    evaluate: (q) => q.sonar && ({ value: q.sonar.qualityGate === 'OK' ? 1 : 0,
      message: q.sonar.qualityGate === 'OK' ? 'Quality gate is passing.' : `Quality gate is failing on ${q.sonar.projectKey}.`,
      action: 'Block merges to main on a failing gate. Fix the gate before any new feature work.' }) },
  // Overall coverage is context, not a target (legacy code drags it down): weight 0, so it never moves the score.
  { id: 'coverage', title: 'Test coverage, overall', unit: '%', amber: 60, red: 40, direction: 'low_bad', weight: 0,
    evaluate: (q) => q.sonar && ({ value: q.sonar.coverage,
      message: `Coverage is ${q.sonar.coverage}%${q.sonar.newCoverage != null ? `, and ${q.sonar.newCoverage}% on new code` : ''}.`,
      action: 'Do not chase the overall number. Require 80% on new code in the gate and let the total climb.' }) },
  { id: 'new_code_coverage', title: 'Coverage on new code', unit: '%', amber: 70, red: 50, direction: 'low_bad', weight: 10,
    evaluate: (q) => q.sonar?.newCoverage != null ? ({ value: q.sonar.newCoverage,
      message: `${q.sonar.newCoverage}% of new code is covered by tests.`,
      action: 'This is the number that shows whether the team is writing tests now. Set the gate to 80% on new code.' }) : null },
  { id: 'vulnerabilities', title: 'Open vulnerabilities', unit: 'count', amber: 1, red: 5, direction: 'high_bad', weight: 10,
    evaluate: (q) => q.sonar && ({ value: q.sonar.vulnerabilities,
      message: `${q.sonar.vulnerabilities} open vulnerabilities and ${q.sonar.securityHotspots} security hotspots to review.`,
      action: 'Vulnerabilities are fixed in the next sprint, no exceptions, in a regulated environment.' }) },
  { id: 'sonar_bugs', title: 'Sonar-detected bugs', unit: 'count', amber: 10, red: 30, direction: 'high_bad', weight: 0, // information only: a raw count, not adjusted for codebase size
    evaluate: (q) => q.sonar && ({ value: q.sonar.bugs, message: `${q.sonar.bugs} bugs detected by static analysis, ${q.sonar.techDebtHours}h estimated tech debt.`,
      action: 'Reserve 15% of each sprint for Sonar bugs until this is under 10.' }) },
  { id: 'duplication', title: 'Duplicated code', unit: '%', amber: 5, red: 10, direction: 'high_bad', weight: 5,
    evaluate: (q) => q.sonar && ({ value: q.sonar.duplicatedLines, message: `${q.sonar.duplicatedLines}% of lines are duplicated.`,
      action: 'High duplication means copy-paste delivery. Flag it in review.' }) },
  { id: 'test_pass_rate', title: 'Automated test pass rate', unit: '%', amber: 97, red: 90, direction: 'low_bad', weight: 10,
    evaluate: (q) => q.testmo && q.testmo.runsLast30d > 0 ? ({ value: q.testmo.lastRunPassRate,
      message: `${q.testmo.lastRunPassRate}% of tests passed across ${q.testmo.runsLast30d} automated runs in 30 days. Latest run: ${q.testmo.failedTestsLastRun} failures, ${q.testmo.flakyTests} flaky.`,
      action: 'A red suite that is tolerated is no suite. Fix or delete failing tests this sprint.' }) : null },
  { id: 'test_runs', title: 'Test runs in the last 30 days', unit: 'count', amber: 20, red: 8, direction: 'low_bad', weight: 5,
    evaluate: (q) => q.testmo && ({ value: q.testmo.runsLast30d, message: `${q.testmo.runsLast30d} automated runs in 30 days.`,
      action: 'Run the suite on every PR. Fewer than one run a day means tests are not part of the workflow.' }) },
  { id: 'automation_share', title: 'Share of tests automated', unit: '%', amber: 50, red: 30, direction: 'low_bad', weight: 5,
    evaluate: (q) => q.testmo && ({ value: q.testmo.automatedShare, message: `${q.testmo.automatedShare}% of test cases are automated.`,
      action: 'Manual regression is why rollout is slow. Automate the top 20 regression cases first.' }) },
];

export function scoreQuality(q: QualitySnapshot): { score: number; rag: Rag; findings: Finding[] } {
  const findings: Finding[] = []; let earned = 0, possible = 0;
  const pts: Record<Rag, number> = { green: 1, amber: 0.5, red: 0 };
  for (const r of qualityRules) {
    const res = r.evaluate(q); if (!res) continue;
    const g = rag(r, res.value); earned += pts[g] * r.weight; possible += r.weight;
    findings.push({ ruleId: r.id, title: r.title, area: 'quality', unit: r.unit, value: Math.round(res.value * 10) / 10, rag: g, message: res.message, action: res.action, evidence: [] , weight: r.weight });
  }
  const score = possible ? Math.round((earned / possible) * 100) : 0;
  const order: Record<Rag, number> = { red: 0, amber: 1, green: 2 };
  findings.sort((a, b) => order[a.rag] - order[b.rag]);
  return { score, rag: score >= 75 ? 'green' : score >= 50 ? 'amber' : 'red', findings };
}
