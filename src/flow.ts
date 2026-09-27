import { config } from './config.js';
import { median } from './cycle.js';
import { hoursExcludingWeekends, weekOf } from './time.js';
import { leadTimes } from './leadtime.js';
import type { Issue } from './types.js';
import type { Slice } from './reports.js';

// Where work waits. Built from each ticket's full status history (Jira changelog), in working hours: a ticket
// parked over a weekend is not "waiting" for two days, because nobody is working.
//
// A ticket's flow runs from its first move into an in-progress status to its resolution. Each stretch between two
// status changes is time in the status it entered. Waiting: JIRA_WAIT_STATUSES (Blocked, Ready for ...), or any
// to-do status after work started (sent back to the backlog). Active: every other in-progress status.

const wait = (status: string, category: string) => config.jira.waitStatuses.includes(status.toLowerCase()) || category === 'new';
const isQa = (status: string) => config.jira.qaStatuses.includes(status.toLowerCase());
const hrs = (a: string, b: string) => hoursExcludingWeekends(a, b, config.weekend, config.tzOffset);

export interface Segment { status: string; waiting: boolean; hours: number }

// The stretches of one ticket's flow, first start to resolution.
export function segments(i: Issue): Segment[] {
  const h = i.statusHistory ?? [];
  if (!i.inProgressSince || !i.resolved || !h.length) return [];
  const start = Date.parse(i.inProgressSince), end = Date.parse(i.resolved);
  const out: Segment[] = [];
  for (let k = 0; k < h.length; k++) {
    const from = Math.max(Date.parse(h[k].at), start), to = Math.min(k + 1 < h.length ? Date.parse(h[k + 1].at) : end, end);
    if (to <= from || h[k].category === 'done') continue;
    out.push({ status: h[k].to, waiting: wait(h[k].to, h[k].category), hours: hrs(new Date(from).toISOString(), new Date(to).toISOString()) });
  }
  return out;
}

// Sprint tickets resolved in the period, once each (a ticket carried across sprints appears in each).
function flowTickets(s: Slice) {
  const byKey = new Map<string, Issue>();
  for (const sp of s.sprints) for (const i of sp.issues) {
    if (i.type === 'Sub-task' || i.statusCategory !== 'done' || !i.resolved) continue;
    const t = Date.parse(i.resolved); if (t < s.from || t >= s.to) continue;
    byKey.set(i.key, i);
  }
  return [...byKey.values()].filter((i) => i.statusHistory?.length && i.inProgressSince);
}

export function flow(s: Slice) {
  const tickets = flowTickets(s);
  const segs = tickets.flatMap((i) => segments(i).map((x) => ({ ...x, key: i.key })));
  const active = segs.filter((x) => !x.waiting).reduce((t, x) => t + x.hours, 0), waiting = segs.filter((x) => x.waiting).reduce((t, x) => t + x.hours, 0);
  // From request: all working hours from the ticket being created to done (backlog waiting included).
  const requestHours = tickets.reduce((t, i) => t + hrs(i.created, i.resolved!), 0);

  // Bottleneck heatmap: hours in each status, summed over tickets, with the median per ticket that visited it.
  const statuses = new Map<string, { waiting: boolean; hours: number; perTicket: Map<string, number> }>();
  for (const x of segs) {
    const e = statuses.get(x.status) ?? { waiting: x.waiting, hours: 0, perTicket: new Map() };
    e.hours += x.hours; e.perTicket.set(x.key, (e.perTicket.get(x.key) ?? 0) + x.hours); statuses.set(x.status, e);
  }
  const total = active + waiting;
  const heatmap = [...statuses.entries()].map(([status, e]) => ({
    status, waiting: e.waiting, hours: Math.round(e.hours), share: total ? Math.round((1000 * e.hours) / total) / 10 : 0,
    tickets: e.perTicket.size, medianHours: Math.round(median([...e.perTicket.values()]) * 10) / 10,
  })).sort((a, b) => b.hours - a.hours);

  // QA rejection: tickets that entered QA in the period, and those sent back from QA to earlier work
  // (a to-do status, or an in-progress status that is neither QA nor a queue). QA to a queue such as
  // "Awaiting Deploy" is forward, not a rejection.
  const inWin = (at: string) => { const t = Date.parse(at); return t >= s.from && t < s.to; };
  const all = new Map<string, Issue>(); for (const sp of s.sprints) for (const i of sp.issues) if (i.type !== 'Sub-task') all.set(i.key, i);
  let entered = 0; const rejected: string[] = [];
  for (const i of all.values()) {
    const h = i.statusHistory ?? [];
    if (!h.some((x) => isQa(x.to) && inWin(x.at))) continue;
    entered++;
    if (h.some((x, k) => k > 0 && isQa(h[k - 1].to) && inWin(x.at) && !isQa(x.to) && x.category !== 'done' && (x.category === 'new' || !config.jira.waitStatuses.includes(x.to.toLowerCase())))) rejected.push(i.key);
  }

  // Lead time in stages, per merged PR that reached production: coding (first commit to PR opened), review (opened to
  // merged), waiting to deploy (merged to the first successful deploy of its repo). Calendar hours, as DORA lead time.
  const merged = s.prs.filter((p) => p.mergedAt && !p.draft && inWin(p.mergedAt));
  const stages = merged.flatMap((p) => {
    const l = leadTimes([p], s.deploys)[0]; if (!l) return [];
    const opened = Date.parse(p.createdAt), mergedT = Date.parse(p.mergedAt!), deployed = Date.parse(l.deployedAt);
    const first = p.firstCommitAt ? Math.min(Date.parse(p.firstCommitAt), opened) : opened;
    return [{ week: weekOf(p.mergedAt!, config.tzOffset), coding: (opened - first) / 3_600_000, review: (mergedT - opened) / 3_600_000, deploy: (deployed - mergedT) / 3_600_000, hasCommit: !!p.firstCommitAt }];
  });
  const weeks = new Map<string, { coding: number; review: number; deploy: number; prs: number }>();
  for (let t = s.from; t < s.to; t += 7 * 86_400_000) weeks.set(weekOf(new Date(t).toISOString(), config.tzOffset), { coding: 0, review: 0, deploy: 0, prs: 0 });
  for (const x of stages) { const w = weeks.get(x.week); if (w) { w.coding += x.coding; w.review += x.review; w.deploy += x.deploy; w.prs++; } }

  return {
    tickets: tickets.length, activeHours: active, waitingHours: waiting, requestHours, heatmap,
    qa: { entered, rejected },
    stages: {
      prs: stages.length, withFirstCommit: stages.filter((x) => x.hasCommit).length,
      median: { coding: stages.length ? median(stages.map((x) => x.coding)) : null, review: stages.length ? median(stages.map((x) => x.review)) : null, deploy: stages.length ? median(stages.map((x) => x.deploy)) : null },
      total: { coding: stages.reduce((t, x) => t + x.coding, 0), review: stages.reduce((t, x) => t + x.review, 0), deploy: stages.reduce((t, x) => t + x.deploy, 0) },
      weekly: [...weeks.entries()].map(([week, v]) => ({ week, ...v })),
    },
  };
}
