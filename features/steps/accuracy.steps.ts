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
  // The same rule sprint completion uses: done by the sprint's end.
  const { doneInSprint } = await import('../../src/cycle.js');
  const sprint = { end: sprintEnd };
  assert.deepEqual([items.filter((i) => doneInSprint(i, sprint)).reduce((t, i) => t + (i.points ?? 0), 0), items.reduce((t, i) => t + (i.points ?? 0), 0)], [done, total]);
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
  const { leadTimes } = await import('../../src/leadtime.js');
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

let flagHistory: any[] = [];
Given("a ticket's flag history, oldest first:", function (t: DataTable) {
  // Newest first, as Jira often returns it, to prove the order does not matter.
  flagHistory = t.hashes().map((r) => ({ created: `${r.when}:00.000+0000`, items: [{ field: 'Flagged', fromString: '', toString: r.flag }] })).reverse();
});
Then('it has been flagged since {word}', async function (at: string) {
  const { fromChangelog } = await import('../../src/collectors/jira.js');
  assert.equal(fromChangelog({ histories: flagHistory }, 1, new Map()).flaggedSince, `${at}:00.000+0000`);
});
Then('it is not flagged', async function () {
  const { fromChangelog } = await import('../../src/collectors/jira.js');
  assert.equal(fromChangelog({ histories: flagHistory }, 1, new Map()).flaggedSince, null);
});

let estimateHistory: any[] = [];
Given("a ticket's estimate history, oldest first:", function (t: DataTable) {
  estimateHistory = t.hashes().map((r) => ({ created: `${r.when}:00.000+0000`, items: [{ field: 'Story Points', fromString: r.from, toString: r.to }] })).reverse();
});
Then('it was first estimated at {word}', async function (at: string) {
  const { fromChangelog } = await import('../../src/collectors/jira.js');
  assert.equal(fromChangelog({ histories: estimateHistory }, 1, new Map()).estimatedAt, `${at}:00.000+0000`);
});
Then('it was estimated when it was created', async function () {
  const { fromChangelog } = await import('../../src/collectors/jira.js');
  assert.equal(fromChangelog({ histories: estimateHistory }, 1, new Map()).estimatedAt, null);
});

let editHistory: any[] = [];
Given("a ticket's edit history:", function (t: DataTable) {
  editHistory = t.hashes().map((r) => ({ created: `${r.when}:00.000+0000`, author: { displayName: r.by, accountType: 'atlassian' }, items: [{ field: r.field, fromString: 'a', toString: 'b' }] }));
});
Then('the requirement edits read are {string}', async function (expected: string) {
  const { fromChangelog } = await import('../../src/collectors/jira.js');
  assert.equal(fromChangelog({ histories: editHistory }, 1, new Map()).requirementEdits.map((e) => `${e.field} by ${e.by}`).join(', '), expected);
});
