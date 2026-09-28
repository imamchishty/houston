import { config } from './config.js';
import { store } from './store/index.js';
import { median, doneInSprint } from './cycle.js';
import { sliceRange, flatMeasures, REPORTS, type Target, type Measure } from './reports.js';
import { HEADLINES, score, boards as allBoards } from './performance.js';
import { recordMonth, storedMonth } from './store/history.js';

// The monthly report: one calendar month (in the team's time zone) for one team or all, against the month before,
// with six months of trend. Every number is computed over the exact month from the collected data. Collected data
// only reaches back JIRA_DAYS / GITHUB_DAYS, so each completed month is also saved for good, and a month the data
// does not fully cover says so instead of showing a number for part of it.

export type MonthStatus = 'complete' | 'in progress' | 'partial' | 'saved' | 'no data';

// The key numbers, in the order the report shows them: the score, then the 10 headline measures (planning, execution,
// quality, stability, security). better: which direction is an improvement. Titles and targets come from the measures themselves.
const KEYS: { id: string; title: string; unit: string; better: 'up' | 'down'; target: Target | null }[] = [
  { id: 'score', title: 'Targets met', unit: '%', better: 'up', target: null },
  ...HEADLINES.map((id) => ({ id, title: '', unit: '', better: 'up' as const, target: null as Target | null })),
];
// Fill in titles, units, targets and direction from the measures (computed once on an empty slice).
{
  const empty = sliceRange('all', 0, 1), ms = new Map(Object.values(REPORTS).flatMap((fn) => flatMeasures(fn(empty))).map((m) => [m.id, m]));
  for (const k of KEYS) { const m = ms.get(k.id); if (!m) continue; k.title = m.title.replace(/ \(median\)$/, ''); k.unit = m.id === 'deploy_frequency' ? 'per week' : m.unit; k.target = m.target; k.better = m.target?.op === '<' ? 'down' : 'up'; }
}

// Month boundaries in the team's time zone: [1st 00:00, next 1st 00:00).
export function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number), off = config.tzOffset * 3_600_000;
  return { from: Date.UTC(y, m - 1, 1) - off, to: Date.UTC(y, m, 1) - off };
}
export const monthOf = (t: number) => new Date(t + config.tzOffset * 3_600_000).toISOString().slice(0, 7);
export const prevMonth = (month: string) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7); };

const boardsOf = (team: string) => (team === 'all' ? allBoards() : [team]);

// When the collected data starts for these teams: the latest start of any source, so every measure is covered.
function coverageStart(team: string) {
  const b = boardsOf(team);
  const starts = [...store.github().filter((g) => b.includes(g.board)).map((g) => Date.parse(g.since)),
    ...store.projects().filter((p) => b.includes(p.board)).map((p) => Date.parse(p.since))];
  return starts.length ? Math.max(...starts) : Infinity;
}

type Val = { value: number | null; num: number | null; den: number | null; smallSample?: boolean };

// The key numbers for one month, computed from the collected data for [from, min(to, now)).
function compute(team: string, from: number, to: number): Map<string, Val> {
  const s = sliceRange(team, from, to);
  const all = new Map(Object.values(REPORTS).flatMap((fn) => flatMeasures(fn(s))).map((m) => [m.id, m] as const));
  const val = (m: Measure | undefined): Val => (m ? { value: m.value, num: m.num, den: m.den, smallSample: m.smallSample } : { value: null, num: null, den: null });
  const sc = score(all);
  const out = new Map<string, Val>([['score', { value: sc.pct, num: sc.met, den: sc.of }], ...HEADLINES.map((id) => [id, val(all.get(id))] as [string, Val])]);
  // Flow distribution: items completed this month by kind (features, defects, risks, debt), saved with the month.
  const dist = (REPORTS.flow(s).groups.find((g) => 'distribution' in g) as unknown as { distribution?: { kind: string; items: number }[] } | undefined)?.distribution ?? [];
  for (const d of dist) out.set(`dist_${d.kind.toLowerCase()}`, { value: d.items, num: null, den: null });
  return out;
}

// One month's numbers and where they came from.
export function monthValues(team: string, month: string, now = Date.now()): { status: MonthStatus; values: Map<string, Val> } {
  const { from, to } = monthRange(month), start = coverageStart(team);
  if (from > now) return { status: 'no data', values: new Map() };
  if (to > now) return { status: 'in progress', values: from >= start ? compute(team, from, now) : new Map() };
  if (from >= start) return { status: 'complete', values: compute(team, from, to) };
  const saved = storedMonth(month, team);
  if (saved.size) return { status: 'saved', values: saved };
  return { status: to <= start ? 'no data' : 'partial', values: new Map() };
}

const fmt = (v: number | null, unit: string) => (v == null ? 'n/a' : `${Number.isInteger(v) ? v : v.toFixed(1)}${unit === '%' ? '%' : unit === 'count' ? '' : ' ' + unit}`);
const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function monthlyReport(team: string, month: string, now = Date.now()) {
  const cur = monthValues(team, month, now), prev = monthValues(team, prevMonth(month), now);
  const headline = KEYS.map((k) => {
    const v = cur.values.get(k.id), p = prev.values.get(k.id);
    const value = v?.value ?? null, previous = p?.value ?? null;
    const change = value == null || previous == null ? null : Math.round((value - previous) * 10) / 10;
    const trend = change == null || change === 0 ? (change === 0 ? 'same' : null) : (k.better === 'up' ? change > 0 : change < 0) ? 'better' : 'worse';
    const met = value == null || !k.target ? null : k.target.op === '<' ? value < k.target.value : value > k.target.value;
    return { ...k, value, previous, change, trend, met, num: v?.num ?? null, den: v?.den ?? null, smallSample: !!v?.smallSample || !!p?.smallSample };
  });
  // Biggest changes relative to the previous value, left out when either month's sample is small.
  const scored = headline.filter((h) => h.trend && h.trend !== 'same' && !h.smallSample && h.previous)
    .map((h) => ({ ...h, size: Math.abs(h.change! / h.previous!) })).sort((a, b) => b.size - a.size);
  const improved = scored.filter((h) => h.trend === 'better').slice(0, 3).map((h) => `${h.title}: ${fmt(h.previous, h.unit)} to ${fmt(h.value, h.unit)}`);
  const worse = scored.filter((h) => h.trend === 'worse').slice(0, 3).map((h) => `${h.title}: ${fmt(h.previous, h.unit)} to ${fmt(h.value, h.unit)}`);

  // Six months of trend, ending with this month.
  const months: string[] = []; for (let m = month, k = 0; k < 6; k++, m = prevMonth(m)) months.unshift(m);
  const trendVals = months.map((m) => ({ month: m, ...monthValues(team, m, now) }));
  const trends = KEYS.map((k) => ({ id: k.id, title: k.title, unit: k.unit, target: k.target, points: trendVals.map((t) => ({ month: t.month, status: t.status, value: t.values.get(k.id)?.value ?? null })) }));
  // Items delivered per month by kind: the Flow Framework's monthly view.
  const KINDS = ['features', 'defects', 'risks', 'debt'];
  const distribution = trendVals.map((t) => ({ month: t.month, status: t.status, ...Object.fromEntries(KINDS.map((k) => [k, t.values.get(`dist_${k}`)?.value ?? null])) }));

  // The month's detail, from the collected data (empty for a month only held as saved numbers).
  const { from, to } = monthRange(month), end = Math.min(to, now), inMonth = (iso: string | null | undefined) => !!iso && Date.parse(iso) >= from && Date.parse(iso) < end;
  const boards = boardsOf(team);
  const sprints = store.sprints().filter((sp) => boards.includes(sp.board) && sp.state === 'closed' && inMonth(sp.end)).map((sp) => {
    const committed = sp.issues.filter((i) => i.type !== 'Sub-task' && i.points != null && (!i.addedToSprintAt || i.addedToSprintAt <= sp.start));
    const planned = committed.reduce((t, i) => t + i.points!, 0), done = committed.filter((i) => doneInSprint(i, sp)).reduce((t, i) => t + i.points!, 0);
    return { board: sp.board, sprint: sp.name, end: sp.end.slice(0, 10), committed: planned, done, pct: planned ? Math.round((100 * done) / planned) : null };
  });
  const features = boards.flatMap((b) => (store.epics()[b] ?? []).filter((e) => inMonth(e.resolved)).map((e) => ({ board: b, key: e.key, summary: e.summary, resolved: e.resolved!.slice(0, 10) })));
  const incidents = store.azure().filter((a) => boards.includes(a.board)).flatMap((a) => a.ops?.incidents ?? []).filter((i) => inMonth(i.firedAt));

  const good = headline.filter((h) => h.met === true).length, measured = headline.filter((h) => h.met != null).length;
  const statusNote: Record<MonthStatus, string> = {
    'complete': '', 'in progress': ` The month is not over: figures so far, to ${new Date(now).toISOString().slice(0, 10)}.`,
    'partial': ' The collected data starts part way through this month, so its numbers are not shown.', 'saved': ' Figures saved when the month closed; detail is no longer held.',
    'no data': ' No data for this month.',
  };
  const summary = cur.status === 'no data' || cur.status === 'partial' ? `${monthName(month)}.${statusNote[cur.status]}`
    : `${monthName(month)}: ${good} of ${measured} targets met.${improved.length ? ` Improved most: ${improved[0].split(':')[0].toLowerCase()}.` : ''}${worse.length ? ` Worse: ${worse[0].split(':')[0].toLowerCase()}.` : ''}${statusNote[cur.status]}`;

  return { team, month, name: monthName(month), status: cur.status, previousStatus: prev.status, summary, headline, improved, worse, trends, distribution,
    detail: { sprints, features, incidents: { count: incidents.length, medianRestoreHours: (() => { const xs = incidents.filter((i) => i.resolvedAt).map((i) => (Date.parse(i.resolvedAt!) - Date.parse(i.firedAt)) / 3_600_000); return xs.length ? Math.round(median(xs) * 10) / 10 : null; })() } } };
}

export function monthlyMarkdown(r: ReturnType<typeof monthlyReport>) {
  const arrow = (t: string | null) => (t === 'better' ? 'better' : t === 'worse' ? 'worse' : t === 'same' ? 'same' : '');
  return [
    `# ${r.team === 'all' ? 'All teams' : r.team}: ${r.name}`, '', r.summary, '',
    '## Key numbers', '', '| Measure | This month | Last month | Change | Target |', '|---|---|---|---|---|',
    ...r.headline.map((h) => `| ${h.title} | ${fmt(h.value, h.unit)}${h.smallSample ? ' (small sample)' : ''} | ${fmt(h.previous, h.unit)} | ${arrow(h.trend)} | ${h.target ? `${h.target.op === '<' ? 'under' : 'over'} ${fmt(h.target.value, h.unit)}` : ''}${h.met == null ? '' : h.met ? ' (met)' : ' (missed)'} |`),
    '', '## What changed', '', ...(r.improved.length ? r.improved.map((x) => `- Better: ${x}`) : ['- Nothing improved clearly.']), ...(r.worse.length ? r.worse.map((x) => `- Worse: ${x}`) : ['- Nothing got clearly worse.']),
    '', '## Delivered by kind', '', (() => { const d = r.distribution[r.distribution.length - 1] as Record<string, unknown>; return d.features == null ? 'No data.' : `Features ${d.features}, defects ${d.defects}, risks ${d.risks}, debt ${d.debt}.`; })(),
    '', '## Sprints closed', '', ...(r.detail.sprints.length ? ['| Team | Sprint | Committed | Done | Completion |', '|---|---|---|---|---|', ...r.detail.sprints.map((s) => `| ${s.board} | ${s.sprint} | ${s.committed} | ${s.done} | ${s.pct ?? 'n/a'}% |`)] : ['None.']),
    '', '## Features shipped', '', ...(r.detail.features.length ? r.detail.features.map((f) => `- ${f.key} ${f.summary} (${f.board}, ${f.resolved})`) : ['None.']),
    '', `## Incidents`, '', `${r.detail.incidents.count} incidents${r.detail.incidents.medianRestoreHours != null ? `, median ${r.detail.incidents.medianRestoreHours} hours to restore` : ''}.`,
  ].join('\n');
}

// Nightly: save the last completed month for every team and for all teams together, if the data fully covers it.
export function recordLastMonth(now = Date.now()) {
  const month = prevMonth(monthOf(now));
  for (const team of [...boardsOf('all'), 'all']) {
    const v = monthValues(team, month, now);
    if (v.status !== 'complete') continue;
    recordMonth(month, team, [...v.values.entries()].map(([metric, x]) => ({ metric, value: x.value, num: x.num, den: x.den })));
  }
}
