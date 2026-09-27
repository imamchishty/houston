import { slice, quality, predictability, efficiency, flatMeasures } from './reports.js';
import { currentSprint } from './sprintNow.js';
import { doraSeries } from './dora.js';

// The numbers the flow diagnoses read, for one team over the last 30 days. Null where there is not enough data.
export interface Diag { flowEfficiency: number | null; pickupHours: number | null; qaRejection: number | null; sprintCompletion: number | null; oldWip: number; deploysPerWeek: number | null }

export function diagFor(board: string, now = Date.now()): Diag {
  const s = slice(board, 30, now);
  const all = [quality(s), predictability(s), efficiency(s)].flatMap(flatMeasures);
  const v = (id: string) => { const m = all.find((x) => x.id === id); return m && m.value != null && !m.smallSample ? m.value : null; };
  const pickup = v('pickup_time');
  return {
    flowEfficiency: v('flow_efficiency'), pickupHours: pickup == null ? null : pickup * 24, qaRejection: v('qa_rejection'),
    sprintCompletion: v('sprint_completion'), oldWip: currentSprint(board, false, now)?.oldWip ?? 0,
    deploysPerWeek: doraSeries(board, 30, now).metrics.find((m) => m.id === 'deploy_frequency')?.value ?? null,
  };
}
