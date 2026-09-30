import { REPORTS, flatMeasures, sliceRange, type Measure } from './reports.js';
import { AREAS, DRILL, HEADLINES } from './performance.js';

// What each measure means and why it matters. "How it is calculated" and the target come from the measure itself
// (reports.ts), so the explanation cannot drift from the number. Shown behind "What is this?" and on the Metrics page.

export interface DoraBand { tier: 'Elite' | 'High' | 'Medium' | 'Low'; test: string; min?: number; max?: number }
export interface MetricInfo { id: string; area: string; headline: boolean; explains: string | null; name: string; why: string; how: string; target: string | null; dora?: DoraBand[] }

// DORA performance bands, from the DORA State of DevOps research (2023 clusters). Approximate: the research reports ranges.
const DORA: Record<string, DoraBand[]> = {
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
  change_failure_rate: [
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
};

// The DORA tier for a value, or null if the measure is not one of the four.
export function doraTier(id: string, value: number): DoraBand['tier'] | null {
  const bands = DORA[id];
  return bands ? bands.find((b) => (b.min != null ? value >= b.min : b.max != null ? value <= b.max : true))!.tier : null;
}

const WHY: Record<string, string> = {
  // Planning and execution
  deploy_frequency: 'How often value reaches users. Teams that release often release smaller, safer changes and learn faster.',
  lead_time: 'How long a change takes from first commit to running in production. The clearest single measure of speed.',
  stage_coding: 'Time spent writing a change before it is opened for review. Long coding time usually means big changes.',
  stage_review: 'Time a change waits for and goes through review. Often the biggest and easiest part of lead time to cut.',
  stage_deploy: 'Time finished work waits to be released. Pure waste: the work is done but no one can use it.',
  handoff_rate: 'Full-stack work handed between a backend and a frontend person instead of owned end to end. Each hand-off is a queue, a context switch and a chance for the requirement to change hands.',
  handoff_wait: 'What a hand-off costs: the days a ticket sits between the person who finished one side and the person who starts the other.',
  lane_crossing: 'Whether engineers work across frontend and backend. A team where everyone stays in one lane cannot own tickets end to end, and every ticket waits for a partner.',
  sprint_completion: 'Whether the team delivers what it commits to. Low completion makes every plan built on it unreliable.',
  unplanned_work: 'Work that did not exist when the sprint was planned. A common reason sprints are missed.',
  scope_added: 'Existing work pulled into a sprint after it started. Changes the plan the team committed to.',
  carry_over: 'Work not finished by the end of its sprint and rolled into the next.',
  requirements_changed: 'Requirements that change after work has started mean rework, retesting and a sprint that cannot be planned. The ticket history shows every edit, when, and by whom.',
  sent_back: 'A ticket sent back to to do after it was started is work thrown away: the requirement was not ready, or changed.',
  ready_rate: 'Work started before it is ready (no estimate, no acceptance criteria) is the commonest cause of missed sprints: the team discovers the real work half way through.',
  // Quality
  defect_leakage: 'The share of bugs customers find rather than the team. The quality outcome customers actually feel.',
  done_rate: 'Tickets marked done without a reviewed pull request, tests or QA are where bugs that reach customers come from. Done has to mean the same thing every time.',
  bugs_per_change: 'Bugs raised for the amount of change shipped. Rising means quality is slipping as the team goes faster.',
  qa_rejection: 'Work sent back from testing. Each rejection is rework and delay.',
  pr_review_rate: 'Code merged without anyone else reviewing it. Unreviewed code is where most escaped bugs come from.',
  quality_gate_pass: 'Whether new code passes the SonarQube quality gate the team set for itself.',
  new_code_coverage: 'How much of the code written now is covered by tests. New code, so legacy code does not count against the team.',
  test_pass_rate: 'Automated tests passing. Failing tests either catch real bugs or have stopped being trusted.',
  bug_workload: 'The share of finished work that is bug fixing: the cost of poor quality in time not spent on features.',
  bug_lead_time: 'How long bugs take to fix once raised.',
  bug_fix_find: 'Bugs fixed against bugs found. Under 100% means the bug backlog is growing.',
  revert_ratio: 'Changes undone after merging. Each revert is work thrown away.',
  // Stability and support
  change_failure_rate: 'How often a change to production breaks something and needs a fix. Speed only counts if this stays low.',
  time_to_restore: 'How fast service comes back after an incident. Failures happen; recovering fast is what users notice.',
  incidents: 'Production incidents (Sev0 to Sev2) in the period.',
  server_errors: 'Requests that failed with a server error. Users see these as errors on screen.',
  availability: 'How much of the time the service answered its availability tests.',
  incidents_out_of_hours: 'Incidents that fired at night or at the weekend: someone is pulled out of bed, with no on-call rota to share it.',
  sla_resolution: 'Whether customers\' support requests are resolved within the time agreed for their priority.',
  sla_response: 'Whether customers get a first answer within the agreed time. Silence is what customers mind most.',
  support_response_time: 'How long customers wait for a first answer.',
  support_resolution_time: 'How long customers wait for a fix.',
  support_per_week: 'How much support arrives. Rising volume explains slower delivery before anyone asks.',
  support_open: 'Support requests not yet resolved. A growing queue means customers waiting.',
  support_share: 'The share of the team\'s finished work that is support. A plan that ignores it will be missed.',
  support_repeat: 'Tickets reopened after being resolved, or raised again as duplicates: fixes that did not hold.',
  support_out_of_hours: 'Support work done at night or at the weekend. Invisible in delivery numbers, and it burns people out.',
  // Flow
  flow_efficiency: 'The share of a ticket\'s time spent being worked on rather than waiting. The one number that says whether work flows.',
  flow_time: 'How long work items take from being raised to done.',
  flow_load: 'Work in progress now. Too much at once means context switching and everything finishing later.',
  flow_velocity: 'Work items finished per week. A trend for the team, not a comparison between teams.',
  pickup_time: 'How long a change waits for its first review.',
  review_time: 'How long from first review to merge.',
  pr_size: 'Lines changed per pull request. Big changes get slow, shallow reviews and hide bugs.',
  reviewer_load: 'The share of reviews done by the busiest reviewer. High means one person is the bottleneck.',
  ci_failure_rate: 'How often the build on the main branch fails. A red main blocks everyone.',
  // Security
  security_on_time: 'Whether serious security issues (vulnerable libraries, flaws in the team\'s code, leaked secrets) are fixed within their deadline. What auditors ask.',
  security_overdue: 'Open security issues already past their fix deadline: the list to work through first.',
  secrets_open: 'Leaked passwords and keys not yet revoked. Anyone who has seen the code can use them until then.',
  security_fix_critical: 'How long critical security issues stay open.',
  security_fix_high: 'How long high severity security issues stay open.',
  security_open_critical_high: 'Critical and high security issues open now, within their deadline or not.',
  security_dismissed: 'Security issues dismissed rather than fixed. Sometimes right, but it must be visible.',
  scan_dependency: 'Repos checked for vulnerable libraries. A repo with scanning off looks safe when it is not.',
  scan_secret: 'Repos checked for leaked passwords and keys.',
  scan_code: 'Repos checked for security flaws in the team\'s own code.',
};

const targetText = (m: Measure) => (m.target ? `${m.target.op === '<' ? 'Under' : 'Over'} ${m.target.value}${m.unit === '%' ? '%' : m.unit === 'count' ? '' : ` ${m.unit}`}` : null);

let catalogue: MetricInfo[] | null = null;
export function metricCatalogue(): MetricInfo[] {
  if (catalogue) return catalogue;
  const empty = sliceRange('all', 0, 1);
  const ms = new Map(Object.values(REPORTS).flatMap((fn) => flatMeasures(fn(empty))).map((m) => [m.id, m]));
  const areaOf = (h: string) => AREAS.find((a) => (a.headlines as readonly string[]).includes(h))!;
  catalogue = HEADLINES.flatMap((h) => [h, ...DRILL[h]].flatMap((id) => {
    const m = ms.get(id); if (!m) return [];
    return [{ id, area: areaOf(h).title, headline: id === h, explains: id === h ? null : h, name: m.title.replace(/ \(median\)$/, ''), why: WHY[id] ?? '', how: m.how, target: targetText(m), dora: DORA[id] }];
  }));
  return catalogue;
}
export const metricById = (id: string) => metricCatalogue().find((m) => m.id === id);
