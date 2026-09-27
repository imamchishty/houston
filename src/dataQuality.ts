import { config } from './config.js';
import { store } from './store/index.js';

// Checks on the collected data for the ways a correct formula still gives a wrong number: a field id that points
// at nothing, a workflow name that matches no runs, bots doing the reviewing, statuses Houston cannot classify.
// Run by `npm run check` after a collect, and served at /api/data-quality.
export interface DataCheck { area: string; check: string; status: 'ok' | 'warn' | 'fail'; detail: string; affects: string[] }

const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);

export function dataQuality(): DataCheck[] {
  const out: DataCheck[] = [];
  const add = (area: string, check: string, status: DataCheck['status'], detail: string, affects: string[]) => out.push({ area, check, status, detail, affects });

  for (const p of store.projects()) {
    const items = p.items.filter((i) => !/sub-?task/i.test(i.type));
    const t = `Jira ${p.project}`;
    if (!items.length) { add(t, 'Work items collected', 'fail', `No work items created or resolved in ${config.jira.days} days. Check JIRA_PROJECTS (project key per board).`, ['all Jira measures']); continue; }
    add(t, 'Work items collected', 'ok', `${items.length} work items in ${config.jira.days} days.`, []);
    const est = pct(items.filter((i) => i.points != null).length, items.length);
    add(t, 'Story points field', est === 0 ? 'fail' : 'ok', est === 0 ? `No item has story points. JIRA_POINTS_FIELD (${config.jira.pointsField}) is probably not this site's field.` : `${est}% of items have story points.`, ['estimates on tickets', 'sprint completion', 'velocity', 'burndown', 'feature cost']);
    const spr = pct(items.filter((i) => i.inSprint).length, items.length);
    add(t, 'Sprint field', spr === 0 ? 'fail' : 'ok', spr === 0 ? `No item is in any sprint. JIRA_SPRINT_FIELD (${config.jira.sprintField}) is probably wrong.` : `${spr}% of items were in a sprint.`, ['tickets in sprints']);
    const epi = pct(items.filter((i) => i.epic).length, items.length);
    add(t, 'Epic link', epi === 0 ? 'warn' : 'ok', epi === 0 ? `No item belongs to an epic. Check JIRA_EPIC_FIELD (${config.jira.epicField}), or the team does not use epics.` : `${epi}% of items belong to an epic.`, ['tickets in epics', 'feature cost']);
    const bugs = items.filter((i) => /^bug$/i.test(i.type)).length;
    add(t, 'Bug issue type', bugs === 0 ? 'warn' : 'ok', bugs === 0 ? 'No items of type Bug. If bugs are filed under another type, bug measures read as zero.' : `${bugs} bugs.`, ['rework rate', 'bug lead time', 'bug fix vs find', 'bug workload']);
    const prios = new Set(items.filter((i) => /^bug$/i.test(i.type)).map((i) => (i.priority ?? '').toLowerCase()).filter(Boolean));
    const sig = config.jira.significant.filter((x) => prios.has(x));
    if ((process.env.CFR_SOURCE ?? 'hotfix') === 'bugs')
      add(t, 'Significant priorities', sig.length ? 'ok' : 'fail', sig.length ? `Significant: ${sig.join(', ')}.` : `None of JIRA_SIGNIFICANT_PRIORITIES (${config.jira.significant.join(', ')}) appear on bugs; seen: ${[...prios].join(', ') || 'none'}.`, ['change failure rate (bugs)']);
  }

  for (const b of [...new Set(store.sprints().map((s) => s.board))]) {
    const done = store.sprints().filter((s) => s.board === b).flatMap((s) => s.issues).filter((i) => i.statusCategory === 'done' && i.type !== 'Sub-task');
    const started = pct(done.filter((i) => i.inProgressSince).length, done.length);
    add(`Jira board ${b}`, 'Work start recorded', started < 50 ? 'warn' : 'ok', started < 50 ? `Only ${started}% of done tickets passed through an "in progress" status. Tickets moved straight to Done have no cycle time.` : `${started}% of done tickets have a start.`, ['cycle time', 'stuck in progress', 'tickets over the size norm']);
  }

  for (const g of store.github()) {
    const t = `GitHub ${g.board}`;
    const merged = g.prs.filter((p) => p.mergedAt && !p.draft);
    add(t, 'Pull requests collected', merged.length ? 'ok' : 'fail', merged.length ? `${merged.length} merged PRs in ${config.github.days} days.` : 'No merged PRs. Check GITHUB_REPOS and the token\'s access.', ['all GitHub measures']);
    const okDeploys = g.deploys.filter((d) => d.success).length;
    add(t, 'Deploy workflow', okDeploys ? 'ok' : 'fail', okDeploys ? `${okDeploys} successful runs of workflows matching "${config.github.deployWorkflow}".` : `No runs of a workflow whose name contains "${config.github.deployWorkflow}". Set GITHUB_DEPLOY_WORKFLOW.`, ['deployment frequency', 'lead time', 'change failure rate']);
    const repos = new Set(g.deploys.map((d) => d.repo)), without = g.repos.filter((r) => !repos.has(r));
    if (okDeploys && without.length) add(t, 'Deploys per repo', 'warn', `No deploys found for ${without.join(', ')}; their PRs' lead time uses the team's other deploys.`, ['lead time']);
    const human = merged.reduce((s, p) => s + p.reviewCount + (p.reviewComments ?? 0), 0), bots = merged.reduce((s, p) => s + (p.botReviews ?? 0), 0);
    const botShare = pct(bots, bots + human);
    add(t, 'Bot reviews left out', botShare > 30 ? 'warn' : 'ok', `${bots} bot reviews and comments left out (${botShare}% of all review activity).${botShare > 30 ? ' If a service account is not a bot, it is being ignored; if a bot is counted as a person, add it to GITHUB_BOTS.' : ''}`, ['PR review rate', 'review comment rate', 'time to first review']);
    const hot = merged.filter((p) => p.isHotfix).length;
    if ((process.env.CFR_SOURCE ?? 'hotfix') === 'hotfix')
      add(t, 'Hotfix naming', hot ? 'ok' : 'warn', hot ? `${hot} merged PRs marked hotfix or revert.` : 'No merged PR has "hotfix" or "revert" in its title or branch. If the team fixes production another way, change failure rate reads 0: consider CFR_SOURCE=bugs.', ['change failure rate']);
    const withBase = pct(merged.filter((p) => p.baseBranch).length, merged.length);
    add(t, 'Default branch known', g.mainCommits?.length ? 'ok' : 'warn', g.mainCommits?.length ? `${g.mainCommits.length} commits on the default branch, ${withBase}% of PRs with a known base branch.` : 'No default branch commits collected (data from before this version). Re-collect.', ['use of branches', 'merged with PR']);
  }

  for (const a of store.azure()) {
    const inc = a.ops?.incidents ?? [];
    if (!inc.length) continue;
    const open = pct(inc.filter((i) => !i.resolvedAt).length, inc.length);
    add(`Azure ${a.board}`, 'Incidents resolved', open > 20 ? 'warn' : 'ok', `${open}% of ${inc.length} alerts never resolved.${open > 20 ? ' Alerts that are never closed are left out of time to restore; set alerts to auto-resolve.' : ''}`, ['time to restore']);
  }
  return out;
}
