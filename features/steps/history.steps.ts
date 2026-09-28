import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { When, Then } from '@cucumber/cucumber';
import { HoustonWorld } from '../support/world.js';

const dataDir = () => process.env.HOUSTON_DATA_DIR!;
async function nightly(day: string) {
  const { snapshot } = await import('../../src/pipeline.js');
  snapshot(day);
}

When('the nightly job runs twice on {string}', async function (day: string) { await nightly(day); await nightly(day); });
When('the nightly job has run on {int} different days', async function (n: number) {
  for (let i = 0; i < n; i++) await nightly(new Date(Date.UTC(2027, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
});

Then("the history has {int} score for {string} on {string}, equal to the team's score now", async function (n: number, board: string, day: string) {
  const { history } = await import('../../src/store/history.js');
  const { performance } = await import('../../src/performance.js');
  const rows = history(board, ['score'], 3650).series.score.filter((r) => r.day === day);
  assert.equal(rows.length, n);
  assert.equal(rows[0].value, performance(board, 30).score.pct);
});
Then('the history has the headline measures for {string} on {string}', async function (board: string, day: string) {
  const { history } = await import('../../src/store/history.js');
  const h = history(board, ['r:lead_time', 'r:defect_leakage'], 3650);
  for (const s of Object.values(h.series)) assert.ok(s.some((r) => r.day === day));
});
Then('a backup of the history exists for {string}', function (day: string) {
  assert.ok(existsSync(join(dataDir(), 'backups', `history-${day}.db`)));
});
Then('there are {int} backups', function (n: number) {
  assert.equal(readdirSync(join(dataDir(), 'backups')).filter((f) => /^history-\d{4}-\d{2}-\d{2}\.db$/.test(f)).length, n);
});
Then('the history response has a score series and one series per headline measure', async function (this: HoustonWorld) {
  const { HEADLINES } = await import('../../src/performance.js');
  const b = JSON.parse(this.res!.body);
  assert.deepEqual(Object.keys(b.series).sort(), ['score', ...HEADLINES.map((h) => `r:${h}`)].sort());
  assert.ok(b.series.score.length >= 1);
});
