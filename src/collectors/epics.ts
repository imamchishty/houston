import { config } from '../config.js';
import type { Epic } from '../types.js';

// Epics resolved in the last 180 days plus open ones, per board's Jira project (key prefix = board name by default).
async function jira<T>(path: string): Promise<T> {
  const { baseUrl, email, token } = config.jira;
  const auth = email ? 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64') : `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: auth, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Jira ${res.status} on ${path}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function collectEpics(project: string): Promise<Epic[]> {
  const jql = encodeURIComponent(`project = ${project} AND issuetype = Epic AND (resolved >= -180d OR resolution is EMPTY) ORDER BY created DESC`);
  const out: Epic[] = [];
  let startAt = 0;
  for (;;) {
    const page = await jira<any>(`/rest/api/2/search?jql=${jql}&startAt=${startAt}&maxResults=50&expand=changelog&fields=summary,status,created,resolutiondate`);
    for (const e of page.issues) {
      let started: string | null = null;
      for (const h of e.changelog?.histories ?? []) for (const it of h.items ?? []) {
        if (it.field === 'status' && /in progress/i.test(it.toString ?? '') && !started) started = h.created;
      }
      const kids = await jira<any>(`/rest/api/2/search?jql=${encodeURIComponent(`"Epic Link" = ${e.key} OR parent = ${e.key}`)}&maxResults=0&fields=status`);
      const kidsDone = await jira<any>(`/rest/api/2/search?jql=${encodeURIComponent(`("Epic Link" = ${e.key} OR parent = ${e.key}) AND statusCategory = Done`)}&maxResults=0`);
      const cat = (e.fields.status?.statusCategory?.key ?? '').toLowerCase();
      out.push({ key: e.key, summary: e.fields.summary, status: e.fields.status?.name ?? '',
        statusCategory: cat === 'done' ? 'done' : cat === 'indeterminate' ? 'inprogress' : 'todo',
        created: e.fields.created, started, resolved: e.fields.resolutiondate ?? null, childCount: kids.total ?? 0, childDone: kidsDone.total ?? 0 });
    }
    startAt += page.issues.length;
    if (startAt >= page.total || !page.issues.length) break;
  }
  return out;
}

export function demoEpics(board: string, weak: boolean): Epic[] {
  const day = 86_400_000, now = Date.now();
  const mk = (i: number, ageDays: number, leadDays: number | null, kids: number, done: number): Epic => ({
    key: `${board}-E${i}`, summary: `Feature ${i}`, status: leadDays ? 'Done' : 'In Progress',
    statusCategory: leadDays ? 'done' : 'inprogress', created: new Date(now - ageDays * day).toISOString(),
    started: new Date(now - ageDays * day + 5 * day).toISOString(), resolved: leadDays ? new Date(now - ageDays * day + leadDays * day).toISOString() : null,
    childCount: kids, childDone: done });
  return weak
    ? [mk(1, 170, 96, 14, 14), mk(2, 150, 88, 9, 9), mk(3, 130, 71, 11, 11), mk(4, 120, 110, 18, 18), mk(5, 95, null, 12, 5), mk(6, 80, null, 8, 2), mk(7, 60, null, 15, 3), mk(8, 40, null, 6, 1)]
    : [mk(1, 170, 24, 8, 8), mk(2, 140, 18, 6, 6), mk(3, 110, 31, 10, 10), mk(4, 80, 20, 5, 5), mk(5, 50, 22, 7, 7), mk(6, 25, null, 6, 4), mk(7, 12, null, 4, 1)];
}
