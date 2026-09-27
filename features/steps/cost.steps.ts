import assert from 'node:assert/strict';
import { Given, When, Then, type DataTable } from '@cucumber/cucumber';
import type { Epic, Issue, Sprint } from '../../src/types.js';
import type { CostReport, Rates } from '../../src/cost.js';
import { HoustonWorld } from '../support/world.js';

type CostWorld = HoustonWorld & {
  rates: Rates; sprint: Sprint; roster: string[]; epics: Map<string, Epic>; report?: CostReport;
};
const cost = (w: HoustonWorld) => w as CostWorld;
const epic = (key: string, statusCategory: Epic['statusCategory'] = 'inprogress', childCount = 0, childDone = 0): Epic =>
  ({ key, summary: key, status: statusCategory, statusCategory, created: '2026-05-01T00:00:00Z', started: null, resolved: null, childCount, childDone });
const featureOf = (w: CostWorld, key: string) => {
  const f = w.report!.features.find((x) => x.key === key);
  assert.ok(f, `no feature ${key}`); return f!;
};

Given('day rates of AED {int} for FTEs and AED {int} for contractors', function (this: HoustonWorld, fte: number, contractor: number) {
  const w = cost(this);
  w.rates = { fteDay: fte, contractorDay: contractor, contractors: [], overrides: {}, currency: 'AED' };
  w.roster = []; w.epics = new Map();
});
Given('{string} is a contractor', function (this: HoustonWorld, name: string) { cost(this).rates.contractors.push(name); });
Given('{string} has her/his/their own day rate of AED {int}', function (this: HoustonWorld, name: string, rate: number) { cost(this).rates.overrides[name] = rate; });
Given('{string} is on the team roster', function (this: HoustonWorld, name: string) { cost(this).roster.push(name); });
Given(/^a sprint from \w+ (\d+ \w+ \d{4}) to \w+ (\d+ \w+ \d{4})$/, function (this: HoustonWorld, from: string, to: string) {
  const iso = (d: string) => new Date(`${d} 00:00:00 UTC`).toISOString();
  cost(this).sprint = { id: 1, name: 'Sprint 1', board: 'A', goal: 'Goal for the sprint', start: iso(from), end: iso(to), state: 'closed', issues: [] };
});
Given('these tickets in the sprint:', function (this: HoustonWorld, table: DataTable) {
  const w = cost(this);
  w.sprint.issues = table.hashes().map((r): Issue => ({
    key: r.ticket, summary: r.ticket, type: 'Story', status: r.status, statusCategory: r.status as Issue['statusCategory'],
    points: r.points ? Number(r.points) : null, assignee: r.assignee || null, hasAcceptanceCriteria: true,
    created: w.sprint.start, resolved: r.status === 'done' ? w.sprint.end : null, addedToSprintAt: null, sprintIds: [1],
    inProgressSince: r.status === 'todo' ? null : w.sprint.start, epic: r.feature || null,
  }));
  for (const i of w.sprint.issues) if (i.epic && !w.epics.has(i.epic)) w.epics.set(i.epic, epic(i.epic));
});
Given('feature {string} is in progress with {int} tickets, {int} done', function (this: HoustonWorld, key: string, n: number, done: number) {
  cost(this).epics.set(key, epic(key, 'inprogress', n, done));
});
Given('feature {string} is done with {int} tickets, {int} done', function (this: HoustonWorld, key: string, n: number, done: number) {
  cost(this).epics.set(key, epic(key, 'done', n, done));
});

When('the feature costs are calculated', async function (this: HoustonWorld) {
  const w = cost(this);
  const { featureCosts } = await import('../../src/cost.js');
  w.report = featureCosts({ sprints: [w.sprint], epics: [...w.epics.values()], rates: w.rates, roster: w.roster, weekend: [6, 0] });
});

Then('the sprint has {int} working days', async function (this: HoustonWorld, n: number) {
  const { workingDays } = await import('../../src/cost.js');
  const s = cost(this).sprint;
  assert.equal(workingDays(s.start, s.end, [6, 0]), n);
});
Then('feature {string} cost AED {int}, of which AED {int} FTE and AED {int} contractor', function (this: HoustonWorld, key: string, total: number, fte: number, contractor: number) {
  const f = featureOf(cost(this), key);
  assert.deepEqual({ spent: f.spent, fte: f.fte, contractor: f.contractor }, { spent: total, fte, contractor });
});
Then('work with no feature cost AED {int}', function (this: HoustonWorld, n: number) { assert.equal(cost(this).report!.noFeature, n); });
Then('people not on tickets cost AED {int}', function (this: HoustonWorld, n: number) { assert.equal(cost(this).report!.notOnTickets, n); });
Then('the team cost AED {int}', function (this: HoustonWorld, n: number) { assert.equal(cost(this).report!.teamCost, n); });
Then('the cost per point is AED {int}', function (this: HoustonWorld, n: number) { assert.equal(cost(this).report!.costPerPoint, n); });
Then('feature {string} has {int} points left costing AED {int} to complete', function (this: HoustonWorld, key: string, pts: number, amount: number) {
  const f = featureOf(cost(this), key);
  assert.deepEqual({ left: f.pointsRemaining, toComplete: f.toComplete }, { left: pts, toComplete: amount });
});
Then('feature {string} is estimated at AED {int} in total', function (this: HoustonWorld, key: string, n: number) { assert.equal(featureOf(cost(this), key).total, n); });

Then('the response shows the day rates', function (this: HoustonWorld) {
  const r = JSON.parse(this.res!.body).rates; assert.ok(r && r.fteDay > 0 && r.contractorDay > 0, JSON.stringify(r));
});
Then('the response does not show the day rates', function (this: HoustonWorld) {
  const body = JSON.parse(this.res!.body);
  assert.equal(body.rates, null);
  assert.ok(!/fteDay|contractorDay|overrides/.test(this.res!.body), 'rate fields leaked');
});
