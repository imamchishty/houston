import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { HoustonWorld } from '../support/world.js';

type Metric = { id: string; value: number | null; previous: number | null; tier: string | null; why: string; how: string; series: unknown[] };
const metrics = (w: HoustonWorld) => JSON.parse(w.res!.body).metrics as Metric[];

Then("the dashboard's {word} matches the team's finding within {float}", async function (this: HoustonWorld, id: string, tol: number) {
  const { team } = JSON.parse(this.res!.body) as { team: string };
  const { store } = await import('../../src/store/index.js');
  const { scoreFlow } = await import('../../src/rules/flowRules.js');
  const finding = scoreFlow(store.github().find((g) => g.board === team)!).findings.find((f) => f.ruleId === id)!;
  const m = metrics(this).find((x) => x.id === id)!;
  assert.ok(Math.abs(m.value! - finding.value) <= tol, `${id}: dashboard ${m.value} vs finding ${finding.value}`);
});
Then('each of the {int} metrics has {int} days of data, an explanation and a DORA tier', function (this: HoustonWorld, n: number, days: number) {
  const ms = metrics(this);
  assert.equal(ms.length, n);
  for (const m of ms) {
    assert.equal(m.series.length, days, m.id);
    assert.ok(m.why.length > 20 && m.how.length > 20, `${m.id} explanation`);
    assert.ok(['Elite', 'High', 'Medium', 'Low'].includes(m.tier!), `${m.id} tier ${m.tier}`);
  }
});
Then('each metric has a previous value', function (this: HoustonWorld) { for (const m of metrics(this)) assert.notEqual(m.previous, null, m.id); });
Then('no metric has a previous value', function (this: HoustonWorld) { for (const m of metrics(this)) assert.equal(m.previous, null, m.id); });
Then("each metric's tier is the DORA band for its value", async function (this: HoustonWorld) {
  const { doraTier } = await import('../../src/metrics.js');
  for (const m of metrics(this)) assert.equal(m.tier, doraTier(m.id, m.value!), m.id);
});
