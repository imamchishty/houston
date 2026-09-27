import { config } from '../config.js';
import { canonical, rosterFor } from '../identity.js';
import { appInsightsRows } from './azure.js';
import type { ClaudeSnapshot, ClaudeUser } from '../types.js';

// Claude Code usage from its OpenTelemetry metrics (CLAUDE_USAGE.md), stored by the collector in Application Insights
// customMetrics. Counters are exported as deltas, so summing value over the window gives the total.
// Only numbers leave the developer's machine: no prompts, no code (OTEL_LOG_USER_PROMPTS stays off).
const KQL = (days: number) => `
customMetrics
| where timestamp > ago(${Math.trunc(days)}d) and name startswith "claude_code."
| extend email = tolower(tostring(customDimensions["user.email"])), t = tostring(customDimensions["type"]), decision = tostring(customDimensions["decision"])
| where isnotempty(email)
| summarize
    activeDays = dcount(bin(timestamp, 1d)),
    sessions = sumif(value, name == "claude_code.session.count"),
    activeSeconds = sumif(value, name == "claude_code.active_time.total"),
    linesAdded = sumif(value, name == "claude_code.lines_of_code.count" and t == "added"),
    linesRemoved = sumif(value, name == "claude_code.lines_of_code.count" and t == "removed"),
    commits = sumif(value, name == "claude_code.commit.count"),
    pullRequests = sumif(value, name == "claude_code.pull_request.count"),
    editsAccepted = sumif(value, name == "claude_code.code_edit_tool.decision" and decision == "accept"),
    editsRejected = sumif(value, name == "claude_code.code_edit_tool.decision" and decision == "reject"),
    costUsd = sumif(value, name == "claude_code.cost.usage")
  by email`;

// PEOPLE can list emails as aliases. Failing that, "aisha.khan@m42.ae" tries the alias "aisha.khan".
export const personFor = (email: string) => {
  const byEmail = canonical(email);
  if (byEmail && byEmail !== email) return byEmail;
  const local = email.split('@')[0];
  const byLocal = canonical(local);
  return byLocal && byLocal !== local ? byLocal : email;
};

const n = (v: unknown) => Math.round(Number(v ?? 0));
const boards = () => (config.mode === 'demo' ? ['OSSI', 'PLAT'] : config.jira.boards.map((b) => b.name));

export async function collectClaude(): Promise<ClaudeSnapshot[]> {
  if (!config.claude.appInsights) return [];
  const rows = await appInsightsRows(config.claude.appInsights, KQL(config.claude.days));
  const users: ClaudeUser[] = rows.map((r) => ({
    name: personFor(String(r.email)), email: String(r.email), activeDays: n(r.activeDays), sessions: n(r.sessions),
    activeHours: Math.round((Number(r.activeSeconds ?? 0) / 3600) * 10) / 10, linesAdded: n(r.linesAdded), linesRemoved: n(r.linesRemoved),
    commits: n(r.commits), pullRequests: n(r.pullRequests), editsAccepted: n(r.editsAccepted), editsRejected: n(r.editsRejected),
    apiEquivalentUsd: Math.round(Number(r.costUsd ?? 0) * 100) / 100,
  }));
  const now = new Date().toISOString();
  // A person counts for every team whose roster names them. People on no roster are left out.
  return boards().map((board) => {
    const roster = new Set(rosterFor(board));
    return { board, capturedAt: now, days: config.claude.days, users: users.filter((u) => roster.has(u.name)) };
  });
}

// Demo: most of OSSI uses Claude Code lightly, two not at all; PLAT uses it daily.
export function demoClaude(): ClaudeSnapshot[] {
  const now = new Date().toISOString();
  const mk = (name: string, days: number, scale: number): ClaudeUser => ({
    name, email: `${name.toLowerCase()}@example.com`, activeDays: days, sessions: Math.round(days * 2.5 * scale),
    activeHours: Math.round(days * 1.8 * scale * 10) / 10, linesAdded: Math.round(days * 310 * scale), linesRemoved: Math.round(days * 120 * scale),
    commits: Math.round(days * 1.4 * scale), pullRequests: Math.round(days * 0.3 * scale),
    editsAccepted: Math.round(days * 22 * scale), editsRejected: Math.round(days * (scale > 1 ? 3 : 8)),
    apiEquivalentUsd: Math.round(days * 9.5 * scale * 100) / 100,
  });
  return [
    { board: 'OSSI', capturedAt: now, days: 30, users: [mk('Aisha', 14, 1), mk('Rahul', 6, 0.6), mk('Priya', 11, 0.9), mk('Fatima', 3, 0.4), mk('Karim', 2, 0.3)] },
    { board: 'PLAT', capturedAt: now, days: 30, users: [mk('Lena', 20, 1.4), mk('Yusuf', 18, 1.2), mk('Mei', 21, 1.5), mk('Sam', 15, 1.1)] },
  ];
}
