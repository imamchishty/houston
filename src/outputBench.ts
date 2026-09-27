import { config } from './config.js';
import type { GithubSnapshot, Sprint, Epic } from './types.js';

// Output per engineer, comparable across teams, with the cost question next to it.
export interface OutputBench {
  board: string;
  engineers: number;             // people with any activity in the window
  pointsPerEngineerPerSprint: number;
  mergedPrsPerEngineerPerWeek: number;
  featuresShipped90d: number;
  teamMonthAed: number | null;
  offshoreMonthAed: number | null;
  costRatio: number | null;      // team ÷ offshore
  outputRatioVsBest: number | null; // this team's points per engineer ÷ best team's
  verdict: string;
}

export function outputBench(board: string, sprints: Sprint[], gh: GithubSnapshot | undefined, epics: Epic[], allBoards: { board: string; ppe: number }[]): OutputBench {
  const closed = sprints.filter((s) => s.state === 'closed').slice(-6);
  const people = new Set<string>();
  for (const s of closed) for (const i of s.issues) if (i.assignee) people.add(i.assignee);
  for (const p of gh?.prs ?? []) people.add(p.author);
  const n = Math.max(1, people.size);
  const pts = closed.reduce((t, s) => t + s.issues.filter((i) => i.statusCategory === 'done' && i.type !== 'Sub-task').reduce((a, i) => a + (i.points ?? 0), 0), 0);
  const ppe = closed.length ? Math.round((pts / closed.length / n) * 10) / 10 : 0;
  const weeks = gh ? (new Date(gh.until).getTime() - new Date(gh.since).getTime()) / (7 * 86_400_000) : 0;
  const prs = gh ? Math.round(((gh.prs.filter((p) => p.mergedAt).length / Math.max(1, weeks)) / n) * 10) / 10 : 0;
  const since = Date.now() - 90 * 86_400_000;
  const shipped = epics.filter((e) => e.resolved && new Date(e.resolved).getTime() >= since).length;
  const team = config.azure.teamCost.find((t) => t.name === board)?.aed ?? null;
  const off = config.offshoreCost.find((t) => t.name === board)?.aed ?? null;
  const best = Math.max(...allBoards.map((b) => b.ppe), 0);
  const outputRatio = best ? Math.round((ppe / best) * 100) / 100 : null;
  const costRatio = team && off ? Math.round((team / off) * 10) / 10 : null;
  let verdict = `${ppe} points and ${prs} merged PRs per engineer per sprint/week, ${shipped} features shipped in 90 days across ${n} people.`;
  if (costRatio && outputRatio != null) verdict += ` Costs ${costRatio}x an offshore equivalent and produces ${Math.round(outputRatio * 100)}% of your best team's output per head.` +
    (costRatio > 1.5 && outputRatio < 0.7 ? ' Paying a premium for below par output is the P&L problem in one line.' : '');
  return { board, engineers: n, pointsPerEngineerPerSprint: ppe, mergedPrsPerEngineerPerWeek: prs, featuresShipped90d: shipped, teamMonthAed: team, offshoreMonthAed: off, costRatio, outputRatioVsBest: outputRatio, verdict };
}
