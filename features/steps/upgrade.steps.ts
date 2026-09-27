import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Given, When, Then, After } from '@cucumber/cucumber';
import { houston } from '../support/world.js';

// Each scenario gets its own data folder, so schema experiments never touch the shared test history.
let saved: string | null = null, error: Error | null = null, extraStep = false;
const hist = () => import('../../src/store/history.js');
async function useFreshDir() {
  const h = await hist();
  h.closeHistory();
  saved ??= houston.config.dataDir;
  houston.config.dataDir = mkdtempSync(join(tmpdir(), 'houston-upgrade-'));
}
After(async function () {
  const h = await hist();
  if (extraStep) { h.MIGRATIONS.pop(); extraStep = false; }
  if (saved) { h.closeHistory(); houston.config.dataDir = saved; saved = null; }
  error = null;
});

Given('a history database with {int} day of scores for {string}', async function (n: number, board: string) {
  await useFreshDir();
  const h = await hist();
  for (let i = 0; i < n; i++) h.recordDay({ day: `2026-09-${String(10 + i).padStart(2, '0')}`, board, areas: [{ area: 'sprint', score: 40, rag: 'red' }], findings: [], sprints: [], cost: null });
  h.closeHistory();
});
Given('a history database written by a newer version', async function () {
  await useFreshDir();
  const d = new DatabaseSync(join(houston.config.dataDir, 'history.db'));
  d.exec('CREATE TABLE future (x INTEGER); PRAGMA user_version = 99;');
  d.close();
});

When('a new version adds a schema step', async function () {
  const h = await hist();
  h.MIGRATIONS.push('ALTER TABLE area_scores ADD COLUMN note TEXT;'); extraStep = true;
  h.closeHistory();
  h.schemaVersion();
});
When('the same version opens it again', async function () { const h = await hist(); h.closeHistory(); h.schemaVersion(); });
When('this version opens it', async function () {
  const h = await hist();
  try { h.schemaVersion(); } catch (e) { error = e as Error; }
});

Then('the history still has {int} day of scores for {string}', async function (n: number, board: string) {
  const h = await hist();
  assert.equal(new Set(h.history(board, 3650).areas.map((a) => (a as { day: string }).day)).size, n);
});
Then('the database is at the new schema version', async function () {
  const h = await hist();
  assert.equal(h.schemaVersion(), h.MIGRATIONS.length);
});
Then('a copy was saved before the schema step ran', function () {
  const dir = join(houston.config.dataDir, 'backups');
  assert.ok(existsSync(dir) && readdirSync(dir).some((f) => f.startsWith('history-before-schema-')), 'no pre-upgrade copy');
});
Then('no pre-upgrade copy was made', function () {
  const dir = join(houston.config.dataDir, 'backups');
  assert.ok(!existsSync(dir) || !readdirSync(dir).some((f) => f.startsWith('history-before-schema-')));
});
Then('it refuses with a message to deploy the newer version or restore a backup', function () {
  assert.ok(error, 'expected a refusal');
  assert.match(error!.message, /newer version or restore a backup/);
});
