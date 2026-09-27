import type { GithubSnapshot, PullRequest } from './types.js';

const h = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;

// Lead time for changes (DORA: code committed to running in production), per merged PR: from its first commit (author
// date, which survives rebases; PR opened when commit data is missing or later) to the first successful deploy of the
// PR's own repo after merge. A repo with no deploys of its own falls back to the team's deploys. PRs never deployed
// are left out.
export function leadTimes(prs: PullRequest[], deploys: GithubSnapshot['deploys']) {
  const ok = deploys.filter((d) => d.success);
  const byRepo = new Map<string, string[]>();
  for (const d of ok) byRepo.set(d.repo, [...(byRepo.get(d.repo) ?? []), d.at]);
  for (const v of byRepo.values()) v.sort();
  const any = ok.map((d) => d.at).sort();
  return prs.filter((p) => p.mergedAt).flatMap((p) => {
    const d = (byRepo.get(p.repo) ?? any).find((x) => x >= p.mergedAt!);
    const start = p.firstCommitAt && p.firstCommitAt < p.createdAt ? p.firstCommitAt : p.createdAt;
    return d ? [{ merged: Date.parse(p.mergedAt!), days: h(start, d) / 24, deployedAt: d }] : [];
  });
}

