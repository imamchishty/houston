import assert from 'node:assert/strict';
import { Given, When, Then, After, type DataTable } from '@cucumber/cucumber';
import type { Slice, Measure } from '../../src/reports.js';
import type { PullRequest, WorkItem, Epic, MainCommit } from '../../src/types.js';

// A hand-built slice: exactly the rows in the scenario, nothing from the demo data.
let s: Slice, measures: Measure[] = [];
const iso = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00Z` : `${d}:00Z`).toISOString(); // dates at midday, times as UTC
const yes = (v: string | undefined) => /^(yes|true|y)$/i.test(v ?? '');
const blank = (v: string | undefined) => !v || !v.trim();

After(function () { delete process.env.CFR_SOURCE; });

Given('a reporting period from {word} to {word}', function (from: string, to: string) {
  s = { from: Date.parse(`${from}T00:00:00Z`), to: Date.parse(`${to}T00:00:00Z`), boards: ['ABC'], prs: [], deploys: [], mainCommits: [], items: [], epics: [], sprints: [], incidents: [], projectKeys: [], defaultBranches: {} };
  measures = [];
});
Given("the team's Jira project is {string} and repos merge into {string}", function (key: string, branch: string) {
  s.projectKeys = [key]; s.defaultBranches = { 'org/repo': branch };
});
Given('change failure rate counts significant bugs', function () { process.env.CFR_SOURCE = 'bugs'; });

Given('these pull requests:', function (t: DataTable) {
  s.prs = t.hashes().map((r): PullRequest => ({
    repo: 'org/repo', number: Number(r.pr), title: yes(r.revert) ? 'Revert "x"' : `change ${r.pr}`, author: 'a',
    createdAt: iso(r.opened), firstReviewAt: blank(r['first review']) ? (Number(r.reviews ?? 0) > 0 ? iso(r.opened) : null) : iso(r['first review']),
    approvedAt: null, mergedAt: blank(r.merged) ? null : iso(r.merged), closedAt: null, additions: 10, deletions: 5, changedFiles: 1,
    reviewers: Number(r.reviews ?? 0) > 0 ? ['b'] : [], reviewCount: Number(r.reviews ?? 0),
    jiraKeys: blank(r.tickets) ? [] : r.tickets.split(',').map((x) => x.trim()), areas: [],
    isHotfix: yes(r.hotfix), draft: yes(r.draft), branch: `b${r.pr}`, baseBranch: r.base || 'main',
    reviewComments: Number(r.comments ?? 0), isRevert: yes(r.revert),
  }));
});
Given('these deploys:', function (t: DataTable) {
  s.deploys = t.hashes().map((r) => ({ repo: 'org/repo', at: iso(r.at), ref: 'x', success: yes(r.success) }));
});
Given('these work items:', function (t: DataTable) {
  s.items = t.hashes().map((r): WorkItem => ({
    key: r.key, type: r.type, status: blank(r.resolved) ? 'To Do' : 'Done', statusCategory: blank(r.resolved) ? 'todo' : 'done',
    priority: r.priority || null, reporter: null, assignee: null, created: iso(r.created), resolved: blank(r.resolved) ? null : iso(r.resolved),
    points: blank(r.points) ? null : Number(r.points), epic: r.epic || null, inSprint: yes(r.sprint),
  }));
});
Given('these commits on main:', function (t: DataTable) {
  s.mainCommits = t.hashes().map((r): MainCommit => ({ repo: 'org/repo', sha: r.sha, at: iso(r.at), merge: yes(r.merge), viaPr: yes(r['via pr']) }));
});
Given('these epics:', function (t: DataTable) {
  s.epics = t.hashes().map((r): Epic => ({ key: r.key, summary: r.key, status: blank(r.closed) ? 'In Progress' : 'Done', statusCategory: blank(r.closed) ? 'inprogress' : 'done',
    created: '2026-06-01T00:00:00Z', started: null, resolved: blank(r.closed) ? null : iso(r.closed), childCount: 0, childDone: 0, due: r.due || null }));
});
Given('these incidents:', function (t: DataTable) {
  s.incidents = t.hashes().map((r) => ({ firedAt: iso(r.fired), resolvedAt: blank(r.resolved) ? null : iso(r.resolved) }));
});

When('the reports are calculated', async function () {
  const { quality, predictability, efficiency, flatMeasures } = await import('../../src/reports.js');
  measures = [quality(s), predictability(s), efficiency(s)].flatMap(flatMeasures);
});

const m = (id: string) => { const x = measures.find((y) => y.id === id); assert.ok(x, `no measure ${id}`); return x!; };
Then(/^(\w+) is (\d+) of (\d+), ([\d.]+)%$/, function (id: string, num: string, den: string, pct: string) {
  const x = m(id);
  assert.deepEqual({ num: x.num, den: x.den, value: x.value }, { num: Number(num), den: Number(den), value: Number(pct) }, id);
});
Then(/^(\w+) is ([\d.]+) (days|hours) from (\d+) items$/, function (id: string, v: string, unit: string, n: string) {
  const x = m(id);
  assert.deepEqual({ value: x.value, unit: x.unit, den: x.den }, { value: Number(v), unit, den: Number(n) }, id);
});
Then(/^(\w+) is not measured$/, function (id: string) { assert.equal(m(id).value, null, `${id} should be null, not ${m(id).value}`); });
Then(/^(\w+) lists (.+)$/, function (id: string, list: string) { assert.deepEqual(m(id).failing, list.split(',').map((x) => x.trim())); });
Then(/^(\w+) (meets|misses) its target of (under|over) ([\d.]+)$/, function (id: string, verdict: string, dir: string, v: string) {
  const x = m(id);
  assert.deepEqual(x.target, { op: dir === 'under' ? '<' : '>', value: Number(v) });
  assert.equal(x.met, verdict === 'meets');
});
