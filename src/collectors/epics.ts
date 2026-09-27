import type { Epic } from '../types.js';
import { searchAll, jqlString, ISSUE_KEY, statusCategoryOf, projectKeyFor } from './jiraSearch.js';

// Epics resolved in the last 180 days plus open ones, per board's Jira project (JIRA_PROJECTS, else the board name).
export async function collectEpics(board: string): Promise<Epic[]> {
  const project = projectKeyFor(board);
  const epics = await searchAll(`project = ${jqlString(project)} AND issuetype = Epic AND (resolved >= -180d OR resolution is EMPTY) ORDER BY created DESC`,
    ['summary', 'status', 'created', 'resolutiondate', 'duedate'], { expand: 'changelog' });
  const out: Epic[] = [];
  for (const e of epics) {
    if (!ISSUE_KEY.test(e.key)) continue; // keys go back into JQL below
    let started: string | null = null;
    for (const h of e.changelog?.histories ?? []) for (const it of h.items ?? []) {
      if (it.field === 'status' && /in progress/i.test(it.toString ?? '') && (!started || h.created < started)) started = h.created; // earliest
    }
    // Children counted exactly, from the issues themselves (the v3 search returns no totals).
    const kids = await searchAll(`"Epic Link" = ${e.key} OR parent = ${e.key}`, ['status']);
    out.push({
      key: e.key, summary: e.fields.summary, status: e.fields.status?.name ?? '',
      statusCategory: statusCategoryOf(e.fields.status?.statusCategory?.key),
      created: e.fields.created, started, resolved: e.fields.resolutiondate ?? null, due: e.fields.duedate ?? null,
      childCount: kids.length, childDone: kids.filter((k) => statusCategoryOf(k.fields?.status?.statusCategory?.key) === 'done').length,
    });
  }
  return out;
}

export function demoEpics(board: string, weak: boolean): Epic[] {
  const day = 86_400_000, now = Date.now();
  const mk = (i: number, ageDays: number, leadDays: number | null, kids: number, done: number, due: boolean): Epic => ({
    key: `${board}-E${i}`, summary: `Feature ${i}`, status: leadDays ? 'Done' : 'In Progress',
    statusCategory: leadDays ? 'done' : 'inprogress', created: new Date(now - ageDays * day).toISOString(),
    started: new Date(now - ageDays * day + 5 * day).toISOString(), resolved: leadDays ? new Date(now - ageDays * day + leadDays * day).toISOString() : null,
    childCount: kids, childDone: done, due: due ? new Date(now - ageDays * day + 60 * day).toISOString().slice(0, 10) : null });
  return weak
    ? [mk(1, 170, 96, 14, 14, true), mk(2, 150, 88, 9, 9, false), mk(3, 130, 71, 11, 11, false), mk(4, 120, 110, 18, 18, true), mk(5, 95, null, 12, 5, false), mk(6, 80, null, 8, 2, true), mk(7, 60, null, 15, 3, false), mk(8, 40, null, 6, 1, false)]
    : [mk(1, 170, 24, 8, 8, true), mk(2, 140, 18, 6, 6, true), mk(3, 110, 31, 10, 10, true), mk(4, 80, 20, 5, 5, true), mk(5, 50, 22, 7, 7, false), mk(6, 25, null, 6, 4, true), mk(7, 12, null, 4, 1, true)];
}
