import { config } from './config.js';
import { store } from './store/index.js';
import { median, doneInSprint } from './cycle.js';
import type { Epic, GithubSnapshot, PullRequest, Sprint, WorkItem } from './types.js';
import { hoursExcludingWeekends, weekOf } from './time.js';

// Quality, Predictability and Efficiency: every measure with the counts behind it, its target and whether it is met.
// One set of functions feeds the dashboard headline, the summary pages and the detailed reports, so they always agree.
// Definitions are in METRICS.md; each measure also carries them for "What is this?".

const DAY = 86_400_000;
export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];

export interface Target { op: '<' | '>'; value: number }
export interface Measure {
  previous?: number | null; trend?: 'better' | 'worse' | 'same' | null; previousMet?: boolean | null; // from withPrevious
  id: string; title: string;
  value: number | null;          // null when there is nothing to measure (0 of 0 is not 0%)
  unit: '%' | 'days' | 'hours' | 'count';
  num: number | null; den: number | null; numLabel?: string; denLabel?: string;  // the counts behind a rate
  target: Target | null; met: boolean | null;
  how: string;                   // the exact definition, as shown to people
  failing?: string[];            // items that did not pass (tickets, PRs, commits), for drill-down
  smallSample?: boolean;         // too few items to trust the value: under 10 for a rate, under 5 for a median
  note?: string;                 // what was left out and why
}
export const MIN_RATE_SAMPLE = 10, MIN_MEDIAN_SAMPLE = 5;

// Targets from the reference dashboards. One place, so every page shows the same target.
export const TARGETS: Record<string, Target> = {
  change_failure_rate: { op: '<', value: 10 }, rework_rate: { op: '<', value: 30 },
  pr_review_rate: { op: '>', value: 95 }, pr_review_comment_rate: { op: '>', value: 50 },
  time_to_restore: { op: '<', value: 24 }, bug_lead_time: { op: '<', value: 14 },
  bug_fix_find: { op: '>', value: 80 }, bug_workload: { op: '<', value: 20 }, revert_ratio: { op: '<', value: 5 },
  sprint_completion: { op: '>', value: 80 }, scope_added: { op: '<', value: 15 }, unplanned_work: { op: '<', value: 20 }, defect_leakage: { op: '<', value: 20 },
  use_of_branches: { op: '>', value: 95 }, merged_with_pr: { op: '>', value: 95 }, prs_traceable: { op: '>', value: 90 },
  tickets_estimated: { op: '>', value: 90 }, tickets_in_sprint: { op: '>', value: 80 }, tickets_in_epic: { op: '>', value: 80 }, epics_with_due_date: { op: '>', value: 80 },
  pr_lead_time: { op: '<', value: 2.5 }, pr_cycle_hours: { op: '<', value: 60 }, pickup_time: { op: '<', value: 1 }, review_time: { op: '<', value: 1.5 }, cycle_time: { op: '<', value: 5 }, pr_size: { op: '<', value: 400 },
};

const round1 = (x: number) => Math.round(x * 10) / 10;
const metTarget = (v: number | null, t: Target | null) => (v == null || !t ? null : t.op === '<' ? v < t.value : v > t.value);
const rate = (id: string, title: string, num: number, den: number, how: string, labels: [string, string], failing?: string[]): Measure => {
  const value = den ? round1((100 * num) / den) : null, target = TARGETS[id] ?? null;
  return { id, title, value, unit: '%', num, den, numLabel: labels[0], denLabel: labels[1], target, met: metTarget(value, target), how, failing, smallSample: den > 0 && den < MIN_RATE_SAMPLE };
};
const med = (id: string, title: string, xs: number[], unit: 'days' | 'hours', how: string, denLabel: string): Measure => {
  const value = xs.length ? round1(median(xs)) : null, target = TARGETS[id] ?? null;
  return { id, title, value, unit, num: null, den: xs.length, denLabel, target, met: metTarget(value, target), how, smallSample: xs.length > 0 && xs.length < MIN_MEDIAN_SAMPLE };
};

// Everything one slice needs: one team or all, over [from, to).
export interface Slice {
  from: number; to: number; boards: string[];
  prs: PullRequest[]; deploys: GithubSnapshot['deploys']; mainCommits: NonNullable<GithubSnapshot['mainCommits']>;
  items: WorkItem[]; epics: Epic[]; sprints: Sprint[];
  incidents: { firedAt: string; resolvedAt: string | null }[];
  projectKeys: string[];
  defaultBranches: Record<string, string>;
}

export function slice(team: string, days: Period, now = Date.now()): Slice {
  const boards = team === 'all' ? [...new Set(store.scorecards().map((c) => c.board))] : [team];
  const gh = store.github().filter((g) => boards.includes(g.board));
  return {
    from: now - days * DAY, to: now, boards,
    prs: gh.flatMap((g) => g.prs), deploys: gh.flatMap((g) => g.deploys), mainCommits: gh.flatMap((g) => g.mainCommits ?? []),
    items: store.projects().filter((p) => boards.includes(p.board)).flatMap((p) => p.items),
    epics: boards.flatMap((b) => store.epics()[b] ?? []),
    sprints: store.sprints().filter((s) => boards.includes(s.board)),
    incidents: store.azure().filter((a) => boards.includes(a.board)).flatMap((a) => a.ops?.incidents ?? []),
    projectKeys: store.projects().filter((p) => boards.includes(p.board)).map((p) => p.project),
    defaultBranches: Object.assign({}, ...gh.map((g) => g.defaultBranches ?? {})),
  };
}

const inWin = (s: Slice, iso: string | null | undefined) => { if (!iso) return false; const t = Date.parse(iso); return t >= s.from && t < s.to; };
const ref = (p: PullRequest) => `${p.repo.split('/')[1]}#${p.number}`;
const isBug = (i: WorkItem) => /^bug$/i.test(i.type);
const isSub = (i: WorkItem) => /sub-?task/i.test(i.type);
const significant = (i: WorkItem) => !!i.priority && config.jira.significant.includes(i.priority.toLowerCase());
// Merged into the repo's default branch in the window, drafts excluded. When either branch is unknown (data collected
// before Houston recorded them) the PR counts, as it did before.
const mergedPrs = (s: Slice) => s.prs.filter((p) => p.mergedAt && !p.draft && inWin(s, p.mergedAt)
  && (!p.baseBranch || !s.defaultBranches[p.repo] || p.baseBranch === s.defaultBranches[p.repo]));

// ---------- Quality ----------
export function quality(s: Slice) {
  const merged = mergedPrs(s);
  const deploysOk = s.deploys.filter((d) => d.success && inWin(s, d.at));
  const bugsCreated = s.items.filter((i) => isBug(i) && inWin(s, i.created));
  const bugsResolved = s.items.filter((i) => isBug(i) && inWin(s, i.resolved));
  const resolved = s.items.filter((i) => !isSub(i) && inWin(s, i.resolved));
  const source = (process.env.CFR_SOURCE ?? 'hotfix').toLowerCase();

  // Change failure rate, by the configured definition.
  let cfr: Measure;
  if (source === 'bugs') {
    const failures = bugsCreated.filter(significant), per = deploysOk.length ? deploysOk.length : merged.length;
    cfr = rate('change_failure_rate', 'Change failure rate', failures.length, per,
      `Significant bugs created (priority ${config.jira.significant.join(', ')}) ÷ ${deploysOk.length ? 'successful production deploys' : 'PRs merged to the default branch'}, in the period.`,
      ['significant bugs', deploysOk.length ? 'deploys' : 'merged PRs'], failures.map((i) => i.key));
  } else {
    const failedDeploys = s.deploys.filter((d) => !d.success && inWin(s, d.at)), hot = merged.filter((p) => p.isHotfix);
    cfr = rate('change_failure_rate', 'Change failure rate', hot.length + failedDeploys.length, merged.length + failedDeploys.length,
      '(Hotfix or revert PRs + failed deploys) ÷ (merged PRs + failed deploys), in the period. A hotfix has "hotfix" or "revert" in its title or branch.',
      ['hotfixes and failed deploys', 'merged PRs and failed deploys'], hot.map(ref));
  }
  const reviewed = merged.filter((p) => p.reviewCount > 0);
  const commented = merged.filter((p) => (p.reviewComments ?? 0) > 0);
  const restore = s.incidents.filter((i) => inWin(s, i.firedAt) && i.resolvedAt).map((i) => (Date.parse(i.resolvedAt!) - Date.parse(i.firedAt)) / 3_600_000);
  const reverts = merged.filter((p) => p.isRevert);
  // Defect leakage: production bugs ÷ (bugs caught before release + production bugs). A bug is production if a
  // production label (or the environment field) says so; caught before release if a QA/staging label does.
  // Bugs with neither are left out and counted in the note, never guessed.
  const envOf = (i: WorkItem) => {
    const tags = [...(i.labels ?? []), ...(i.env ? [String(i.env).toLowerCase()] : [])];
    return tags.some((l) => config.bugs.prodLabels.includes(l)) ? 'prod' : tags.some((l) => config.bugs.qaLabels.includes(l)) ? 'qa' : null;
  };
  const prodBugs = bugsCreated.filter((i) => envOf(i) === 'prod'), qaBugs = bugsCreated.filter((i) => envOf(i) === 'qa');
  const unlabelled = bugsCreated.length - prodBugs.length - qaBugs.length;
  const leakage = rate('defect_leakage', 'Defect leakage', prodBugs.length, prodBugs.length + qaBugs.length,
    `Bugs created in the period found in production ÷ bugs found in production or before release (labels ${config.bugs.prodLabels.join('/')} vs ${config.bugs.qaLabels.join('/')}${config.bugs.envField ? ', or the environment field' : ''}).`,
    ['found in production', 'labelled bugs'], prodBugs.map((i) => i.key));
  if (unlabelled) leakage.note = `${unlabelled} of ${bugsCreated.length} bugs had no environment label and are not counted.`;
  // Escaped bugs by week: significant bugs found in production (or any significant bug if unlabelled), and incidents.
  const weeks = new Map<string, { significantBugs: number; incidents: number }>();
  for (let t = s.from; t < s.to; t += 7 * DAY) weeks.set(weekOf(new Date(t).toISOString(), config.tzOffset), { significantBugs: 0, incidents: 0 });
  for (const i of bugsCreated.filter((b) => significant(b) && envOf(b) !== 'qa')) { const w = weeks.get(weekOf(i.created, config.tzOffset)); if (w) w.significantBugs++; }
  for (const i of s.incidents.filter((x) => inWin(s, x.firedAt))) { const w = weeks.get(weekOf(i.firedAt, config.tzOffset)); if (w) w.incidents++; }
  return {
    groups: [
      { id: 'bug_creation', title: 'Bug creation', question: 'How many bugs are being created, and by how much change?', measures: [
        cfr,
        rate('rework_rate', 'Rework rate', bugsCreated.length, merged.length, 'Bugs created ÷ PRs merged to the default branch, in the period. All priorities.', ['bugs created', 'merged PRs'], bugsCreated.map((i) => i.key)),
      ] },
      { id: 'bug_escape', title: 'Bugs reaching customers', question: 'How many bugs get past us into production?', measures: [leakage],
        trend: [...weeks.entries()].map(([week, v]) => ({ week, ...v })) },
      { id: 'bug_prevention', title: 'Bug prevention', question: 'Do our processes stop bugs getting in?', measures: [
        rate('pr_review_rate', 'PR review rate', reviewed.length, merged.length, 'Merged PRs with at least one review by someone other than the author ÷ merged PRs.', ['reviewed', 'merged PRs'], merged.filter((p) => p.reviewCount === 0).map(ref)),
        rate('pr_review_comment_rate', 'PR review comment rate', commented.length, merged.length, 'Merged PRs with at least one review comment, or a review with a written body, by someone other than the author ÷ merged PRs.', ['with review comments', 'merged PRs'], merged.filter((p) => !(p.reviewComments ?? 0)).map(ref)),
      ] },
      { id: 'bug_resolution', title: 'Bug resolution', question: 'How quickly do we fix what matters?', measures: [
        med('time_to_restore', 'Time to restore (median)', restore, 'hours', 'Median hours from alert fired to alert resolved, Sev0 to Sev2 incidents fired in the period (Azure Monitor).', 'resolved incidents'),
        med('bug_lead_time', 'Bug lead time (median)', bugsResolved.map((i) => (Date.parse(i.resolved!) - Date.parse(i.created)) / DAY), 'days', 'Median days from bug created to resolved, bugs resolved in the period.', 'bugs resolved'),
      ] },
      { id: 'bug_workload', title: 'Bug workload', question: 'How much of our capacity goes on bugs?', measures: [
        rate('bug_fix_find', 'Bug fix vs find rate', bugsResolved.length, bugsCreated.length, 'Bugs resolved in the period ÷ bugs created in the period. Above 100% means the backlog of bugs is shrinking.', ['resolved', 'created']),
        rate('bug_workload', 'Bug workload', bugsResolved.length, resolved.length, 'Bugs resolved ÷ all work items resolved (sub-tasks excluded), in the period. By count, not points.', ['bugs resolved', 'items resolved']),
      ] },
      { id: 'code_churn', title: 'Code churn', question: 'How much change is being undone?', measures: [
        rate('revert_ratio', 'Code revert ratio', reverts.length, merged.length, 'Merged revert PRs (GitHub\'s revert button: title "Revert …" or branch revert-N-…) ÷ merged PRs.', ['reverts', 'merged PRs'], reverts.map(ref)),
      ], note: '14-day churn is not shown: measuring lines rewritten within 14 days needs line-level history that the GitHub API does not provide.' },
    ],
  };
}

// ---------- Predictability ----------
export function predictability(s: Slice) {
  const closedSprints = s.sprints.filter((sp) => sp.state === 'closed' && inWin(s, sp.end));
  const completion = closedSprints.flatMap((sp) => {
    const committed = sp.issues.filter((i) => i.type !== 'Sub-task' && i.points != null && (!i.addedToSprintAt || i.addedToSprintAt <= sp.start));
    const planned = committed.reduce((t, i) => t + i.points!, 0), done = committed.filter((i) => doneInSprint(i, sp)).reduce((t, i) => t + i.points!, 0);
    return planned ? [{ sprint: sp.name, board: sp.board, planned, done, pct: (100 * done) / planned }] : [];
  });
  const added = closedSprints.flatMap((sp) => sp.issues.filter((i) => i.type !== 'Sub-task'));
  const addedLate = closedSprints.flatMap((sp) => sp.issues.filter((i) => i.type !== 'Sub-task' && i.addedToSprintAt && i.addedToSprintAt > sp.start));
  const plannedSum = completion.reduce((t, c) => t + c.planned, 0), doneSum = completion.reduce((t, c) => t + c.done, 0);
  // Unplanned work: of the points finished in these sprints, how many were on tickets created after the sprint started.
  const finished = closedSprints.flatMap((sp) => sp.issues.filter((i) => i.type !== 'Sub-task' && i.points != null && doneInSprint(i, sp)).map((i) => ({ i, sp })));
  const unplanned = finished.filter(({ i, sp }) => i.created > sp.start);
  const unestimatedDone = closedSprints.flatMap((sp) => sp.issues.filter((i) => i.type !== 'Sub-task' && i.points == null && doneInSprint(i, sp))).length;

  // Code traceability
  const commits = s.mainCommits.filter((c) => inWin(s, c.at));
  const nonMerge = commits.filter((c) => !c.merge), plainMerges = commits.filter((c) => c.merge && !c.viaPr);
  const merged = mergedPrs(s);
  const keys = new Set(s.projectKeys);
  // A ticket reference counts only if it names one of the team's Jira projects: "UTF-8" in a title is not a ticket.
  const traceable = merged.filter((p) => p.jiraKeys.some((k) => !keys.size || keys.has(k.split('-')[0])));
  // Ticket hygiene, on work items closed in the period (sub-tasks inherit from their parent, so excluded).
  const closed = s.items.filter((i) => !isSub(i) && i.statusCategory === 'done' && inWin(s, i.resolved));
  const closedEpics = s.epics.filter((e) => e.statusCategory === 'done' && inWin(s, e.resolved));
  const pass = (xs: WorkItem[], ok: (i: WorkItem) => boolean) => ({ n: xs.filter(ok).length, fail: xs.filter((i) => !ok(i)).map((i) => i.key) });
  const est = pass(closed, (i) => i.points != null), spr = pass(closed, (i) => i.inSprint), epi = pass(closed.filter((i) => !isBug(i)), (i) => !!i.epic);
  const nonBugClosed = closed.filter((i) => !isBug(i)).length;
  return {
    groups: [
      { id: 'delivery', title: 'Delivery against plan', question: 'Does the team deliver what it commits to?', measures: [
        rate('sprint_completion', 'Sprint completion', doneSum, plannedSum, 'Committed story points done ÷ committed story points, over sprints that closed in the period. Committed = estimated items in the sprint before it started.', ['points done', 'points committed']),
        (() => { const m = rate('unplanned_work', 'Unplanned work', unplanned.reduce((t, x) => t + x.i.points!, 0), finished.reduce((t, x) => t + x.i.points!, 0),
          'Story points finished on tickets created after their sprint started ÷ story points finished, sprints that closed in the period. Pulling in an existing ticket is scope change; a ticket that did not exist at planning is unplanned work.',
          ['points unplanned', 'points finished'], unplanned.map((x) => x.i.key));
          if (unestimatedDone) m.note = `${unestimatedDone} finished tickets had no estimate and are not counted.`; return m; })(),
        rate('scope_added', 'Scope added mid-sprint', addedLate.length, added.length, 'Items added after the sprint started ÷ items in the sprint, sprints that closed in the period.', ['added late', 'items'], addedLate.map((i) => i.key)),
      ], detail: completion.map((c) => ({ ...c, pct: round1(c.pct) })) },
      { id: 'traceability', title: 'Code traceability', question: 'Is all work visible as tickets and pull requests?', measures: [
        rate('use_of_branches', 'Use of branches', nonMerge.filter((c) => c.viaPr).length, nonMerge.length, 'Non-merge commits on the default branch that arrived through a merged PR ÷ all non-merge commits on the default branch, in the period. GitHub links each commit to its PR, whatever the merge strategy.', ['via a PR', 'commits'], nonMerge.filter((c) => !c.viaPr).map((c) => `${c.repo.split('/')[1]}@${c.sha.slice(0, 7)}`)),
        rate('merged_with_pr', 'Merged branches with PR', merged.length, merged.length + plainMerges.length, 'PRs merged to the default branch ÷ (those PRs + plain git merges on the default branch with no PR), in the period.', ['PR merges', 'all merges'], plainMerges.map((c) => `${c.repo.split('/')[1]}@${c.sha.slice(0, 7)}`)),
        rate('prs_traceable', 'PRs traceable to a ticket', traceable.length, merged.length, `Merged PRs whose title, branch or body contains a ticket key of the team's Jira project${keys.size ? ` (${[...keys].join(', ')})` : ''} ÷ merged PRs.`, ['with a ticket', 'merged PRs'], merged.filter((p) => !traceable.includes(p)).map(ref)),
      ] },
      { id: 'hygiene', title: 'Ticket hygiene', question: 'Are tickets set up so plans can be trusted?', measures: [
        rate('tickets_estimated', 'Estimates on tickets', est.n, closed.length, 'Work items closed in the period that have story points ÷ work items closed (sub-tasks excluded).', ['estimated', 'closed'], est.fail),
        rate('tickets_in_sprint', 'Tickets in sprints', spr.n, closed.length, 'Work items closed in the period that were ever in a sprint ÷ work items closed (sub-tasks excluded).', ['in a sprint', 'closed'], spr.fail),
        rate('tickets_in_epic', 'Tickets in epics', epi.n, nonBugClosed, 'Work items closed in the period that belong to an epic ÷ work items closed (sub-tasks and bugs excluded: bugs are often not feature work).', ['in an epic', 'closed'], epi.fail),
        rate('epics_with_due_date', 'Due dates on epics', closedEpics.filter((e) => !!e.due).length, closedEpics.length, 'Epics closed in the period that had a due date ÷ epics closed.', ['with a due date', 'epics closed'], closedEpics.filter((e) => !e.due).map((e) => e.key)),
      ] },
    ],
  };
}

// ---------- Efficiency ----------
export function efficiency(s: Slice) {
  const merged = mergedPrs(s);
  const hrs = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3_600_000;
  const cyc = s.sprints.flatMap((sp) => sp.issues).filter((i) => i.statusCategory === 'done' && i.inProgressSince && inWin(s, i.resolved));
  const uniq = [...new Map(cyc.map((i) => [i.key, i])).values()];
  return {
    groups: [
      { id: 'pr_flow', title: 'Pull request flow', question: 'How fast does a change get from opened to merged?', measures: [
        med('pr_lead_time', 'PR lead time (median)', merged.map((p) => hrs(p.createdAt, p.mergedAt!) / 24), 'days', 'Median days from PR opened to merged, PRs merged in the period.', 'merged PRs'),
        med('pr_cycle_hours', 'PR cycle time, weekends excluded (median)', merged.map((p) => hoursExcludingWeekends(p.createdAt, p.mergedAt!, config.weekend, config.tzOffset)), 'hours',
          `Median hours from PR opened to merged, leaving out weekend days (${config.weekend.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}, UTC${config.tzOffset >= 0 ? '+' : ''}${config.tzOffset}). PRs merged in the period.`, 'merged PRs'),
        med('pickup_time', 'Time to first review (median)', merged.filter((p) => p.firstReviewAt).map((p) => hrs(p.createdAt, p.firstReviewAt!) / 24), 'days', 'Median days from PR opened to the first review or review comment by someone else, PRs merged in the period.', 'reviewed PRs'),
        med('review_time', 'Review to merge (median)', merged.filter((p) => p.firstReviewAt).map((p) => hrs(p.firstReviewAt!, p.mergedAt!) / 24), 'days', 'Median days from first review to merge, PRs merged in the period.', 'reviewed PRs'),
        (() => { const xs = merged.map((p) => p.additions + p.deletions); const v = xs.length ? Math.round(median(xs)) : null; return { id: 'pr_size', title: 'PR size (median)', value: v, unit: 'count' as const, num: null, den: xs.length, denLabel: 'merged PRs', target: TARGETS.pr_size, met: metTarget(v, TARGETS.pr_size), how: 'Median lines changed (additions + deletions) per PR merged in the period.', smallSample: xs.length > 0 && xs.length < MIN_MEDIAN_SAMPLE }; })(),
      ] },
      { id: 'ticket_flow', title: 'Ticket flow', question: 'Once work starts, how long until it is done?', measures: [
        med('cycle_time', 'Cycle time (median)', uniq.map((i) => (Date.parse(i.resolved!) - Date.parse(i.inProgressSince!)) / DAY), 'days', 'Median days from moving to In Progress to resolved, sprint tickets resolved in the period.', 'tickets'),
      ] },
    ],
  };
}

// ---------- Activity ----------
export function activitySummary(s: Slice) {
  const people = new Set<string>();
  for (const i of s.items) if (i.assignee && (inWin(s, i.resolved) || inWin(s, i.created))) people.add(i.assignee);
  for (const p of s.prs) {
    if (inWin(s, p.createdAt) || inWin(s, p.mergedAt)) people.add(p.author);
    if (inWin(s, p.mergedAt)) p.reviewers.forEach((r) => people.add(r));
  }
  people.delete('unknown');
  return {
    activePeople: people.size,
    commits: s.mainCommits.filter((c) => inWin(s, c.at)).length,
    mergedPrs: mergedPrs(s).length,
    ticketsCompleted: s.items.filter((i) => !isSub(i) && i.statusCategory === 'done' && inWin(s, i.resolved)).length,
  };
}

// ---------- Per-team table for a report ----------
export function perTeam<T>(team: string, days: Period, fn: (s: Slice) => T, now = Date.now()) {
  const boards = team === 'all' ? [...new Set(store.scorecards().map((c) => c.board))].sort((a, b) => a.localeCompare(b)) : [team];
  return boards.map((b) => ({ board: b, ...fn(slice(b, days, now)) }));
}

export const flatMeasures = (r: { groups: { measures: Measure[] }[] }) => r.groups.flatMap((g) => g.measures);

// The same report for the period before, so every measure can say whether it got better. A previous value is given
// only when the collected data reaches back that far (Jira JIRA_DAYS, GitHub GITHUB_DAYS); otherwise null.
export function withPrevious<T extends { groups: { measures: Measure[] }[] }>(team: string, days: Period, fn: (s: Slice) => T, now = Date.now()): T {
  const cur = fn(slice(team, days, now));
  const boards = team === 'all' ? [...new Set(store.scorecards().map((c) => c.board))] : [team];
  const starts = [...store.github().filter((g) => boards.includes(g.board)).map((g) => Date.parse(g.since)),
    ...store.projects().filter((p) => boards.includes(p.board)).map((p) => Date.parse(p.since))];
  const covered = starts.length > 0 && now - 2 * days * DAY >= Math.max(...starts) - DAY;
  const prev = covered ? flatMeasures(fn(slice(team, days, now - days * DAY))) : [];
  for (const m of flatMeasures(cur)) {
    const p = prev.find((x) => x.id === m.id);
    (m as Measure & { previous?: number | null; trend?: string | null }).previous = p?.value ?? null;
    (m as Measure & { trend?: string | null }).trend = p?.value == null || m.value == null || !m.target ? null
      : m.value === p.value ? 'same' : (m.target.op === '<' ? m.value < p.value : m.value > p.value) ? 'better' : 'worse';
    (m as Measure & { previousMet?: boolean | null }).previousMet = p?.met ?? null;
  }
  return cur;
}
