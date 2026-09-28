import assert from 'node:assert/strict';
import { When, Then } from '@cucumber/cucumber';
import { HoustonWorld } from '../support/world.js';

type M = { id: string };
type Dash = { teams: { board: string; score: unknown; summary: string; measures: M[]; missed: { id: string; missedTwice: boolean }[] }[]; data: { stale: boolean }; attention: { board: string; id: string; missedTwice: boolean }[] };
let direct: Dash | null = null;
const body = (w: HoustonWorld): Dash => { const d = direct ?? JSON.parse(w.res!.body); direct = null; return d; };
const ORDER = ['deploy_frequency', 'lead_time', 'sprint_completion', 'defect_leakage', 'bug_workload', 'change_failure_rate', 'time_to_restore', 'sla_resolution', 'flow_efficiency', 'security_on_time'];

When('the dashboard is read {int} days after the last collect', async function (days: number) {
  const { store } = await import('../../src/store/index.js');
  const { dashboard } = await import('../../src/dashboard.js');
  const last = Math.max(...store.github().map((g) => Date.parse(g.until)), ...store.support().map((s) => Date.parse(s.capturedAt)));
  direct = dashboard(last + days * 86_400_000) as unknown as Dash;
});
Then('every team shows the headline measures in order, and nothing else', function (this: HoustonWorld) {
  const d = body(this);
  assert.ok(d.teams.length >= 2);
  for (const t of d.teams) { const ids = t.measures.map((m) => m.id); assert.deepEqual(ids, ORDER.filter((id) => ids.includes(id)), t.board); assert.ok(ids.length >= 8, `${t.board}: ${ids.length} headlines`); }
});
Then('the teams are in alphabetical order', function (this: HoustonWorld) {
  const names = body(this).teams.map((t) => t.board);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});
Then("each team's score and summary equal its own team page", async function (this: HoustonWorld) {
  const d = body(this);
  for (const t of d.teams) {
    await this.request('GET', `/api/teams/${t.board}?days=30`, this.signedIn());
    const p = JSON.parse(this.res!.body);
    assert.deepEqual({ score: t.score, summary: t.summary }, { score: p.score, summary: p.summary }, t.board);
  }
});
Then('the data is marked fresh', function (this: HoustonWorld) { assert.equal(body(this).data.stale, false); });
Then('the data is marked stale', function (this: HoustonWorld) { assert.equal(body(this).data.stale, true); });
Then('every attention item names a team and a headline measure missed two periods running', function (this: HoustonWorld) {
  const d = body(this), boards = new Set(d.teams.map((t) => t.board));
  assert.ok(d.attention.length > 0);
  for (const a of d.attention) { assert.ok(boards.has(a.board)); assert.ok(ORDER.includes(a.id), a.id); assert.equal(a.missedTwice, true); }
});
