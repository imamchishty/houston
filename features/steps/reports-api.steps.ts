import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Given, When, Then, After, type DataTable } from '@cucumber/cucumber';
import { HoustonWorld, houston } from '../support/world.js';
import type { Sprint, Issue } from '../../src/types.js';

Then('no work in progress item has an assignee', function (this: HoustonWorld) {
  const s = JSON.parse(this.res!.body); assert.ok(s.inProgress.length > 0);
  for (const x of s.inProgress) assert.ok(!('assignee' in x), x.key);
});
Then('every work in progress item has an assignee field', function (this: HoustonWorld) {
  const s = JSON.parse(this.res!.body); assert.ok(s.inProgress.length > 0);
  for (const x of s.inProgress) assert.ok('assignee' in x, x.key);
});

// ---- Sprint board, hand-built ----
let saved: string | null = null, board: any = null;
After(async function () { if (saved) { houston.config.dataDir = saved; saved = null; } board = null; });
Given(/^a (closed )?sprint "([^"]+)" from \w+ (\S+) to \w+ (\S+) with these items:$/, async function (closed: string | undefined, name: string, from: string, to: string, t: DataTable) {
  saved = houston.config.dataDir; houston.config.dataDir = mkdtempSync(join(tmpdir(), 'houston-sprint-'));
  const start = `${from}T00:00:00.000Z`;
  const issues: Issue[] = t.hashes().map((r) => ({
    key: r.key, summary: r.key, type: 'Story', status: r.status === 'done' ? 'Done' : r.status === 'doing' ? 'In Progress' : 'To Do',
    statusCategory: r.status === 'done' ? 'done' : r.status === 'doing' ? 'inprogress' : 'todo', points: r.points ? Number(r.points) : null,
    assignee: 'x', hasAcceptanceCriteria: true, created: '2026-09-01T00:00:00Z', resolved: r.resolved ? `${r.resolved}T12:00:00.000Z` : null,
    addedToSprintAt: r.added ? `${r.added}T12:00:00.000Z` : null, sprintIds: [1], inProgressSince: r.status === 'todo' ? null : '2026-09-08T09:00:00.000Z', epic: null,
  }));
  const sprint: Sprint = { id: 1, name, board: 'ABC', goal: 'g', start, end: `${to}T00:00:00.000Z`, state: closed ? 'closed' : 'active', issues };
  const { store } = await import('../../src/store/index.js');
  store.saveSprints([sprint]); store.saveProjects([]);
});
When(/^the (?:sprint board|board for sprint (\d+)) is read at (\S+)$/, async function (id: string | undefined, at: string) {
  const { currentSprint } = await import('../../src/sprintNow.js');
  board = currentSprint('ABC', false, Date.parse(`${at}:00Z`), id ? Number(id) : undefined);
  (globalThis as any).__houstonBoard = board;
  assert.ok(board, 'no sprint');
});
Then('the sprint has {int} working days, {int} elapsed and {int} left', function (total: number, el: number, left: number) {
  assert.deepEqual([board.workingDays, board.workingDaysElapsed, board.workingDaysLeft], [total, el, left]);
});
Then('committed is {int} points, scope {int}, done {int} and remaining {int}', function (c: number, s: number, d: number, r: number) {
  assert.deepEqual([board.points.committed, board.points.scope, board.points.done, board.points.remaining], [c, s, d, r]);
});
Then('the projection is {int} points and the outlook is {string}', function (p: number, o: string) {
  assert.equal(board.points.projected, p); assert.equal(board.outlook, o);
});
Then('{int} item is unestimated', function (n: number) { assert.equal(board.unestimated, n); });
Then('the ideal line runs from {int} to {int}', function (a: number, b: number) {
  assert.equal(board.burndown[0].ideal, a); assert.equal(board.burndown[board.burndown.length - 1].ideal, b);
});
Then('scope on {word} is {int} and on {word} is {int}', function (d1: string, s1: number, d2: string, s2: number) {
  const at = (d: string) => board.burndown.find((x: { day: string }) => x.day === d).scope;
  assert.equal(at(d1), s1); assert.equal(at(d2), s2);
});
