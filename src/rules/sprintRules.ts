import type { Issue, Sprint } from '../types.js';
import type { RuleDef } from './engine.js';
import { cycleDays, overBand, sizeBucket } from '../cycle.js';

const pct = (n: number, d: number) => (d === 0 ? 0 : (n / d) * 100);
const keys = (issues: Issue[]) => issues.map((i) => i.key);
const work = (s: Sprint) => s.issues.filter((i) => i.type !== 'Sub-task');
const committed = (s: Sprint) =>
  work(s).filter((i) => !i.addedToSprintAt || i.addedToSprintAt <= s.start);
const daysBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;

export const rules: RuleDef[] = [
  {
    id: 'commit_completion',
    title: 'Sprint commitment delivered',
    area: 'delivery', unit: '%', amber: 80, red: 60, direction: 'low_bad', weight: 25,
    evaluate(s) {
      const c = committed(s).filter((i) => i.points != null);
      if (!c.length) return null;
      const planned = c.reduce((t, i) => t + (i.points ?? 0), 0);
      const done = c.filter((i) => i.statusCategory === 'done').reduce((t, i) => t + (i.points ?? 0), 0);
      const value = pct(done, planned);
      return {
        value,
        message: `${Math.round(value)}% of committed points were delivered (${done} of ${planned}).`,
        action: value < 80
          ? 'Commit to less. Cap the next sprint at the average points actually finished over the last three sprints.'
          : 'Keep commitment at this level.',
        evidence: keys(c.filter((i) => i.statusCategory !== 'done')),
      };
    },
  },
  {
    id: 'carry_over',
    title: 'Work carried over from a previous sprint',
    area: 'delivery', unit: '%', amber: 20, red: 40, direction: 'high_bad', weight: 15,
    evaluate(s) {
      const w = work(s);
      if (!w.length) return null;
      const carried = w.filter((i) => i.sprintIds.some((id) => id < s.id));
      const value = pct(carried.length, w.length);
      return {
        value,
        message: `${carried.length} of ${w.length} items (${Math.round(value)}%) were already in an earlier sprint.`,
        action: 'Any item entering its third sprint gets split or dropped in planning, no exceptions.',
        evidence: keys(carried),
      };
    },
  },
  {
    id: 'scope_added_mid_sprint',
    title: 'Scope added after sprint start',
    area: 'delivery', unit: '%', amber: 15, red: 30, direction: 'high_bad', weight: 10,
    evaluate(s) {
      const w = work(s);
      if (!w.length) return null;
      const added = w.filter((i) => i.addedToSprintAt && i.addedToSprintAt > s.start);
      const value = pct(added.length, w.length);
      return {
        value,
        message: `${added.length} items (${Math.round(value)}%) were pulled in after the sprint started.`,
        action: 'Route unplanned work through the PO. Label interrupts so they show up in the retro.',
        evidence: keys(added),
      };
    },
  },
  {
    id: 'no_estimate',
    title: 'Items without an estimate',
    area: 'hygiene', unit: '%', amber: 10, red: 25, direction: 'high_bad', weight: 10,
    evaluate(s) {
      const w = work(s);
      if (!w.length) return null;
      const missing = w.filter((i) => i.points == null);
      const value = pct(missing.length, w.length);
      return {
        value,
        message: `${missing.length} of ${w.length} items (${Math.round(value)}%) have no story points.`,
        action: 'Nothing enters a sprint unestimated. Add a board filter that blocks unpointed items from planning.',
        evidence: keys(missing),
      };
    },
  },
  {
    id: 'no_acceptance_criteria',
    title: 'Stories without acceptance criteria',
    area: 'hygiene', unit: '%', amber: 15, red: 35, direction: 'high_bad', weight: 15,
    evaluate(s) {
      const stories = work(s).filter((i) => i.type === 'Story');
      if (!stories.length) return null;
      const missing = stories.filter((i) => !i.hasAcceptanceCriteria);
      const value = pct(missing.length, stories.length);
      return {
        value,
        message: `${missing.length} of ${stories.length} stories (${Math.round(value)}%) have no acceptance criteria.`,
        action: 'Use a story template with a mandatory acceptance criteria section. Refinement rejects stories without it.',
        evidence: keys(missing),
      };
    },
  },
  {
    id: 'unassigned',
    title: 'In-progress items with no owner',
    area: 'ownership', unit: 'count', amber: 1, red: 3, direction: 'high_bad', weight: 5,
    evaluate(s) {
      const orphans = work(s).filter((i) => i.statusCategory === 'inprogress' && !i.assignee);
      return {
        value: orphans.length,
        message: orphans.length
          ? `${orphans.length} items are in progress with nobody assigned.`
          : 'Every in-progress item has an owner.',
        action: 'Assign on the day it moves to In Progress. Standup checks the unassigned column first.',
        evidence: keys(orphans),
      };
    },
  },
  {
    id: 'stale_in_progress',
    title: 'Items stuck in progress',
    area: 'flow', unit: 'count', amber: 2, red: 4, direction: 'high_bad', weight: 10,
    evaluate(s) {
      const ref = s.state === 'closed' ? s.end : new Date().toISOString();
      const stale = work(s).filter(
        (i) => i.statusCategory === 'inprogress' && i.inProgressSince && daysBetween(i.inProgressSince, ref) > 5,
      );
      return {
        value: stale.length,
        message: stale.length
          ? `${stale.length} items have been in progress for more than 5 days.`
          : 'Nothing has been in progress longer than 5 days.',
        action: 'Anything over 5 days is raised at standup: split it, pair on it, or park it.',
        evidence: keys(stale),
      };
    },
  },
  {
    id: 'bug_share',
    title: 'Share of sprint spent on bugs',
    area: 'delivery', unit: '%', amber: 25, red: 40, direction: 'high_bad', weight: 5,
    evaluate(s) {
      const w = work(s);
      if (!w.length) return null;
      const bugs = w.filter((i) => i.type === 'Bug');
      const value = pct(bugs.length, w.length);
      return {
        value,
        message: `${bugs.length} of ${w.length} items (${Math.round(value)}%) were bugs.`,
        action: 'Above 25% means quality is eating feature capacity. Trace where bugs originate before adding features.',
        evidence: keys(bugs),
      };
    },
  },
  {
    id: 'cycle_time_vs_size',
    title: 'Tickets that took longer than their size warrants',
    area: 'flow', unit: '%', amber: 15, red: 30, direction: 'high_bad', weight: 15,
    evaluate(s) {
      if (!s.baseline) return null;
      const done = work(s).filter((i) => i.statusCategory === 'done' && cycleDays(i) != null);
      if (done.length < 3) return null;
      const slow = done.filter((i) => overBand(i, s.baseline!));
      const value = pct(slow.length, done.length);
      const worst = [...slow].sort((a, b) => (cycleDays(b) ?? 0) - (cycleDays(a) ?? 0))[0];
      const detail = worst
        ? ` Worst: ${worst.key} (${worst.points ?? 'unsized'} pts, ${worst.assignee ?? 'unassigned'}) took ${Math.round(cycleDays(worst)!)} days against a team norm of ${s.baseline![sizeBucket(worst.points)]} for that size.`
        : '';
      return {
        value,
        message: `${slow.length} of ${done.length} finished tickets (${Math.round(value)}%) took more than double the team's normal time for their size.${detail}`,
        action: 'Ask on each one: under-estimated, blocked, or interrupted? Recurring names or ticket types point at the real cause.',
        evidence: slow.map((i) => i.key),
      };
    },
  },
  {
    id: 'sprint_goal',
    title: 'Sprint has a goal',
    area: 'hygiene', unit: 'count', amber: 0.5, red: 0, direction: 'low_bad', weight: 5,
    evaluate(s) {
      const has = s.goal && s.goal.trim().length > 10 ? 1 : 0;
      return {
        value: has,
        message: has ? `Sprint goal: "${s.goal}"` : 'No sprint goal was set.',
        action: 'One sentence describing what will be true at the end of the sprint. Planning does not start without it.',
        evidence: [],
      };
    },
  },
];
