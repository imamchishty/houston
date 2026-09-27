import assert from 'node:assert/strict';
import { Given, When, Then } from '@cucumber/cucumber';
import { HoustonWorld, houston } from '../support/world.js';

Then('with time zone offset {int} hours, {word} runs from {word} to {word}', async function (tz: number, month: string, from: string, to: string) {
  const { monthRange } = await import('../../src/monthly.js');
  const before = houston.config.tzOffset; houston.config.tzOffset = tz;
  try { const r = monthRange(month); assert.deepEqual([new Date(r.from).toISOString(), new Date(r.to).toISOString()], [from, to]); }
  finally { houston.config.tzOffset = before; }
});

async function dataStartMonth() {
  const { store } = await import('../../src/store/index.js');
  const { monthOf } = await import('../../src/monthly.js');
  const starts = [...store.github().filter((g) => g.board === 'OSSI').map((g) => Date.parse(g.since)), ...store.projects().filter((p) => p.board === 'OSSI').map((p) => Date.parse(p.since))];
  return monthOf(Math.max(...starts));
}
Then('the monthly status for the current month is {string}', async function (status: string) {
  const { monthValues, monthOf } = await import('../../src/monthly.js');
  assert.equal(monthValues('OSSI', monthOf(Date.now())).status, status);
});
Then('the monthly status for the month the collected data starts in is {string}', async function (status: string) {
  const { monthValues } = await import('../../src/monthly.js');
  assert.equal(monthValues('OSSI', await dataStartMonth()).status, status);
});
Then('the monthly status for the month before that is {string}', async function (status: string) {
  const { monthValues, prevMonth } = await import('../../src/monthly.js');
  const m = prevMonth(await dataStartMonth());
  const { storedMonth } = await import('../../src/store/history.js');
  assert.equal(storedMonth(m, 'OSSI').size, 0, 'a saved month would change the answer');
  assert.equal(monthValues('OSSI', m).status, status);
});

let savedMonth = '';
Given('the month before the collected data starts was saved with {float} deploys per week', async function (v: number) {
  const { prevMonth } = await import('../../src/monthly.js');
  const { recordMonth } = await import('../../src/store/history.js');
  savedMonth = prevMonth(prevMonth(await dataStartMonth()));
  recordMonth(savedMonth, 'OSSI', [{ metric: 'deploy_frequency', value: v, num: null, den: null }]);
});
Then('that month shows as {string} with {float} deploys per week', async function (status: string, v: number) {
  const { monthValues } = await import('../../src/monthly.js');
  const r = monthValues('OSSI', savedMonth);
  assert.equal(r.status, status); assert.equal(r.values.get('deploy_frequency')?.value, v);
});

let lastMonth = '';
When('the user requests the monthly report for last month', async function (this: HoustonWorld) {
  const { monthOf, prevMonth } = await import('../../src/monthly.js');
  lastMonth = prevMonth(monthOf(Date.now()));
  await this.request('GET', `/api/monthly?team=OSSI&month=${lastMonth}`, this.signedIn());
});
Then('it has {int} key numbers and {int} months of trend for each', function (this: HoustonWorld, n: number, months: number) {
  const r = JSON.parse(this.res!.body);
  assert.equal(r.headline.length, n);
  for (const t of r.trends) assert.equal(t.points.length, months, t.id);
});
Then('the Markdown for the same month shows the same deploys per week', async function (this: HoustonWorld) {
  const r = JSON.parse(this.res!.body), d = r.headline.find((h: { id: string }) => h.id === 'deploy_frequency');
  await this.request('GET', `/api/monthly.md?team=OSSI&month=${lastMonth}`, this.signedIn());
  assert.ok(this.res!.body.includes(`| Deploys per week | ${d.value} per week`), this.res!.body.slice(0, 400));
});
