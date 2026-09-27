import { config } from './config.js';
import { store } from './store/index.js';
import { median, doneInSprint } from './cycle.js';
import type { Epic, GithubSnapshot, PullRequest, ScanCoverage, SecurityAlert, Sprint, WorkItem } from './types.js';
import { hoursExcludingWeekends, weekOf } from './time.js';
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
  pr_review_rate: { op: '>', value: 95 }, pr_review_comment_rate: { op: '>', value: 50 },
  time_to_restore: { op: '<', value: 24 }, bug_lead_time: { op: '<', value: 14 },
  bug_fix_find: { op: '>', value: 80 }, bug_workload: { op: '<', value: 20 }, revert_ratio: { op: '<', value: 5 },
  deploy_frequency: { op: '>', value: 1 }, lead_time: { op: '<', value: 7 },
  sprint_completion: { op: '>', value: 80 }, scope_added: { op: '<', value: 15 }, unplanned_work: { op: '<', value: 20 }, defect_leakage: { op: '<', value: 20 }, qa_rejection: { op: '<', value: 15 }, flow_efficiency: { op: '>', value: 40 },
  use_of_branches: { op: '>', value: 95 }, merged_with_pr: { op: '>', value: 95 }, prs_traceable: { op: '>', value: 90 },
  tickets_estimated: { op: '>', value: 90 }, tickets_in_sprint: { op: '>', value: 80 }, tickets_in_epic: { op: '>', value: 80 },
  pr_cycle_hours: { op: '<', value: 60 }, new_code_coverage: { op: '>', value: 70 }, vulnerabilities: { op: '<', value: 1 }, test_pass_rate: { op: '>', value: 97 }, quality_gate_pass: { op: '>', value: 99 }, flow_time: { op: '<', value: 14 }, pickup_time: { op: '<', value: 1 }, review_time: { op: '<', value: 1.5 }, cycle_time: { op: '<', value: 5 }, pr_size: { op: '<', value: 400 },
  security_on_time: { op: '>', value: 95 }, security_overdue: { op: '<', value: 1 }, secrets_open: { op: '<', value: 1 },
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
}

export const slice = (team: string, days: Period, now = Date.now()): Slice => sliceRange(team, now - days * DAY, now);

// Any exact range [from, to), for calendar months in the monthly report.
export function sliceRange(team: string, from: number, to: number): Slice {
  const boards = team === 'all' ? [...new Set(store.scorecards().map((c) => c.board))] : [team];
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
  const commented = merged.filter((p) => (p.reviewComments ?? 0) > 0);
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
        rate('pr_review_comment_rate', 'PR review comment rate', commented.length, merged.length, 'Merged PRs with at least one review comment, or a review with a written body, by someone other than the author ÷ merged PRs.', ['with review comments', 'merged PRs'], merged.filter((p) => !(p.reviewComments ?? 0)).map(ref)),
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
        med('pr_cycle_hours', 'PR cycle time (median)', merged.map((p) => hoursExcludingWeekends(p.createdAt, p.mergedAt!, config.weekend, config.tzOffset)), 'hours',
          `Median hours from PR opened to merged, leaving out weekend days (${config.weekend.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}, UTC${config.tzOffset >= 0 ? '+' : ''}${config.tzOffset}). PRs merged in the period.`, 'merged PRs'),
        med('pickup_time', 'Time to first review (median)', merged.filter((p) => p.firstReviewAt).map((p) => hrs(p.createdAt, p.firstReviewAt!) / 24), 'days', 'Median days from PR opened to the first review or review comment by someone else, PRs merged in the period.', 'reviewed PRs'),
        med('review_time', 'Review to merge (median)', merged.filter((p) => p.firstReviewAt).map((p) => hrs(p.firstReviewAt!, p.mergedAt!) / 24), 'days', 'Median days from first review to merge, PRs merged in the period.', 'reviewed PRs'),
        (() => { const xs = merged.map((p) => p.additions + p.deletions); const v = xs.length ? Math.round(median(xs)) : null; return { id: 'pr_size', title: 'PR size (median)', value: v, unit: 'count' as const, num: null, den: xs.length, denLabel: 'merged PRs', target: TARGETS.pr_size, met: metTarget(v, TARGETS.pr_size), how: 'Median lines changed (additions + deletions) per PR merged in the period.', smallSample: xs.length > 0 && xs.length < MIN_MEDIAN_SAMPLE }; })(),
      ] },
      (() => {
        const f = flow(s);
        const eff = rate('flow_efficiency', 'Flow efficiency', Math.round(f.activeHours), Math.round(f.activeHours + f.waitingHours),
          `Working hours in active statuses ÷ all working hours from first start to done, tickets resolved in the period. Waiting: ${config.jira.waitStatuses.join(', ')}, or back in to do. Weekends left out.`,
          ['active hours', 'hours from start to done']);
        eff.note = `${f.tickets} tickets with a full status history.`;
        const req = rate('flow_efficiency_request', 'Flow efficiency from request', Math.round(f.activeHours), Math.round(f.requestHours),
          'Active working hours ÷ all working hours from the ticket being created to done, so time waiting in the backlog counts too (the Flow Framework\'s definition). Usually far lower than flow efficiency from start, which is the part the team controls.',
          ['active hours', 'hours from created to done']);
        req.target = null; req.met = null;
        return { id: 'flow', title: 'Where work waits', question: 'How much of a ticket\'s life is active work, and where does it sit idle?', measures: [eff, req], heatmap: f.heatmap };
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
      stage('stage_coding', 'Coding time (median)', f.stages.median.coding, `Median hours from a PR's first commit (author date) to the PR being opened. ${f.stages.withFirstCommit} of ${f.stages.prs} PRs have commit dates.`),
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
  const sonar = s.quality.map((q) => q.sonar).filter((x): x is NonNullable<typeof x> => !!x);
  const sonarVulns: Measure = { id: 'vulnerabilities', title: 'SonarQube vulnerabilities', value: sonar.length ? sonar.reduce((t, x) => t + x.vulnerabilities, 0) : null, unit: 'count',
    num: null, den: sonar.length, denLabel: sonar.length === 1 ? 'team' : 'teams', target: TARGETS.vulnerabilities, met: null, how: 'SonarQube open vulnerabilities, latest scan, all teams together (not the selected period).' };
  sonarVulns.met = metTarget(sonarVulns.value, sonarVulns.target);

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
      sonarVulns,
      { ...count('security_dismissed', 'Dismissed instead of fixed', dismissed, 'Alerts dismissed in the period (false positive, won\'t fix, used in tests, or auto-dismissed). Shown so dismissals are seen, not hidden.'), target: null, met: null },
    ] },
    { id: 'scan_coverage', title: 'Scanning turned on', question: 'Is every repo actually being scanned?', measures: [
      cov('dependency', 'scan_dependency', 'Dependency scanning', 'Dependabot alerts'),
      cov('secret', 'scan_secret', 'Secret scanning', 'secret scanning'),
      cov('code', 'scan_code', 'Code scanning', 'code scanning'),
    ], note: 'As GitHub reports it today, not for the selected period.' },
  ] };
}

// Report names as the pages show them.
export const REPORTS = { dora, flow: efficiency, quality, planning: predictability, security } as const;
