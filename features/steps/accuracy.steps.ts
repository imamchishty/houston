import assert from 'node:assert/strict';
import { Given, Then, type DataTable } from '@cucumber/cucumber';
import { houston } from '../support/world.js';
import type { Issue, PullRequest } from '../../src/types.js';

Then('a review by {string} of type {string} on a PR by {string} counts', async function (login: string, type: string, author: string) {
  const { isPersonReview } = await import('../../src/collectors/github.js');
  houston.config.github.bots = ['build-svc'];
  assert.equal(isPersonReview({ user: { login, type } }, author), true);
});
Then('a review by {string} of type {string} on a PR by {string} does not count', async function (login: string, type: string, author: string) {
  const { isPersonReview } = await import('../../src/collectors/github.js');
  houston.config.github.bots = ['build-svc'];
  assert.equal(isPersonReview({ user: { login, type } }, author), false);
});

let sprintEnd = '', items: Issue[] = [];
Given('a closed sprint ending {word} with these items:', function (end: string, t: DataTable) {
  sprintEnd = `${end}T17:00:00Z`;
  items = t.hashes().map((r) => ({ key: r.key, summary: r.key, type: 'Story', status: r.resolved ? 'Done' : 'To Do', statusCategory: r.resolved ? 'done' : 'todo',
    points: Number(r.points), assignee: null, hasAcceptanceCriteria: true, created: '2026-08-01T00:00:00Z', resolved: r.resolved ? `${r.resolved}T12:00:00Z` : null,
    addedToSprintAt: null, sprintIds: [1], inProgressSince: null }));
});
Then('{int} of {int} committed points are done in that sprint', async function (done: number, total: number) {
  const { rules } = await import('../../src/rules/sprintRules.js');
  const sprint = { id: 1, name: 's', board: 'ABC', goal: 'g', start: '2026-09-01T00:00:00Z', end: sprintEnd, state: 'closed' as const, issues: items };
  const r = rules.find((x) => x.id === 'commit_completion')!.evaluate(sprint)!;
  assert.equal(r.message.includes(`(${done} of ${total})`), true, r.message);
});

let prs: PullRequest[] = [], deploys: { repo: string; at: string; ref: string; success: boolean }[] = [];
Given('PR {int} in {string} opened {word} and merged {word}', function (n: number, repo: string, opened: string, merged: string) {
  deploys = [];
  prs = [{ repo, number: n, title: 't', author: 'a', createdAt: `${opened}T00:00:00Z`, firstReviewAt: null, approvedAt: null, mergedAt: `${merged}T00:00:00Z`, closedAt: null,
    additions: 1, deletions: 1, changedFiles: 1, reviewers: [], reviewCount: 0, jiraKeys: [], areas: [], isHotfix: false, draft: false }];
});
Given('its first commit was on {word}', function (at: string) { prs[0].firstCommitAt = `${at}T00:00:00Z`; });
Given('a successful deploy of {string} on {word}', function (repo: string, at: string) { deploys.push({ repo, at: `${at}T00:00:00Z`, ref: 'x', success: true }); });
Then('its lead time is {int} days', async function (days: number) {
  const { leadTimes } = await import('../../src/rules/flowRules.js');
  assert.deepEqual(leadTimes(prs, deploys).map((l) => l.days), [days]);
});

let cats = new Map<string, string>(), histories: any[] = [];
Given(/^Jira statuses: (.+)$/, function (list: string) {
  cats = new Map([...list.matchAll(/(\d+) "[^"]+" is (in progress|done|to do)/g)].map((m) => [m[1], m[2] === 'in progress' ? 'indeterminate' : m[2] === 'done' ? 'done' : 'new']));
});
Given('a ticket history, newest first:', function (t: DataTable) {
  histories = t.hashes().map((r) => ({ created: `${r.when}:00.000+0000`, items: [{ field: 'status', to: r.to, toString: `status ${r.to}` }] }));
});
Then('work started at {word}', async function (at: string) {
  const { fromChangelog } = await import('../../src/collectors/jira.js');
  assert.equal(fromChangelog({ histories }, 1, cats).inProgressSince, `${at}:00.000+0000`);
});
