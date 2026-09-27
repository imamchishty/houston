import { config } from './config.js';
import { store } from './store/index.js';
import { workingDays } from './cost.js';
import { doneInSprint } from './cycle.js';
import type { Issue, Sprint } from './types.js';

// The sprint in progress for each team: time and points left, whether it will make it, and what is in flight.
// Jira's sprint report only lists the issues in the sprint now; an item removed mid-sprint is not seen, so scope
// can only grow in the burndown. Said on the page.
const DAY = 86_400_000;
const work = (s: Sprint) => s.issues.filter((i) => i.type !== 'Sub-task');
const pts = (xs: Issue[]) => xs.reduce((t, i) => t + (i.points ?? 0), 0);
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

// A sprint's board: the one in progress, or a past one by id (then "now" is its end).
export function currentSprint(board: string, named: boolean, now = Date.now(), sprintId?: number) {
  const sprints = store.sprints().filter((s) => s.board === board).sort((a, b) => a.start.localeCompare(b.start));
  const sp = sprintId != null ? sprints.find((s) => s.id === sprintId) : sprints.filter((s) => s.state === 'active').pop();
  if (!sp) return null;
  if (sp.state === 'closed') now = Math.min(now, Date.parse(sp.end));
  const start = Date.parse(sp.start), end = Date.parse(sp.end), today = Math.min(now, end);
  const items = work(sp);
  const committed = items.filter((i) => !i.addedToSprintAt || i.addedToSprintAt <= sp.start);
  const done = items.filter((i) => i.statusCategory === 'done' && i.resolved && Date.parse(i.resolved) <= now);
  const totalWd = workingDays(sp.start, sp.end, config.weekend), elapsedWd = workingDays(sp.start, new Date(today).toISOString(), config.weekend);
  const leftWd = Math.max(0, totalWd - elapsedWd);
  const scopePts = pts(items), donePts = pts(done), committedPts = pts(committed);
  // Linear projection: points done per working day so far, carried to the end of the sprint.
  const projected = elapsedWd ? (donePts / elapsedWd) * totalWd : 0;
  const outlook = !elapsedWd ? 'Just started' : projected >= scopePts ? 'On track' : projected >= 0.8 * scopePts ? 'At risk' : 'Off track';

  // Burndown: one point per working day from start to today. Scope counts items once they were in the sprint.
  const burndown: { day: string; remaining: number; scope: number; ideal: number }[] = [];
  let wdIndex = 0;
  for (let t = start; t <= end; t += DAY) {
    if (config.weekend.includes(new Date(t).getUTCDay())) continue;
    const eod = t + DAY;
    const scope = pts(items.filter((i) => !i.addedToSprintAt || Date.parse(i.addedToSprintAt) < eod));
    const doneBy = pts(done.filter((i) => Date.parse(i.resolved!) < eod));
    const ideal = Math.max(0, committedPts * (1 - wdIndex / Math.max(1, totalWd - 1)));
    burndown.push({ day: dayOf(t), remaining: t <= today ? scope - doneBy : NaN, scope: t <= today ? scope : NaN, ideal: Math.round(ideal * 10) / 10 });
    wdIndex++;
  }
  const byStatus = [...items.reduce((m, i) => m.set(i.status, (m.get(i.status) ?? 0) + 1), new Map<string, number>())]
    .map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
  const bugs = items.filter((i) => /^bug$/i.test(i.type));
  const inProgress = items.filter((i) => i.statusCategory === 'inprogress')
    .map((i) => ({ key: i.key, summary: i.summary, status: i.status, points: i.points, days: i.inProgressSince ? Math.round(((now - Date.parse(i.inProgressSince)) / DAY) * 10) / 10 : null, ...(named ? { assignee: i.assignee } : {}) }))
    .sort((a, b) => (b.days ?? 0) - (a.days ?? 0));
  const cycle = done.filter((i) => i.inProgressSince)
    .map((i) => ({ key: i.key, summary: i.summary, points: i.points, days: Math.round(((Date.parse(i.resolved!) - Date.parse(i.inProgressSince!)) / DAY) * 10) / 10 }))
    .sort((a, b) => b.days - a.days);
  // Per working day of the sprint so far: bugs created and resolved in the team's project (sprint or not),
  // and the average cycle time of sprint items resolved that day.
  const bugsAll = store.projects().filter((p) => p.board === board).flatMap((p) => p.items).filter((i) => /^bug$/i.test(i.type));
  const sprintDays = burndown.filter((b) => Date.parse(b.day) <= today).map((b) => b.day);
  const bugTrend = sprintDays.map((day) => ({ day, created: bugsAll.filter((i) => i.created.slice(0, 10) === day).length, resolved: bugsAll.filter((i) => i.resolved?.slice(0, 10) === day).length }));
  const cycleByDay = sprintDays.map((day) => {
    const xs = cycle.filter((c) => done.find((d) => d.key === c.key)!.resolved!.slice(0, 10) === day).map((c) => c.days);
    return { day, avg: xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null, n: xs.length };
  });
  // Status columns in workflow order (to do, in progress, done), each split into bugs and other work.
  const order = { todo: 0, inprogress: 1, done: 2 } as const;
  const statusType = [...new Map(items.map((i) => [i.status, i.statusCategory])).entries()].sort((a, b) => order[a[1]] - order[b[1]])
    .map(([status]) => ({ status, bugs: items.filter((i) => i.status === status && /^bug$/i.test(i.type)).length, other: items.filter((i) => i.status === status && !/^bug$/i.test(i.type)).length }));
  // WIP per person: tickets in progress at once. Over 2 means switching between tasks, and slower finishing.
  const WIP_LIMIT = 2;
  const wipBy = new Map<string, number>();
  for (const i of items.filter((x) => x.statusCategory === 'inprogress' && x.assignee)) wipBy.set(i.assignee!, (wipBy.get(i.assignee!) ?? 0) + 1);
  const over = [...wipBy.entries()].filter(([, n]) => n > WIP_LIMIT).sort((a, b) => b[1] - a[1]);
  const wip = { limit: WIP_LIMIT, people: wipBy.size, overLimit: over.length, max: Math.max(0, ...wipBy.values()),
    unassigned: items.filter((x) => x.statusCategory === 'inprogress' && !x.assignee).length,
    ...(named ? { over: over.map(([name, count]) => ({ name, count })) } : {}) };
  const velocity = sprints.filter((s) => s.state === 'closed' && s.start <= sp.start).slice(-6).map((s) => {
    const c = work(s).filter((i) => i.points != null && (!i.addedToSprintAt || i.addedToSprintAt <= s.start));
    return { sprint: s.name, committed: pts(c), completed: pts(c.filter((i) => doneInSprint(i, s))) };
  });

  return {
    board, sprint: sp.name, goal: sp.goal, start: sp.start.slice(0, 10), end: sp.end.slice(0, 10),
    workingDays: totalWd, workingDaysLeft: leftWd, workingDaysElapsed: elapsedWd,
    points: { committed: committedPts, scope: scopePts, done: donePts, remaining: scopePts - donePts, projected: Math.round(projected * 10) / 10 },
    unestimated: items.filter((i) => i.points == null).length,
    items: { total: items.length, done: done.length },
    outlook,
    burndown, byStatus, statusType, bugTrend, cycleByDay,
    bugs: { total: bugs.length, resolved: bugs.filter((b) => b.statusCategory === 'done').length },
    inProgress, cycle, velocity, wip, state: sp.state, id: sp.id,
    sprints: sprints.map((s) => ({ id: s.id, name: s.name, state: s.state })),
  };
}

export const currentSprints = (named: boolean, now = Date.now()) =>
  [...new Set(store.sprints().map((s) => s.board))].sort((a, b) => a.localeCompare(b)).flatMap((b) => { const c = currentSprint(b, named, now); return c ? [c] : []; });
