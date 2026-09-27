import { store } from './store/index.js';
import { median } from './cycle.js';
import { doraTier, metricById } from './metrics.js';
import type { GithubSnapshot } from './types.js';

// The four DORA metrics as a headline number and a daily series, for one team or all of them, over 7, 30 or 90 days.
// Same definitions as the flow and production rules (METRICS.md), so the dashboard and the findings always agree.
export const PERIODS = [7, 30, 90] as const;
const DAY = 86_400_000;
const dayOf = (iso: string | number) => new Date(iso).toISOString().slice(0, 10);

interface Point { day: string; value: number | null; avg: number | null }
export interface DoraMetric {
  id: 'deploy_frequency' | 'lead_time' | 'change_failure' | 'time_to_restore';
  title: string; why: string; how: string;
  value: number | null; unit: string; previous: number | null;
  better: boolean | null;          // is this period better than the previous one
  tier: string | null;
  series: Point[]; seriesLabel: string; seriesUnit: string; chart: 'bar' | 'line';
  note: string;
}

// Every day in [from, to), oldest first.
const daysIn = (from: number, to: number) => { const out: string[] = []; for (let t = from; t < to; t += DAY) out.push(dayOf(t)); return out; };
// Trailing 7 day average; for "line" series, the mean of the days that have a value.
function withAverage(days: string[], byDay: Map<string, number>, fill: boolean): Point[] {
  const vals = days.map((d) => (byDay.has(d) ? byDay.get(d)! : fill ? 0 : null));
  return days.map((day, i) => {
    const w = vals.slice(Math.max(0, i - 6), i + 1).filter((v): v is number => v != null);
    return { day, value: vals[i], avg: w.length ? Math.round((w.reduce((a, b) => a + b, 0) / w.length) * 10) / 10 : null };
  });
}
const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);

// Lead time items for one snapshot: PR opened to the next successful deploy after merge, in days, keyed by merge day.
function leadItems(g: GithubSnapshot) {
  const deploys = g.deploys.filter((d) => d.success).map((d) => d.at).sort();
  return g.prs.filter((p) => p.mergedAt && !p.draft).flatMap((p) => {
    const d = deploys.find((x) => x >= p.mergedAt!);
    return d ? [{ merged: Date.parse(p.mergedAt!), days: (Date.parse(d) - Date.parse(p.createdAt)) / DAY }] : [];
  });
}

export function doraSeries(team: string, days: (typeof PERIODS)[number], now = Date.now()) {
  const boards = team === 'all' ? [...new Set(store.scorecards().map((c) => c.board))] : [team];
  const gh = store.github().filter((g) => boards.includes(g.board));
  const az = store.azure().filter((a) => boards.includes(a.board));
  const to = now, from = now - days * DAY, prevFrom = from - days * DAY;
  const span = daysIn(from, to);
  // Data older than the collection window is not there: no comparison rather than a misleading one.
  const ghSince = gh.length ? Math.min(...gh.map((g) => Date.parse(g.since))) : Infinity;
  const hasPrev = prevFrom >= ghSince - DAY;
  const inWin = (t: number, a: number, b: number) => t >= a && t < b;
  const count = (xs: number[]) => { const m = new Map<string, number>(); for (const t of xs) m.set(dayOf(t), (m.get(dayOf(t)) ?? 0) + 1); return m; };
  const text = (id: string) => ({ why: metricById(id)?.why ?? '', how: metricById(id)?.how ?? '' });
  const verdict = (v: number | null, p: number | null, higherBetter: boolean) => (v == null || p == null || v === p ? null : higherBetter ? v > p : v < p);

  // 1. Deployment frequency: successful production deploys per week
  const deploys = gh.flatMap((g) => g.deploys.filter((d) => d.success).map((d) => Date.parse(d.at)));
  const perWeek = (a: number, b: number) => (deploys.filter((t) => inWin(t, a, b)).length / (days / 7));
  const df = r1(perWeek(from, to)), dfPrev = hasPrev ? r1(perWeek(prevFrom, from)) : null;

  // 2. Lead time: median days, PR opened to running in production
  const leads = gh.flatMap(leadItems);
  const leadIn = (a: number, b: number) => { const xs = leads.filter((l) => inWin(l.merged, a, b)).map((l) => l.days); return xs.length ? median(xs) : null; };
  const leadByDay = new Map<string, number>();
  for (const d of span) { const xs = leads.filter((l) => dayOf(l.merged) === d).map((l) => l.days); if (xs.length) leadByDay.set(d, Math.round(median(xs) * 10) / 10); }
  const lt = r1(leadIn(from, to)), ltPrev = hasPrev ? r1(leadIn(prevFrom, from)) : null;

  // 3. Change failure rate: (hotfix or revert PRs + failed deploys) / (merged PRs + failed deploys)
  const merges = gh.flatMap((g) => g.prs.filter((p) => p.mergedAt && !p.draft).map((p) => ({ t: Date.parse(p.mergedAt!), hot: p.isHotfix })));
  const failedDeploys = gh.flatMap((g) => g.deploys.filter((d) => !d.success).map((d) => Date.parse(d.at)));
  const cfrIn = (a: number, b: number) => {
    const m = merges.filter((x) => inWin(x.t, a, b)), f = failedDeploys.filter((t) => inWin(t, a, b)).length;
    return m.length + f ? (100 * (m.filter((x) => x.hot).length + f)) / (m.length + f) : null;
  };
  const failuresByDay = count([...merges.filter((x) => x.hot).map((x) => x.t), ...failedDeploys]);
  const cfr = r1(cfrIn(from, to)), cfrPrev = hasPrev ? r1(cfrIn(prevFrom, from)) : null;

  // 4. Time to restore: median hours from alert fired to resolved (Azure Monitor, Sev0 to Sev2)
  const incidents = az.flatMap((a) => a.ops?.incidents ?? []).map((i) => ({ t: Date.parse(i.firedAt), h: i.resolvedAt ? (Date.parse(i.resolvedAt) - Date.parse(i.firedAt)) / 3_600_000 : null }));
  const mttrIn = (a: number, b: number) => { const xs = incidents.filter((i) => inWin(i.t, a, b) && i.h != null).map((i) => i.h!); return xs.length ? median(xs) : null; };
  const incSince = incidents.length ? Math.min(...incidents.map((i) => i.t)) : Infinity;
  const tr = r1(mttrIn(from, to)), trPrev = prevFrom >= incSince - 7 * DAY ? r1(mttrIn(prevFrom, from)) : null;

  const metrics: DoraMetric[] = [
    { id: 'deploy_frequency', title: 'Deployment frequency', ...text('deploy_frequency'), value: df, unit: 'per week', previous: dfPrev,
      better: verdict(df, dfPrev, true), tier: df == null ? null : doraTier('deploy_frequency', df),
      series: withAverage(span, count(deploys.filter((t) => inWin(t, from, to))), true), seriesLabel: 'Successful deploys', seriesUnit: 'deploys', chart: 'bar',
      note: df == null ? '' : `${Math.round(((df ?? 0) / 7) * 10) / 10} a day on average` },
    { id: 'lead_time', title: 'Lead time for changes', ...text('lead_time'), value: lt, unit: 'days', previous: ltPrev,
      better: verdict(lt, ltPrev, false), tier: lt == null ? null : doraTier('lead_time', lt),
      series: withAverage(span, leadByDay, false), seriesLabel: 'Median lead time of PRs merged that day', seriesUnit: 'days', chart: 'line',
      note: lt == null ? 'No merged and deployed PRs in this period' : `${Math.round((lt ?? 0) * 24)} hours, PR opened to production` },
    { id: 'change_failure', title: 'Change failure rate', ...text('change_failure'), value: cfr, unit: '%', previous: cfrPrev,
      better: verdict(cfr, cfrPrev, false), tier: cfr == null ? null : doraTier('change_failure', cfr),
      series: withAverage(span, failuresByDay, true), seriesLabel: 'Failures (hotfix or revert PRs, failed deploys)', seriesUnit: 'failures', chart: 'bar',
      note: cfr == null ? 'No merges in this period' : 'of changes needed a fix' },
    { id: 'time_to_restore', title: 'Time to restore', ...text('time_to_restore'), value: tr, unit: 'hours', previous: trPrev,
      better: verdict(tr, trPrev, false), tier: tr == null ? null : doraTier('time_to_restore', tr),
      series: withAverage(span, count(incidents.filter((i) => inWin(i.t, from, to)).map((i) => i.t)), true), seriesLabel: 'Incidents (Sev0 to Sev2)', seriesUnit: 'incidents', chart: 'bar',
      note: az.length ? (tr == null ? 'No resolved incidents in this period' : 'median, alert fired to resolved') : 'Connect Azure Monitor to measure this' },
  ];
  return { team, days, from: dayOf(from), to: dayOf(to - 1), boards, metrics };
}
