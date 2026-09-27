import { store } from './store/index.js';
import { quality, predictability, efficiency, flatMeasures, withPrevious, type Measure } from './reports.js';
import { doraSeries } from './dora.js';
import { currentSprint } from './sprintNow.js';
import { teamSummary } from './summary.js';

// The simple dashboard: each team in plain English. Four questions anyone can read, answered Yes / Partly / No with
// one sentence and a number. Built from the same measures as the detailed pages, so the two never disagree.
export type Answer = 'Yes' | 'Partly' | 'No' | 'Not enough data';
export interface Question { id: string; question: string; answer: Answer; sentence: string }

const pct = (v: number) => `${Math.round(v)}%`;
const usable = (m?: Measure) => !!m && m.value != null && !m.smallSample;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const days = (d: number) => (d < 1 ? 'less than a day' : d < 1.5 ? 'about a day' : `about ${Math.round(d)} days`);

// Plain names for the measures that can appear under "fix first" and "getting worse".
const PLAIN: Record<string, string> = {
  change_failure_rate: 'Too many changes break something and need a fix',
  bugs_per_change: 'Too many bugs for the amount of change',
  defect_leakage: 'Customers are finding bugs before the team does',
  pr_review_rate: 'Code is going live without a second person checking it',
  pr_review_comment_rate: 'Code reviews rarely say anything',
  time_to_restore: 'Outages take too long to fix',
  bug_lead_time: 'Bugs take too long to fix',
  bug_fix_find: 'Bugs are being found faster than they are fixed',
  bug_workload: 'Too much of the team\'s time goes on bugs',
  revert_ratio: 'Too many changes are being undone',
  sprint_completion: 'The team finishes less than it promises',
  unplanned_work: 'Too much work arrives that was not planned',
  scope_added: 'Work keeps being added after the sprint has started',
  use_of_branches: 'Code is changed without going through a review',
  merged_with_pr: 'Code is merged without a review',
  prs_traceable: 'Work is done that is not linked to a ticket',
  tickets_estimated: 'Work is started without being sized',
  tickets_in_sprint: 'Work is done outside the sprint plan',
  tickets_in_epic: 'Work is not linked to a feature',
  epics_with_due_date: 'Features have no due date',
  pr_cycle_hours: 'Changes take too long to be approved',
  pickup_time: 'Changes wait too long for someone to look at them',
  review_time: 'Reviews take too long to finish',
  pr_size: 'Changes are too big to review properly',
  cycle_time: 'Tickets take too long once started',
  qa_rejection: 'Work sent to testing keeps coming back', flow_efficiency: 'Work spends most of its time waiting',
  flow_time: 'Work takes too long from request to done', flow_velocity: 'Little work is being finished', flow_load: 'Too much work is started at once',
  stage_coding: 'Changes take long to write', stage_review: 'Changes take long to review', stage_deploy: 'Finished changes wait to be released',
  // Findings on the team pages
  commit_completion: 'The team finishes less than it promises', carry_over: 'Unfinished work keeps rolling into the next sprint',
  scope_added_mid_sprint: 'Work keeps being added after the sprint has started', no_estimate: 'Work is started without being sized',
  no_acceptance_criteria: 'Work starts without an agreed definition of done', unassigned: 'Some work in progress has nobody responsible',
  stale_in_progress: 'Work gets stuck half done',
  cycle_time_vs_size: 'Some tickets take far longer than their size suggests', sprint_goal: 'Sprints have no clear goal',
  stale_prs: 'Changes sit waiting and go stale',
  no_jira_link: 'Work is done that is not linked to a ticket', reviewer_load: 'One person does most of the reviewing',
  lane_crossing: 'Few people work on both the front end and the back end', ci_red_rate: 'Automated checks fail too often',
  deploy_frequency: 'Changes are released too rarely', lead_time: 'Changes take too long to reach customers', change_failure: 'Too many changes break something and need a fix',
  quality_gate: 'The code quality check is failing', coverage: 'Too little of the code is tested', new_code_coverage: 'New code is not being tested',
  vulnerabilities: 'There are open security issues', sonar_bugs: 'Automated scans find bugs in the code', duplication: 'Too much copied code',
  test_pass_rate: 'Automated tests are failing', test_runs: 'Automated tests are not run often enough', automation_share: 'Too much testing is done by hand',
   feature_lead_time: 'Features take too long from idea to done',
  feature_wip: 'Too many features are started at once', failed_requests: 'Users are seeing errors', availability: 'The service is not always available',
  incidents: 'There are too many incidents', cloud_cost: 'Cloud spend',
  stale_docs: 'Documentation is out of date', runbook_coverage: 'Services have no runbook for when things go wrong',
  adr_activity: 'Architecture decisions are not written down',
};
export const plainName = (id: string, fallback: string) => PLAIN[id] ?? fallback;

export function simpleTeam(board: string, now = Date.now()) {
  const s = teamSummary(board);
  if (!s) return null;
  const all = [quality, predictability, efficiency].flatMap((fn) => flatMeasures(withPrevious(board, 30, fn, now)));
  const m = (id: string) => all.find((x) => x.id === id);
  const q: Question[] = [];

  // 1. Delivering what it promised: sprint completion over the last 30 days.
  const sc = m('sprint_completion');
  q.push(!usable(sc) ? { id: 'promises', question: 'Is the team delivering what it promised?', answer: 'Not enough data', sentence: 'No finished sprints with estimates in the last 30 days.' }
    : { id: 'promises', question: 'Is the team delivering what it promised?', answer: sc!.value! >= 80 ? 'Yes' : sc!.value! >= 60 ? 'Partly' : 'No',
      sentence: `It finished ${pct(sc!.value!)} of the work it committed to in its last sprints. Good teams finish 80% or more.` });

  // 2. The sprint in progress.
  const cs = currentSprint(board, false, now);
  q.push(!cs ? { id: 'sprint', question: 'Is the current sprint on track?', answer: 'Not enough data', sentence: 'No sprint in progress.' }
    : { id: 'sprint', question: 'Is the current sprint on track?', answer: cs.outlook === 'On track' ? 'Yes' : cs.outlook === 'At risk' ? 'Partly' : cs.outlook === 'Off track' ? 'No' : 'Not enough data',
      sentence: `${cs.points.done} of ${cs.points.scope} points done with ${cs.workingDaysLeft} working ${cs.workingDaysLeft === 1 ? 'day' : 'days'} left. At the current pace it will finish about ${Math.round(cs.points.projected)}.` });

  // 3. Quality: changes that broke something, and bugs customers found.
  const cfr = m('change_failure_rate'), leak = m('defect_leakage');
  const parts = [usable(cfr) ? `${pct(cfr!.value!)} of changes needed a fix afterwards (good: under 10%).` : '',
    usable(leak) ? `${pct(leak!.value!)} of bugs were found in production rather than before release (good: under 20%).` : ''].filter(Boolean);
  const misses = [cfr, leak].filter((x) => usable(x) && x!.met === false).length, known = [cfr, leak].filter(usable).length;
  q.push(!known ? { id: 'quality', question: 'Is quality good?', answer: 'Not enough data', sentence: 'Not enough changes or labelled bugs in the last 30 days.' }
    : { id: 'quality', question: 'Is quality good?', answer: misses === 0 ? 'Yes' : misses < known ? 'Partly' : 'No', sentence: parts.join(' ') });

  // 4. Speed: DORA lead time, from a change being started to it being live.
  // Speed. Three different situations, said differently: nothing released at all (a clear No when work was finished),
  // released but not yet this period's changes, and a measured lead time.
  const dm = doraSeries(board, 30, now).metrics, lt = dm.find((x) => x.id === 'lead_time'), df = dm.find((x) => x.id === 'deploy_frequency');
  const finished = m('pr_cycle_hours')?.den ?? 0, speedQ = 'How fast do changes reach customers?';
  q.push(lt && lt.value != null
    ? { id: 'speed', question: speedQ, answer: lt.tier === 'Elite' || lt.tier === 'High' ? 'Yes' : lt.tier === 'Medium' ? 'Partly' : 'No',
        sentence: `${cap(days(lt.value))} from starting a change to it being live. The best teams take under a day; good teams under a week.` }
    : !df?.value && finished > 0
      ? { id: 'speed', question: speedQ, answer: 'No', sentence: `Nothing was released in the last 30 days, although ${finished} changes were finished. Finished work is waiting to reach customers.` }
      : df?.value
        ? { id: 'speed', question: speedQ, answer: 'Not enough data', sentence: 'Releases happened, but none of the changes finished in the last 30 days has been released yet.' }
        : { id: 'speed', question: speedQ, answer: 'Not enough data', sentence: 'No changes were finished or released in the last 30 days.' });

  // What to fix first: the biggest score gains. Getting worse: targets missed two periods running.
  const fixFirst = s.gains.slice(0, 2).map((g) => plainName(g.metric, g.title));
  const worse = all.filter((x) => x.met === false && x.previousMet === false && !x.smallSample).map((x) => plainName(x.id, x.title));
  const yes = q.filter((x) => x.answer === 'Yes').length, no = q.filter((x) => x.answer === 'No').length;
  const worseList = [...new Set(worse)];
  const base = no === 0 && yes >= 3 ? 'Doing well' : no >= 2 ? 'Struggling in several areas' : no === 1 ? 'Mostly fine, with one clear problem' : 'Some things to watch';
  // Never "doing well" without saying what keeps missing its target.
  const summary = worseList.length && no === 0 ? `${base} overall, but ${worseList.length === 1 ? 'one thing keeps missing its target' : `${worseList.length} things keep missing their targets`}.` : `${base}.`;
  return { board, band: s.band, score: s.score, summary, questions: q, fixFirst, worse: worseList.slice(0, 3), worseCount: worseList.length };
}

export const simpleDashboard = (now = Date.now()) =>
  [...new Set(store.scorecards().map((c) => c.board))].sort((a, b) => a.localeCompare(b)).flatMap((b) => { const t = simpleTeam(b, now); return t ? [t] : []; });
