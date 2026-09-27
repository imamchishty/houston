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

// From the changelog: when the issue entered this sprint, and when it last moved into In Progress.
function fromChangelog(changelog: any, sprintId: number) {
  let addedToSprintAt: string | null = null;
  let inProgressSince: string | null = null;
  for (const h of changelog?.histories ?? []) {
    for (const it of h.items ?? []) {
      if (it.field === 'Sprint' && String(it.to ?? '').split(',').map((x: string) => x.trim()).includes(String(sprintId))) {
        if (!addedToSprintAt || h.created < addedToSprintAt) addedToSprintAt = h.created;
      }
      if (it.field === 'status' && /in progress/i.test(it.toString ?? '')) {
        inProgressSince = h.created;
      }
    }
  }
  return { addedToSprintAt, inProgressSince };
}

async function sprintIssues(sprintId: number, boardName: string): Promise<Issue[]> {
  const out: Issue[] = [];
  let startAt = 0;
  const fields = ['summary', 'issuetype', 'status', 'assignee', 'created', 'resolutiondate', 'description',
    config.jira.pointsField, 'parent', config.jira.epicField, ...(config.jira.acField ? [config.jira.acField] : [])].join(',');
  for (;;) {
    const page = await jira<any>(`/rest/agile/1.0/sprint/${sprintId}/issue?startAt=${startAt}&maxResults=100&expand=changelog&fields=${fields}`);
    for (const r of page.issues) {
      const f = r.fields;
      const cl = fromChangelog(r.changelog, sprintId);
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
