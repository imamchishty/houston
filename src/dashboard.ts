import { store } from './store/index.js';
import { teamSummary } from './summary.js';
import { claudeReport } from './claude.js';
import { BANDS } from './metrics.js';

// Everything on the home page in one call: every team's status, what needs attention, and whether the data is fresh.
// Team level only, so it is safe for any signed in user or API token.
const STALE_HOURS = 36; // the nightly run is every 24 hours; past 36 one has been missed

export function dashboard(now = Date.now()) {
  const boards = [...new Set(store.scorecards().map((c) => c.board))].sort((a, b) => a.localeCompare(b));
  const teams = boards.flatMap((board) => {
    const s = teamSummary(board);
    if (!s) return [];
    const trend = store.scorecards().filter((c) => c.board === board).sort((a, b) => a.sprintId - b.sprintId).slice(-6).map((c) => c.score);
    const claude = claudeReport(board, false);
    return [{
      board, sprint: s.sprint, score: s.score, band: s.band, change: s.change, trend,
      areas: Object.fromEntries(s.areas.map((a) => [a.area, { score: a.score, band: a.band }])),
      dora: Object.fromEntries(s.dora.map((d) => [d.metric, { tier: d.tier, value: d.value, unit: d.unit }])),
      headcountGateOpen: s.headcountGateOpen,
      claudeAdoptionPct: claude.usageConnected ? claude.adoptionPct : null,
      costOnFeaturesPct: s.cost?.onFeaturesPct ?? null,
      gains: s.gains,
    }];
  });

  const last = store.scorecards().reduce<string | null>((m, c) => (!m || c.generatedAt > m ? c.generatedAt : m), null);
  const ageHours = last ? (now - Date.parse(last)) / 3_600_000 : null;
  const costs = boards.map((b) => teamSummary(b)?.cost).filter((c): c is NonNullable<typeof c> => !!c);
  const teamCost = costs.reduce((t, c) => t + c.teamCost, 0);
  const claude = boards.map((b) => claudeReport(b, false)).filter((c) => c.usageConnected);
  const roster = claude.reduce((t, c) => t + c.rosterSize, 0);

  return {
    generatedAt: new Date(now).toISOString(),
    data: { lastCollected: last, ageHours: ageHours == null ? null : Math.round(ageHours * 10) / 10, stale: ageHours == null || ageHours > STALE_HOURS },
    counts: { teams: teams.length, ...Object.fromEntries(BANDS.map((b) => [b.label, teams.filter((t) => t.band === b.label).length])) },
    cost: costs.length ? {
      currency: costs[0].currency, teamCost,
      onFeaturesPct: teamCost ? Math.round((costs.reduce((t, c) => t + (c.teamCost * c.onFeaturesPct) / 100, 0) / teamCost) * 100) : 0,
      aiCost: costs.reduce((t, c) => t + (c.aiCost ?? 0), 0),
    } : null,
    claudeAdoptionPct: roster ? Math.round((claude.reduce((t, c) => t + c.activeUsers, 0) / roster) * 100) : null,
    // The biggest gains anywhere, each naming its team: where an hour of effort moves a score most.
    attention: teams.flatMap((t) => t.gains.map((g) => ({ board: t.board, ...g }))).sort((a, b) => b.gain - a.gain).slice(0, 6),
    teams: teams.map(({ gains, ...t }) => t),
  };
}
