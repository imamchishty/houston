import { store } from '../store/index.js';
import { config } from '../config.js';
import { learnBaseline, sizeBucket } from '../cycle.js';
import { hoursExcludingWeekends, workingDays } from '../time.js';
import type { Issue } from '../types.js';

// Allocation, for the admin only: who is working on what right now, what has stopped moving, and what finished
// against the team's own normal for its size. Built from traces (ticket moves, PRs), never effort: a quiet row can
// mean leave, incidents, reviews or design. No lines of code, no totals, no ranking, no AI estimates. Every row is a
// ticket to ask about. Lanes (frontend, backend, infra) come from the person's merged PRs in 90 days.

const DAY = 86_400_000;
const LANES = ['frontend', 'backend', 'infra'];
const wd = (fromIso: string, to: number) => Math.round((hoursExcludingWeekends(fromIso, new Date(to).toISOString(), config.weekend, config.tzOffset) / 24) * 10) / 10;

export function allocation(board: string, now = Date.now()) {
  const sprints = store.sprints().filter((s) => s.board === board).sort((a, b) => a.start.localeCompare(b.start));
  if (!sprints.length) return null;
  const baseline = learnBaseline(sprints);
  // Every sprint work item once; a ticket carried across sprints keeps its latest state.
  const issues = new Map<string, Issue>();
  for (const s of sprints) for (const i of s.issues) if (i.type !== 'Sub-task') issues.set(i.key, i);
  const prs = store.github().filter((g) => g.board === board).flatMap((g) => g.prs).filter((p) => now - Date.parse(p.createdAt) <= 90 * DAY && Date.parse(p.createdAt) <= now);
  const people = new Set<string>();
  for (const i of issues.values()) if (i.assignee) people.add(i.assignee);
  for (const p of prs) if (p.author && p.author !== 'unknown') people.add(p.author);
  const lastMove = (i: Issue) => i.statusHistory?.length ? i.statusHistory[i.statusHistory.length - 1].at : i.inProgressSince ?? i.created;

  const rows = [...people].sort((a, b) => a.localeCompare(b)).map((name) => {
    const mine = [...issues.values()].filter((i) => i.assignee === name);
    const inProgress = mine.filter((i) => i.statusCategory === 'inprogress').map((i) => {
      const sinceMove = wd(lastMove(i), now);
      return { key: i.key, summary: i.summary, status: i.status, points: i.points, daysInProgress: i.inProgressSince ? wd(i.inProgressSince, now) : null, daysSinceMove: sinceMove,
        stuck: sinceMove >= 5, waiting: config.jira.waitStatuses.includes(i.status.toLowerCase()) || !!i.flaggedSince };
    }).sort((a, b) => b.daysSinceMove - a.daysSinceMove);
    const finished = mine.filter((i) => i.statusCategory === 'done' && i.resolved && now - Date.parse(i.resolved) <= 30 * DAY && Date.parse(i.resolved) <= now).map((i) => {
      const days = i.inProgressSince ? Math.round(((Date.parse(i.resolved!) - Date.parse(i.inProgressSince)) / DAY) * 10) / 10 : null;
      const normal = baseline[sizeBucket(i.points)] ?? null;
      return { key: i.key, summary: i.summary, points: i.points, resolved: i.resolved!.slice(0, 10), days, normal, over: days != null && normal != null && days > 3 * normal };
    }).sort((a, b) => b.resolved.localeCompare(a.resolved));
    const finished14 = finished.filter((f) => now - Date.parse(f.resolved) <= 14 * DAY).length;
    const myPrs = prs.filter((p) => p.author === name);
    const lanes = [...new Set(myPrs.filter((p) => p.mergedAt).flatMap((p) => p.areas.filter((a) => LANES.includes(a))))].sort();
    // The latest trace of any kind: a ticket move, a start or finish, a PR opened or merged, or a review given (a
    // tech lead who only reviews is working; the review's time is taken as the PR's first review or merge).
    const reviewed = prs.filter((p) => p.reviewers.includes(name)).map((p) => p.firstReviewAt ?? p.mergedAt ?? p.createdAt);
    const traces = [...mine.flatMap((i) => [i.inProgressSince, i.resolved, ...(i.statusHistory ?? []).map((h) => h.at)]), ...myPrs.flatMap((p) => [p.createdAt, p.mergedAt]), ...reviewed]
      .filter((x): x is string => !!x).map(Date.parse).filter((t) => t <= now);
    const lastTrace = traces.length ? Math.max(...traces) : null;
    const daysSinceTrace = lastTrace ? wd(new Date(lastTrace).toISOString(), now) : null;
    const stuck = inProgress.filter((x) => x.stuck);
    const signals: string[] = [];
    if (stuck.length) signals.push(`${stuck.length} in progress ${stuck.length === 1 ? 'item has' : 'items have'} not moved for 5 or more working days`);
    if (inProgress.length > 3 && finished14 === 0) signals.push(`${inProgress.length} items in progress and nothing finished in 14 days`);
    if (daysSinceTrace == null) signals.push('nothing recorded in Jira or GitHub');
    else if (daysSinceTrace >= 10) signals.push(`nothing recorded in Jira or GitHub for ${daysSinceTrace} working days`);
    return { name, lanes, lastTrace: lastTrace ? new Date(lastTrace).toISOString().slice(0, 10) : null, daysSinceTrace, inProgress, finished, finished14, signals };
  });
  // Rough capacity of the sprint in progress: people with tickets in it × its working days, and a cost at RATE_DAY.
  const active = sprints.filter((s) => s.state === 'active').pop();
  const capacity = active ? (() => {
    const inSprint = new Set(active.issues.filter((i) => i.type !== 'Sub-task' && i.assignee).map((i) => i.assignee!));
    const days = workingDays(active.start, active.end, config.weekend), personDays = inSprint.size * days;
    return { sprint: active.name, people: inSprint.size, workingDays: days, personDays, rateDay: config.rateDay, currency: config.currency, cost: config.rateDay ? personDays * config.rateDay : null };
  })() : null;
  return { board, generatedAt: new Date(now).toISOString(), capacity, people: rows,
    worthAConversation: rows.filter((r) => r.signals.length).map((r) => ({ name: r.name, signals: r.signals })) };
}
