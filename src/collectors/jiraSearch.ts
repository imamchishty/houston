import { config } from '../config.js';

// Shared Jira access. Jira Cloud retired /rest/api/2/search in favour of /rest/api/3/search/jql (token paging, no
// total). Jira Data Center still has only /rest/api/2/search. searchAll tries the new endpoint and falls back.

export async function jiraGet<T>(path: string): Promise<T> {
  const res = await jiraFetch(path);
  if (!res.ok) throw new Error(`Jira ${res.status} on ${path.split('?')[0]}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

function jiraFetch(path: string) {
  const { baseUrl, email, token } = config.jira;
  const auth = email ? 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64') : `Bearer ${token}`;
  return fetch(`${baseUrl}${path}`, { headers: { Authorization: auth, Accept: 'application/json' } });
}

// JQL string literal: a value cannot end the string or add a clause.
export const jqlString = (s: string) => `"${s.replace(/[\\"]/g, (c) => '\\' + c)}"`;
export const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
export const projectKeyFor = (board: string) => config.jira.projects[board] ?? board;

let useV3: boolean | null = null; // decided on the first search, then remembered

// Every issue matching the JQL, all pages. limit guards against an unexpectedly broad query.
export async function searchAll(jql: string, fields: string[], opts: { expand?: string; limit?: number } = {}): Promise<any[]> {
  const limit = opts.limit ?? 20_000, out: any[] = [];
  const f = encodeURIComponent(fields.join(',')), q = encodeURIComponent(jql), ex = opts.expand ? `&expand=${encodeURIComponent(opts.expand)}` : '';
  if (useV3 !== false) {
    let token: string | undefined;
    for (;;) {
      const res = await jiraFetch(`/rest/api/3/search/jql?jql=${q}&fields=${f}&maxResults=100${ex}${token ? `&nextPageToken=${encodeURIComponent(token)}` : ''}`);
      if ((res.status === 404 || res.status === 410) && useV3 === null && !out.length) { useV3 = false; break; } // Data Center: no v3 search
      if (!res.ok) throw new Error(`Jira ${res.status} on search: ${(await res.text()).slice(0, 300)}`);
      useV3 = true;
      const page = await res.json() as { issues?: any[]; nextPageToken?: string; isLast?: boolean };
      out.push(...(page.issues ?? []));
      if (page.isLast !== false || !page.nextPageToken || out.length >= limit) return out;
      token = page.nextPageToken;
    }
  }
  for (let startAt = 0; ;) {
    const page = await jiraGet<{ issues: any[]; total: number }>(`/rest/api/2/search?jql=${q}&fields=${f}&startAt=${startAt}&maxResults=100${ex}`);
    out.push(...page.issues);
    startAt += page.issues.length;
    if (!page.issues.length || startAt >= page.total || out.length >= limit) return out;
  }
}

export function statusCategoryOf(key: string | undefined): 'todo' | 'inprogress' | 'done' {
  const k = (key ?? '').toLowerCase();
  return k === 'done' ? 'done' : k === 'indeterminate' || k === 'in progress' ? 'inprogress' : 'todo';
}
