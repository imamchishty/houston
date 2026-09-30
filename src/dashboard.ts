import { store } from './store/index.js';
import { AREAS, boards, performance } from './performance.js';
import { currentSprint } from './sprintNow.js';
import type { Measure } from './reports.js';

// The home page in one call: every team (alphabetical) on the 10 headline measures, its score and trend, one plain sentence, and
// what has missed its target two periods running. Team level only, so it is safe for any signed in user or API token.
const STALE_HOURS = 36; // the nightly run is every 24 hours; past 36 one has been missed

// A headline as the dashboard shows it: no definition text or failing item lists (those are on the team page).
const compact = ({ how, failing, note, ...m }: Measure) => m;

export function dashboard(now = Date.now()) {
  const row = (board: string) => {
    const p = performance(board, 30, now);
    const cs = board === 'all' ? null : currentSprint(board, false, now);
    const drill = p.areas.flatMap((a) => a.headlines.flatMap((h) => h.drill));
    return { board, score: p.score, summary: p.summary, missed: p.missed,
      measures: p.areas.flatMap((a) => a.headlines.map((h) => ({ area: a.id, ...compact(h.measure) }))),
      // Ready and Done, not scored: shown as one line on the card.
      checks: Object.fromEntries(['ready_rate', 'done_rate'].flatMap((id) => { const m = drill.find((x) => x.id === id); return m ? [[id, compact(m)]] : []; })),
      sprint: cs ? { name: cs.sprint, outlook: cs.outlook, workingDaysLeft: cs.workingDaysLeft } : null };
  };
  // Alphabetical, not ranked: a league table of teams is disheartening and invites the wrong conversation.
  const teams = boards().map(row);
  const last = lastCollected(), ageHours = last ? (now - Date.parse(last)) / 3_600_000 : null;
  return {
    generatedAt: new Date(now).toISOString(), days: 30,
    areas: AREAS.map((a) => ({ id: a.id, title: a.title, headlines: [...a.headlines] })),
    all: teams.length > 1 ? row('all') : null,
    teams,
    // Needs attention: headline targets missed this period and the one before, worst first.
    attention: teams.flatMap((t) => t.missed.filter((m) => m.missedTwice).map((m) => ({ board: t.board, ...m }))),
    data: { lastCollected: last, ageHours: ageHours == null ? null : Math.round(ageHours * 10) / 10, stale: ageHours == null || ageHours > STALE_HOURS },
  };
}

// When the data was last collected: the newest capture time of any source.
function lastCollected(): string | null {
  const times = [...store.github().map((g) => g.until), ...store.support().map((s) => s.capturedAt), ...store.azure().map((a) => a.capturedAt), ...store.quality().map((q) => (q as { capturedAt?: string }).capturedAt)].filter((x): x is string => !!x);
  return times.length ? times.sort().at(-1)! : null;
}
