import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Given, When, Then } from '@cucumber/cucumber';
import type { Scorecard } from '../../src/types.js';

const dataDir = () => process.env.HOUSTON_DATA_DIR!;
async function nightly(day: string) {
  const { snapshot } = await import('../../src/pipeline.js');
  snapshot(day);
}

When('the nightly job runs twice on {string}', async function (day: string) { await nightly(day); await nightly(day); });
When('the nightly job runs on {string}', async function (day: string) { await nightly(day); });
When('the nightly job has run on {int} different days', async function (n: number) {
  for (let i = 0; i < n; i++) await nightly(new Date(Date.UTC(2027, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
});
Given('the history already holds a sprint {string} for {string}', async function (name: string, board: string) {
  const { recordDay } = await import('../../src/store/history.js');
  const old: Scorecard = { board, sprintId: 999, sprintName: name, sprintEnd: '2026-03-01T00:00:00Z', score: 40, rag: 'red', findings: [], generatedAt: '2026-03-01T00:00:00Z' };
  recordDay({ day: '2026-03-01', board, areas: [], findings: [], sprints: [old], cost: null });
});

Then('the history has {int} day(s) of area scores for {string}', async function (n: number, board: string) {
  const { history } = await import('../../src/store/history.js');
  const days = new Set(history(board, 3650).areas.map((a) => (a as { day: string }).day));
  assert.equal(days.size, n);
});
Then('the history keeps {int} sprints for {string}', async function (n: number, board: string) {
  const { history } = await import('../../src/store/history.js');
  assert.equal(history(board).sprints.length, n);
});
Then('a backup of the history exists for {string}', function (day: string) {
  assert.ok(existsSync(join(dataDir(), 'backups', `history-${day}.db`)));
});
Then('there are {int} backups', function (n: number) {
  assert.equal(readdirSync(join(dataDir(), 'backups')).filter((f) => f.startsWith('history-')).length, n);
});
