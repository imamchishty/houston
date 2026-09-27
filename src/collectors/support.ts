import { config } from '../config.js';
import { jqlString, searchAll, projectKeyFor } from './jiraSearch.js';
import type { SupportSnapshot, SupportTicket } from '../types.js';

// Support tickets from plain Jira, over JIRA_DAYS plus every ticket still open. A team with its own support project
// (SUPPORT_PROJECTS) counts every ticket in it. Otherwise tickets in the team's project count when their issue type is
// in SUPPORT_ISSUE_TYPES or they carry a SUPPORT_LABELS label. Only times are kept, never names or comment text.
export const supportProjectFor = (board: string) => config.jira.supportProjects[board] ?? projectKeyFor(board);
const dedicated = (board: string) => !!config.jira.supportProjects[board] && config.jira.supportProjects[board] !== projectKeyFor(board);

export const supportJql = (board: string, days: number) => supportJqlFor(supportProjectFor(board), dedicated(board), days);
export function supportJqlFor(project: string, dedicatedProject: boolean, days: number): string {
  const d = Math.trunc(days);
  const which = dedicatedProject ? '' : ` AND (issuetype in (${config.jira.supportTypes.map(jqlString).join(', ')})${config.jira.supportLabels.length ? ` OR labels in (${config.jira.supportLabels.map(jqlString).join(', ')})` : ''})`;
  return `project = ${jqlString(project)}${which} AND (created >= -${d}d OR resolved >= -${d}d OR statusCategory != Done) ORDER BY created DESC`;
}

export function toTicket(i: any): SupportTicket {
  const f = i.fields ?? {}, reporter = f.reporter?.accountId ?? f.reporter?.name ?? null;
  const person = (a: any) => a && a.accountType !== 'app';
  // Status changes made by people: automation (Jira apps and rules) is left out; only the time is kept.
  const changes: string[] = (i.changelog?.histories ?? []).filter((h: any) => person(h.author) && (h.items ?? []).some((x: any) => x.field === 'status')).map((h: any) => new Date(h.created).toISOString()).sort();
  // First response: the first comment by someone other than the reporter, or the first status change by a person.
  const comments: string[] = (f.comment?.comments ?? []).filter((c: any) => person(c.author) && (c.author?.accountId ?? c.author?.name) !== reporter).map((c: any) => new Date(c.created).toISOString());
  const firstResponse = [...comments, ...changes].sort()[0] ?? null;
  return {
    key: String(i.key), priority: f.priority?.name ?? null, created: new Date(f.created).toISOString(), resolved: f.resolutiondate ? new Date(f.resolutiondate).toISOString() : null,
    // Reopened: a resolution was cleared after being set. Duplicate: this ticket "duplicates" another (Jira's Duplicate link).
    reopened: (i.changelog?.histories ?? []).some((h: any) => (h.items ?? []).some((x: any) => x.field === 'resolution' && (x.from || x.fromString) && !x.to && !x.toString)),
    duplicate: (f.issuelinks ?? []).some((l: any) => /duplicate/i.test(String(l.type?.name ?? '')) && l.outwardIssue),
    firstResponse, changes,
  };
}

export async function collectSupport(): Promise<SupportSnapshot[]> {
  const out: SupportSnapshot[] = [];
  for (const b of config.jira.boards) {
    const issues = await searchAll(supportJql(b.name, config.jira.days), ['priority', 'created', 'resolutiondate', 'status', 'issuelinks', 'reporter', 'comment'], { expand: 'changelog', limit: 10_000 });
    out.push({ board: b.name, project: supportProjectFor(b.name), capturedAt: new Date().toISOString(), tickets: issues.map(toTicket) });
  }
  return out;
}

// Demo: OSSI is swamped (many tickets, slow answers, work at night); PLAT is quiet.
export function demoSupport(): SupportSnapshot[] {
  const DAY = 86_400_000, now = Date.now();
  const mk = (board: string, seed: number, perDay: number, slow: number, nightShare: number, reopen: number): SupportSnapshot => {
    let s = seed; const r = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const tickets: SupportTicket[] = [];
    const tz = config.tzOffset * 3_600_000, wh = config.workingHours;
    for (let t = now - 90 * DAY, n = 1; t < now; t += DAY / perDay, n++) {
      const day = Math.floor((t + tz) / DAY) * DAY - tz, created = day + (wh.start + r() * (wh.end - wh.start - 1)) * 3_600_000, pri = r() < 0.12 ? 'Highest' : r() < 0.3 ? 'High' : r() < 0.75 ? 'Medium' : 'Low';
      // Work happens in the working day, except a nightShare of it, which happens in the evening.
      const place = (x: number) => { let d = Math.floor((x + tz) / DAY) * DAY - tz; while (config.weekend.includes(new Date(d + tz).getUTCDay())) d += DAY; return r() < nightShare ? d + (wh.end + 1 + r() * 3) * 3_600_000 : d + (wh.start + r() * (wh.end - wh.start)) * 3_600_000; };
      const respond = Math.max(created + 600_000, place(created + (r() < slow ? 6 + r() * 40 : 0.3 + r() * 3) * 3_600_000));
      const resolved = Math.max(respond + 600_000, place(created + (r() < slow ? 3 + r() * 12 : 0.3 + r() * 3) * DAY));
      const changes = [respond, resolved].filter((x) => x <= now).map((x) => new Date(x).toISOString());
      tickets.push({ key: `${board}-S${n}`, priority: pri, created: new Date(created).toISOString(), resolved: resolved > now ? null : new Date(resolved).toISOString(),
        reopened: resolved <= now && r() < reopen, duplicate: r() < reopen / 2, firstResponse: respond <= now ? changes[0] ?? null : null, changes });
    }
    return { board, project: board, capturedAt: new Date(now).toISOString(), tickets };
  };
  return [mk('OSSI', 21, 3.2, 0.3, 0.22, 0.12), mk('PLAT', 5, 0.7, 0.05, 0.04, 0.03)];
}
