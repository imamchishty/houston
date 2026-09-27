import { config } from './config.js';
import type { GithubSnapshot, Sprint } from './types.js';

// Active days per person: days with any trace in Jira (ticket created, moved, resolved) or GitHub (PR opened, merged, reviewed).
// This is NOT attendance. It shows on which days work left a trace. Weekends excluded from the denominator.
export interface ActivityStats { name: string; activeDaysPerWeek: number; weekdaysCovered: number; weekdaysInWindow: number; lastActive: string | null; pattern: string; }

export function activity(sprints: Sprint[], gh: GithubSnapshot | undefined, days = 42): ActivityStats[] {
  const since = Date.now() - days * 86_400_000;
  const byPerson = new Map<string, Set<string>>();
  const mark = (who: string | null | undefined, when: string | null | undefined) => {
    if (!who || !when || new Date(when).getTime() < since) return;
    const d = new Date(when); if (config.weekend.includes(d.getUTCDay())) return; // WEEKEND in .env, Sat/Sun by default
    (byPerson.get(who) ?? byPerson.set(who, new Set()).get(who)!).add(when.slice(0, 10));
  };
  for (const s of sprints) for (const i of s.issues) { mark(i.assignee, i.inProgressSince); mark(i.assignee, i.resolved); mark(i.assignee, i.addedToSprintAt); }
  for (const p of gh?.prs ?? []) { mark(p.author, p.createdAt); mark(p.author, p.mergedAt); for (const r of p.reviewers) mark(r, p.firstReviewAt); }
  let weekdays = 0; for (let t = since; t < Date.now(); t += 86_400_000) { if (!config.weekend.includes(new Date(t).getUTCDay())) weekdays++; }
  return [...byPerson.entries()].map(([name, set]) => {
    const covered = set.size, perWeek = Math.round((covered / weekdays) * 5 * 10) / 10;
    const last = [...set].sort().pop() ?? null;
    const dow = [0, 0, 0, 0, 0, 0, 0]; for (const d of set) dow[new Date(d).getUTCDay()]++;
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const quiet = [0, 1, 2, 3, 4].filter((i) => dow[i] < Math.max(1, covered / 10)).map((i) => names[i]);
    return { name, activeDaysPerWeek: perWeek, weekdaysCovered: covered, weekdaysInWindow: weekdays, lastActive: last,
      pattern: quiet.length ? `Little or no trace on ${quiet.join(', ')}` : 'Activity spread across the week' };
  }).sort((a, b) => a.activeDaysPerWeek - b.activeDaysPerWeek);
}
