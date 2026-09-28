// Fast unit checks of the rules everything else rests on: working time and the score. The BDD suite covers the rest.
import assert from 'node:assert/strict';
import { workingMinutes, addWorkingMinutes, durationMinutes, workingDays } from './time.js';
import { score, HEADLINES, DRILL } from './performance.js';
import type { Measure } from './reports.js';

const hours = { start: 8, end: 18 }, weekend = [6, 0];
// Friday 16:00 to Monday 10:00 (UTC, Sat/Sun weekend): 2 working hours Friday + 2 Monday.
assert.equal(workingMinutes('2026-06-05T16:00:00Z', '2026-06-08T10:00:00Z', weekend, 0, hours), 240);
assert.equal(addWorkingMinutes('2026-06-05T16:00:00Z', 240, weekend, 0, hours), '2026-06-08T10:00:00.000Z');
assert.equal(durationMinutes('2d', hours), 1200);
assert.equal(workingDays('2026-06-01T00:00:00Z', '2026-06-15T00:00:00Z', weekend), 10);

const m = (id: string, met: boolean | null, smallSample = false) => ({ id, met, smallSample } as Measure);
assert.deepEqual(score(new Map([m('lead_time', true), m('sprint_completion', false), m('defect_leakage', true, true), m('pickup_time', false)].map((x) => [x.id, x]))), { met: 1, of: 2, pct: 50 });
assert.equal(HEADLINES.length, 10);
assert.ok(HEADLINES.every((h) => Array.isArray(DRILL[h])));
console.log('core ok');
