import assert from 'node:assert/strict';
import { Given, Then, type DataTable } from '@cucumber/cucumber';
import { HoustonWorld } from '../support/world.js';
import type { Issue, Sprint, GithubSnapshot, PullRequest, QualitySnapshot } from '../../src/types.js';

let sprint: Sprint;
Given('a finished sprint from {word} to {word} where the normal for {int} points is {int} days, with:', function (from: string, to: string, pts: number, norm: number, t: DataTable) {
  const end = `${to}T00:00:00.000Z`;
  const issues: Issue[] = t.hashes().map((r) => {
    const started = `${r.started}T09:00:00.000Z`, finished = r.finished ? `${r.finished}T12:00:00.000Z` : null;
    const endCat = r['status at end'] === 'Done' ? 'done' : 'indeterminate';
    const history = [{ at: `${r.started}T08:00:00.000Z`, to: 'To Do', category: 'new' }, { at: started, to: 'In Progress', category: 'indeterminate' }];
    if (endCat === 'done' && finished) history.push({ at: finished, to: 'Done', category: 'done' });
    if (endCat !== 'done' && finished) history.push({ at: finished, to: 'Done', category: 'done' });
    return { key: r.key, summary: r.key, type: 'Story', status: finished ? 'Done' : 'In Progress', statusCategory: finished ? 'done' : 'inprogress', points: Number(r.points),
      assignee: 'x', hasAcceptanceCriteria: true, created: '2026-09-01T00:00:00.000Z', resolved: finished, addedToSprintAt: null, sprintIds: [1], inProgressSince: started, statusHistory: history };
  });
  sprint = { id: 1, name: 's', board: 'ABC', goal: 'g', start: `${from}T00:00:00.000Z`, end, state: 'closed', issues, baseline: { [String(pts)]: norm } };
});
Then('{int} item is flagged as in progress far longer than normal: {word}', async function (n: number, key: string) {
  const { rules } = await import('../../src/rules/sprintRules.js');
  const r = rules.find((x) => x.id === 'stale_in_progress')!.evaluate(sprint)!;
  assert.deepEqual({ value: r.value, evidence: r.evidence }, { value: n, evidence: [key] });
});

let ops: any;
Given('production data with no availability tests', function () {
  ops = { board: 'ABC', capturedAt: '', ops: { requests30d: 1000, failedRate: 0.5, p95LatencyMs: 200, availability: null, incidents30d: 0, medianRestoreMin: null }, cost: null };
});
Then('there is no availability check', async function () {
  const { scoreOps } = await import('../../src/rules/opsRules.js');
  assert.ok(!scoreOps(ops).findings.some((f) => f.ruleId === 'availability'));
});

const snap = (prs: PullRequest[], ci: GithubSnapshot['ci'] = []): GithubSnapshot => ({ board: 'ABC', since: '2026-06-01T00:00:00Z', until: '2026-09-01T00:00:00Z', repos: ['org/web', 'org/api'], prs, deploys: [], ci, defaultBranches: { 'org/web': 'main', 'org/api': 'main' } });
const pr = (n: number, author: string, repo: string, areas: string[], keys: string[] = []): PullRequest => ({ repo, number: n, title: 't', author, createdAt: '2026-08-01T00:00:00Z', firstReviewAt: null, approvedAt: null,
  mergedAt: '2026-08-02T00:00:00Z', closedAt: null, additions: 1, deletions: 1, changedFiles: 1, reviewers: [], reviewCount: 0, jiraKeys: keys, areas, isHotfix: false, draft: false });
let g: GithubSnapshot;
Given('merged pull requests in separate repos:', function (t: DataTable) {
  let n = 0; const prs: PullRequest[] = [];
  for (const r of t.hashes()) for (let k = 0; k < Number(r.count); k++) prs.push(pr(n++, r.author, r.repo, [r.area]));
  g = snap(prs);
});
Then('{int} of {int} active engineers work across frontend and backend', async function (both: number, active: number) {
  const { scoreFlow } = await import('../../src/rules/flowRules.js');
  const f = scoreFlow(g).findings.find((x) => x.ruleId === 'lane_crossing')!;
  assert.ok(f.message.startsWith(`${both} of ${active} active engineers`), f.message);
});
Given('CI runs:', function (t: DataTable) {
  const ci: GithubSnapshot['ci'] = [];
  for (const r of t.hashes()) for (const [c, n] of [['success', r.success], ['failure', r.failure]] as const) for (let k = 0; k < Number(n); k++) ci.push({ repo: 'org/api', at: '2026-08-01T00:00:00Z', conclusion: c, durationMin: 5, branch: r.branch });
  g = snap([], ci);
});
Then('the CI failure rate is {int}%', async function (v: number) {
  const { scoreFlow } = await import('../../src/rules/flowRules.js');
  assert.equal(scoreFlow(g).findings.find((x) => x.ruleId === 'ci_red_rate')!.value, v);
});
Given('merged pull requests for team {string} mentioning:', function (board: string, t: DataTable) {
  g = { ...snap(t.hashes().map((r, k) => pr(k, 'a', 'org/api', ['backend'], r.tickets ? [r.tickets] : []))), board };
});
Then('{int} of {int} merged PRs reference no ticket of the team\'s project', async function (none: number, total: number) {
  const { scoreFlow } = await import('../../src/rules/flowRules.js');
  const f = scoreFlow(g).findings.find((x) => x.ruleId === 'no_jira_link')!;
  assert.ok(f.message.startsWith(`${none} of ${total} merged PRs`), f.message);
});

const quality = (coverage: number): QualitySnapshot => ({ board: 'ABC', capturedAt: '', sprintId: 1,
  sonar: { projectKey: 'k', qualityGate: 'OK', coverage, newCoverage: 80, bugs: 1, vulnerabilities: 0, codeSmells: 0, duplicatedLines: 2, securityHotspots: 0, techDebtHours: 1 },
  testmo: null, escapedBugs: 0, reopened: 0 } as unknown as QualitySnapshot);
Then('changing overall coverage from {int}% to {int}% leaves the quality score the same', async function (a: number, b: number) {
  const { scoreQuality } = await import('../../src/rules/qualityRules.js');
  assert.equal(scoreQuality(quality(a)).score, scoreQuality(quality(b)).score);
});
let q: QualitySnapshot;
Given('a Testmo project with no runs in 30 days', function () {
  q = { ...quality(50), sonar: null, testmo: { projectId: 1, lastRunPassRate: 0, runsLast30d: 0, failedTestsLastRun: 0, automatedShare: 0, flakyTests: 0 } } as unknown as QualitySnapshot;
});
Then('there is no test pass rate check', async function () {
  const { scoreQuality } = await import('../../src/rules/qualityRules.js');
  assert.ok(!scoreQuality(q).findings.some((f) => f.ruleId === 'test_pass_rate'));
});

Given('change failure rate uses {string}', function (source: string) { process.env.CFR_SOURCE = source; });
Then("the DORA change failure rate equals the DORA report's", function (this: HoustonWorld) {
  const dora = JSON.parse(this.res!.body).metrics.find((m: { id: string }) => m.id === 'change_failure');
  const rep = require_second().groups.flatMap((x: { measures: { id: string; value: number }[] }) => x.measures).find((m: { id: string }) => m.id === 'change_failure_rate');
  assert.equal(dora.value, rep.value, `${process.env.CFR_SOURCE}: DORA ${dora.value} vs report ${rep.value}`);
});
function require_second() { return (globalThis as any).__houstonSecond; }
