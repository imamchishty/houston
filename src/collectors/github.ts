import { config } from '../config.js';
import type { CiRun, Deploy, GithubSnapshot, MainCommit, PullRequest } from '../types.js';
import { store } from '../store/index.js';
import { canonical } from '../identity.js';

// GitHub REST v3. Works against GitHub Enterprise Server (https://<host>/api/v3) and github.com.
// Read only. One list call per repo plus reviews and files per PR, so first run is slow; cache nightly.

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`${config.github.api}${path}`, {
    headers: { Authorization: `Bearer ${config.github.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function all<T>(path: string, limit = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; out.length < limit; page++) {
    const chunk = await gh<T[]>(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    out.push(...chunk);
    if (chunk.length < 100) break;
  }
  return out;
}

// owner/name with each part URL encoded, so a repo value cannot change the API path.
const repoPath = (repo: string) => repo.split('/').map(encodeURIComponent).join('/');

export const isBot = (u: { login?: string; type?: string } | null | undefined) =>
  !!u && (u.type === 'Bot' || /\[bot\]$/i.test(u.login ?? '') || config.github.bots.includes((u.login ?? '').toLowerCase()));

// A review or comment counts as someone else's review: a person (not a bot) who is not the PR's author.
export const isPersonReview = (x: { user?: { login?: string; type?: string } | null }, authorLogin: string) =>
  !!x.user?.login && x.user.login.toLowerCase() !== authorLogin.toLowerCase() && !isBot(x.user);

const JIRA_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/g;

export function laneFor(path: string): string {
  for (const l of config.github.lanes) {
    for (const p of l.patterns) {
      if (p.startsWith('*.') ? path.endsWith(p.slice(1)) : path.includes(p)) return l.area;
    }
  }
  return 'other';
}

async function pullRequests(repo: string, since: string): Promise<PullRequest[]> {
  const list = await all<any>(`/repos/${repoPath(repo)}/pulls?state=all&sort=updated&direction=desc`, 600);
  const out: PullRequest[] = [];
  for (const p of list) {
    if (p.created_at < since) continue;
    const [detail, reviews, comments, files, commits] = await Promise.all([
      gh<any>(`/repos/${repoPath(repo)}/pulls/${p.number}`),
      all<any>(`/repos/${repoPath(repo)}/pulls/${p.number}/reviews`, 200),
      all<any>(`/repos/${repoPath(repo)}/pulls/${p.number}/comments`, 200),
      all<any>(`/repos/${repoPath(repo)}/pulls/${p.number}/files`, 300),
      all<any>(`/repos/${repoPath(repo)}/pulls/${p.number}/commits`, 250),
    ]);
    const author = canonical(p.user?.login) ?? 'unknown';
    // A review counts only from another person: compare raw logins (PEOPLE maps logins to names, so the author's
    // mapped name never equals a raw login), and leave out bots (GitHub type Bot, "[bot]" logins, GITHUB_BOTS).
    const authorLogin = String(p.user?.login ?? '').toLowerCase();
    const others = (x: any) => isPersonReview(x, authorLogin);
    const firstReview = [...reviews.filter(others).map((r: any) => r.submitted_at), ...comments.filter(others).map((c: any) => c.created_at)].sort()[0] ?? null;
    const approved = reviews.filter((r: any) => r.state === 'APPROVED' && others(r)).map((r: any) => r.submitted_at).sort()[0] ?? null;
    const text = `${p.title} ${p.head?.ref ?? ''} ${p.body ?? ''}`;
    out.push({
      repo, number: p.number, title: p.title, author,
      createdAt: p.created_at, firstReviewAt: firstReview, approvedAt: approved,
      mergedAt: p.merged_at ?? null, closedAt: p.closed_at ?? null,
      additions: detail.additions ?? 0, deletions: detail.deletions ?? 0, changedFiles: detail.changed_files ?? 0,
      reviewers: [...new Set(reviews.filter(others).map((r: any) => canonical(r.user.login) as string))], // people only, no bots
      reviewCount: reviews.filter(others).length,
      jiraKeys: [...new Set(text.match(JIRA_KEY) ?? [])],
      areas: [...new Set(files.map((f: any) => laneFor(f.filename)))],
      isHotfix: /hotfix|revert/i.test(`${p.title} ${p.head?.ref ?? ''}`),
      draft: !!p.draft,
      branch: p.head?.ref ?? '', baseBranch: p.base?.ref ?? '',
      // Review comments (inline) plus reviews that say something, by anyone but the author.
      reviewComments: comments.filter(others).length + reviews.filter((x: any) => others(x) && String(x.body ?? '').trim()).length,
      // GitHub's own revert button makes 'Revert "<title>"' on a revert-<n>-<branch> branch.
      isRevert: /^revert\b/i.test(p.title ?? '') || /^revert-\d+/i.test(p.head?.ref ?? ''),
      botReviews: [...reviews, ...comments].filter((x: any) => isBot(x.user)).length,
      firstCommitAt: commits.map((c: any) => c.commit?.author?.date).filter(Boolean).sort()[0] ?? null,
    });
  }
  return out;
}

async function runs(repo: string, since: string): Promise<{ ci: CiRun[]; deploys: Deploy[] }> {
  const list = await all<any>(`/repos/${repoPath(repo)}/actions/runs?created=>=${since.slice(0, 10)}`, 1000);
  const ci: CiRun[] = [];
  const deploys: Deploy[] = [];
  for (const r of list) {
    if (r.status !== 'completed') continue;
    const c = r.conclusion === 'success' ? 'success' : r.conclusion === 'failure' ? 'failure' : r.conclusion === 'cancelled' ? 'cancelled' : 'other';
    const mins = (new Date(r.updated_at).getTime() - new Date(r.run_started_at ?? r.created_at).getTime()) / 60_000;
    const isDeploy = String(r.name ?? '').toLowerCase().includes(config.github.deployWorkflow.toLowerCase());
    if (isDeploy) deploys.push({ repo, at: r.updated_at, ref: r.head_sha, success: c === 'success' });
    else ci.push({ repo, at: r.updated_at, conclusion: c, durationMin: Math.round(mins) });
  }
  return { ci, deploys };
}

// Commits on the default branch in the window, each marked by whether GitHub links it to a merged PR.
// Asking per commit is the only way that is right for merge, squash and rebase merges alike, so answers from the
// previous collection are reused and only new commits are looked up.
async function mainCommits(repo: string, branch: string, since: string, known: Map<string, boolean>): Promise<MainCommit[]> {
  const list = await all<any>(`/repos/${repoPath(repo)}/commits?sha=${encodeURIComponent(branch)}&since=${encodeURIComponent(since)}`, 2000);
  const out: MainCommit[] = [];
  for (const c of list) {
    let viaPr = known.get(c.sha);
    if (viaPr === undefined) {
      const prs = await gh<any[]>(`/repos/${repoPath(repo)}/commits/${encodeURIComponent(c.sha)}/pulls`);
      viaPr = prs.some((p) => p.merged_at && p.base?.ref === branch);
    }
    out.push({ repo, sha: c.sha, at: c.commit?.committer?.date ?? c.commit?.author?.date, merge: (c.parents ?? []).length > 1, viaPr });
  }
  return out;
}

export async function collectGithub(): Promise<GithubSnapshot[]> {
  const until = new Date();
  const since = new Date(until.getTime() - config.github.days * 86_400_000).toISOString();
  const out: GithubSnapshot[] = [];
  for (const b of config.github.repos) {
    const snap: GithubSnapshot = { board: b.name, since, until: until.toISOString(), repos: b.repos, prs: [], deploys: [], ci: [], defaultBranches: {}, mainCommits: [] };
    const known = new Map((store.github().find((g) => g.board === b.name)?.mainCommits ?? []).map((c) => [c.sha, c.viaPr] as const));
    for (const repo of b.repos) {
      const branch = (await gh<any>(`/repos/${repoPath(repo)}`)).default_branch ?? 'main';
      snap.defaultBranches![repo] = branch;
      snap.mainCommits!.push(...(await mainCommits(repo, branch, since, known)));
      snap.prs.push(...(await pullRequests(repo, since)));
      const r = await runs(repo, since);
      snap.ci.push(...r.ci);
      snap.deploys.push(...r.deploys);
    }
    out.push(snap);
  }
  return out;
}
