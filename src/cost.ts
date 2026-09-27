import type { Epic, Issue, Sprint } from './types.js';
import { median } from './cycle.js';

// Cost to build each feature, from who worked on it and what they cost. An estimate, not accounting:
// it assumes each person's sprint went on the tickets they touched that sprint, split by story points.
//
// 1. Day rate per person: RATE_OVERRIDES, else RATE_CONTRACTOR_DAY for CONTRACTORS, else RATE_FTE_DAY.
// 2. Person sprint cost = day rate x working days in the sprint (WEEKEND days excluded).
// 3. That cost is split across the tickets they touched in the sprint (in progress or done), weighted by points.
//    Unestimated tickets count as the team's median ticket size.
// 4. Feature cost = the cost of its tickets, across every sprint they were in. Tickets with no epic are "no feature".
//    Roster members who touched no ticket in a sprint are "not on tickets": real cost, but no feature to put it on.
// 5. To complete = remaining points x the team's cost per point over the sprints seen. Done features: zero.

export interface Rates { fteDay: number; contractorDay: number; contractors: string[]; overrides: Record<string, number>; currency: string }
export type Kind = 'fte' | 'contractor';

export interface FeatureCost {
  key: string; summary: string; status: Epic['statusCategory'];
  spent: number; fte: number; contractor: number;
  pointsDone: number; pointsRemaining: number; remainingEstimated: boolean; // true if some remaining size was guessed
  toComplete: number; total: number;
}
export interface CostReport {
  currency: string;
  sprints: number;
  teamCost: number;             // everyone, every sprint seen
  onFeatures: number;
  noFeature: number;            // tickets without an epic: bugs, support, unplanned work
  notOnTickets: number;         // people with no ticket in a sprint
  costPerPoint: number | null;  // team cost / points done
  fteShare: number;             // % of team cost that is FTE
  features: FeatureCost[];
}

export function rateFor(name: string, r: Rates): { day: number; kind: Kind } {
  const kind: Kind = r.contractors.includes(name) ? 'contractor' : 'fte';
  return { day: r.overrides[name] ?? (kind === 'contractor' ? r.contractorDay : r.fteDay), kind };
}

export function workingDays(startIso: string, endIso: string, weekend: number[]): number {
  let n = 0;
  const end = new Date(endIso).getTime();
  for (let t = new Date(startIso).getTime(); t < end; t += 86_400_000) if (!weekend.includes(new Date(t).getUTCDay())) n++;
  return n;
}

const touched = (i: Issue) => i.statusCategory !== 'todo' && i.type !== 'Sub-task';
const round = (x: number) => Math.round(x);

export function featureCosts(input: { sprints: Sprint[]; epics: Epic[]; rates: Rates; roster: string[]; weekend: number[] }): CostReport {
  const { sprints, epics, rates, roster, weekend } = input;
  const sized = sprints.flatMap((s) => s.issues).map((i) => i.points).filter((p): p is number => p != null && p > 0);
  const typical = Math.max(1, median(sized) ?? 1);
  const weight = (i: Issue) => (i.points != null && i.points > 0 ? i.points : typical);

  const byEpic = new Map<string, { fte: number; contractor: number }>();
  let teamCost = 0, noFeature = 0, notOnTickets = 0;
  const add = (epic: string, kind: Kind, amount: number) => {
    const e = byEpic.get(epic) ?? { fte: 0, contractor: 0 };
    e[kind] += amount; byEpic.set(epic, e);
  };
  let fteCost = 0;

  for (const s of sprints) {
    const days = workingDays(s.start, s.end, weekend);
    const people = new Set<string>([...roster, ...s.issues.map((i) => i.assignee).filter((a): a is string => !!a)]);
    for (const person of people) {
      const { day, kind } = rateFor(person, rates);
      const cost = day * days;
      teamCost += cost;
      if (kind === 'fte') fteCost += cost;
      const mine = s.issues.filter((i) => i.assignee === person && touched(i));
      if (!mine.length) { notOnTickets += cost; continue; }
      const total = mine.reduce((t, i) => t + weight(i), 0);
      for (const i of mine) {
        const share = (cost * weight(i)) / total;
        if (i.epic) add(i.epic, kind, share); else noFeature += share;
      }
    }
  }

  // Points done across the sprints seen, each ticket counted once, for cost per point.
  const latest = new Map<string, Issue>();
  for (const s of [...sprints].sort((a, b) => a.start.localeCompare(b.start))) for (const i of s.issues) latest.set(i.key, i);
  const pointsDone = [...latest.values()].filter((i) => i.statusCategory === 'done').reduce((t, i) => t + (i.points ?? 0), 0);
  const costPerPoint = pointsDone ? teamCost / pointsDone : null;

  const features = epics.map((e): FeatureCost => {
    const spent = byEpic.get(e.key) ?? { fte: 0, contractor: 0 };
    const kids = [...latest.values()].filter((i) => i.epic === e.key);
    const done = kids.filter((i) => i.statusCategory === 'done');
    const open = kids.filter((i) => i.statusCategory !== 'done');
    // Jira's child counts include backlog items never pulled into a sprint: size those at the team's median.
    const unseen = e.statusCategory === 'done' ? 0 : Math.max(0, (e.childCount - e.childDone) - open.length);
    const remaining = e.statusCategory === 'done' ? 0 : open.reduce((t, i) => t + weight(i), 0) + unseen * typical;
    const toComplete = costPerPoint == null ? 0 : remaining * costPerPoint;
    const s = spent.fte + spent.contractor;
    return {
      key: e.key, summary: e.summary, status: e.statusCategory,
      spent: round(s), fte: round(spent.fte), contractor: round(spent.contractor),
      pointsDone: done.reduce((t, i) => t + (i.points ?? 0), 0), pointsRemaining: Math.round(remaining * 10) / 10,
      remainingEstimated: e.statusCategory !== 'done' && (unseen > 0 || open.some((i) => i.points == null)),
      toComplete: round(toComplete), total: round(s + toComplete),
    };
  });

  const onFeatures = [...byEpic.values()].reduce((t, e) => t + e.fte + e.contractor, 0);
  return {
    currency: rates.currency, sprints: sprints.length, teamCost: round(teamCost), onFeatures: round(onFeatures),
    noFeature: round(noFeature), notOnTickets: round(notOnTickets),
    costPerPoint: costPerPoint == null ? null : round(costPerPoint),
    fteShare: teamCost ? Math.round((fteCost / teamCost) * 1000) / 10 : 0,
    features: features.sort((a, b) => b.total - a.total),
  };
}
