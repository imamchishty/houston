import { store } from './store/index.js';
import { teamSummary } from './summary.js';
import { claudeReport } from './claude.js';
import { BANDS } from './metrics.js';
import { slice, activitySummary, flatMeasures, withPrevious, REPORTS } from './reports.js';
import { currentSprints } from './sprintNow.js';
import { featureCosts } from './cost.js';
import { costRates } from './claude.js';
import { rosterFor } from './identity.js';
import { config } from './config.js';
import { boardData } from './board.js';

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

  // Headlines: one card per area, two measures each, last 30 days, all teams. The same functions as the area pages.
  const s30 = slice('all', 30, now);
  const AREAS = [
    { page: 'dora', title: 'DORA', question: 'How fast and how safely does change reach users?', ids: ['lead_time', 'change_failure_rate'] },
    { page: 'flow', title: 'Flow', question: 'How much work flows, and where does it wait?', ids: ['flow_efficiency', 'flow_time'] },
    { page: 'quality', title: 'Quality', question: 'Are bugs hurting customers, and is the code sound?', ids: ['bugs_per_change', 'defect_leakage'] },
    { page: 'security', title: 'Security', question: 'Are serious security issues fixed in time?', ids: ['security_on_time', 'security_overdue'] },
    { page: 'support', title: 'Support', question: 'How much support arrives, and is it answered in time?', ids: ['support_share', 'sla_resolution'] },
    { page: 'planning', title: 'Planning', question: 'Does the team deliver what it plans?', ids: ['sprint_completion', 'unplanned_work'] },
  ] as const;
  const headlines = AREAS.map((h) => { const all = flatMeasures(REPORTS[h.page](s30));
    return { page: h.page, title: h.title, question: h.question, measures: h.ids.flatMap((id) => { const x = all.find((y) => y.id === id); if (!x) return []; const { failing, how, ...m } = x; return [m]; }) }; }); // a measure not collected yet is left out, never a crash

  // Team health alerts: every target a team missed in the last 30 days, per team. Red when it was missed the
  // 30 days before as well (a pattern, not a blip); amber when it is new. Small samples never raise an alert.
  const alerts = boards.flatMap((board) => AREAS.flatMap(({ page }) =>
    flatMeasures(withPrevious(board, 30, REPORTS[page], now)).filter((m) => m.met === false && !m.smallSample).map((m) => ({
      board, page, id: m.id, title: m.title, value: m.value, unit: m.unit, target: m.target, num: m.num, den: m.den, denLabel: m.denLabel,
      severity: m.previousMet === false ? 'red' as const : 'amber' as const, previous: m.previous ?? null, trend: m.trend ?? null,
    })))).sort((a, b) => (a.severity === b.severity ? a.board.localeCompare(b.board) || a.title.localeCompare(b.title) : a.severity === 'red' ? -1 : 1));

  // Features in progress, with what they have cost so far and are estimated to cost to finish.
  const projects = boards.flatMap((board) => {
    const b = boardData(board);
    const cost = config.cost.fteDay || config.cost.contractorDay
      ? featureCosts({ sprints: b.sprints, epics: b.raw.epics, rates: costRates(), roster: rosterFor(board), weekend: config.weekend }) : null;
    return b.raw.epics.filter((e) => e.statusCategory === 'inprogress').map((e) => {
      const c = cost?.features.find((f) => f.key === e.key);
      return { board, key: e.key, summary: e.summary, childDone: e.childDone, childCount: e.childCount, due: e.due ?? null,
        pctDone: e.childCount ? Math.round((100 * e.childDone) / e.childCount) : null,
        spent: c?.spent ?? null, toComplete: c?.toComplete ?? null, total: c?.total ?? null, currency: cost?.currency ?? null };
    });
  }).sort((a, b) => (b.total ?? 0) - (a.total ?? 0));

  return {
    generatedAt: new Date(now).toISOString(),
    activity: { days: 30, ...activitySummary(s30) },
    alerts,
    headlines,
    sprints: currentSprints(false, now).map(({ burndown, byStatus, statusType, bugTrend, cycleByDay, inProgress, cycle, velocity, ...sp }) => sp),
    projects,
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
