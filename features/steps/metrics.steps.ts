import assert from 'node:assert/strict';
import { When, Then } from '@cucumber/cucumber';
import { HoustonWorld } from '../support/world.js';

let seen: string[] = [];
When('the demo teams are scored', async function (this: HoustonWorld) {
  const { store } = await import('../../src/store/index.js');
  const { scoreFlow } = await import('../../src/rules/flowRules.js');
  const { scoreQuality } = await import('../../src/rules/qualityRules.js');
  const { scoreDocs } = await import('../../src/rules/docsRules.js');
  const { scoreFeatures } = await import('../../src/rules/featureRules.js');
  const { scoreOps } = await import('../../src/rules/opsRules.js');
  const ids = new Set<string>();
  for (const c of store.scorecards()) c.findings.forEach((f) => ids.add(f.ruleId));
  for (const g of store.github()) scoreFlow(g).findings.forEach((f) => ids.add(f.ruleId));
  for (const q of store.quality()) scoreQuality(q).findings.forEach((f) => ids.add(f.ruleId));
  for (const d of store.docs()) scoreDocs(d, 1).findings.forEach((f) => ids.add(f.ruleId));
  for (const e of Object.values(store.epics())) if (e?.length) scoreFeatures(e).findings.forEach((f) => ids.add(f.ruleId));
  for (const a of store.azure()) scoreOps(a).findings.forEach((f) => ids.add(f.ruleId));
  seen = [...ids];
  assert.ok(seen.length > 30, `only ${seen.length} metrics scored`);
});
Then('every metric on every team has a reason it matters and how it is calculated', async function () {
  const { metricById } = await import('../../src/metrics.js');
  const missing = seen.filter((id) => { const m = metricById(id); return !m || m.why.length < 20 || m.how.length < 20; });
  assert.deepEqual(missing, [], 'metrics without an explanation');
});
Then(/^a (\w+) of ([\d.]+) is DORA "(\w+)"$/, async function (metric: string, value: string, tier: string) {
  const { doraTier } = await import('../../src/metrics.js');
  assert.equal(doraTier(metric, Number(value)), tier);
});
