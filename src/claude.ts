import { config } from './config.js';
import { store } from './store/index.js';
import { rosterFor } from './identity.js';
import type { Rates } from './cost.js';
import type { ClaudeUser } from './types.js';

// Claude seat cost per working day: monthly seat price x 12 months / working days in a year.
export const seatDay = () => {
  const workdays = 52 * (7 - config.weekend.length);
  return config.claude.seatMonthly ? (config.claude.seatMonthly * 12) / workdays : 0;
};

// Cost rates with the Claude seat folded into each seat holder's day rate.
export const costRates = (): Rates => ({ ...config.cost, seatDay: seatDay(), seatHolders: config.claude.seats });

// One team's Claude usage. Team level for everyone; per person only when named is true (people viewers).
export function claudeReport(board: string, named: boolean) {
  const roster = rosterFor(board);
  const snap = store.claude().find((c) => c.board === board);
  const seats = config.claude.seats.length ? roster.filter((p) => config.claude.seats.includes(p)).length : roster.length;
  const users = snap?.users ?? [];
  const active = users.filter((u) => u.activeDays > 0);
  const sum = (k: keyof ClaudeUser) => users.reduce((t, u) => t + Number(u[k]), 0);
  const accepted = sum('editsAccepted'), rejected = sum('editsRejected');
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
  return {
    configured: !!snap || !!config.claude.seatMonthly,
    usageConnected: !!snap,
    days: snap?.days ?? config.claude.days,
    currency: config.cost.currency,
    seats,
    seatCostMonthly: Math.round(seats * config.claude.seatMonthly),
    rosterSize: roster.length,
    activeUsers: active.length,
    adoptionPct: roster.length ? Math.round((active.length / roster.length) * 100) : 0,
    medianActiveDays: median(active.map((u) => u.activeDays)),
    sessions: sum('sessions'),
    linesAdded: sum('linesAdded'), linesRemoved: sum('linesRemoved'),
    commits: sum('commits'), pullRequests: sum('pullRequests'),
    acceptanceRate: accepted + rejected ? Math.round((accepted / (accepted + rejected)) * 1000) / 10 : null,
    apiEquivalent: Math.round(sum('apiEquivalentUsd') * config.claude.usdRate),
    notUsing: named ? roster.filter((p) => !active.some((u) => u.name === p)) : undefined,
    people: named ? users.map(({ email, ...u }) => ({ ...u, apiEquivalent: Math.round(u.apiEquivalentUsd * config.claude.usdRate) })) : undefined,
  };
}
