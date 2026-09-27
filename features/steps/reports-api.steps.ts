import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Given, When, Then, After, type DataTable } from '@cucumber/cucumber';
import { HoustonWorld, houston } from '../support/world.js';
import type { Sprint, Issue } from '../../src/types.js';

type M = { id: string; value: number | null; num: number | null; den: number | null; target: unknown; how?: string; unit: string };
let second: any = null;
When('the user also requests {string}', async function (this: HoustonWorld, url: string) {
  const first = this.res; await this.request('GET', url, this.signedIn()); second = JSON.parse(this.res!.body); (globalThis as any).__houstonSecond = second; this.res = first;
});
Then("the dashboard's {word} equals the report's", function (this: HoustonWorld, id: string) {
  const dash = JSON.parse(this.res!.body);
  const h = dash.headlines.flatMap((x: { measures: M[] }) => x.measures).find((m: M) => m.id === id);
  const r = second.groups.flatMap((g: { measures: M[] }) => g.measures).find((m: M) => m.id === id);
  assert.ok(h && r, id);
  assert.deepEqual({ value: h.value, num: h.num, den: h.den }, { value: r.value, num: r.num, den: r.den }, id);
});
Then("every team's row equals the report filtered to that team", async function (this: HoustonWorld) {
  const all = JSON.parse(this.res!.body);
  for (const t of all.teams) {
    await this.request('GET', `/api/reports/${all.report}?team=${t.board}&days=${all.days}`, this.signedIn());
    const own = JSON.parse(this.res!.body).groups.flatMap((g: { measures: M[] }) => g.measures);
    for (const m of t.measures as M[]) {
      const o = own.find((x: M) => x.id === m.id);
      assert.deepEqual({ value: m.value, num: m.num, den: m.den }, { value: o.value, num: o.num, den: o.den }, `${t.board} ${m.id}`);
    }
  }
});
Then('every measured rate has a count over a count that gives its value', function (this: HoustonWorld) {
  const ms: M[] = JSON.parse(this.res!.body).groups.flatMap((g: { measures: M[] }) => g.measures);
  for (const m of ms.filter((x) => x.unit === '%' && x.value != null))
    assert.equal(m.value, Math.round((1000 * m.num!) / m.den!) / 10, `${m.id}: ${m.num}/${m.den} vs ${m.value}`);
});
Then('every measure has a target and a definition', function (this: HoustonWorld) {
  const ms: M[] = JSON.parse(this.res!.body).groups.flatMap((g: { measures: M[] }) => g.measures);
  for (const m of ms) { assert.ok(m.target, `${m.id} target`); assert.ok((m.how ?? '').length > 30, `${m.id} definition`); }
});
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
