import { config } from './config.js';
import { store } from './store/index.js';
import { median, doneInSprint } from './cycle.js';
import type { Epic, GithubSnapshot, PullRequest, ScanCoverage, SecurityAlert, Sprint, SupportTicket, WorkItem } from './types.js';
import { addWorkingMinutes, durationMinutes, outsideWorkingHours, weekOf, workingMinutes } from './time.js';
import { flow } from './flow.js';
import { leadTimes } from './leadtime.js';

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
  change_failure_rate: { op: '<', value: 10 }, bugs_per_change: { op: '<', value: 30 },
  pr_review_rate: { op: '>', value: 95 },
  time_to_restore: { op: '<', value: 24 }, bug_lead_time: { op: '<', value: 14 },
  bug_fix_find: { op: '>', value: 80 }, bug_workload: { op: '<', value: 20 }, revert_ratio: { op: '<', value: 5 },
  deploy_frequency: { op: '>', value: 1 }, lead_time: { op: '<', value: 7 },
  sprint_completion: { op: '>', value: 80 }, scope_added: { op: '<', value: 15 }, unplanned_work: { op: '<', value: 20 }, defect_leakage: { op: '<', value: 20 }, qa_rejection: { op: '<', value: 15 }, flow_efficiency: { op: '>', value: 40 },
  use_of_branches: { op: '>', value: 95 }, merged_with_pr: { op: '>', value: 95 }, prs_traceable: { op: '>', value: 90 },
  tickets_estimated: { op: '>', value: 90 }, tickets_in_sprint: { op: '>', value: 80 }, tickets_in_epic: { op: '>', value: 80 },
  pr_cycle_hours: { op: '<', value: 60 }, new_code_coverage: { op: '>', value: 70 }, vulnerabilities: { op: '<', value: 1 }, test_pass_rate: { op: '>', value: 97 }, quality_gate_pass: { op: '>', value: 99 }, flow_time: { op: '<', value: 14 }, pickup_time: { op: '<', value: 1 }, review_time: { op: '<', value: 1.5 }, cycle_time: { op: '<', value: 5 }, pr_size: { op: '<', value: 400 }, reviewer_load: { op: '<', value: 40 }, ci_failure_rate: { op: '<', value: 10 },
  server_errors: { op: '<', value: 1 }, availability: { op: '>', value: 99.9 },
  security_on_time: { op: '>', value: 95 }, security_overdue: { op: '<', value: 1 }, secrets_open: { op: '<', value: 1 },
  support_share: { op: '<', value: 20 }, support_out_of_hours: { op: '<', value: 10 }, support_repeat: { op: '<', value: 20 },
  scan_dependency: { op: '>', value: 99 }, scan_secret: { op: '>', value: 99 }, scan_code: { op: '>', value: 99 },
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
  quality: import('./types.js').QualitySnapshot[];
  security: { alerts: SecurityAlert[]; coverage: Record<string, ScanCoverage> };
  support: SupportTicket[]; supportConnected: boolean;
  ci: GithubSnapshot['ci']; ops: { failedRate: number; availability: number | null; requests30d: number }[];
}

// Every team Houston has data for: Jira sprints, or teams set up in .env or the admin page.
export const allBoards = () => [...new Set([...store.sprints().map((s) => s.board), ...config.jira.boards.map((b) => b.name)])].sort((a, b) => a.localeCompare(b));

export const slice = (team: string, days: Period, now = Date.now()): Slice => sliceRange(team, now - days * DAY, now);

// Any exact range [from, to), for calendar months in the monthly report.
export function sliceRange(team: string, from: number, to: number): Slice {
  const boards = team === 'all' ? allBoards() : [team];
  const gh = store.github().filter((g) => boards.includes(g.board));
  return {
    from, to, boards,
    prs: gh.flatMap((g) => g.prs), deploys: gh.flatMap((g) => g.deploys), mainCommits: gh.flatMap((g) => g.mainCommits ?? []),
    items: store.projects().filter((p) => boards.includes(p.board)).flatMap((p) => p.items),
    epics: boards.flatMap((b) => store.epics()[b] ?? []),
    sprints: store.sprints().filter((s) => boards.includes(s.board)),
    incidents: store.azure().filter((a) => boards.includes(a.board)).flatMap((a) => a.ops?.incidents ?? []),
    projectKeys: store.projects().filter((p) => boards.includes(p.board)).map((p) => p.project),
    defaultBranches: Object.assign({}, ...gh.map((g) => g.defaultBranches ?? {})),
    quality: store.quality().filter((q) => boards.includes(q.board)),
    security: { alerts: gh.flatMap((g) => g.security?.alerts ?? []), coverage: Object.assign({}, ...gh.map((g) => g.security?.coverage ?? {})) },
    support: store.support().filter((x) => boards.includes(x.board)).flatMap((x) => x.tickets),
    supportConnected: store.support().some((x) => boards.includes(x.board)),
    ci: gh.flatMap((g) => g.ci), ops: store.azure().filter((a) => boards.includes(a.board) && a.ops).map((a) => ({ failedRate: a.ops!.failedRate, availability: a.ops!.availability ?? null, requests30d: a.ops!.requests30d })),
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
  const bugsCreated = s.items.filter((i) => isBug(i) && inWin(s, i.created));
  const bugsResolved = s.items.filter((i) => isBug(i) && inWin(s, i.resolved));
  const resolved = s.items.filter((i) => !isSub(i) && inWin(s, i.resolved));

  const reviewed = merged.filter((p) => p.reviewCount > 0);
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
      { id: 'bug_creation', title: 'Bugs created', question: 'How many bugs does each change bring?', measures: [
        rate('bugs_per_change', 'Bugs per change', bugsCreated.length, merged.length, 'Bugs created ÷ PRs merged to the default branch, in the period. All priorities.', ['bugs created', 'merged PRs'], bugsCreated.map((i) => i.key)),
      ] },
      { id: 'bug_escape', title: 'Bugs reaching customers', question: 'How many bugs get past us into production?', measures: [leakage],
        trend: [...weeks.entries()].map(([week, v]) => ({ week, ...v })) },
      { id: 'bug_prevention', title: 'Bug prevention', question: 'Do our processes stop bugs getting in?', measures: [
        rate('pr_review_rate', 'PR review rate', reviewed.length, merged.length, 'Merged PRs with at least one review by someone other than the author ÷ merged PRs.', ['reviewed', 'merged PRs'], merged.filter((p) => p.reviewCount === 0).map(ref)),
        (() => { const f = flow(s); return rate('qa_rejection', 'QA rejection rate', f.qa.rejected.length, f.qa.entered,
          `Tickets sent back from QA (${config.jira.qaStatuses.join(', ')}) to earlier work ÷ tickets that entered QA, in the period. Moving on to a queue such as Awaiting Deploy is not a rejection.`,
          ['sent back', 'entered QA'], f.qa.rejected); })(),
      ] },
      codeQuality(s),
      { id: 'bug_resolution', title: 'Bug fixing', question: 'How quickly are bugs fixed?', measures: [
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
export function planning(s: Slice) {
  const closedSprints = s.sprints.filter((sp) => sp.state === 'closed' && inWin(s, sp.end));
  const completion = closedSprints.flatMap((sp) => {
    const committed = sp.issues.filter((i) => i.type !== 'Sub-task' && i.points != null && (!i.addedToSprintAt || i.addedToSprintAt <= sp.start));
    const planned = committed.reduce((t, i) => t + i.points!, 0), done = committed.filter((i) => doneInSprint(i, sp)).reduce((t, i) => t + i.points!, 0);
    // Added after the start: points of items pulled in or created once the sprint had begun (scope creep).
    const added = sp.issues.filter((i) => i.type !== 'Sub-task' && i.points != null && i.addedToSprintAt && i.addedToSprintAt > sp.start).reduce((t, i) => t + i.points!, 0);
    return planned ? [{ sprint: sp.name, board: sp.board, end: sp.end.slice(0, 10), planned, done, added, pct: (100 * done) / planned }] : [];
  });
  const added = closedSprints.flatMap((sp) => sp.issues.filter((i) => i.type !== 'Sub-task'));
  const addedLate = closedSprints.flatMap((sp) => sp.issues.filter((i) => i.type !== 'Sub-task' && i.addedToSprintAt && i.addedToSprintAt > sp.start));
  const plannedSum = completion.reduce((t, c) => t + c.planned, 0), doneSum = completion.reduce((t, c) => t + c.done, 0);
  // Unplanned work: of the points finished in these sprints, how many were on tickets created after the sprint started.
  const finished = closedSprints.flatMap((sp) => sp.issues.filter((i) => i.type !== 'Sub-task' && i.points != null && doneInSprint(i, sp)).map((i) => ({ i, sp })));
  const unplanned = finished.filter(({ i, sp }) => i.created > sp.start);
  const unestimatedDone = closedSprints.flatMap((sp) => sp.issues.filter((i) => i.type !== 'Sub-task' && i.points == null && doneInSprint(i, sp))).length;

  // Carried over: items in the sprint at its end that were not done by then.
  const atEnd = closedSprints.flatMap((sp) => sp.issues.filter((i) => i.type !== 'Sub-task').map((i) => ({ i, sp })));
  const carried = atEnd.filter(({ i, sp }) => !doneInSprint(i, sp));
  return {
    groups: [
      { id: 'delivery', title: 'Delivery against plan', question: 'Does the team deliver what it commits to?', measures: [
        rate('sprint_completion', 'Sprint completion', doneSum, plannedSum, 'Committed story points done ÷ committed story points, over sprints that closed in the period. Committed = estimated items in the sprint before it started.', ['points done', 'points committed']),
        (() => { const m = rate('unplanned_work', 'Unplanned work', unplanned.reduce((t, x) => t + x.i.points!, 0), finished.reduce((t, x) => t + x.i.points!, 0),
          'Story points finished on tickets created after their sprint started ÷ story points finished, sprints that closed in the period. Pulling in an existing ticket is scope change; a ticket that did not exist at planning is unplanned work.',
          ['points unplanned', 'points finished'], unplanned.map((x) => x.i.key));
          if (unestimatedDone) m.note = `${unestimatedDone} finished tickets had no estimate and are not counted.`; return m; })(),
        rate('scope_added', 'Scope added mid-sprint', addedLate.length, added.length, 'Items added after the sprint started ÷ items in the sprint, sprints that closed in the period.', ['added late', 'items'], addedLate.map((i) => i.key)),
        { ...rate('carry_over', 'Work carried over', carried.length, atEnd.length, 'Items in a sprint that were not done by its end ÷ items in the sprint, sprints that closed in the period. They roll into the next sprint.', ['not done', 'items'], carried.map((x) => x.i.key)), target: null, met: null },
      ], detail: completion.map((c) => ({ ...c, pct: round1(c.pct) })) },
    ],
  };
}

// ---------- Data hygiene ----------
// Not performance: whether the data behind the measures can be trusted. Shown on the Data checks page.
export function hygiene(s: Slice) {
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
  // Review concentration: the one reviewer who did the largest share of reviews on merged PRs.
  const reviews = new Map<string, number>(); for (const p of merged) for (const r of p.reviewers) reviews.set(r, (reviews.get(r) ?? 0) + 1);
  const totalReviews = [...reviews.values()].reduce((t, n) => t + n, 0), topReviews = Math.max(0, ...reviews.values());
  // CI on the default branch only: a red run on a feature branch is normal work in progress; a red main blocks everyone.
  const ci = s.ci.filter((c) => inWin(s, c.at) && (!c.branch || !s.defaultBranches[c.repo] || c.branch === s.defaultBranches[c.repo]) && (c.conclusion === 'success' || c.conclusion === 'failure'));
  return {
    groups: [
      { id: 'pr_flow', title: 'Pull request flow', question: 'How fast does a change get from opened to merged?', measures: [
        med('pickup_time', 'Time to first review (median)', merged.filter((p) => p.firstReviewAt).map((p) => hrs(p.createdAt, p.firstReviewAt!) / 24), 'days', 'Median days from PR opened to the first review or review comment by someone else, PRs merged in the period.', 'reviewed PRs'),
        med('review_time', 'Review to merge (median)', merged.filter((p) => p.firstReviewAt).map((p) => hrs(p.firstReviewAt!, p.mergedAt!) / 24), 'days', 'Median days from first review to merge, PRs merged in the period.', 'reviewed PRs'),
        { ...rate('reviewer_load', 'Review concentration', topReviews, totalReviews, 'Reviews done by the busiest reviewer ÷ all reviews on PRs merged in the period. High means one person is the bottleneck. No names are shown.', ['by the busiest reviewer', 'reviews']), target: TARGETS.reviewer_load, met: totalReviews ? metTarget(round1((100 * topReviews) / totalReviews), TARGETS.reviewer_load) : null },
        rate('ci_failure_rate', 'CI failure rate (main)', ci.filter((c) => c.conclusion === 'failure').length, ci.length, 'Failed CI runs on the default branch ÷ finished CI runs on the default branch, in the period. A red main blocks everyone.', ['failed', 'runs']),
        (() => { const xs = merged.map((p) => p.additions + p.deletions); const v = xs.length ? Math.round(median(xs)) : null; return { id: 'pr_size', title: 'PR size (median)', value: v, unit: 'count' as const, num: null, den: xs.length, denLabel: 'merged PRs', target: TARGETS.pr_size, met: metTarget(v, TARGETS.pr_size), how: 'Median lines changed (additions + deletions) per PR merged in the period.', smallSample: xs.length > 0 && xs.length < MIN_MEDIAN_SAMPLE }; })(),
      ] },
      (() => {
        const f = flow(s);
        const eff = rate('flow_efficiency', 'Flow efficiency', Math.round(f.activeHours), Math.round(f.activeHours + f.waitingHours),
          `Working hours in active statuses ÷ all working hours from first start to done, tickets resolved in the period. Working hours: ${String(Math.floor(config.workingHours.start)).padStart(2, '0')}:00 to ${String(Math.floor(config.workingHours.end)).padStart(2, '0')}:00 on working days, so nights and weekends count as neither. Waiting: ${config.jira.waitStatuses.join(', ')}, or back in to do.`,
          ['active hours', 'hours from start to done']);
        eff.note = `${f.tickets} tickets with a full status history.`;
        return { id: 'flow', title: 'Where work waits', question: 'How much of a ticket\'s life is active work, and where does it sit idle?', measures: [eff], heatmap: f.heatmap };
      })(),
      // The Flow Framework's five: velocity, time, load and distribution here; efficiency in "Where work waits".
      (() => {
        const done = s.items.filter((i) => !isSub(i) && i.statusCategory === 'done' && inWin(s, i.resolved));
        const weeksN = Math.max(1, (s.to - s.from) / (7 * DAY));
        const kind = (i: WorkItem) => isBug(i) ? 'Defects' : (i.labels ?? []).some((l) => config.jira.riskLabels.includes(l)) ? 'Risks' : (i.labels ?? []).some((l) => config.jira.debtLabels.includes(l)) ? 'Debt' : 'Features';
        const dist = ['Features', 'Defects', 'Risks', 'Debt'].map((k) => ({ kind: k, items: done.filter((i) => kind(i) === k).length }));
        const byWeek = new Map<string, number>(); for (let t = s.from; t < s.to; t += 7 * DAY) byWeek.set(weekOf(new Date(t).toISOString(), config.tzOffset), 0);
        for (const i of done) { const w = weekOf(i.resolved!, config.tzOffset); if (byWeek.has(w)) byWeek.set(w, byWeek.get(w)! + 1); }
        const load = s.items.filter((i) => !isSub(i) && i.statusCategory === 'inprogress').length;
        const velocity: Measure = { id: 'flow_velocity', title: 'Flow velocity', value: round1(done.length / weeksN), unit: 'count', num: done.length, den: null, numLabel: 'items done',
          target: null, met: null, how: 'Work items completed per week in the period (sub-tasks excluded), whatever their size. Useful as a trend, not against other teams.', smallSample: done.length > 0 && done.length < MIN_RATE_SAMPLE };
        const loadM: Measure = { id: 'flow_load', title: 'Flow load', value: load, unit: 'count', num: null, den: null, target: null, met: null,
          how: 'Work items in an in-progress status now (sub-tasks excluded): the work in progress. Too much means context switching; the right level differs by team.' };
        return { id: 'flow_framework', title: 'Flow Framework', question: 'How much value flows, how fast, and on what kind of work?', measures: [
          velocity,
          med('flow_time', 'Flow time (median)', done.map((i) => (Date.parse(i.resolved!) - Date.parse(i.created)) / DAY), 'days', 'Median days from a work item being created to done, items completed in the period. Jira resolution is the end: production release per ticket is not linked.', 'items done'),
          loadM,
        ], distribution: dist, velocityByWeek: [...byWeek.entries()].map(([week, items]) => ({ week, items })) };
      })(),
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
  const boards = team === 'all' ? allBoards() : [team];
  return boards.map((b) => ({ board: b, ...fn(slice(b, days, now)) }));
}

export const flatMeasures = (r: { groups: { measures: Measure[] }[] }) => r.groups.flatMap((g) => g.measures);

// The same report for the period before, so every measure can say whether it got better. A previous value is given
// only when the collected data reaches back that far (Jira JIRA_DAYS, GitHub GITHUB_DAYS); otherwise null.
export function withPrevious<T extends { groups: { measures: Measure[] }[] }>(team: string, days: Period, fn: (s: Slice) => T, now = Date.now()): T {
  const cur = fn(slice(team, days, now));
  const boards = team === 'all' ? allBoards() : [team];
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

// Change failure rate, by the configured definition (CFR_SOURCE: hotfix, bugs or linked). One function for the
// Quality report, the DORA section and the team page, so the three never disagree. times: when each failure happened.
export function changeFailure(s: Slice): Measure & { times: number[] } {
  const merged = mergedPrs(s);
  const deploysOk = s.deploys.filter((d) => d.success && inWin(s, d.at));
  const bugsCreated = s.items.filter((i) => isBug(i) && inWin(s, i.created));
  const source = (process.env.CFR_SOURCE ?? 'hotfix').toLowerCase();
  let cfr: Measure; let times: number[] = [];
  if (source === 'linked') {
    // Deployment linked: a successful production deploy failed if a significant bug, an incident or a hotfix PR
    // appears within 24 hours after it. Each failure is linked to the one most recent deploy before it (same repo
    // for a hotfix PR), so one incident never fails several deploys. A time link, not proof of cause.
    const ok = deploysOk.map((d) => ({ ...d, t: Date.parse(d.at) })).sort((a, b) => a.t - b.t);
    const failed = new Set<number>();
    const link = (at: string, repo?: string) => {
      const t = Date.parse(at);
      let best = -1; ok.forEach((d, k) => { if (d.t <= t && t - d.t <= DAY && (!repo || d.repo === repo)) best = k; });
      if (best >= 0) failed.add(best);
    };
    for (const b of bugsCreated.filter(significant)) link(b.created);
    for (const i of s.incidents.filter((x) => inWin(s, x.firedAt))) link(i.firedAt);
    for (const p of merged.filter((x) => x.isHotfix)) link(p.createdAt, p.repo);
    times = [...failed].map((k) => ok[k].t);
    cfr = rate('change_failure_rate', 'Change failure rate', failed.size, ok.length,
      'Successful production deploys followed within 24 hours by a significant bug, an incident or a hotfix PR ÷ successful deploys. Each failure is linked to the one most recent deploy before it (same repo for hotfixes). A time link, not proof of cause.',
      ['deploys followed by a failure', 'deploys'], [...failed].map((k) => `${ok[k].repo.split('/')[1]}@${ok[k].at.slice(0, 16)}`));
  } else if (source === 'bugs') {
    const failures = bugsCreated.filter(significant), per = deploysOk.length ? deploysOk.length : merged.length;
    times = failures.map((i) => Date.parse(i.created));
    cfr = rate('change_failure_rate', 'Change failure rate', failures.length, per,
      `Significant bugs created (priority ${config.jira.significant.join(', ')}) ÷ ${deploysOk.length ? 'successful production deploys' : 'PRs merged to the default branch'}, in the period.`,
      ['significant bugs', deploysOk.length ? 'deploys' : 'merged PRs'], failures.map((i) => i.key));
  } else {
    const failedDeploys = s.deploys.filter((d) => !d.success && inWin(s, d.at)), hot = merged.filter((p) => p.isHotfix);
    times = [...hot.map((p) => Date.parse(p.mergedAt!)), ...failedDeploys.map((d) => Date.parse(d.at))];
    cfr = rate('change_failure_rate', 'Change failure rate', hot.length + failedDeploys.length, merged.length + failedDeploys.length,
      '(Hotfix or revert PRs + failed deploys) ÷ (merged PRs + failed deploys), in the period. A hotfix has "hotfix" or "revert" in its title or branch.',
      ['hotfixes and failed deploys', 'merged PRs and failed deploys'], hot.map(ref));
  }
  return Object.assign(cfr, { times });
}

// Code quality from each team's latest SonarQube and Testmo data (a snapshot, not the period). For several teams:
// quality gate as teams passing, coverage and pass rate as the median team, vulnerabilities summed.
function codeQuality(s: Slice) {
  const sonar = s.quality.map((q) => q.sonar).filter((x): x is NonNullable<typeof x> => !!x);
  const testmo = s.quality.map((q) => q.testmo).filter((x): x is NonNullable<typeof x> => !!x && x.runsLast30d > 0);
  const med2 = (xs: number[]) => (xs.length ? round1(median(xs)) : null);
  const one = (id: string, title: string, value: number | null, unit: Measure['unit'], target: Target | null, how: string, den: number): Measure =>
    ({ id, title, value, unit, num: null, den, denLabel: den === 1 ? 'team' : 'teams', target, met: metTarget(value, target), how });
  const passing = sonar.filter((x) => x.qualityGate === 'OK').length;
  return { id: 'code_quality', title: 'Code quality', question: 'Is the code the team writes now tested and passing its own gate?', measures: [
    rate('quality_gate_pass', 'Quality gate passing', passing, sonar.length, 'Teams whose SonarQube quality gate passes, latest scan.', ['passing', 'teams']),
    one('new_code_coverage', 'Coverage on new code', med2(sonar.map((x) => x.newCoverage).filter((v): v is number => v != null)), '%', TARGETS.new_code_coverage, 'SonarQube coverage on new code, latest scan (the median team when several).', sonar.length),
    one('test_pass_rate', 'Automated test pass rate', med2(testmo.map((x) => x.lastRunPassRate)), '%', TARGETS.test_pass_rate, 'Tests passed ÷ tests run over the last 30 days of Testmo automation runs (the median team when several).', testmo.length),
  ], note: 'From the latest SonarQube scan and Testmo runs, not the selected period.' };
}

// DORA: the four measures and where lead time goes. The same calculations as everywhere else in Houston.
export function dora(s: Slice) {
  const weeks = Math.max(1, (s.to - s.from) / (7 * DAY));
  const ok = s.deploys.filter((d) => d.success && inWin(s, d.at));
  const merged = mergedPrs(s);
  const leads = leadTimes(merged, s.deploys).map((l) => l.days);
  const restore = s.incidents.filter((i) => inWin(s, i.firedAt) && i.resolvedAt).map((i) => (Date.parse(i.resolvedAt!) - Date.parse(i.firedAt)) / 3_600_000);
  const df: Measure = { id: 'deploy_frequency', title: 'Deployment frequency', value: round1(ok.length / weeks), unit: 'count', num: ok.length, den: null, numLabel: 'deploys',
    target: TARGETS.deploy_frequency, met: metTarget(round1(ok.length / weeks), TARGETS.deploy_frequency), how: 'Successful runs of the production deploy workflow (GITHUB_DEPLOY_WORKFLOW) per week in the period.' };
  const f = flow(s);
  const stage = (id: string, title: string, v: number | null, how: string): Measure => ({ id, title, value: v == null ? null : round1(v), unit: 'hours', num: null, den: f.stages.prs, denLabel: 'deployed PRs', target: null, met: null, how, smallSample: f.stages.prs > 0 && f.stages.prs < MIN_MEDIAN_SAMPLE });
  return { groups: [
    { id: 'dora4', title: 'The four DORA measures', question: 'How fast and how safely does change reach users?', measures: [
      df,
      med('lead_time', 'Lead time for changes (median)', leads, 'days', 'Median days from a PR\'s first commit (author date) to the first successful production deploy of its repo after merge, PRs merged in the period.', 'deployed PRs'),
      changeFailure(s),
      med('time_to_restore', 'Time to restore (median)', restore, 'hours', 'Median hours from alert fired to alert resolved, Sev0 to Sev2 incidents fired in the period (Azure Monitor).', 'resolved incidents'),
    ] },
    { id: 'lead_stages', title: 'Where lead time goes', question: 'Is the time in writing, reviewing, or waiting to release?', measures: [
      { ...stage('stage_coding', 'Coding time (median)', f.stages.median.coding, 'Median hours from a PR\'s first commit (author date) to the PR being opened. PRs without commit dates count from when they were opened.'), note: f.stages.prs ? `${f.stages.withFirstCommit} of ${f.stages.prs} PRs have commit dates.` : undefined },
      stage('stage_review', 'Review time (median)', f.stages.median.review, 'Median hours from PR opened to merged.'),
      stage('stage_deploy', 'Waiting to deploy (median)', f.stages.median.deploy, 'Median hours from merge to the first successful production deploy of its repo.'),
    ], stages: f.stages },
  ] };
}
// ---------- Security ----------
// GitHub security alerts: vulnerable dependencies (Dependabot), leaked secrets (secret scanning) and flaws in the team's
// own code (code scanning), plus SonarQube vulnerabilities. Deadlines by severity from SECURITY_DEADLINE_DAYS.
//
// On time: each critical or high alert is judged once, at whichever comes first: it being closed, or its deadline
// passing. Fixed by the deadline is on time; still open at the deadline is late, whatever happens after, so dismissing
// an overdue alert cannot improve the rate. Dismissed before the deadline is left out of the rate and listed.
const deadlineDays = (a: SecurityAlert) => config.github.securityDeadlines[a.severity];
const dueAt = (a: SecurityAlert) => { const d = deadlineDays(a); return d == null ? null : Date.parse(a.createdAt) + d * DAY; };
const openAt = (a: SecurityAlert, t: number) => Date.parse(a.createdAt) < t && (!a.closedAt || Date.parse(a.closedAt) >= t);
const KIND = { dependency: 'dependency', secret: 'leaked secret', code: 'code' } as const;
const aref = (a: SecurityAlert, extra = '') => `${a.repo.split('/')[1] ?? a.repo}: ${a.title} (${a.severity} ${KIND[a.kind]}${extra})`;

export function security(s: Slice) {
  const A = s.security.alerts, serious = A.filter((a) => a.severity === 'critical' || a.severity === 'high');
  const judged: { a: SecurityAlert; onTime: boolean }[] = [], dismissedEarly: SecurityAlert[] = [];
  for (const a of serious) {
    const due = dueAt(a); if (due == null) continue;
    const closed = a.closedAt ? Date.parse(a.closedAt) : null;
    const at = closed != null && closed <= due ? closed : due;
    if (at < s.from || at >= s.to) continue;
    if (closed != null && closed <= due && a.state === 'dismissed') { dismissedEarly.push(a); continue; }
    judged.push({ a, onTime: closed != null && closed <= due });
  }
  const onTime = rate('security_on_time', 'Critical and high fixed on time', judged.filter((x) => x.onTime).length, judged.length,
    `Critical and high alerts fixed within their deadline (critical ${config.github.securityDeadlines.critical ?? '·'} days, high ${config.github.securityDeadlines.high ?? '·'} days). Each alert is judged once, when it is fixed or when its deadline passes, whichever is first, in the period. Still open at the deadline counts as late even if dismissed later. Dismissed before the deadline is left out and listed separately.`,
    ['on time', 'alerts due or closed'], judged.filter((x) => !x.onTime).map((x) => aref(x.a)));
  const fixDays = (sv: 'critical' | 'high') => A.filter((a) => a.severity === sv && a.state === 'fixed' && inWin(s, a.closedAt)).map((a) => (Date.parse(a.closedAt!) - Date.parse(a.createdAt)) / DAY);
  const fixMed = (sv: 'critical' | 'high') => { const d = config.github.securityDeadlines[sv]; const m = med(`security_fix_${sv}`, `Time to fix, ${sv} (median)`, fixDays(sv), 'days', `Median days from a ${sv} alert being opened to it being fixed (for a leaked secret: revoked), alerts fixed in the period.`, 'fixed alerts');
    const target: Target | null = d ? { op: '<', value: d } : null; return { ...m, target, met: metTarget(m.value, target) }; };

  const now = s.to;
  const overdue = A.filter((a) => openAt(a, now) && (dueAt(a) ?? Infinity) < now);
  const count = (id: string, title: string, xs: SecurityAlert[], how: string, withAge = false): Measure => {
    const target = TARGETS[id] ?? null;
    return { id, title, value: xs.length, unit: 'count', num: null, den: null, target, met: metTarget(xs.length, target), how,
      failing: xs.map((a) => aref(a, withAge ? `, ${Math.floor((now - Date.parse(a.createdAt)) / DAY)} days old` : '')) };
  };
  const openCH = A.filter((a) => openAt(a, now) && (a.severity === 'critical' || a.severity === 'high'));
  const secrets = A.filter((a) => a.kind === 'secret' && openAt(a, now));
  const dismissed = A.filter((a) => a.state === 'dismissed' && inWin(s, a.closedAt));
  const repos = Object.entries(s.security.coverage);
  const cov = (k: keyof ScanCoverage, id: string, title: string, what: string): Measure => {
    const known = repos.filter(([, c]) => c[k] != null), off = known.filter(([, c]) => c[k] === false).map(([r]) => r);
    const unknown = repos.length - known.length;
    return { ...rate(id, title, known.length - off.length, known.length, `Team repos with ${what} turned on. A repo with scanning off shows no alerts, so it looks safe when it is not.`, ['repos on', 'repos'], off),
      smallSample: false, note: unknown ? `${unknown} repos could not be checked: the GitHub token needs read access to ${what}.` : undefined };
  };

  return { groups: [
    { id: 'fix_on_time', title: 'Fixed on time', question: 'Are serious security issues fixed within their deadline?', measures: [onTime, fixMed('critical'), fixMed('high')] },
    { id: 'exposure', title: 'Open now', question: 'What is exposed right now?', measures: [
      count('security_overdue', 'Overdue now', overdue, 'Open alerts past their deadline at the end of the period, any severity with a deadline. Each is listed with its age.', true),
      count('security_open_critical_high', 'Open critical and high', openCH, 'Open critical and high alerts at the end of the period, within their deadline or not.'),
      count('secrets_open', 'Leaked secrets not yet revoked', secrets, 'Secrets (passwords, keys, tokens) found in code and not yet revoked, at the end of the period. Houston stores only the secret type, never the secret.'),
      { ...count('security_dismissed', 'Dismissed instead of fixed', dismissed, 'Alerts dismissed in the period (false positive, won\'t fix, used in tests, or auto-dismissed). Shown so dismissals are seen, not hidden.'), target: null, met: null },
    ] },
    { id: 'scan_coverage', title: 'Scanning turned on', question: 'Is every repo actually being scanned?', measures: [
      cov('dependency', 'scan_dependency', 'Dependency scanning', 'Dependabot alerts'),
      cov('secret', 'scan_secret', 'Secret scanning', 'secret scanning'),
      cov('code', 'scan_code', 'Code scanning', 'code scanning'),
    ], note: 'As GitHub reports it today, not for the selected period.' },
  ] };
}

// ---------- Support ----------
// Support tickets from plain Jira. Plain Jira has no SLA clock, so Houston measures SLAs itself: SUPPORT_SLA goals per
// priority, in working time (WORKING_HOURS on working days, in TZ_OFFSET_HOURS). Each ticket's SLA is judged once:
// when it is met (first response, or resolution) or when its goal passes unmet, whichever is first.
const SLA_TARGET: Target = { op: '>', value: 95 };
const outside = (iso: string) => outsideWorkingHours(iso, config.weekend, config.tzOffset, config.workingHours);
const wmin = (a: string, b: string) => workingMinutes(a, b, config.weekend, config.tzOffset, config.workingHours);
const breachOf = (created: string, goal: string) => { const m = durationMinutes(goal, config.workingHours); return m == null ? null : addWorkingMinutes(created, m, config.weekend, config.tzOffset, config.workingHours); };

export function support(s: Slice) {
  const T = s.support, weeks = Math.max(1, (s.to - s.from) / (7 * DAY));
  if (!s.supportConnected) return { groups: [{ id: 'support_volume', title: 'Incoming support', question: 'How much support work arrives, and how much of the team\'s work is it?', measures: [] as Measure[],
    note: 'No support data yet: collected from Jira on the next run (SUPPORT_PROJECTS, SUPPORT_ISSUE_TYPES, SUPPORT_LABELS).' }] };
  const created = T.filter((t) => inWin(s, t.created)), resolved = T.filter((t) => inWin(s, t.resolved));
  const work = s.items.filter((i) => !isSub(i) && inWin(s, i.resolved));
  const open = T.filter((t) => Date.parse(t.created) < s.to && (!t.resolved || Date.parse(t.resolved) >= s.to)).sort((a, b) => a.created.localeCompare(b.created));
  const perWeek: Measure = { id: 'support_per_week', title: 'Support tickets per week', value: round1(created.length / weeks), unit: 'count', num: created.length, den: null, numLabel: 'tickets created',
    target: null, met: null, how: 'Support tickets created in the period ÷ weeks in the period: tickets in the team\'s support project, or support issue types and labels in its own project.' };
  const backlog: Measure = { id: 'support_open', title: 'Open support tickets', value: open.length, unit: 'count', num: null, den: null, target: null, met: null,
    how: 'Support tickets not resolved at the end of the period, oldest listed first with their age.', failing: open.map((t) => `${t.key} (${Math.floor((s.to - Date.parse(t.created)) / DAY)} days)`) };
  const weekly = new Map<string, { created: number; resolved: number }>();
  for (let t = s.from; t < s.to; t += 7 * DAY) weekly.set(weekOf(new Date(t).toISOString(), config.tzOffset), { created: 0, resolved: 0 });
  for (const t of created) { const w = weekly.get(weekOf(t.created, config.tzOffset)); if (w) w.created++; }
  for (const t of resolved) { const w = weekly.get(weekOf(t.resolved!, config.tzOffset)); if (w) w.resolved++; }

  // SLAs: first response and resolution against the goal for the ticket's priority.
  const noSla = new Set<string>();
  const slaRate = (kind: 'response' | 'resolution') => {
    const judged: { key: string; met: boolean }[] = [];
    for (const t of T) {
      const goal = config.jira.supportSla[(t.priority ?? '').toLowerCase()]?.[kind];
      if (!goal) { noSla.add(t.priority ?? 'no priority'); continue; }
      const breach = breachOf(t.created, goal), done = kind === 'response' ? t.firstResponse : t.resolved;
      if (!breach) continue;
      if (done && Date.parse(done) <= Date.parse(breach)) { if (inWin(s, done)) judged.push({ key: t.key, met: true }); }
      else if (inWin(s, breach)) judged.push({ key: t.key, met: false });
    }
    const id = kind === 'response' ? 'sla_response' : 'sla_resolution';
    const m = rate(id, kind === 'response' ? 'First response within SLA' : 'Resolved within SLA', judged.filter((x) => x.met).length, judged.length,
      `Tickets ${kind === 'response' ? 'answered' : 'resolved'} within the SLA for their priority (SUPPORT_SLA, working time: ${hoursText} on working days). Judged once: when ${kind === 'response' ? 'first answered' : 'resolved'}, or when the goal passes unmet. ${kind === 'response' ? 'First response: the first comment by someone other than the reporter, or the first status change by a person.' : ''}`.trim(),
      ['within SLA', 'tickets due or done'], judged.filter((x) => !x.met).map((x) => x.key));
    return { ...m, target: SLA_TARGET, met: m.value == null ? null : metTarget(m.value, SLA_TARGET) };
  };
  const respTimes = T.filter((t) => t.firstResponse && inWin(s, t.firstResponse)).map((t) => wmin(t.created, t.firstResponse!) / 60);
  const resTimes = T.filter((t) => inWin(s, t.resolved)).map((t) => wmin(t.created, t.resolved!) / 60);
  const hoursText = `${String(Math.floor(config.workingHours.start)).padStart(2, '0')}:${String(Math.round((config.workingHours.start % 1) * 60)).padStart(2, '0')} to ${String(Math.floor(config.workingHours.end)).padStart(2, '0')}:${String(Math.round((config.workingHours.end % 1) * 60)).padStart(2, '0')}`;
  const slaMeasures = [
    slaRate('response'), med('support_response_time', 'Time to first response (median)', respTimes, 'hours', 'Median working hours from a ticket being raised to its first response, tickets first answered in the period.', 'answered tickets'),
    slaRate('resolution'), med('support_resolution_time', 'Time to resolve (median)', resTimes, 'hours', 'Median working hours from a ticket being raised to it being resolved, tickets resolved in the period.', 'resolved tickets'),
  ];

  // Out of hours: status changes people made outside WORKING_HOURS or on the weekend, and incidents fired then.
  const changes = T.flatMap((t) => t.changes).filter((c) => inWin(s, c));
  const inc = s.incidents.filter((i) => inWin(s, i.firedAt));
  const incOut = inc.filter((i) => outside(i.firedAt));

  // Repeat issues: resolved tickets that were reopened, or that duplicate another ticket. Both are recorded by Jira
  // itself (the resolution being cleared, the Duplicate link), so nothing is guessed from names or components.
  const repeats = resolved.filter((t) => t.reopened || t.duplicate);
  const repeatM = rate('support_repeat', 'Reopened or duplicate', repeats.length, resolved.length,
    'Support tickets resolved in the period that had been reopened after an earlier resolution, or are linked as a duplicate of another ticket: a fix that did not hold, or the same problem raised again.',
    ['reopened or duplicate', 'resolved tickets'], repeats.map((t) => `${t.key} (${[t.reopened && 'reopened', t.duplicate && 'duplicate'].filter(Boolean).join(', ')})`));

  return { groups: [
    { id: 'support_volume', title: 'Incoming support', question: 'How much support work arrives, and how much of the team\'s work is it?', measures: [
      perWeek,
      rate('support_share', 'Support share of work finished', resolved.length, resolved.length + work.length,
        'Support tickets resolved ÷ (support tickets resolved + the team\'s own work items resolved), in the period. A count of items, not hours: a big story and a quick support answer count one each.',
        ['support tickets', 'items finished']),
      backlog,
    ], weekly: [...weekly.entries()].map(([week, v]) => ({ week, ...v })) },
    { id: 'support_sla', title: 'Service levels', question: 'Are customers answered and helped within the agreed time?', measures: slaMeasures,
      note: `SLA goals per priority: ${Object.entries(config.jira.supportSla).map(([p, v]) => `${p} ${v.response} to respond, ${v.resolution} to resolve`).join('; ') || 'none set'} (working time).${noSla.size ? ` No SLA for: ${[...noSla].join(', ')}.` : ''}` },
    { id: 'support_hours', title: 'Outside working hours', question: 'Is support pulling people in at night and at weekends?', measures: [
      rate('support_out_of_hours', 'Support work outside working hours', changes.filter(outside).length, changes.length,
        `Status changes on support tickets made by people (not automation) outside ${hoursText} or at the weekend, in local time (TZ_OFFSET_HOURS, WORKING_HOURS, WEEKEND). Team total only: Houston does not keep who made them.`,
        ['outside hours', 'status changes']),
      { ...rate('incidents_out_of_hours', 'Incidents outside working hours', incOut.length, inc.length,
        `Sev0 to Sev2 incidents (Azure Monitor) fired outside ${hoursText} or at the weekend. With no on-call tool, this counts incidents, not who responded.`, ['outside hours', 'incidents']), target: null, met: null },
    ] },
    { id: 'support_repeat', title: 'Repeat issues', question: 'Do the same problems keep coming back?', measures: [repeatM] },
  ] };
}

// ---------- Production ----------
// Incidents in the period (Azure Monitor alerts, Sev0 to Sev2), and server errors and availability from Application
// Insights (last 30 days as collected, not the selected period). Several teams: requests-weighted errors, lowest availability.
export function production(s: Slice) {
  const inc = s.incidents.filter((i) => inWin(s, i.firedAt));
  const req = s.ops.reduce((t, o) => t + o.requests30d, 0);
  const err = s.ops.length ? round1(req ? s.ops.reduce((t, o) => t + o.failedRate * o.requests30d, 0) / req : median(s.ops.map((o) => o.failedRate))) : null;
  const avs = s.ops.map((o) => o.availability).filter((v): v is number => v != null), av = avs.length ? Math.min(...avs) : null;
  const one = (id: string, title: string, value: number | null, how: string): Measure => ({ id, title, value, unit: '%', num: null, den: s.ops.length, denLabel: s.ops.length === 1 ? 'team' : 'teams', target: TARGETS[id], met: metTarget(value, TARGETS[id]), how });
  return { groups: [{ id: 'production', title: 'Production', question: 'What breaks in production?', measures: [
    { id: 'incidents', title: 'Incidents', value: inc.length, unit: 'count' as const, num: null, den: null, target: null, met: null, how: 'Sev0 to Sev2 incidents (Azure Monitor alerts) fired in the period.' },
    one('server_errors', 'Server errors', err, 'Requests answered with a 5xx server error ÷ all requests, last 30 days (Application Insights).'),
    one('availability', 'Availability', av, 'Availability from Application Insights availability tests, last 30 days. Not measured when there are no tests.'),
  ], note: 'Server errors and availability are the last 30 days as collected, not the selected period.' }] };
}

// Every measure, by where it is calculated. The headline and drill-down layout is in performance.ts.
export const REPORTS = { dora, planning, quality, flow: efficiency, support, production, security } as const;
