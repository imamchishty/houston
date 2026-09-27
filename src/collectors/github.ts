import { config } from '../config.js';
import type { CiRun, Deploy, GithubSnapshot, PullRequest } from '../types.js';
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
  const list = await all<any>(`/repos/${repo}/pulls?state=all&sort=updated&direction=desc`, 600);
  const out: PullRequest[] = [];
  for (const p of list) {
    if (p.created_at < since) continue;
    const [detail, reviews, comments, files] = await Promise.all([
      gh<any>(`/repos/${repo}/pulls/${p.number}`),
      all<any>(`/repos/${repo}/pulls/${p.number}/reviews`, 200),
      all<any>(`/repos/${repo}/pulls/${p.number}/comments`, 200),
      all<any>(`/repos/${repo}/pulls/${p.number}/files`, 300),
    ]);
    const author = canonical(p.user?.login) ?? 'unknown';
    const others = (x: any) => x.user?.login && x.user.login !== author;
    const firstReview = [...reviews.filter(others).map((r: any) => r.submitted_at), ...comments.filter(others).map((c: any) => c.created_at)].sort()[0] ?? null;
    const approved = reviews.filter((r: any) => r.state === 'APPROVED' && others(r)).map((r: any) => r.submitted_at).sort()[0] ?? null;
    const text = `${p.title} ${p.head?.ref ?? ''} ${p.body ?? ''}`;
    out.push({
      repo, number: p.number, title: p.title, author,
      createdAt: p.created_at, firstReviewAt: firstReview, approvedAt: approved,
      mergedAt: p.merged_at ?? null, closedAt: p.closed_at ?? null,
      additions: detail.additions ?? 0, deletions: detail.deletions ?? 0, changedFiles: detail.changed_files ?? 0,
      reviewers: [...new Set(reviews.filter(others).map((r: any) => canonical(r.user.login) as string))],
      reviewCount: reviews.filter(others).length,
      jiraKeys: [...new Set(text.match(JIRA_KEY) ?? [])],
      areas: [...new Set(files.map((f: any) => laneFor(f.filename)))],
      isHotfix: /hotfix|revert/i.test(`${p.title} ${p.head?.ref ?? ''}`),
      draft: !!p.draft,
    });
  }
  return out;
}

async function runs(repo: string, since: string): Promise<{ ci: CiRun[]; deploys: Deploy[] }> {
  const list = await all<any>(`/repos/${repo}/actions/runs?created=>=${since.slice(0, 10)}`, 1000);
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

export async function collectGithub(): Promise<GithubSnapshot[]> {
  const until = new Date();
  const since = new Date(until.getTime() - config.github.days * 86_400_000).toISOString();
  const out: GithubSnapshot[] = [];
  for (const b of config.github.repos) {
    const snap: GithubSnapshot = { board: b.name, since, until: until.toISOString(), repos: b.repos, prs: [], deploys: [], ci: [] };
    for (const repo of b.repos) {
      snap.prs.push(...(await pullRequests(repo, since)));
      const r = await runs(repo, since);
      snap.ci.push(...r.ci);
      snap.deploys.push(...r.deploys);
    }
    out.push(snap);
  }
  return out;
}
