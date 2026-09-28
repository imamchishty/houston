import { REPORTS, slice, sliceRange, type Measure, type Period, type Slice } from './reports.js';

// How a team is performing: 10 headline measures in five areas, speed and quality first. Each headline has a target;
// the score is the share of headline targets met. Everything else is drill-down: it explains a headline and does not
// count in the score. Every number comes from reports.ts, so the dashboard, team page, monthly report and API agree.
export const AREAS = [
  { id: 'speed', title: 'Speed', question: 'How fast does work reach users, and do we deliver what we plan?', headlines: ['deploy_frequency', 'lead_time', 'sprint_completion'] },
  { id: 'quality', title: 'Quality', question: 'Are we shipping good work, or creating rework?', headlines: ['defect_leakage', 'bug_workload'] },
  { id: 'stability', title: 'Stability and support', question: 'How often do things break, how fast do we recover, and are customers helped in time?', headlines: ['change_failure_rate', 'time_to_restore', 'sla_resolution'] },
  { id: 'flow', title: 'Flow', question: 'Does work move smoothly, or sit waiting?', headlines: ['flow_efficiency'] },
  { id: 'security', title: 'Security', question: 'Are serious security issues fixed in time?', headlines: ['security_on_time'] },
] as const;
export const HEADLINES: string[] = AREAS.flatMap((a) => [...a.headlines]);

// What explains each headline, in the order to read it.
export const DRILL: Record<string, string[]> = {
  deploy_frequency: [],
  lead_time: ['stage_coding', 'stage_review', 'stage_deploy'],
  sprint_completion: ['unplanned_work', 'scope_added', 'carry_over'],
  defect_leakage: ['bugs_per_change', 'qa_rejection', 'pr_review_rate', 'quality_gate_pass', 'new_code_coverage', 'test_pass_rate'],
  bug_workload: ['bug_lead_time', 'bug_fix_find', 'revert_ratio'],
  change_failure_rate: ['incidents', 'server_errors', 'availability'],
  time_to_restore: ['incidents_out_of_hours'],
  sla_resolution: ['sla_response', 'support_response_time', 'support_resolution_time', 'support_per_week', 'support_open', 'support_share', 'support_repeat', 'support_out_of_hours'],
  flow_efficiency: ['flow_time', 'flow_load', 'flow_velocity', 'pickup_time', 'review_time', 'pr_size', 'reviewer_load', 'ci_failure_rate'],
  security_on_time: ['security_overdue', 'secrets_open', 'security_fix_critical', 'security_fix_high', 'security_open_critical_high', 'security_dismissed', 'scan_dependency', 'scan_secret', 'scan_code'],
};
// Charts and tables that go with a headline, by the name reports.ts gives them.
const EXTRAS: Record<string, string[]> = { lead_time: ['stages'], sprint_completion: ['detail'], defect_leakage: ['trend'], flow_efficiency: ['heatmap', 'distribution', 'velocityByWeek'], sla_resolution: ['weekly'] };

// Plain names for the one-line summary and the Teams post.
export const PLAIN: Record<string, string> = {
  deploy_frequency: 'releases too rarely', lead_time: 'changes take too long to reach users', sprint_completion: 'finishes less than it plans',
  defect_leakage: 'too many bugs reach customers', bug_workload: 'too much time goes on bugs',
  change_failure_rate: 'too many changes break something', time_to_restore: 'takes too long to recover from incidents', sla_resolution: 'support requests are not resolved in the agreed time',
  flow_efficiency: 'work spends most of its time waiting', security_on_time: 'serious security issues are not fixed in time',
};

// Every measure of a slice by id, and the charts and tables that came with them.
function all(s: Slice) {
  const measures = new Map<string, Measure>(), extras = new Map<string, unknown>();
  for (const fn of Object.values(REPORTS)) for (const g of (fn as (s: Slice) => { groups: Record<string, unknown>[] })(s).groups) {
    for (const m of g.measures as Measure[]) measures.set(m.id, m);
    for (const [k, v] of Object.entries(g)) if (!['id', 'title', 'question', 'measures', 'note'].includes(k)) extras.set(k, v);
  }
  return { measures, extras };
}

// Judged: a target, a value, and enough items to trust it. Small samples and unmeasured headlines are shown, not scored.
const judged = (m: Measure | undefined) => !!m && m.met != null && !m.smallSample;
export function score(measures: Map<string, Measure>) {
  const hs = HEADLINES.map((id) => measures.get(id)).filter(judged) as Measure[];
  const met = hs.filter((m) => m.met).length;
  return { met, of: hs.length, pct: hs.length ? Math.round((100 * met) / hs.length) : null };
}

const trendOf = (m: Measure, p: Measure | undefined): Measure => {
  if (!p || m.value == null || p.value == null || !m.target) return { ...m, previous: p?.value ?? null, previousMet: p?.met ?? null, trend: null };
  const better = m.target.op === '<' ? m.value < p.value : m.value > p.value;
  return { ...m, previous: p.value, previousMet: p.met, trend: m.value === p.value ? 'same' : better ? 'better' : 'worse' };
};

// One team (or 'all') over the last `days`: the areas with their headlines and drill-down, the score, and the score
// for the period before, so the trend is like for like.
export function performance(team: string, days: Period, now = Date.now()) {
  const cur = all(slice(team, days, now)), prev = all(sliceRange(team, now - 2 * days * 86_400_000, now - days * 86_400_000));
  const withPrev = (id: string) => { const m = cur.measures.get(id); return m ? trendOf(m, prev.measures.get(id)) : null; };
  const areas = AREAS.map((a) => ({
    id: a.id, title: a.title, question: a.question,
    headlines: a.headlines.flatMap((id) => {
      const m = withPrev(id); if (!m) return [];
      return [{ measure: m, missedTwice: m.met === false && m.previousMet === false && !m.smallSample,
        drill: DRILL[id].flatMap((d) => { const x = withPrev(d); return x ? [x] : []; }),
        extras: Object.fromEntries((EXTRAS[id] ?? []).filter((k) => cur.extras.has(k)).map((k) => [k, cur.extras.get(k)])) }];
    }),
  }));
  const sc = score(cur.measures), before = score(prev.measures);
  const missed = areas.flatMap((a) => a.headlines).filter((h) => h.measure.met === false && !h.measure.smallSample)
    .sort((x, y) => Number(y.missedTwice) - Number(x.missedTwice) || HEADLINES.indexOf(x.measure.id) - HEADLINES.indexOf(y.measure.id));
  return {
    team, days, from: new Date(now - days * 86_400_000).toISOString(), to: new Date(now).toISOString(),
    score: { ...sc, previousPct: before.pct, trend: sc.pct == null || before.pct == null ? null : sc.pct > before.pct ? 'better' : sc.pct < before.pct ? 'worse' : 'same' },
    summary: summaryLine(sc, missed.map((h) => h.measure)),
    // Missed targets, worst first: missed two periods running before missed once, then speed and quality first.
    missed: missed.map((h) => ({ id: h.measure.id, title: h.measure.title, value: h.measure.value, unit: h.measure.unit, target: h.measure.target, missedTwice: h.missedTwice })),
    areas,
  };
}

// One plain sentence: how many targets are met, and what is missed.
export function summaryLine(sc: { met: number; of: number }, missed: Measure[]) {
  if (!sc.of) return 'Not enough data yet to judge.';
  const names = missed.map((m) => PLAIN[m.id] ?? m.title.toLowerCase());
  if (!names.length) return `Meets all ${sc.of} targets.`;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Meets ${sc.met} of ${sc.of} targets. Missing: ${list}.`;
}

export { allBoards as boards } from './reports.js';
