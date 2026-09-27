import assert from 'node:assert/strict';
import { When, Then } from '@cucumber/cucumber';
import { HoustonWorld } from '../support/world.js';

type Dash = { counts: Record<string, number> & { teams: number }; teams: { board: string }[]; data: { stale: boolean }; attention: { board: string; gain: number }[] };
let direct: Dash | null = null;
const body = (w: HoustonWorld): Dash => direct ?? JSON.parse(w.res!.body);

When('the dashboard is read {int} days after the last collect', async function (days: number) {
  const { store } = await import('../../src/store/index.js');
  const { dashboard } = await import('../../src/dashboard.js');
  const last = Math.max(...store.scorecards().map((c) => Date.parse(c.generatedAt)));
  direct = dashboard(last + days * 86_400_000) as unknown as Dash;
});

Then('the band counts add up to the number of teams', function (this: HoustonWorld) {
  const d = body(this); direct = null;
  assert.ok(d.counts.teams > 0);
  assert.equal(d.counts.Healthy + d.counts.Watch + d.counts['Needs attention'], d.counts.teams);
});
Then('the teams are in alphabetical order', function (this: HoustonWorld) {
  const names = body(this).teams.map((t) => t.board); direct = null;
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});
Then('the data is marked fresh', function (this: HoustonWorld) { const d = body(this); direct = null; assert.equal(d.data.stale, false); });
Then('the data is marked stale', function (this: HoustonWorld) { const d = body(this); direct = null; assert.equal(d.data.stale, true); });
Then('every attention item names a team', function (this: HoustonWorld) {
  const d = body(this);
  const boards = new Set(d.teams.map((t) => t.board));
  assert.ok(d.attention.length > 0 && d.attention.every((a) => boards.has(a.board)));
});
Then('the attention items are in descending order of gain', function (this: HoustonWorld) {
  const g = body(this).attention.map((a) => a.gain); direct = null;
  assert.deepEqual(g, [...g].sort((a, b) => b - a));
});
