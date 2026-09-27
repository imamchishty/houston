import type { Finding, Rag, Scorecard, Sprint } from '../types.js';
import { rules } from './sprintRules.js';

export interface RuleDef {
  id: string;
  title: string;
  area: Finding['area'];
  unit: Finding['unit'];
  amber: number;
  red: number;
  direction: 'high_bad' | 'low_bad';
  weight: number; // contribution to the 100 point score
  evaluate: (s: Sprint) => { value: number; message: string; action: string; evidence: string[] } | null;
}

export function ragFor(rule: RuleDef, value: number): Rag {
  if (rule.direction === 'high_bad') {
    if (value >= rule.red) return 'red';
    if (value >= rule.amber) return 'amber';
    return 'green';
  }
  if (value <= rule.red) return 'red';
  if (value <= rule.amber) return 'amber';
  return 'green';
}

const ragPoints: Record<Rag, number> = { green: 1, amber: 0.5, red: 0 };

export function scoreSprint(sprint: Sprint, defs: RuleDef[] = rules): Scorecard {
  const findings: Finding[] = [];
  let earned = 0;
  let possible = 0;

  for (const rule of defs) {
    const result = rule.evaluate(sprint);
    if (!result) continue; // rule not applicable to this sprint
    const rag = ragFor(rule, result.value);
    earned += ragPoints[rag] * rule.weight;
    possible += rule.weight;
    findings.push({
      ruleId: rule.id,
      title: rule.title,
      area: rule.area,
      value: Math.round(result.value * 10) / 10,
      unit: rule.unit,
      rag,
      message: result.message,
      action: result.action,
      evidence: result.evidence.slice(0, 10),
      weight: rule.weight,
    });
  }

  const score = possible ? Math.round((earned / possible) * 100) : 0;
  const rag: Rag = score >= 75 ? 'green' : score >= 50 ? 'amber' : 'red';
  const order: Record<Rag, number> = { red: 0, amber: 1, green: 2 };
  findings.sort((a, b) => order[a.rag] - order[b.rag]);

  return {
    board: sprint.board,
    sprintId: sprint.id,
    sprintName: sprint.name,
    sprintEnd: sprint.end,
    score,
    rag,
    findings,
    generatedAt: new Date().toISOString(),
  };
}
