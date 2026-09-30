import { config } from './config.js';
import { leadTimes } from './leadtime.js';
import type { GithubSnapshot, Issue, PullRequest, Sprint } from './types.js';
import { churn } from './requirements.js';

// Definition of Ready and Definition of Done, checked per ticket from what Jira and GitHub record. Which checks apply
// is the team's choice (Admin, Settings, or DOR_CHECKS / DOD_CHECKS); a check that cannot be judged for a ticket
// (no GitHub data, no QA status in the workflow, no tests lane) is left out, never failed.
//
// Ready is judged on the ticket as it is now, except the estimate: Houston reads when it was first set, so an
// estimate added after work started does not count. Done is judged only on tickets that are done.

export const READY_CHECKS: Record<string, string> = {
  estimate: 'Estimated before work starts',
  acceptance: 'Has acceptance criteria',
  epic: 'Belongs to an epic (bugs excepted)',
  size: 'Small enough to finish in a sprint',
};
export const DONE_CHECKS: Record<string, string> = {
  pr: 'Has a merged pull request that names the ticket',
  review: 'Every pull request reviewed by someone other than its author',
  tests: 'The change includes tests',
  qa: 'Went through QA',
  stayed_done: 'Not reopened after being marked done',
  released: 'Released to production',
};

export interface Verdict { ok: boolean; missing: string[] }  // missing: plain phrases, in the order of the checks
const isBug = (i: Issue) => /^bug$/i.test(i.type);
const isQa = (status: string) => config.jira.qaStatuses.includes(status.toLowerCase());

export function readiness(i: Issue): Verdict {
  const d = config.definitions, on = (id: string) => d.ready.includes(id), missing: string[] = [];
  if (on('estimate')) {
    if (i.points == null) missing.push('no estimate');
    else if (i.estimatedAt && i.inProgressSince && Date.parse(i.estimatedAt) > Date.parse(i.inProgressSince)) missing.push('estimated after work started');
  }
  if (on('acceptance') && !i.hasAcceptanceCriteria) missing.push('no acceptance criteria');
  if (on('epic') && !isBug(i) && !i.epic) missing.push('not in an epic');
  if (on('size') && i.points != null && i.points > d.maxPoints) missing.push(`bigger than ${d.maxPoints} points`);
  return { ok: !missing.length, missing };
}

// What Done needs to know about the team: its merged pull requests by ticket, its deploys, and which checks can apply.
export interface DoneContext { prs: Map<string, PullRequest[]>; deploys: GithubSnapshot['deploys']; hasGithub: boolean; usesQa: boolean; hasTestsLane: boolean }
export function doneContext(issues: Issue[], prs: PullRequest[], deploys: GithubSnapshot['deploys']): DoneContext {
  const byKey = new Map<string, PullRequest[]>();
  for (const p of prs) if (p.mergedAt && !p.draft) for (const k of p.jiraKeys) byKey.set(k, [...(byKey.get(k) ?? []), p]);
  return { prs: byKey, deploys, hasGithub: prs.length > 0,
    usesQa: issues.some((i) => (i.statusHistory ?? []).some((h) => isQa(h.to))),
    hasTestsLane: config.github.lanes.some((l) => l.area === 'tests') };
}

// null when the ticket is not done: there is nothing to judge yet.
export function doneness(i: Issue, ctx: DoneContext): Verdict | null {
  if (i.statusCategory !== 'done') return null;
  const d = config.definitions, on = (id: string) => d.done.includes(id), missing: string[] = [];
  // Code checks: for ticket types that need code, when the team's GitHub is connected.
  if (ctx.hasGithub && !d.noCodeTypes.includes(i.type.toLowerCase())) {
    const prs = ctx.prs.get(i.key) ?? [];
    if (!prs.length) { if (on('pr')) missing.push('no merged pull request'); }
    else {
      if (on('review') && prs.some((p) => !p.reviewCount)) missing.push('not reviewed by someone else');
      if (on('tests') && ctx.hasTestsLane && !prs.some((p) => p.areas.includes('tests'))) missing.push('no tests in the change');
      if (on('released') && leadTimes(prs, ctx.deploys).length < prs.length) missing.push('not released yet');
    }
  }
  const h = i.statusHistory ?? [];
  if (on('qa') && ctx.usesQa && h.length && !h.some((x) => isQa(x.to))) missing.push('did not go through QA');
  if (on('stayed_done') && h.some((x, k) => x.category === 'done' && h.slice(k + 1).some((y) => y.category !== 'done'))) missing.push('reopened after being marked done');
  return { ok: !missing.length, missing };
}

// The checks in force, as the team page shows them.
export const definitionsInForce = () => ({
  ready: config.definitions.ready.filter((id) => READY_CHECKS[id]).map((id) => (id === 'size' ? `No bigger than ${config.definitions.maxPoints} points` : READY_CHECKS[id])),
  done: config.definitions.done.filter((id) => DONE_CHECKS[id]).map((id) => DONE_CHECKS[id]),
});

// The phrases missed most often, for a measure's note: "no acceptance criteria (12), no estimate (5)".
export function commonMisses(verdicts: Verdict[], top = 3): string {
  const n = new Map<string, number>();
  for (const v of verdicts) for (const m of v.missing) n.set(m, (n.get(m) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([m, c]) => `${m} (${c})`).join(', ');
}

// The trend: per closed sprint, oldest first, the share of tickets started in it that were ready and the share of
// tickets finished in it that were properly done, with what was missed most.
export function definitionTrend(sprints: Sprint[], prs: PullRequest[], deploys: GithubSnapshot['deploys']) {
  const ctx = doneContext(sprints.flatMap((s) => s.issues), prs, deploys);
  const pct = (n: number, of: number) => (of ? Math.round((1000 * n) / of) / 10 : null);
  return [...sprints].filter((s) => s.state === 'closed').sort((a, b) => a.start.localeCompare(b.start)).map((sp) => {
    const items = sp.issues.filter((i) => i.type !== 'Sub-task');
    const startedItems = items.filter((i) => i.inProgressSince && i.inProgressSince >= sp.start && i.inProgressSince < sp.end);
    const started = startedItems.map((i) => readiness(i)), changed = startedItems.filter((i) => churn(i).changes > 0).length;
    const finished = items.filter((i) => i.statusCategory === 'done' && i.resolved && i.resolved >= sp.start && i.resolved <= sp.end).map((i) => doneness(i, ctx)!);
    return { sprint: sp.name, end: sp.end.slice(0, 10),
      ready: { n: started.filter((v) => v.ok).length, of: started.length, pct: pct(started.filter((v) => v.ok).length, started.length), missing: commonMisses(started.filter((v) => !v.ok), 2) },
      changed: { n: changed, of: startedItems.length, pct: pct(changed, startedItems.length) },
      done: { n: finished.filter((v) => v.ok).length, of: finished.length, pct: pct(finished.filter((v) => v.ok).length, finished.length), missing: commonMisses(finished.filter((v) => !v.ok), 2) } };
  });
}
