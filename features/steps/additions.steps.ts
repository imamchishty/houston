import assert from 'node:assert/strict';
import { Given, When, Then, type DataTable } from '@cucumber/cucumber';
import { HoustonWorld } from '../support/world.js';

Then('from {word} to {word} with offset {int} hours is {int} hours excluding weekends', async function (from: string, to: string, tz: number, hours: number) {
  const { hoursExcludingWeekends } = await import('../../src/time.js');
  assert.equal(Math.round(hoursExcludingWeekends(`${from}:00Z`, `${to}:00Z`, [6, 0], tz) * 100) / 100, hours);
});

Then('{int} of {int} people has more than {int} tickets in progress, at most {int}', function (over: number, people: number, limit: number, max: number) {
  // the sprint board from the sprint-board steps is read into the shared "board" there; read it back via the API shape
  const b = (globalThis as any).__houstonBoard;
  assert.deepEqual({ over: b.wip.overLimit, people: b.wip.people, limit: b.wip.limit, max: b.wip.max }, { over, people, limit, max });
});

Then('every headline measure has a plain name', async function () {
  const { HEADLINES, PLAIN } = await import('../../src/performance.js');
  assert.deepEqual(HEADLINES.filter((id) => !PLAIN[id]), [], 'no plain name');
});
Then("every team's summary line uses no jargon", function (this: HoustonWorld) {
  const words = /\b(DORA|PR|PRs|CFR|WIP|epic|epics|merge|merged|deploy|deploys|story points|velocity|burndown|median|p95|KQL|Jira|GitHub|sprint goal|SLA breach)\b/;
  const d = JSON.parse(this.res!.body);
  for (const t of [...d.teams, ...(d.all ? [d.all] : [])]) { assert.ok(t.summary.length > 10); assert.ok(!words.test(t.summary), `jargon in: ${t.summary}`); }
});

When("the user requests the board for OSSI's first sprint", async function (this: HoustonWorld) {
  const { store } = await import('../../src/store/index.js');
  const first = store.sprints().filter((s) => s.board === 'OSSI').sort((a, b) => a.start.localeCompare(b.start))[0];
  (this as any).sprintEnd = first.end;
  await this.request('GET', `/api/sprints/current?team=OSSI&sprint=${first.id}`, this.signedIn());
});
Then('no item on it was finished after the sprint ended', async function (this: HoustonWorld) {
  const b = JSON.parse(this.res!.body);
  const { store } = await import('../../src/store/index.js');
  const sp = store.sprints().find((x) => x.id === b.id)!;
  const end = Date.parse(sp.end);
  // Expected from the raw tickets: points of work items resolved by the sprint's end, nothing later.
  const expected = sp.issues.filter((i) => i.type !== 'Sub-task' && i.statusCategory === 'done' && i.resolved && Date.parse(i.resolved) <= end).reduce((t, i) => t + (i.points ?? 0), 0);
  const later = sp.issues.filter((i) => i.type !== 'Sub-task' && i.statusCategory === 'done' && i.resolved && Date.parse(i.resolved) > end).length;
  assert.equal(b.state, 'closed'); assert.equal(b.workingDaysLeft, 0);
  assert.equal(b.points.done, expected, `done ${b.points.done} vs ${expected} (${later} tickets finished after the end)`);
});
