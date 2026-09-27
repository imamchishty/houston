import assert from 'node:assert/strict';
import { Given, Then } from '@cucumber/cucumber';
import { HoustonWorld, houston } from '../support/world.js';
import type { Rates, CostReport } from '../../src/cost.js';

type W = HoustonWorld & { rates: Rates; report?: CostReport };

Given('a Claude seat costing AED {int} a working day for everyone', function (this: HoustonWorld, day: number) {
  (this as W).rates.seatDay = day; (this as W).rates.seatHolders = [];
});
Given('a Claude seat costing AED {int} a working day for {string}', function (this: HoustonWorld, day: number, who: string) {
  (this as W).rates.seatDay = day; (this as W).rates.seatHolders = [who];
});
Then('Claude seats cost AED {int} of the team cost', function (this: HoustonWorld, n: number) { assert.equal((this as W).report!.aiCost, n); });

Then('a seat of AED {int} a month costs AED {int} a working day', async function (monthly: number, daily: number) {
  const { seatDay } = await import('../../src/claude.js');
  const before = houston.config.claude.seatMonthly;
  houston.config.claude.seatMonthly = monthly;
  try { assert.equal(Math.round(seatDay() * 100) / 100, daily); } finally { houston.config.claude.seatMonthly = before; }
});

Then('{int} of {int} people use Claude Code, {int}%', function (this: HoustonWorld, active: number, roster: number, pct: number) {
  const c = JSON.parse(this.res!.body);
  assert.deepEqual({ active: c.activeUsers, roster: c.rosterSize, pct: c.adoptionPct }, { active, roster, pct });
});
Then('the Claude report has no per person data', function (this: HoustonWorld) {
  const c = JSON.parse(this.res!.body);
  assert.equal(c.people, undefined); assert.equal(c.notUsing, undefined);
});
Then('the Claude report lists {int} people and {int} not using it', function (this: HoustonWorld, n: number, not: number) {
  const c = JSON.parse(this.res!.body);
  assert.equal(c.people.length, n); assert.equal(c.notUsing.length, not);
});
Then('no Claude person record has an email address', function (this: HoustonWorld) {
  assert.ok(!/@/.test(this.res!.body), 'email leaked');
});
Then('the metrics {string} are explained', async function (list: string) {
  const { metricById } = await import('../../src/metrics.js');
  for (const id of list.split(',').map((x) => x.trim())) assert.ok(metricById(id)?.why && metricById(id)?.how, id);
});
