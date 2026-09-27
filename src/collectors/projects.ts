import { config } from '../config.js';
import { canonical } from '../identity.js';
import { searchAll, jqlString, statusCategoryOf, projectKeyFor } from './jiraSearch.js';
import type { ProjectSnapshot, Sprint, WorkItem } from '../types.js';

// Every work item in each team's Jira project created or resolved in the last JIRA_DAYS, sprint or not.
// Bug metrics and ticket hygiene need the tickets that never went near a sprint as much as the ones that did.
const DAY = 86_400_000;

export async function collectProjects(): Promise<ProjectSnapshot[]> {
  const until = new Date(), since = new Date(until.getTime() - config.jira.days * DAY);
  const { pointsField, epicField, sprintField } = config.jira;
  const out: ProjectSnapshot[] = [];
  for (const b of config.jira.boards) {
    const project = projectKeyFor(b.name);
    const rows = await searchAll(
      `project = ${jqlString(project)} AND issuetype != Epic AND (created >= -${config.jira.days}d OR resolved >= -${config.jira.days}d)`,
      ['issuetype', 'status', 'priority', 'reporter', 'assignee', 'created', 'resolutiondate', 'parent', pointsField, epicField, sprintField]);
    const items: WorkItem[] = rows.map((r) => {
      const f = r.fields ?? {};
      const parentIsEpic = f.parent?.fields?.issuetype?.hierarchyLevel === 1 || f.parent?.fields?.issuetype?.name === 'Epic';
      const sprints = f[sprintField];
      return {
        key: r.key, type: f.issuetype?.name ?? 'Task', status: f.status?.name ?? '', statusCategory: statusCategoryOf(f.status?.statusCategory?.key),
        priority: f.priority?.name ?? null, reporter: canonical(f.reporter?.displayName), assignee: canonical(f.assignee?.displayName),
        created: f.created, resolved: f.resolutiondate ?? null,
        points: typeof f[pointsField] === 'number' ? f[pointsField] : null,
        epic: f[epicField] ?? (parentIsEpic ? f.parent.key : null),
        inSprint: Array.isArray(sprints) ? sprints.length > 0 : !!sprints,
      };
    });
    out.push({ board: b.name, project, since: since.toISOString(), until: until.toISOString(), items });
  }
  return out;
}

// Demo: the sprint tickets, plus work that never entered a sprint (support, bugs filed and fixed on the side),
// with priorities and reporters, so every quality and hygiene metric has something to measure.
export function demoProjects(sprints: Sprint[]): ProjectSnapshot[] {
  const until = Date.now(), since = until - 90 * DAY;
  const boards = [...new Set(sprints.map((s) => s.board))];
  return boards.map((board, bi) => {
    let s = 17 + bi; const r = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const weak = board === 'OSSI';
    const seen = new Map<string, WorkItem>();
    for (const sp of sprints.filter((x) => x.board === board)) for (const i of sp.issues) {
      seen.set(i.key, {
        key: i.key, type: i.type, status: i.status, statusCategory: i.statusCategory,
        priority: i.type === 'Bug' ? (r() < (weak ? 0.25 : 0.08) ? 'Highest' : r() < 0.5 ? 'High' : 'Medium') : 'Medium',
        reporter: i.type === 'Bug' ? (r() < 0.3 ? 'Support' : r() < 0.5 ? 'QA' : i.assignee) : i.assignee,
        assignee: i.assignee, created: i.created, resolved: i.resolved, points: i.points, epic: i.epic ?? null, inSprint: true,
      });
    }
    const people = [...new Set([...seen.values()].map((x) => x.assignee).filter((x): x is string => !!x))];
    for (let n = 0; n < (weak ? 40 : 18); n++) {
      const created = since + r() * 88 * DAY, done = r() < (weak ? 0.55 : 0.85), bug = r() < (weak ? 0.6 : 0.4);
      seen.set(`${board}-${9000 + n}`, {
        key: `${board}-${9000 + n}`, type: bug ? 'Bug' : 'Task', status: done ? 'Done' : 'To Do', statusCategory: done ? 'done' : 'todo',
        priority: bug && r() < (weak ? 0.3 : 0.1) ? 'Highest' : bug ? 'High' : 'Low',
        reporter: bug ? (r() < 0.5 ? 'Support' : 'QA') : people[n % people.length] ?? null, assignee: people[(n + 1) % people.length] ?? null,
        created: new Date(created).toISOString(), resolved: done ? new Date(created + (1 + r() * (weak ? 25 : 8)) * DAY).toISOString() : null,
        points: r() < (weak ? 0.5 : 0.85) ? [1, 2, 3][Math.floor(r() * 3)] : null,
        epic: !bug && r() < (weak ? 0.3 : 0.7) ? `${board}-E${1 + Math.floor(r() * 6)}` : null, inSprint: false,
      });
    }
    return { board, project: board, since: new Date(since).toISOString(), until: new Date(until).toISOString(), items: [...seen.values()] };
  });
}
