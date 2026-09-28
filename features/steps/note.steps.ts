import assert from 'node:assert/strict';
import { Given, When, Then, type DataTable } from '@cucumber/cucumber';
import { HoustonWorld } from '../support/world.js';
import type { Measure } from '../../src/reports.js';
import type { PerfLike, SprintLike, Note, Driver } from '../../src/note.js';

const TITLES: Record<string, string> = { lead_time: 'Lead time for changes (median)', sprint_completion: 'Sprint completion', defect_leakage: 'Defect leakage', bug_workload: 'Bug workload',
  stage_deploy: 'Waiting to deploy (median)', stage_review: 'Review time (median)', unplanned_work: 'Unplanned work', carry_over: 'Work carried over', pr_review_rate: 'PR review rate', incidents_out_of_hours: 'Incidents outside working hours' };
// A measure with a previous value: "id from to unit [target op value]".
function m(id: string, previous: number, value: number, unit: string, target?: string): Measure {
  const t = target ? { op: target.split(/\s+/)[0] as '<' | '>', value: Number(target.split(/\s+/)[1]) } : null;
  const met = (v: number) => (!t ? null : t.op === '<' ? v < t.value : v > t.value);
  const better = !t ? null : t.op === '<' ? value < previous : value > previous;
  return { id, title: TITLES[id] ?? id, value, previous, unit: unit as Measure['unit'], num: null, den: null, target: t, met: met(value), previousMet: met(previous), how: 'x',
    trend: value === previous ? 'same' : better == null ? null : better ? 'better' : 'worse' };
}
const drills = (spec: string): Measure[] => spec.split(';').map((x) => x.trim()).filter(Boolean).map((x) => {
  const r = /^(\w+) ([\d.]+) to ([\d.]+) (\S+)(?: target ([<>] [\d.]+))?$/.exec(x)!;
  return m(r[1], Number(r[2]), Number(r[3]), r[4], r[5]);
});

let perf: PerfLike, sprint: SprintLike | null = null, note: Note, driver: Driver | null = null;
Given(/^a team meeting (\d+) of (\d+) targets, (\d+)% \(up from (\d+)%\), missing (.+)$/, function (met: string, of: string, pct: string, prev: string, missing: string) {
  const ids = missing === 'nothing' ? [] : missing.replace(/ \(.*\)$/, '').split(/ and |, /);
  const twice = [...missing.matchAll(/\((\w+) two periods running\)/g)].map((x) => x[1]);
  perf = { from: '2026-08-28', to: '2026-09-27', summary: '', score: { met: +met, of: +of, pct: +pct, previousPct: +prev, trend: 'better' },
    missed: ids.map((id) => ({ id, title: TITLES[id] ?? id, missedTwice: twice.includes(id) })), areas: [{ headlines: [] }] };
  sprint = null;
});
Given('these headline results with their previous period:', function (t: DataTable) {
  perf.areas = [{ headlines: t.hashes().map((r) => ({ measure: m(r.measure, Number(r.previous), Number(r.value), r.unit, r.target), drill: drills(r.drill) })) }];
});
Given(/^a sprint "([^"]+)" in progress: (\d+) of (\d+) points done, (\d+) working days? elapsed, (\d+) left, projected (\d+), (\d+) blocked and (\d+) ageing$/,
  function (name: string, done: string, scope: string, elapsed: string, left: string, projected: string, blocked: string, ageing: string) {
    const outlook = +projected >= +scope ? 'On track' : +projected >= 0.8 * +scope ? 'At risk' : 'Off track';
    sprint = { sprint: name, state: 'active', outlook, points: { done: +done, scope: +scope, projected: +projected }, workingDaysElapsed: +elapsed, workingDaysLeft: +left, blocked: Array(+blocked).fill(0), ageing: Array(+ageing).fill(0) };
  });
When(/^the note is composed( with no sprint in progress)?$/, async function (_none: string | undefined) { const { composeNote } = await import('../../src/note.js'); note = composeNote('ABC', perf, sprint); });
Then('the note says {string}', function (line: string) { assert.ok(note.lines.includes(line), `not found:\n${line}\nin:\n${note.lines.join('\n')}`); });
Then('the note has no {string} line', function (prefix: string) { assert.ok(!note.lines.some((l) => l.includes(prefix))); });

Given(/^a headline that got worse from (\d+) to (\d+) hours with drill-down (\w+) (\d+) to (\d+) (\S+)(?:, no target| target ([<>] \d+))$/,
  async function (a: string, b: string, id: string, da: string, db: string, unit: string, target?: string) {
    const { driverFor } = await import('../../src/note.js');
    driver = driverFor(m('time_to_restore', +a, +b, 'hours', '< 24'), [m(id, +da, +db, unit, target)]);
  });
Then('it has no driver', function () { assert.equal(driver, null); });
Then('the driver is {string}', function (text: string) { assert.equal(driver?.text, text); });

Then('the note has a score line, a what-changed line and a likely-next line', function (this: HoustonWorld) {
  const n = JSON.parse(this.res!.body) as Note;
  assert.match(n.lines[0], /^\*\*\d+% of targets met\*\* \(\d+ of \d+\)/);
  assert.ok(n.lines.some((l) => l.startsWith('**What changed.**')) && n.lines.some((l) => l.startsWith('**Likely next.**')), n.lines.join('\n'));
});
