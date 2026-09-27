import type { Issue, Sprint } from './types.js';

export const cycleDays = (i: Issue) =>
  i.inProgressSince && i.resolved
    ? (new Date(i.resolved).getTime() - new Date(i.inProgressSince).getTime()) / 86_400_000
    : null;

export const sizeBucket = (points: number | null) => (points == null ? 'unsized' : String(points));

export function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Median cycle time per size bucket, learned from every done ticket on the board.
export function learnBaseline(sprints: Sprint[]): Record<string, number> {
  const buckets: Record<string, number[]> = {};
  for (const s of sprints) for (const i of s.issues) {
    const d = cycleDays(i);
    if (d == null || i.statusCategory !== 'done' || i.type === 'Sub-task') continue;
    (buckets[sizeBucket(i.points)] ??= []).push(d);
  }
  return Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, Math.round(median(v) * 10) / 10]));
}

// A ticket is "over band" when it took more than twice the team median for its size (and at least 2 days over).
export function overBand(i: Issue, baseline: Record<string, number>) {
  const d = cycleDays(i);
  const base = baseline[sizeBucket(i.points)];
  if (d == null || base == null) return false;
  return d > Math.max(base * 2, base + 2);
}
