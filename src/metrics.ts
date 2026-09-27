import { rules } from './rules/sprintRules.js';
import { flowRules } from './rules/flowRules.js';
import { qualityRules } from './rules/qualityRules.js';
import { docsRules } from './rules/docsRules.js';

// What each metric means, why it matters, and how it is calculated. Shown behind "What is this?" on every
// finding and on the Metrics page. The formulas match METRICS.md; thresholds come from the rule definitions
// where they are exported, so the explanation cannot drift from what is scored.

export type Area = 'Sprint process' | 'Flow & DORA' | 'Quality' | 'Features' | 'Production & cost' | 'Docs' | 'Claude' | 'Scores';
export interface DoraBand { tier: 'Elite' | 'High' | 'Medium' | 'Low'; test: string; min?: number; max?: number }
export interface MetricInfo { id: string; area: Area; name: string; why: string; how: string; thresholds?: string; dora?: DoraBand[] }

type Def = { amber: number; red: number; direction: 'high_bad' | 'low_bad'; unit: string };
const fmt = (v: number, unit: string) => (unit === '%' ? `${v}%` : unit === 'days' ? `${v} ${v === 1 ? 'day' : 'days'}` : String(v));
const band = (d: Def) => d.direction === 'high_bad'
  ? `Green below ${fmt(d.amber, d.unit)}, amber from ${fmt(d.amber, d.unit)}, red from ${fmt(d.red, d.unit)}.`
  : `Green above ${fmt(d.amber, d.unit)}, amber at ${fmt(d.amber, d.unit)} or below, red at ${fmt(d.red, d.unit)} or below.`;
const defs: Record<string, Def> = Object.fromEntries([...rules, ...flowRules, ...qualityRules, ...docsRules].map((r) => [r.id, r]));

const W = (area: Area, id: string, name: string, why: string, how: string, thresholds?: string, dora?: DoraBand[]): MetricInfo =>
  ({ id, area, name, why, how, thresholds: thresholds ?? (defs[id] ? band(defs[id]) : undefined), dora });

// DORA performance bands, from the DORA State of DevOps research (2023 clusters). Approximate: the research reports ranges.
const DORA = {
  deploy_frequency: [
    { tier: 'Elite', test: 'On demand, several a day (7 or more a week)', min: 7 },
    { tier: 'High', test: 'Between daily and weekly', min: 1 },
    { tier: 'Medium', test: 'Between weekly and monthly', min: 0.23 },
    { tier: 'Low', test: 'Less than monthly' },
  ],
  lead_time: [
    { tier: 'Elite', test: 'Less than a day', max: 1 },
    { tier: 'High', test: 'A day to a week', max: 7 },
    { tier: 'Medium', test: 'A week to a month', max: 30 },
    { tier: 'Low', test: 'More than a month' },
  ],
  change_failure: [
    { tier: 'Elite', test: '5% or less', max: 5 },
    { tier: 'High', test: '10% or less', max: 10 },
    { tier: 'Medium', test: '15% or less', max: 15 },
    { tier: 'Low', test: 'More than 15%' },
  ],
  time_to_restore: [
    { tier: 'Elite', test: 'Less than an hour', max: 1 },
    { tier: 'High', test: 'Less than a day', max: 24 },
    { tier: 'Medium', test: 'Less than a week', max: 168 },
    { tier: 'Low', test: 'More than a week' },
  ],
} satisfies Record<string, DoraBand[]>;

// The DORA tier for a value, or null if the metric is not one of the four.
export function doraTier(id: string, value: number): DoraBand['tier'] | null {
  const bands = (DORA as Record<string, DoraBand[]>)[id];
  if (!bands) return null;
  return bands.find((b) => (b.min != null ? value >= b.min : b.max != null ? value <= b.max : true))!.tier;
}

const catalogue: MetricInfo[] = [
  // Scores
  W('Scores', 'score', 'Health scores (0 to 100)',
    'One number per area so a team can see at a glance where to look first. The checks underneath matter more than the score.',
    'Each check has a weight. Green earns its full weight, amber half, red nothing. Score = points earned ÷ points possible × 100. Checks with no data are left out, not scored as zero. "What moves this score" lists the checks with the most points to gain.',
    'Healthy: 75 and above. Watch: 50 to 74. Needs attention: below 50.'),

  // Sprint process
  W('Sprint process', 'commit_completion', 'Sprint commitment delivered',
    'The product team plans around what engineering commits to. Missing the commitment every sprint teaches everyone to ignore the plan.',
    'Story points done ÷ story points committed. Committed means estimated items that were in the sprint before it started (from the Jira changelog).'),
  W('Sprint process', 'carry_over', 'Work carried over',
    'Carried work is work that was started and not finished. It hides in the next sprint, inflates it, and makes delivery look better than it is.',
    'Items that were also in an earlier sprint ÷ all work items in the sprint (sub-tasks excluded).'),
  W('Sprint process', 'scope_added_mid_sprint', 'Scope added after the sprint started',
    'Unplanned work pushes out planned work. A little is normal; a lot means interrupts are not being routed through the product owner.',
    'Items added to the sprint after its start date ÷ all work items. The add date comes from the Sprint field in the changelog.'),
  W('Sprint process', 'no_estimate', 'Items without an estimate',
    'An unestimated item cannot be planned, so the commitment is a guess. It is also the first condition of the headcount gate.',
    'Work items with no story points ÷ all work items.'),
  W('Sprint process', 'no_acceptance_criteria', 'Stories without acceptance criteria',
    'Without acceptance criteria nobody agrees what done means, which shows up later as rework and escaped bugs.',
    'Stories with no acceptance criteria ÷ stories. Found in the JIRA_AC_FIELD field if set, otherwise in the description ("Acceptance criteria", Given/When/Then, "AC:").'),
  W('Sprint process', 'unassigned', 'In-progress items with no owner',
    'Work nobody owns drifts. It is also invisible in stand-up because nobody speaks to it.',
    'Count of In Progress items with no assignee.'),
  W('Sprint process', 'stale_in_progress', 'Work in progress far longer than normal',
    'Long-running tickets are where quality and predictability go. Stuck work usually means blocked, too big, or under-estimated.',
    'Count of items in progress at the sprint\'s end (or now for the sprint in progress), taken from each ticket\'s status history, that had been in progress more than 3x the team\'s median cycle time for their size (5 days where the size has no history).'),
  W('Sprint process', 'cycle_time_vs_size', 'Tickets that took far longer than their size',
    'A 3 point ticket that takes three weeks is a question worth asking: blocked, unclear, or wrongly sized. Compared with the team\'s own norm, not an outside standard.',
    'Done tickets whose cycle time (In Progress to resolved) was more than double the team\'s median for that point size, and at least 2 days over, ÷ done tickets with a cycle time.'),
  W('Sprint process', 'sprint_goal', 'Sprint has a goal',
    'A goal lets the team make trade-offs mid-sprint without asking. Without one every ticket is equally important.',
    '1 if the sprint goal in Jira is longer than 10 characters, otherwise 0.', 'Red if missing.'),

  // Flow & DORA
  W('Flow & DORA', 'pickup_time', 'Time to first review',
    'A PR waiting for review is finished work nobody can use. Long waits make people start something else, which makes everything slower.',
    'Median time from PR opened to the first review or review comment by someone other than the author, merged PRs, in days.'),
  W('Flow & DORA', 'review_time', 'Review to merge',
    'Long review cycles mean big PRs or back and forth. Both slow delivery and both are fixable.',
    'Median time from first review to merge, in days.'),
  W('Flow & DORA', 'pr_size', 'PR size',
    'Small PRs get reviewed properly and quickly. Large ones get skimmed, and skimmed code is where defects hide.',
    'Median lines changed (additions + deletions) per merged PR.'),
  W('Flow & DORA', 'stale_prs', 'Stale PRs',
    'Open PRs age into merge conflicts and forgotten work.',
    'Count of open, non-draft PRs older than 72 hours.'),
  W('Flow & DORA', 'no_jira_link', 'PRs with no Jira ticket',
    'Code with no ticket cannot be traced to a requirement or a feature, and its cost lands nowhere.',
    'Merged PRs with no Jira key (like OSSI-123) in the title, branch or body ÷ merged PRs.'),
  W('Flow & DORA', 'reviewer_load', 'Review concentration',
    'When one person does most reviews, everyone waits for them and knowledge stays with one head.',
    'Reviews by the busiest reviewer ÷ all reviews on merged PRs.'),
  W('Flow & DORA', 'lane_crossing', 'Engineers working across frontend and backend',
    'Teams that stay in lanes hand work off, and every handoff is a wait. People who can work both sides ship features end to end.',
    'Engineers with 5 or more merged PRs in the period who merged work in both frontend and backend paths (any repo, paths from GITHUB_LANES) ÷ those engineers.'),
  W('Flow & DORA', 'ci_red_rate', 'CI failure rate',
    'A red build blocks everyone and trains people to ignore failures.',
    'Failed CI runs ÷ (successful + failed) on each repo\'s default branch, excluding the deploy workflow. Runs on feature branches are left out: failing there is normal work in progress.'),
  W('Flow & DORA', 'deploy_frequency', 'Deployment frequency (DORA)',
    'One of the four DORA measures. Teams that deploy often ship smaller changes, which are safer and easier to fix.',
    'Successful runs of the production deploy workflow (GITHUB_DEPLOY_WORKFLOW) ÷ weeks in the window.', undefined, DORA.deploy_frequency),
  W('Flow & DORA', 'lead_time', 'Lead time for changes (DORA)',
    'One of the four DORA measures: how long a change takes to reach users. It is what the business feels as speed.',
    'Median days from a PR\'s first commit (author date; PR opened if commit data is missing) to the first successful production deploy of its own repo after it merged. A repo with no deploy workflow of its own falls back to the team\'s deploys. PRs never deployed are left out.', undefined, DORA.lead_time),
  W('Flow & DORA', 'change_failure', 'Change failure rate (DORA)',
    'One of the four DORA measures: how often a change breaks production. Speed only counts if it holds.',
    '(Hotfix or revert PRs + failed deploys) ÷ (merged PRs + failed deploys). A hotfix has "hotfix" or "revert" in its title or branch.', undefined, DORA.change_failure),

  // Quality
  W('Quality', 'quality_gate', 'SonarQube quality gate',
    'The gate is the team\'s own definition of shippable code. A failing gate that nobody fixes means the definition is not real.',
    'SonarQube quality gate status for the project: 1 if passed, 0 if failed.', 'Red if failing.'),
  W('Quality', 'coverage', 'Test coverage, overall',
    'Information only, not scored. Context only. Legacy code drags this down; do not chase it. New code coverage is the number to act on.',
    'SonarQube coverage for the project.'),
  W('Quality', 'new_code_coverage', 'Test coverage on new code',
    'Whether the code being written now is tested. It is the one coverage number a team can control, and a headcount gate condition.',
    'SonarQube coverage on new code, for the new code period set in SonarQube.'),
  W('Quality', 'vulnerabilities', 'Open vulnerabilities',
    'In a regulated healthcare environment an open vulnerability is a compliance exposure, not a backlog item.',
    'SonarQube vulnerability count.'),
  W('Quality', 'sonar_bugs', 'SonarQube bugs',
    'Static analysis bugs are defects found before users find them. Cheap to fix now, expensive later.',
    'SonarQube bug count.'),
  W('Quality', 'duplication', 'Duplicated code',
    'Duplicated code means every fix has to be made twice, and one copy gets missed.',
    'SonarQube duplicated lines density.'),
  W('Quality', 'test_pass_rate', 'Automated test pass rate',
    'A suite that is often red is ignored, and then it protects nothing.',
    'Tests passed ÷ tests run, pooled over every Testmo automation run in the last 30 days. Not measured when there were no runs.'),
  W('Quality', 'test_runs', 'Automated test runs',
    'Tests only help if they run. Frequent runs catch problems while the change is still fresh.',
    'Testmo automation runs in the last 30 days.'),
  W('Quality', 'automation_share', 'Share of tests automated',
    'Manual regression is what makes releases slow. Automating it shortens every release after.',
    'Automated tests ÷ (automated + manual test cases) in Testmo.'),

  // Features
  W('Features', 'feature_lead_time', 'Feature lead time',
    'Product sees features, not tickets. This is the number they judge engineering by.',
    'Median days from epic created to epic done, for epics resolved in the last 180 days.',
    'Green at 45 days or under, amber up to 90, red over 90.'),
  W('Features', 'feature_wip', 'Features in progress at once',
    'Starting many features at once means finishing each one later. Fewer in flight ships each sooner.',
    'Count of epics in the In Progress status category.',
    'Green up to 3, amber 4 or 5, red over 5.'),
  W('Features', 'feature_cost', 'Cost to build a feature',
    'What a feature really cost, and what the rest will cost at the current pace. Lets product weigh value against cost, and shows how much of the team goes on work that is no feature at all.',
    'Each person\'s sprint cost (day rate × working days) is split across the tickets they worked that sprint, weighted by story points; unestimated tickets count as the median size. A feature\'s cost is the sum over its tickets. FTE and contractor rates are configured separately (RATE_FTE_DAY, RATE_CONTRACTOR_DAY, CONTRACTORS, RATE_OVERRIDES). To complete = remaining points × the team\'s cost per point. An estimate, not accounting.',
    'Informational. Compare features with each other and over time.'),
  W('Features', 'cost_per_point', 'Cost per story point',
    'The price of a unit of delivered work. Falls when the team gets more done for the same cost.',
    'Team cost over the sprints seen ÷ story points done in those sprints.', 'Informational.'),
  W('Features', 'cost_off_features', 'Cost not on features',
    'Money spent on work with no feature (unplanned work, support, bugs without an epic) or by people with no ticket that sprint. Some is healthy; a lot means the plan is not where the money goes.',
    'Cost of tickets with no epic, plus the sprint cost of people who touched no ticket that sprint, ÷ team cost.', 'Informational.'),

  // Production & cost
  W('Production & cost', 'failed_requests', 'Server errors',
    'Requests the service failed to handle: the errors users see that are the service\'s fault.',
    'Application Insights requests with a 5xx result code ÷ all requests, last 30 days. 4xx responses (not found, not signed in) are not the service failing.',
    'Green under 1%, amber from 1%, red from 3%.'),
  W('Production & cost', 'availability', 'Availability',
    'Whether the service was there when users needed it.',
    'Application Insights availability tests passed ÷ run, last 30 days.',
    'Green at 99.9% or above, amber from 99.5%, red below 99.5%.'),
  W('Production & cost', 'incidents', 'Incidents',
    'Each serious incident costs users trust and costs the team a day.',
    'Sev0 to Sev2 alerts fired in the last 30 days for the team\'s resource group.',
    'Green up to 1, amber 2 to 4, red 5 or more.'),
  W('Production & cost', 'time_to_restore', 'Time to restore (DORA)',
    'One of the four DORA measures: failures will happen, so how fast service comes back matters most.',
    'Median time from alert fired to alert resolved, in hours.',
    'Green under 1 hour, amber under 24, red 24 or more.', DORA.time_to_restore),
  W('Production & cost', 'cloud_cost', 'Cloud cost',
    'Context for cost per feature, and a check that spend tracks usage.',
    'Azure Cost Management actual cost for the team\'s resource group, last full calendar month.', 'Informational.'),

  // Claude
  W('Claude', 'claude_seat_cost', 'Claude seat cost',
    'What the team pays for Claude, so AI shows up in cost per feature like any other cost.',
    'Seats × CLAUDE_SEAT_MONTHLY. Seat holders are CLAUDE_SEATS, or everyone on the roster. In cost per feature the seat is added to the holder\'s day rate: monthly price × 12 ÷ working days in a year.',
    'Informational.'),
  W('Claude', 'claude_adoption', 'Claude Code adoption',
    'A seat nobody uses is pure cost. Adoption shows whether the team has made Claude part of how it works, and where help is needed.',
    'People on the team roster with any Claude Code activity in the last CLAUDE_DAYS (30) ÷ people on the roster. Activity comes from Claude Code\'s own OpenTelemetry metrics.',
    'Informational. Low adoption is a question for the team, not a verdict on anyone.'),
  W('Claude', 'claude_acceptance', 'Edit acceptance rate',
    'How often people keep what Claude proposes. Very low means it is not helping on this codebase; very high with no review is worth a look.',
    'Accepted ÷ (accepted + rejected) Edit, Write and NotebookEdit proposals, from claude_code.code_edit_tool.decision.', 'Informational.'),
  W('Claude', 'claude_output', 'Output through Claude Code',
    'Lines, commits and PRs made through Claude Code, next to the GitHub numbers, so AI\'s share of the work is visible.',
    'Sums of claude_code.lines_of_code.count, commit.count and pull_request.count for the team\'s people over the window.', 'Informational.'),
  W('Claude', 'claude_api_equivalent', 'API-equivalent value',
    'What the same usage would cost at API prices. On a seat plan this is not billed; it shows how much the seats are worth.',
    'Sum of claude_code.cost.usage (tokens priced at API rates, USD) × USD_TO_CURRENCY.', 'Informational. Not billed on a Team plan.'),

  // Docs
  W('Docs', 'stale_docs', 'Pages untouched for 90+ days',
    'Stale docs are worse than none: people follow them and get it wrong.',
    'Pages last edited over 90 days ago ÷ pages in the team\'s Confluence spaces.'),
  W('Docs', 'runbook_coverage', 'Runbooks per service',
    'At 3 a.m. the runbook is the difference between a 20 minute and a 4 hour outage. Missing runbooks are also an audit finding.',
    'Pages classified as runbooks ÷ repos configured for the team. Classified by CONFLUENCE_RUNBOOK_MARKERS in the title or labels.'),
  W('Docs', 'adr_activity', 'Architecture decisions recorded',
    'Unwritten decisions get re-argued every sprint, and nobody can tell whether architecture work is happening.',
    'ADR pages created in the last 90 days, classified by CONFLUENCE_ADR_MARKERS.'),
];

// Plain-language band for a 0 to 100 score. Same cut-offs as green, amber and red.
export const BANDS = [{ min: 75, label: 'Healthy' }, { min: 50, label: 'Watch' }, { min: 0, label: 'Needs attention' }] as const;
export const bandFor = (score: number) => BANDS.find((b) => score >= b.min)!.label;

export function metricCatalogue(): MetricInfo[] { return catalogue; }
export const metricById = (id: string) => catalogue.find((m) => m.id === id);
