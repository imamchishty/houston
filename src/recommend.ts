import type { Finding, Rag, Scorecard, PersonStats } from './types.js';
import type { GithubPersonStats } from './githubPeople.js';

export interface Recommendation {
  id: string;
  title: string;
  why: string;          // the evidence, in plain English with numbers
  what: string[];       // concrete steps, in order
  owner: 'Tech lead' | 'Product owner' | 'VP Engineering' | 'Team';
  horizon: 'This sprint' | 'Next 2 sprints' | 'This quarter';
  impact: 'high' | 'medium';
}

export interface HeadcountGate {
  ready: boolean;
  criteria: { name: string; target: string; actual: string; met: boolean }[];
  verdict: string;
}

type Ctx = {
  card: Scorecard;                  // latest sprint scorecard
  history: Scorecard[];             // oldest to newest
  quality: { score: number; rag: Rag; findings: Finding[] } | null;
  people: PersonStats[];
  flow?: { score: number; rag: Rag; findings: Finding[] } | null;
  github?: GithubPersonStats[];
  docs?: { score: number; rag: Rag; findings: Finding[] } | null;
  docsPeople?: { name: string; created: number; edited: number; adrs: number; runbooks: number }[];
  features?: { score: number; rag: Rag; findings: Finding[] } | null;
  named?: boolean;                  // false for shared outputs: names become a count
  diag?: import('./diag.js').Diag;  // flow numbers for the three flow diagnoses
};
const dc = (c: Ctx, id: string) => c.docs?.findings.find((x) => x.ruleId === id);
const ft = (c: Ctx, id: string) => c.features?.findings.find((x) => x.ruleId === id);
const fl = (c: Ctx, id: string) => c.flow?.findings.find((x) => x.ruleId === id);

const f = (c: Ctx, id: string) => c.card.findings.find((x) => x.ruleId === id);
const q = (c: Ctx, id: string) => c.quality?.findings.find((x) => x.ruleId === id);
// Names only for people viewers. Shared outputs (digest, Teams, other users) get a count and a pointer to the people view.
const who = (c: Ctx, names: string[], sep = ', ') =>
  c.named === false ? `${names.length} ${names.length === 1 ? 'person' : 'people'} (names in the people view)` : names.join(sep);
const bad = (x?: Finding) => !!x && x.rag !== 'green';
const red = (x?: Finding) => !!x && x.rag === 'red';

// Each pattern looks at several findings together. Order here is the order they are considered, not shown.
const patterns: ((c: Ctx) => Recommendation | null)[] = [
  // 1. Work is entering the sprint unready
  (c) => {
    const est = f(c, 'no_estimate'), ac = f(c, 'no_acceptance_criteria'), goal = f(c, 'sprint_goal');
    const hits = [est, ac, goal].filter(bad);
    if (hits.length < 2) return null;
    return {
      id: 'intake',
      title: 'Stop unready work entering the sprint',
      why: `${est?.value ?? 0}% of items have no estimate, ${ac?.value ?? 0}% of stories have no acceptance criteria${goal && bad(goal) ? ', and there is no sprint goal' : ''}. The team is committing to work nobody has defined, so under delivery is built in before the sprint starts.`,
      what: [
        'Add a Definition of Ready: estimate, acceptance criteria, and a named owner, or it does not enter planning.',
        'Put a Jira board filter on the sprint that hides unestimated items.',
        'Refinement becomes a fixed weekly session with the PO. Its only output is ready tickets for the next sprint.',
        'Planning does not start until the PO has written a one sentence sprint goal.',
      ],
      owner: 'Product owner', horizon: 'This sprint', impact: 'high',
    };
  },
  // 2. Over commitment
  (c) => {
    const cc = f(c, 'commit_completion'), co = f(c, 'carry_over');
    if (!bad(cc) && !bad(co)) return null;
    const last3 = c.history.slice(-3).map((h) => h.findings.find((x) => x.ruleId === 'commit_completion')?.value ?? null).filter((v): v is number => v != null);
    const avg = last3.length ? Math.round(last3.reduce((a, b) => a + b, 0) / last3.length) : null;
    return {
      id: 'commitment',
      title: 'Commit to what the team actually finishes',
      why: `${cc?.value ?? '?'}% of committed points were delivered this sprint${avg != null ? `, ${avg}% on average over the last three` : ''}, and ${co?.value ?? 0}% of items were carried over. Planning is optimistic every time, so every sprint ends with a miss and the product team stops believing the plan.`,
      what: [
        'Next sprint, cap commitment at the average points actually finished over the last three sprints. Not the velocity chart, the finished number.',
        'Any item entering its third sprint is split or dropped in planning.',
        'Publish the commitment and the result to the product team at the end of every sprint. Hitting a small number three times rebuilds more trust than one big plan.',
      ],
      owner: 'Tech lead', horizon: 'This sprint', impact: 'high',
    };
  },
  // 3. Interrupts
  (c) => {
    const add = f(c, 'scope_added_mid_sprint'), bugShare = c.diag?.bugWorkload ?? null; // bug workload, Quality report
    const bugsHigh = bugShare != null && bugShare >= 20;
    if (!bad(add)) return null;
    return {
      id: 'interrupts',
      title: 'Protect the sprint from unplanned work',
      why: `${add?.value}% of the sprint was added after it started${bugsHigh ? `, and bugs were ${Math.round(bugShare!)}% of the work finished in the last 30 days` : ''}. The team cannot deliver a plan that changes every week.`,
      what: [
        'All mid-sprint requests go through the PO, who swaps an equal size item out.',
        'Label unplanned work "interrupt" so Houston and the retro can see it.',
        bugsHigh ? 'Reserve a fixed 20% of capacity for bugs and interrupts, and plan features into the remaining 80%.' : 'Track the interrupt share for two sprints before deciding whether to reserve capacity.',
      ],
      owner: 'Product owner', horizon: 'Next 2 sprints', impact: 'medium',
    };
  },
  // 4. Flow: things stuck
  (c) => {
    const stuck = f(c, 'stale_in_progress'), slow = f(c, 'cycle_time_vs_size');
    if (!bad(stuck) && !bad(slow)) return null;
    const names = c.people.filter((p) => p.overBand >= 2 || p.stuckNow >= 1).map((p) => p.name);
    return {
      id: 'flow',
      title: 'Unstick work faster',
      why: `${stuck?.value ?? 0} items have been in progress more than three times longer than normal for their size, and ${slow?.value ?? 0}% of finished tickets took more than double the team's norm${names.length ? `. The same names recur: ${who(c, names)}` : ''}. Long running tickets are where quality and predictability both go.`,
      what: [
        'Standup reviews the oldest in-progress ticket first, every day. Split it, pair on it, or park it.',
        'WIP limit of 2 per person. Nobody starts a third ticket while two are open.',
        names.length ? `Have a one to one with ${who(c, names, ' and ')} this week. Ask what is blocking, not why it is late. Under-estimation, unclear tickets and dependencies are the usual answers, and all three are fixable by the team.` : 'Ask on each stuck ticket: under-estimated, blocked, or interrupted?',
      ],
      owner: 'Tech lead', horizon: 'This sprint', impact: 'high',
    };
  },
  // 5. Quality debt is eating delivery
  (c) => {
    const gate = q(c, 'quality_gate'), cov = q(c, 'new_code_coverage'), pass = q(c, 'test_pass_rate'), auto = q(c, 'automation_share');
    if (![gate, cov, pass, auto].some(bad)) return null;
    return {
      id: 'quality',
      title: 'Make quality a gate, not a hope',
      why: [
        red(gate) ? 'The SonarQube quality gate is failing' : null,
        bad(cov) ? `new code coverage is ${cov?.value}%` : null,
        bad(pass) ? `the automated suite passes ${pass?.value}%` : null,
        bad(auto) ? `only ${auto?.value}% of tests are automated` : null,
      ].filter(Boolean).join(', ') + '. Slow feature rollout is mostly rework and manual regression, not lack of hands.',
      what: [
        'Set the Sonar gate to 80% coverage on new code and block merges to main on it. Do not chase overall coverage on legacy code.',
        'The automated suite runs on every PR. A red suite blocks merge. Fix or delete failing tests this sprint.',
        'Automate the 20 regression cases that QA runs by hand most often. That is what shortens rollout.',
        'Every escaped bug gets a one line root cause in the retro: missing test, missing AC, or rushed review.',
      ],
      owner: 'Tech lead', horizon: 'Next 2 sprints', impact: 'high',
    };
  },
  // 6. Security, non negotiable in a regulated environment
  (c) => {
    const v = q(c, 'vulnerabilities');
    if (!bad(v)) return null;
    return {
      id: 'security',
      title: 'Clear open vulnerabilities',
      why: `${v?.value} open vulnerabilities in SonarQube. In a regulated healthcare environment this is a compliance exposure, not a backlog item.`,
      what: ['Fix all open vulnerabilities in the next sprint before feature work.', 'Add a Sonar rule that fails the gate on any new vulnerability.'],
      owner: 'Tech lead', horizon: 'This sprint', impact: 'high',
    };
  },
  // 8. Review bottleneck and roles not doing the job
  (c) => {
    const load = fl(c, 'reviewer_load'), pickup = fl(c, 'pickup_time');
    const reviewOnly = (c.github ?? []).filter((p) => p.flags.some((f) => f.startsWith('Reviews only')));
    const silent = (c.github ?? []).filter((p) => p.flags.some((f) => f.startsWith('No commits')));
    if (!bad(load) && !bad(pickup) && !reviewOnly.length && !silent.length) return null;
    const why = [
      bad(load) ? (c.named === false ? `One person did ${load!.value}% of all reviews.` : load!.message) : null, // the message names the reviewer
      bad(pickup) ? `Median wait for a first review is ${pickup!.value} days.` : null,
      reviewOnly.length ? `${who(c, reviewOnly.map((p) => p.name))}: reviews only, no code authored in 90 days.` : null,
      silent.length ? `${who(c, silent.map((p) => p.name))}: no PRs, commits or reviews in 90 days.` : null,
    ].filter(Boolean).join(' ');
    return {
      id: 'review_roles',
      title: 'Fix the review bottleneck and the roles behind it',
      why: why + ' A single gatekeeper slows everyone and hides whether senior people are contributing.',
      what: [
        'Branch protection: one approval from any engineer, not a named person. Every engineer reviews at least two PRs a week.',
        reviewOnly.length ? `Reset the tech lead role for ${who(c, reviewOnly.map((p) => p.name))}: 30% coding, architecture decisions written as ADRs in Confluence, reviews shared with the team. Measure again in 30 days.` : 'Tech lead reviews are for design and risk, not the only gate.',
        silent.length && c.named === false ? `${who(c, silent.map((p) => p.name))}: ask for the last 90 days of output, in code, Confluence or elsewhere. If it cannot be shown, the role is not being done.`
        : silent.length ? silent.map((p) => {
          const d = (c.docsPeople ?? []).find((x) => x.name === p.name);
          return d && (d.created + d.edited) > 0
            ? `${p.name}: no code in 90 days, but ${d.created} pages created and ${d.edited} edited in Confluence (${d.adrs} ADRs). Ask whether that output is what the role should produce.`
            : `${p.name}: nothing in GitHub or Confluence in 90 days. Ask for the last 90 days of output. If it cannot be shown, the role is not being done.`;
        }).join(' ') : 'Confirm every senior role has visible output somewhere: code, ADRs, or reviews.',
      ],
      owner: 'VP Engineering', horizon: 'This sprint', impact: 'high',
    };
  },
  // 9. Lanes
  (c) => {
    const lanes = fl(c, 'lane_crossing');
    const stuckInLane = (c.github ?? []).filter((p) => p.flags.some((f) => f.startsWith('Stays in')));
    if (!bad(lanes) || stuckInLane.length < 2) return null;
    return {
      id: 'lanes',
      title: 'Break the frontend and backend lanes',
      why: `${lanes!.message} ${stuckInLane.length} of ${(c.github ?? []).filter((p) => p.prsAuthored >= 5).length} active engineers have never touched the other side. Every feature needs a handoff, and every handoff is a wait.`,
      what: [
        'Tickets are sized and owned end to end by one engineer, frontend and backend together.',
        `Pair across lanes for two sprints: ${who(c, stuckInLane.slice(0, 4).map((p) => p.name))} each pair with someone from the other side.`,
        'Track lane crossing in Houston. Target: 25% of PRs touch both sides within a quarter.',
      ],
      owner: 'Tech lead', horizon: 'Next 2 sprints', impact: 'medium',
    };
  },
  // 10. Control gaps
  (c) => {
    const reviewed = c.diag?.prReviewRate ?? null, nj = fl(c, 'no_jira_link'), ci = fl(c, 'ci_red_rate');
    const unreviewed = reviewed != null && reviewed < 95;
    if (!unreviewed && ![nj, ci].some(bad)) return null;
    return {
      id: 'controls',
      title: 'Turn on the basic engineering controls',
      why: [unreviewed ? `Only ${Math.round(reviewed!)}% of merged pull requests were reviewed by someone else in the last 30 days.` : null, bad(nj) ? nj!.message : null, bad(ci) ? ci!.message : null].filter(Boolean).join(' ') + ' These are one-time settings, not habits, and they close audit findings as well as quality gaps.',
      what: [
        'Branch protection on main: required review, required CI green, no force push.',
        'PR check that fails if no Jira key is in the branch name or title.',
        'Red main is fixed first. Nobody merges onto a red build.',
      ],
      owner: 'Tech lead', horizon: 'This sprint', impact: 'high',
    };
  },
  // 11. Too many features in flight
  (c) => {
    const lead = ft(c, 'feature_lead_time'), wip = ft(c, 'feature_wip');
    if (!bad(lead) && !bad(wip)) return null;
    return {
      id: 'features',
      title: 'Finish features before starting new ones',
      why: [bad(lead) ? lead!.message : null, bad(wip) ? wip!.message : null].filter(Boolean).join(' ') + ' Product sees features, not tickets. This is the number they are losing trust over.',
      what: [
        'Agree with the PO a maximum of three features in progress. New ones wait until one ships.',
        'Publish feature lead time to the product team monthly. Set a target of 45 days by end of quarter.',
        'Pick the oldest open feature and finish it this sprint, whatever it takes. One visible win.',
      ],
      owner: 'Product owner', horizon: 'This sprint', impact: 'high',
    };
  },
  // 12. Docs and architecture output
  (c) => {
    const adr = dc(c, 'adr_activity'), rb = dc(c, 'runbook_coverage'), stale = dc(c, 'stale_docs');
    if (![adr, rb, stale].some(bad)) return null;
    return {
      id: 'docs',
      title: 'Make architecture and operations visible in writing',
      why: [bad(adr) ? adr!.message : null, bad(rb) ? rb!.message : null, bad(stale) ? stale!.message : null].filter(Boolean).join(' ') + ' Undocumented decisions are re-argued every sprint, and missing runbooks are an audit finding.',
      what: [
        'ADR for every decision that changes an interface, data model or dependency. Owner: the architect. Target: two a month.',
        'One runbook per deployable service, reviewed after every incident.',
        'Every page gets an owner. Quarterly review or archive.',
      ],
      owner: 'VP Engineering', horizon: 'Next 2 sprints', impact: 'medium',
    };
  },
  // 7. Ownership
  (c) => {
    const un = f(c, 'unassigned');
    const carriers = c.people.filter((p) => p.carriedOver >= 5);
    if (!bad(un) && carriers.length < 2) return null;
    return {
      id: 'ownership',
      title: 'Put a name on every piece of work',
      why: `${un?.value ?? 0} items are in progress with no owner and ${carriers.length} people carried five or more tickets across sprints. Work without a single accountable owner drifts.`,
      what: [
        'One named tech lead is accountable for the sprint commitment. Not the team, one person.',
        'Every ticket has an assignee the moment it moves to In Progress.',
        'Each engineer presents their own tickets at the review, not the tech lead on their behalf.',
      ],
      owner: 'VP Engineering', horizon: 'This sprint', impact: 'medium',
    };
  },
];

// Flow diagnoses: two numbers that point at one root cause together.
patterns.push(
  (c) => {
    const d = c.diag; if (!d || d.flowEfficiency == null || d.pickupHours == null || !(d.flowEfficiency < 40 && d.pickupHours > 24)) return null;
    return { id: 'review_first', title: 'Review before starting new work', owner: 'Team', horizon: 'This sprint', impact: 'high',
      why: `Tickets are actively worked ${Math.round(d.flowEfficiency)}% of the time from start to done, and a pull request waits a median ${Math.round(d.pickupHours)} hours for its first review. Work is written, then sits waiting for each other.`,
      what: ['Team rule: before picking up a new ticket, review any open pull request that is waiting.', 'Start the day with reviews, not new code.', 'Measure again in two sprints: time to first review under a day, flow efficiency above 40%.'] };
  },
  (c) => {
    const d = c.diag; if (!d || d.qaRejection == null || !(d.qaRejection > 20 && (d.sprintCompletion ?? 0) >= 70)) return null;
    return { id: 'definition_of_done', title: 'Tighten the definition of done', owner: 'Tech lead', horizon: 'Next 2 sprints', impact: 'high',
      why: `${Math.round(d.qaRejection)}% of tickets that reach QA are sent back, while the team finishes ${Math.round(d.sprintCompletion!)}% of what it commits to. Work is being handed to QA before it is ready, so it counts as progress and comes back as rework.`,
      what: ['Definition of done before QA: acceptance criteria met, tests written and passing, reviewed.', 'The developer demonstrates the ticket against its acceptance criteria before moving it to QA.', 'Every rejection gets a one line reason in the retro: missing test, unclear criteria, or environment.'] };
  },
  (c) => {
    const d = c.diag; if (!d || !(d.oldWip >= 2 && d.deploysPerWeek != null && d.deploysPerWeek < 1)) return null;
    return { id: 'smaller_tickets', title: 'Break work into pieces under two days', owner: 'Tech lead', horizon: 'Next 2 sprints', impact: 'high',
      why: `${d.oldWip} tickets have been in progress more than three times longer than normal for their size, and the team releases ${d.deploysPerWeek} times a week. Big tickets take weeks, so there is little to release.`,
      what: ['Split any ticket estimated above 3 points in refinement.', 'Each ticket should be releasable on its own within two days of starting.', 'Release every ticket that is finished, rather than batching them.'] };
  },
);

export function recommend(c: Ctx): Recommendation[] {
  const out = patterns.map((p) => p(c)).filter((r): r is Recommendation => !!r);
  out.sort((a, b) => (a.impact === b.impact ? 0 : a.impact === 'high' ? -1 : 1));
  return out.slice(0, 8);
}

// Headcount gate: the three conditions that must hold for three consecutive sprints before adding people.
export function headcountGate(c: Ctx): HeadcountGate {
  const last3 = c.history.slice(-3);
  const val = (h: Scorecard, id: string) => h.findings.find((x) => x.ruleId === id)?.value ?? null;
  const commit = last3.map((h) => val(h, 'commit_completion'));
  const unest = last3.map((h) => val(h, 'no_estimate'));
  const cov = q(c, 'new_code_coverage')?.value ?? null;
  const fmt = (xs: (number | null)[], u = '%') => xs.map((x) => (x == null ? 'n/a' : `${Math.round(x)}${u}`)).join(', ');
  const criteria = [
    { name: 'Committed points delivered, last 3 sprints', target: '80% or more, all three', actual: fmt(commit), met: last3.length === 3 && commit.every((x) => x != null && x >= 80) },
    { name: 'Unestimated items in sprint, last 3 sprints', target: '0%, all three', actual: fmt(unest), met: last3.length === 3 && unest.every((x) => x != null && x === 0) },
    { name: 'Coverage on new code', target: '70% or more', actual: cov == null ? 'n/a' : `${cov}%`, met: cov != null && cov >= 70 },
  ];
  const ready = criteria.every((x) => x.met);
  return {
    ready,
    criteria,
    verdict: ready
      ? 'All three conditions met. Capacity is now the constraint and a headcount case is credible.'
      : `${criteria.filter((x) => !x.met).length} of 3 conditions not met. Adding people now would add onboarding and coordination cost to a process that is not yet delivering what it plans. Fix the gaps above first.`,
  };
}
