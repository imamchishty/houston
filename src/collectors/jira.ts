import { config } from '../config.js';
import type { Issue, Sprint } from '../types.js';
import { canonical } from '../identity.js';

// Jira Agile REST API collector. Works with Jira Cloud (basic auth email:token)
// and Data Center (set JIRA_EMAIL blank and JIRA_API_TOKEN to a PAT).

const AC_PATTERNS = [/acceptance criteria/i, /\bgiven\b.*\bwhen\b.*\bthen\b/is, /\bAC:/];

async function jira<T>(path: string): Promise<T> {
  const { baseUrl, email, token } = config.jira;
  const auth = email ? 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64') : `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: auth, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Jira ${res.status} on ${path}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

function statusCategory(raw: string): Issue['statusCategory'] {
  const k = raw.toLowerCase();
  if (k === 'done') return 'done';
  if (k === 'indeterminate' || k === 'in progress') return 'inprogress';
  return 'todo';
}

function hasAC(fields: any): boolean {
  if (config.jira.acField) {
    const v = fields[config.jira.acField];
    return typeof v === 'string' ? v.trim().length > 20 : !!v;
  }
  const text = typeof fields.description === 'string' ? fields.description : JSON.stringify(fields.description ?? '');
  return AC_PATTERNS.some((p) => p.test(text));
}

// From the changelog: when the issue entered this sprint, and when work on it FIRST started. Started means a move
// into any status Jira classes as "In Progress" (status category), whatever the team calls it ("In Development",
// "Doing"). Earliest wins, whatever order Jira returns the history in, so a reopened ticket keeps its real start.
export function fromChangelog(changelog: any, sprintId: number, categories: Map<string, string>) {
  let addedToSprintAt: string | null = null;
  let inProgressSince: string | null = null;
  const statusHistory: { at: string; to: string; category: string }[] = [];
  for (const h of changelog?.histories ?? []) {
    for (const it of h.items ?? []) {
      if (it.field === 'Sprint' && String(it.to ?? '').split(',').map((x: string) => x.trim()).includes(String(sprintId))) {
        if (!addedToSprintAt || h.created < addedToSprintAt) addedToSprintAt = h.created;
      }
      if (it.field === 'status') {
        const cat = categories.get(String(it.to ?? ''));
        const started = cat ? cat === 'indeterminate' : /in progress/i.test(it.toString ?? ''); // name only if the status is unknown
        if (started && (!inProgressSince || h.created < inProgressSince)) inProgressSince = h.created;
        statusHistory.push({ at: h.created, to: String(it.toString ?? ''), category: cat ?? (started ? 'indeterminate' : /done|closed|resolved/i.test(it.toString ?? '') ? 'done' : 'new') });
      }
    }
  }
  statusHistory.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { addedToSprintAt, inProgressSince, statusHistory };
}

// Every status's category (new / indeterminate / done), once per run.
let statusCategories: Map<string, string> | null = null;
async function categories() {
  if (!statusCategories) {
    const list = await jira<any[]>('/rest/api/2/status').catch(() => []);
    statusCategories = new Map(list.map((s) => [String(s.id), String(s.statusCategory?.key ?? '')]));
  }
  return statusCategories;
}

// Search results embed at most 100 changelog entries. A long-lived ticket's history is fetched in full.
async function fullChangelog(key: string, embedded: any) {
  if (!embedded || (embedded.total ?? 0) <= (embedded.histories?.length ?? 0)) return embedded;
  const histories: any[] = [];
  for (let startAt = 0; ;) {
    const page = await jira<any>(`/rest/api/2/issue/${encodeURIComponent(key)}/changelog?startAt=${startAt}&maxResults=100`)
      .catch(() => null);
    if (!page) return embedded; // Data Center before 8.x has no changelog endpoint: keep what was embedded
    histories.push(...(page.values ?? []));
    startAt += page.values?.length ?? 0;
    if (!page.values?.length || page.isLast || startAt >= (page.total ?? 0)) return { ...embedded, histories };
  }
}

async function sprintIssues(sprintId: number, boardName: string): Promise<Issue[]> {
  const out: Issue[] = [];
  let startAt = 0;
  // 'sprint' and 'closedSprints' are Agile fields: with an explicit field list Jira only returns them when named,
  // and without them carry-over could never be seen.
  const fields = ['summary', 'issuetype', 'status', 'assignee', 'created', 'resolutiondate', 'description', 'sprint', 'closedSprints',
    config.jira.pointsField, 'parent', config.jira.epicField, ...(config.jira.acField ? [config.jira.acField] : [])].join(',');
  for (;;) {
    const page = await jira<any>(`/rest/agile/1.0/sprint/${sprintId}/issue?startAt=${startAt}&maxResults=100&expand=changelog&fields=${fields}`);
    for (const r of page.issues) {
      const f = r.fields;
      const cl = fromChangelog(await fullChangelog(r.key, r.changelog), sprintId, await categories());
      out.push({
        key: r.key,
        summary: f.summary,
        type: f.issuetype?.name ?? 'Task',
        status: f.status?.name ?? '',
        statusCategory: statusCategory(f.status?.statusCategory?.key ?? ''),
        points: f[config.jira.pointsField] ?? null,
        assignee: canonical(f.assignee?.displayName),
        hasAcceptanceCriteria: hasAC(f),
        created: f.created,
        resolved: f.resolutiondate ?? null,
        addedToSprintAt: cl.addedToSprintAt,
        sprintIds: (f.closedSprints ?? []).map((s: any) => s.id).concat(f.sprint ? [f.sprint.id] : []),
        inProgressSince: cl.inProgressSince,
        statusHistory: cl.statusHistory,
        // Company-managed projects use the Epic Link field; team-managed ones make the epic the parent.
        epic: f[config.jira.epicField] ?? (f.parent?.fields?.issuetype?.hierarchyLevel === 1 || f.parent?.fields?.issuetype?.name === 'Epic' ? f.parent.key : null),
      });
    }
    startAt += page.issues.length;
    if (startAt >= page.total || page.issues.length === 0) break;
  }
  return out;
}

export async function collectJira(): Promise<Sprint[]> {
  const sprints: Sprint[] = [];
  for (const board of config.jira.boards) {
    const list = await jira<any>(`/rest/agile/1.0/board/${board.id}/sprint?state=closed,active&maxResults=50`);
    const recent = (list.values as any[])
      .filter((s) => s.startDate)
      .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
      .slice(0, config.jira.history);
    for (const s of recent) {
      sprints.push({
        id: s.id,
        name: s.name,
        board: board.name,
        goal: s.goal ?? null,
        start: s.startDate,
        end: s.completeDate ?? s.endDate,
        state: s.state,
        issues: await sprintIssues(s.id, board.name),
      });
    }
  }
  return sprints;
}
