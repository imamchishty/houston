import type { Finding, GithubSnapshot, PullRequest, Rag } from '../types.js';
import { median } from '../cycle.js';

const h = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;
const pct = (n: number, d: number) => (d ? (n / d) * 100 : 0);
const merged = (s: GithubSnapshot) => s.prs.filter((p) => p.mergedAt && !p.draft);
const ref = (p: PullRequest) => `${p.repo.split('/')[1]}#${p.number}`;
const days = (s: GithubSnapshot) => Math.max(1, (new Date(s.until).getTime() - new Date(s.since).getTime()) / 86_400_000);

// Lead time per merged PR: opened to the first successful deploy after merge, of the PR's own repo. A repo with no
// deploys of its own (deployed from another repo) falls back to the team's deploys. PRs never deployed are left out.
export function leadTimes(prs: PullRequest[], deploys: GithubSnapshot['deploys']) {
  const ok = deploys.filter((d) => d.success);
  const byRepo = new Map<string, string[]>();
  for (const d of ok) byRepo.set(d.repo, [...(byRepo.get(d.repo) ?? []), d.at]);
  for (const v of byRepo.values()) v.sort();
  const any = ok.map((d) => d.at).sort();
  return prs.filter((p) => p.mergedAt).flatMap((p) => {
    const d = (byRepo.get(p.repo) ?? any).find((x) => x >= p.mergedAt!);
    return d ? [{ merged: Date.parse(p.mergedAt!), days: h(p.createdAt, d) / 24 }] : [];
  });
}

interface FRule {
  id: string; title: string; unit: Finding['unit']; amber: number; red: number; direction: 'high_bad' | 'low_bad'; weight: number;
  evaluate: (s: GithubSnapshot) => { value: number; message: string; action: string; evidence: string[] } | null;
}
const rag = (r: FRule, v: number): Rag =>
  r.direction === 'high_bad' ? (v >= r.red ? 'red' : v >= r.amber ? 'amber' : 'green') : (v <= r.red ? 'red' : v <= r.amber ? 'amber' : 'green');

export const flowRules: FRule[] = [
  { id: 'pickup_time', title: 'Time to first review (pickup)', unit: 'days', amber: 1, red: 2, direction: 'high_bad', weight: 15,
    evaluate(s) {
      const xs = merged(s).filter((p) => p.firstReviewAt).map((p) => h(p.createdAt, p.firstReviewAt!) / 24);
      if (xs.length < 5) return null;
      const m = median(xs);
      return { value: Math.round(m * 10) / 10, message: `Median wait for a first review is ${m.toFixed(1)} days across ${xs.length} merged PRs.`,
        action: 'Working agreement: every PR gets a first review within 24 hours. Reviews come before new work at the start of the day.', evidence: [] };
    } },
  { id: 'review_time', title: 'Review to merge time', unit: 'days', amber: 1.5, red: 3, direction: 'high_bad', weight: 10,
    evaluate(s) {
      const xs = merged(s).filter((p) => p.firstReviewAt).map((p) => h(p.firstReviewAt!, p.mergedAt!) / 24);
      if (xs.length < 5) return null;
      const m = median(xs);
      return { value: Math.round(m * 10) / 10, message: `Once reviewed, PRs take a median ${m.toFixed(1)} days to merge.`,
        action: 'Long review to merge usually means big PRs or a reviewer bottleneck. Check reviewer load below.', evidence: [] };
    } },
  { id: 'pr_size', title: 'PR size', unit: 'count', amber: 400, red: 800, direction: 'high_bad', weight: 10,
    evaluate(s) {
      const xs = merged(s).map((p) => p.additions + p.deletions);
      if (xs.length < 5) return null;
      const m = median(xs);
      const big = merged(s).filter((p) => p.additions + p.deletions > 800);
      return { value: Math.round(m), message: `Median PR is ${Math.round(m)} lines changed, ${big.length} PRs over 800 lines.`,
        action: 'Working agreement: PRs under 400 lines. Big PRs get slow, shallow reviews and hide defects.', evidence: big.map(ref) };
    } },
  { id: 'stale_prs', title: 'Open PRs older than 3 days', unit: 'count', amber: 3, red: 6, direction: 'high_bad', weight: 10,
    evaluate(s) {
      const stale = s.prs.filter((p) => !p.closedAt && !p.draft && h(p.createdAt, s.until) > 72);
      return { value: stale.length, message: stale.length ? `${stale.length} PRs have been open for more than 3 days.` : 'No PR has been open more than 3 days.',
        action: 'Finished work that is not merged is waste. Standup lists open PRs before tickets.', evidence: stale.map(ref) };
    } },
  { id: 'no_review_merges', title: 'PRs merged without a review', unit: '%', amber: 5, red: 15, direction: 'high_bad', weight: 10,
    evaluate(s) {
      const m = merged(s); if (m.length < 5) return null;
      const none = m.filter((p) => p.reviewCount === 0);
      return { value: Math.round(pct(none.length, m.length) * 10) / 10, message: `${none.length} of ${m.length} merged PRs (${Math.round(pct(none.length, m.length))}%) had no review.`,
        action: 'Branch protection on main: one approval required, no self-merge. This is a control, not a preference, in a regulated environment.', evidence: none.map(ref) };
    } },
  { id: 'no_jira_link', title: 'PRs with no Jira ticket', unit: '%', amber: 10, red: 30, direction: 'high_bad', weight: 10,
    evaluate(s) {
      const m = merged(s); if (m.length < 5) return null;
      const none = m.filter((p) => !p.jiraKeys.length);
      return { value: Math.round(pct(none.length, m.length) * 10) / 10, message: `${none.length} of ${m.length} merged PRs (${Math.round(pct(none.length, m.length))}%) reference no Jira ticket.`,
        action: 'Work outside the plan cannot be measured or prioritised. Branch naming convention with the ticket key, enforced by a PR check.', evidence: none.map(ref) };
    } },
  { id: 'reviewer_load', title: 'Review concentration', unit: '%', amber: 40, red: 60, direction: 'high_bad', weight: 10,
    evaluate(s) {
      const counts = new Map<string, number>();
      for (const p of merged(s)) for (const r of p.reviewers) counts.set(r, (counts.get(r) ?? 0) + 1);
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      if (total < 10) return null;
      const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      const share = pct(n, total);
      return { value: Math.round(share), message: `${top} did ${Math.round(share)}% of all reviews (${n} of ${total}).`,
        action: share > 40 ? `${top} is the bottleneck. Spread reviews across the team, every engineer reviews at least two PRs a week.` : 'Review load is spread reasonably.', evidence: [] };
    } },
  { id: 'lane_crossing', title: 'Engineers working outside their lane', unit: '%', amber: 25, red: 10, direction: 'low_bad', weight: 5,
    evaluate(s) {
      const m = merged(s).filter((p) => p.areas.some((a) => a === 'frontend' || a === 'backend'));
      if (m.length < 10) return null;
      const cross = m.filter((p) => p.areas.includes('frontend') && p.areas.includes('backend'));
      return { value: Math.round(pct(cross.length, m.length)), message: `${Math.round(pct(cross.length, m.length))}% of PRs touch both frontend and backend. Below 10% means people stay strictly in lanes and hand off.`,
        action: 'Tickets are owned end to end by one person. Pair frontend and backend engineers for two sprints to build range.', evidence: [] };
    } },
  { id: 'ci_red_rate', title: 'CI failure rate', unit: '%', amber: 10, red: 25, direction: 'high_bad', weight: 10,
    evaluate(s) {
      const done = s.ci.filter((c) => c.conclusion === 'success' || c.conclusion === 'failure');
      if (done.length < 10) return null;
      const red = done.filter((c) => c.conclusion === 'failure');
      const dur = median(s.ci.map((c) => c.durationMin));
      return { value: Math.round(pct(red.length, done.length)), message: `${Math.round(pct(red.length, done.length))}% of CI runs failed, median run ${Math.round(dur)} minutes.`,
        action: 'A red build is fixed before anything else is merged. If runs take over 15 minutes, people stop waiting for them.', evidence: [] };
    } },
  { id: 'deploy_frequency', title: 'Deployment frequency (DORA)', unit: 'ratio', amber: 1, red: 0.25, direction: 'low_bad', weight: 10,
    evaluate(s) {
      const ok = s.deploys.filter((d) => d.success);
      const perWeek = ok.length / (days(s) / 7);
      return { value: Math.round(perWeek * 10) / 10, message: `${ok.length} successful production deploys in ${Math.round(days(s))} days, ${perWeek.toFixed(1)} per week. DORA: elite is on demand, high is weekly to daily, low is under monthly.`,
        action: 'Ship smaller changes more often. Every merged PR should be deployable, and deploy at least weekly.', evidence: [] };
    } },
  { id: 'lead_time', title: 'Lead time for changes (DORA)', unit: 'days', amber: 7, red: 30, direction: 'high_bad', weight: 10,
    evaluate(s) {
      // PR created to the next successful deploy of its own repo after merge
      const xs = leadTimes(merged(s), s.deploys).map((l) => l.days);
      if (xs.length < 5) return null;
      const m = median(xs);
      return { value: Math.round(m * 10) / 10, message: `Median ${m.toFixed(1)} days from PR opened to running in production. DORA: elite under a day, high a day to a week, low over a month.`,
        action: 'Lead time is pickup + review + waiting for a deploy. Fix whichever of the three is largest first.', evidence: [] };
    } },
  { id: 'change_failure', title: 'Change failure rate (DORA)', unit: '%', amber: 15, red: 30, direction: 'high_bad', weight: 10,
    evaluate(s) {
      const m = merged(s); if (m.length < 10) return null;
      const failedDeploys = s.deploys.filter((d) => !d.success).length;
      const hot = m.filter((p) => p.isHotfix).length;
      const value = Math.round(pct(hot + failedDeploys, m.length + failedDeploys));
      return { value, message: `${hot} hotfix or revert PRs plus ${failedDeploys} failed deploys against ${m.length} merges: ${value}% change failure rate. DORA: elite under 5%, high under 15%.`,
        action: 'Each hotfix gets a root cause: missing test, missing review, or environment. Fix the category, not the incident.', evidence: m.filter((p) => p.isHotfix).map(ref) };
    } },
];

export function scoreFlow(s: GithubSnapshot): { score: number; rag: Rag; findings: Finding[] } {
  const findings: Finding[] = []; let earned = 0, possible = 0;
  const pts: Record<Rag, number> = { green: 1, amber: 0.5, red: 0 };
  for (const r of flowRules) {
    const res = r.evaluate(s); if (!res) continue;
    const g = rag(r, res.value); earned += pts[g] * r.weight; possible += r.weight;
    findings.push({ ruleId: r.id, title: r.title, area: 'flow', unit: r.unit, value: res.value, rag: g, message: res.message, action: res.action, evidence: res.evidence.slice(0, 10) , weight: r.weight });
  }
  const score = possible ? Math.round((earned / possible) * 100) : 0;
  const order: Record<Rag, number> = { red: 0, amber: 1, green: 2 };
  findings.sort((a, b) => order[a.rag] - order[b.rag]);
  return { score, rag: score >= 75 ? 'green' : score >= 50 ? 'amber' : 'red', findings };
}
