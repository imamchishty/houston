import type { CiRun, Deploy, GithubSnapshot, MainCommit, PullRequest, SecurityAlert, Severity } from '../types.js';

function rng(seed: number) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); }
const day = 86_400_000, hour = 3_600_000;

// Ossi cast: 6 engineers plus a tech lead (Karim) who only reviews and an architect (Dinesh) with no activity.
const ossi = [
  { name: 'Aisha', lane: 'backend', prs: 22, speed: 1 }, { name: 'Rahul', lane: 'backend', prs: 20, speed: 1.2 },
  { name: 'Omar', lane: 'backend', prs: 14, speed: 1.8 }, { name: 'Priya', lane: 'frontend', prs: 18, speed: 1 },
  { name: 'Tom', lane: 'frontend', prs: 12, speed: 2 }, { name: 'Fatima', lane: 'frontend', prs: 24, speed: 0.9 },
  { name: 'Karim', lane: 'backend', prs: 1, speed: 1 }, { name: 'Dinesh', lane: 'backend', prs: 0, speed: 1 },
];
const plat = [
  { name: 'Lena', lane: 'backend', prs: 28, speed: 0.8 }, { name: 'Yusuf', lane: 'infra', prs: 26, speed: 0.9 },
  { name: 'Mei', lane: 'frontend', prs: 24, speed: 0.9 }, { name: 'Sam', lane: 'backend', prs: 25, speed: 1 },
];

function snapshot(board: string, people: typeof ossi, weak: boolean, seed: number): GithubSnapshot {
  const r = rng(seed);
  const until = Date.now(), since = until - 90 * day;
  const prs: PullRequest[] = []; let n = 100;
  const reviewers = weak ? ['Karim', 'Karim', 'Karim', 'Aisha'] : people.map((p) => p.name);
  for (const p of people) for (let i = 0; i < p.prs; i++) {
    const created = since + r() * 88 * day;
    const size = weak ? 60 + Math.floor(r() * 900) : 40 + Math.floor(r() * 300);
    const pickupH = (weak ? 6 + r() * 60 : 1 + r() * 10) * p.speed;
    const reviewH = (weak ? 8 + r() * 70 : 2 + r() * 14);
    const merged = r() < (weak ? 0.8 : 0.95);
    const stale = !merged && r() < 0.6;
    const first = created + pickupH * hour;
    const mergedAt = merged ? first + reviewH * hour : null;
    const crossLane = r() < (weak ? 0.06 : 0.35);
    const areas = crossLane ? ['frontend', 'backend'] : [p.lane];
    if (r() < 0.3) areas.push('tests');
    const noReview = weak && r() < 0.18;
    // Reviewer is never the author (a self review does not count, and would make the demo look worse than it is).
    const others = reviewers.filter((x) => x !== p.name);
    const rev = noReview || !others.length ? [] : [others[Math.floor(r() * others.length)]];
    prs.push({
      repo: `m42/${board.toLowerCase()}-${p.lane === 'frontend' ? 'web' : 'api'}`, number: n++, title: `${p.lane} change ${i}`, author: p.name,
      createdAt: new Date(created).toISOString(),
      firstReviewAt: noReview ? null : new Date(first).toISOString(),
      approvedAt: mergedAt ? new Date(mergedAt - hour).toISOString() : null,
      mergedAt: mergedAt ? new Date(mergedAt).toISOString() : null,
      closedAt: mergedAt ? new Date(mergedAt).toISOString() : stale ? null : new Date(first + day).toISOString(),
      additions: Math.round(size * 0.7), deletions: Math.round(size * 0.3), changedFiles: 1 + Math.floor(size / 80),
      reviewers: rev, reviewCount: rev.length ? 1 + Math.floor(r() * 3) : 0,
      jiraKeys: r() < (weak ? 0.55 : 0.92) ? [`${board}-${1000 + Math.floor(r() * 400)}`] : [],
      areas, isHotfix: false, draft: false,
      branch: `${p.lane}/${board}-${n}`, baseBranch: 'main',
      firstCommitAt: new Date(created - (weak ? 6 + r() * 40 : 1 + r() * 12) * hour).toISOString(),
      reviewComments: rev.length ? (r() < (weak ? 0.45 : 0.8) ? 1 + Math.floor(r() * 5) : 0) : 0,
    });
    // Hotfixes and reverts: a revert is also a hotfix for change failure; its title and branch follow GitHub's revert button.
    const last = prs[prs.length - 1], kind = r();
    if (kind < (weak ? 0.05 : 0.01)) Object.assign(last, { title: `Revert "${last.title}"`, branch: `revert-${last.number - 1}-${last.branch}`, isRevert: true, isHotfix: true });
    else if (kind < (weak ? 0.12 : 0.03)) Object.assign(last, { title: `hotfix: ${last.title}`, branch: `hotfix/${board}-${last.number}`, isHotfix: true });
  }
  const ci: CiRun[] = []; const deploys: Deploy[] = [];
  for (let t = since; t < until; t += (weak ? 0.5 : 0.2) * day) {
    ci.push({ repo: `m42/${board.toLowerCase()}-api`, at: new Date(t).toISOString(), conclusion: r() < (weak ? 0.68 : 0.94) ? 'success' : 'failure', durationMin: Math.round(weak ? 25 + r() * 30 : 8 + r() * 8), branch: 'main' });
  }
  for (let t = since; t < until; t += (weak ? 9 : 0.7) * day) {
    deploys.push({ repo: `m42/${board.toLowerCase()}-api`, at: new Date(t).toISOString(), ref: 'sha', success: r() < (weak ? 0.75 : 0.96) });
  }
  // Commits on main: one per merged PR (squash merges), plus direct pushes and plain git merges the weak team still does.
  const repos = [`m42/${board.toLowerCase()}-api`, `m42/${board.toLowerCase()}-web`];
  const mainCommits: MainCommit[] = prs.filter((p) => p.mergedAt).map((p) => ({ repo: p.repo, sha: `pr${p.number}`, at: p.mergedAt!, merge: false, viaPr: true }));
  for (let i = 0; i < (weak ? 34 : 3); i++) mainCommits.push({ repo: repos[i % 2], sha: `direct${i}`, at: new Date(since + r() * 89 * day).toISOString(), merge: false, viaPr: false });
  for (let i = 0; i < (weak ? 6 : 0); i++) mainCommits.push({ repo: repos[0], sha: `merge${i}`, at: new Date(since + r() * 89 * day).toISOString(), merge: true, viaPr: false });
  // Security alerts over 120 days. The weak team fixes slowly, has code scanning off on its web repo and one leaked
  // secret still open; the strong team fixes within days.
  const alerts: SecurityAlert[] = []; let an = 1;
  const PKGS = ['lodash', 'axios', 'jackson-databind', 'log4j-core', 'express', 'minimist', 'netty-codec', 'spring-web'];
  for (let i = 0; i < (weak ? 34 : 14); i++) {
    const repo = repos[i % 2], x = r(), severity: Severity = x < 0.12 ? 'critical' : x < 0.4 ? 'high' : x < 0.8 ? 'medium' : 'low';
    const kind = i % 7 === 3 && !(weak && repo.endsWith('-web')) ? 'code' as const : 'dependency' as const;
    const created = until - (4 + r() * 116) * day;
    const fixDays = (weak ? 3 + r() * 60 : 0.5 + r() * 9) * (severity === 'low' ? 3 : 1);
    const closed = created + fixDays * day;
    const state = closed > until ? 'open' as const : r() < (weak ? 0.15 : 0.05) ? 'dismissed' as const : 'fixed' as const;
    alerts.push({ repo, kind, number: an++, severity, state, createdAt: new Date(created).toISOString(), closedAt: state === 'open' ? null : new Date(closed).toISOString(),
      title: kind === 'code' ? ['SQL injection', 'Cross-site scripting', 'Path traversal', 'Hard-coded credentials'][i % 4] : `${PKGS[i % PKGS.length]}: known vulnerability` });
  }
  const leakAt = until - (weak ? 12 : 40) * day;
  alerts.push({ repo: repos[0], kind: 'secret', number: an++, severity: 'critical', state: weak ? 'open' : 'fixed', createdAt: new Date(leakAt).toISOString(), closedAt: weak ? null : new Date(leakAt + 0.2 * day).toISOString(), title: 'Azure Storage Account Access Key' });
  const coverage = Object.fromEntries(repos.map((x) => [x, { dependency: true, secret: true, code: !(weak && x.endsWith('-web')) }]));
  return { board, since: new Date(since).toISOString(), until: new Date(until).toISOString(), repos, prs, deploys, ci,
    defaultBranches: Object.fromEntries(repos.map((x) => [x, 'main'])), mainCommits, security: { alerts, coverage } };
}

export function demoGithub(): GithubSnapshot[] {
  return [snapshot('OSSI', ossi, true, 7), snapshot('PLAT', plat, false, 11)];
}
