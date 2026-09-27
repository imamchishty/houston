import { cycleDays, doneInSprint, learnBaseline, median, overBand } from './cycle.js';
import type { Sprint } from './types.js';

export interface PersonStats {
  name: string;
  ticketsDone: number;
  pointsDone: number;
  medianCycleDays: number;      // In Progress to Done, their tickets
  teamMedianCycleDays: number;  // same measure, whole team
  overBand: number;             // tickets that took over double the team norm for their size
  stuckNow: number;             // in progress over 5 days in the latest sprint
  carriedOver: number;          // tickets they owned that rolled in from an earlier sprint
  sprints: number;
}

// Per person view across a board's sprints. Read privately; see README on how to use it.
export function peopleStats(sprints: Sprint[]): PersonStats[] {
  const baseline = learnBaseline(sprints);
  const latest = [...sprints].sort((a, b) => b.id - a.id)[0];
  const teamCycle = median(sprints.flatMap((s) => s.issues.map(cycleDays).filter((d): d is number => d != null)));
  const by = new Map<string, PersonStats>();
  const cycles = new Map<string, number[]>();
  const get = (n: string) => {
    if (!by.has(n)) by.set(n, {
      name: n, ticketsDone: 0, pointsDone: 0, medianCycleDays: 0,
      teamMedianCycleDays: Math.round(teamCycle * 10) / 10,
      overBand: 0, stuckNow: 0, carriedOver: 0, sprints: sprints.length,
    });
    return by.get(n)!;
  };

  for (const s of sprints) for (const i of s.issues) {
    if (!i.assignee || i.type === 'Sub-task') continue;
    const p = get(i.assignee);
    if (doneInSprint(i, s)) { // once, in the sprint it was finished in
      p.ticketsDone++;
      p.pointsDone += i.points ?? 0;
      const d = cycleDays(i);
      if (d != null) (cycles.get(p.name) ?? cycles.set(p.name, []).get(p.name)!).push(d);
      if (overBand(i, baseline)) p.overBand++;
    }
    if (i.sprintIds.some((id) => id < s.id)) p.carriedOver++;
    if (s.id === latest.id && i.statusCategory === 'inprogress' && i.inProgressSince) {
      const ref = s.state === 'closed' ? s.end : new Date().toISOString();
      if ((new Date(ref).getTime() - new Date(i.inProgressSince).getTime()) / 86_400_000 > 5) p.stuckNow++;
    }
  }
  for (const p of by.values()) p.medianCycleDays = Math.round(median(cycles.get(p.name) ?? []) * 10) / 10;
  return [...by.values()].sort((a, b) => b.overBand - a.overBand || b.medianCycleDays - a.medianCycleDays);
}
