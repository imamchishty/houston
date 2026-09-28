import assert from 'node:assert/strict';
import { When, Then } from '@cucumber/cucumber';
import { HoustonWorld } from '../support/world.js';

let seen: string[] = [];
When("the demo teams' performance is read", async function () {
  const { performance, boards } = await import('../../src/performance.js');
  const ids = new Set<string>();
  for (const b of [...boards(), 'all']) for (const a of performance(b, 90).areas) for (const h of a.headlines) [h.measure, ...h.drill].forEach((m) => ids.add(m.id));
  seen = [...ids];
  assert.ok(seen.length > 40, `only ${seen.length} measures shown`);
});
Then('every measure shown has a reason it matters and how it is calculated', async function () {
  const { metricById } = await import('../../src/metrics.js');
  const missing = seen.filter((id) => { const m = metricById(id); return !m || m.why.length < 20 || m.how.length < 20; });
  assert.deepEqual(missing, [], 'measures without an explanation');
});
Then(/^a (\w+) of ([\d.]+) is DORA "(\w+)"$/, async function (metric: string, value: string, tier: string) {
  const { doraTier } = await import('../../src/metrics.js');
  assert.equal(doraTier(metric, Number(value)), tier);
});

Then('METRICS.md defines every headline and drill-down measure', async function () {
  const { readFileSync } = await import('node:fs');
  const { HEADLINES, DRILL } = await import('../../src/performance.js');
  const doc = readFileSync('METRICS.md', 'utf8');
  const missing = HEADLINES.flatMap((h) => [h, ...DRILL[h]]).filter((id) => !doc.includes(`\`${id}\``));
  assert.deepEqual(missing, [], 'measures missing from METRICS.md');
});
