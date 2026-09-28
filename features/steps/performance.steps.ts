import assert from 'node:assert/strict';
import { Given, When, Then, type DataTable } from '@cucumber/cucumber';
import { HoustonWorld } from '../support/world.js';
import type { Measure } from '../../src/reports.js';

let ms = new Map<string, Measure>(), result: { met: number; of: number; pct: number | null };
const mk = (id: string, value: number | null, target: string, small = false): Measure => {
  const [op, v] = target.trim().split(/\s+/) as ['<' | '>', string];
  const t = { op, value: Number(v) };
  return { id, title: id, value, unit: '%', num: null, den: null, target: t, met: value == null ? null : op === '<' ? value < t.value : value > t.value, how: 'x', smallSample: small };
};
Given('these headline results:', function (t: DataTable) {
  ms = new Map(t.hashes().map((r) => [r.measure, mk(r.measure, r.value === '' ? null : Number(r.value), r.target, r['small sample'] === 'yes')]));
});
Given('a drill-down measure {word} of {int} against a target of under {int}', function (id: string, v: number, under: number) { ms.set(id, mk(id, v, `< ${under}`)); });
When('the score is worked out', async function () { const { score } = await import('../../src/performance.js'); result = score(ms); });
Then('{int} of {int} targets are met, {int}%', function (met: number, of: number, pct: number) { assert.deepEqual(result, { met, of, pct }); });

type P = { missed: { id: string; missedTwice: boolean }[]; areas: { headlines: { measure: Measure & { denLabel?: string }; drill: Measure[] }[] }[] };
const body = (w: HoustonWorld) => JSON.parse(w.res!.body) as P;
const everything = (p: P) => p.areas.flatMap((a) => a.headlines.flatMap((h) => [h.measure, ...h.drill]));

Then('the missed targets come before nothing else, two periods running first, then in area order', async function (this: HoustonWorld) {
  const { HEADLINES } = await import('../../src/performance.js');
  const p = body(this), heads = p.areas.flatMap((a) => a.headlines.map((h) => h.measure));
  assert.deepEqual(p.missed.map((m) => m.id).sort(), heads.filter((m) => m.met === false && !m.smallSample).map((m) => m.id).sort());
  const key = (m: { id: string; missedTwice: boolean }) => (m.missedTwice ? 0 : 100) + HEADLINES.indexOf(m.id);
  const keys = p.missed.map(key);
  assert.deepEqual(keys, [...keys].sort((a, b) => a - b));
  assert.ok(p.missed.length > 0);
});
Then('every measured rate has a count over a count that gives its value', function (this: HoustonWorld) {
  // A rate is a count over a count. Percentages from a scan or a snapshot (SonarQube coverage, server errors) have
  // no count to show, so they must say how many teams they come from instead.
  for (const m of everything(body(this)).filter((x) => x.unit === '%' && x.value != null) as (Measure & { denLabel?: string })[]) {
    if (m.num == null) { assert.match(m.denLabel ?? '', /^teams?$/, `${m.id}: a percentage with no count`); continue; }
    assert.equal(m.value, Math.round((1000 * m.num!) / m.den!) / 10, `${m.id}: ${m.num}/${m.den} vs ${m.value}`);
  }
});
Then('every headline has a target and a definition', function (this: HoustonWorld) {
  for (const a of body(this).areas) for (const h of a.headlines) { assert.ok(h.measure.target, `${h.measure.id} target`); assert.ok((h.measure.how ?? '').length > 30, `${h.measure.id} definition`); }
});
Then("each headline count for all teams is the sum of the teams' counts", async function (this: HoustonWorld) {
  const all = body(this);
  const { boards } = await import('../../src/performance.js');
  const per = [];
  for (const b of boards()) { await this.request('GET', `/api/teams/${b}?days=30`, this.signedIn()); per.push(body(this)); }
  // Rates add up exactly: the numerator and denominator of all teams are the sums of the teams'.
  for (const a of all.areas) for (const h of a.headlines) {
    const m = h.measure; if (m.num == null || m.den == null || m.unit !== '%') continue;
    const parts = per.map((p) => everything(p).find((x) => x.id === m.id)).filter(Boolean) as Measure[];
    const sum = [parts.reduce((t, x) => t + (x.num ?? 0), 0), parts.reduce((t, x) => t + (x.den ?? 0), 0)];
    // Flow efficiency counts hours, rounded to whole hours per slice: each team's rounding can differ by under an hour.
    const slack = m.id === 'flow_efficiency' ? parts.length : 0;
    assert.ok(Math.abs(m.num - sum[0]) <= slack && Math.abs(m.den - sum[1]) <= slack, `${m.id}: ${m.num}/${m.den} vs ${sum}`);
  }
});
