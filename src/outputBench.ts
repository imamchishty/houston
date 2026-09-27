import { config } from './config.js';
import type { Epic } from './types.js';

// Team cost next to an offshore equivalent, and features shipped. Facts only.
// Output per engineer is deliberately not compared across teams: story points are sized differently by every team,
// and pull request counts reward splitting work, so either comparison would mislead.
export interface CostFacts {
  board: string;
  featuresShipped90d: number;
  teamMonthAed: number | null;
  offshoreMonthAed: number | null;
  costRatio: number | null;      // team ÷ offshore
  verdict: string;
}

export function outputBench(board: string, epics: Epic[]): CostFacts | null {
  const since = Date.now() - 90 * 86_400_000;
  const shipped = epics.filter((e) => e.resolved && new Date(e.resolved).getTime() >= since).length;
  const team = config.azure.teamCost.find((t) => t.name === board)?.aed ?? null;
  const off = config.offshoreCost.find((t) => t.name === board)?.aed ?? null;
  if (team == null && off == null) return null;
  const costRatio = team && off ? Math.round((team / off) * 10) / 10 : null;
  const verdict = [team != null ? `The team costs AED ${team.toLocaleString()} a month.` : '',
    costRatio != null ? `That is ${costRatio}x the configured offshore equivalent (AED ${off!.toLocaleString()}).` : '',
    `${shipped} ${shipped === 1 ? 'feature' : 'features'} shipped in the last 90 days. Cost per feature is on the Features tab.`].filter(Boolean).join(' ');
  return { board, featuresShipped90d: shipped, teamMonthAed: team, offshoreMonthAed: off, costRatio, verdict };
}
