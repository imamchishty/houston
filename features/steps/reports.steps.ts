import assert from 'node:assert/strict';
import { Given, When, Then, After, type DataTable } from '@cucumber/cucumber';
import type { Slice, Measure } from '../../src/reports.js';
import type { PullRequest, WorkItem, Epic, MainCommit } from '../../src/types.js';

// A hand-built slice: exactly the rows in the scenario, nothing from the demo data.
let s: Slice, measures: Measure[] = [], groups: any[] = [];
const iso = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00Z` : `${d}:00Z`).toISOString(); // dates at midday, times as UTC
const yes = (v: string | undefined) => /^(yes|true|y)$/i.test(v ?? '');
const blank = (v: string | undefined) => !v || !v.trim();

After(function () { delete process.env.CFR_SOURCE; });

Given('a reporting period from {word} to {word}', function (from: string, to: string) {
  s = { from: Date.parse(`${from}T00:00:00Z`), to: Date.parse(`${to}T00:00:00Z`), boards: ['ABC'], prs: [], deploys: [], mainCommits: [], items: [], epics: [], sprints: [], incidents: [], quality: [], security: { alerts: [], coverage: {} }, support: [], supportConnected: true, ci: [], ops: [], projectKeys: [], defaultBranches: {} };
  measures = [];
});
Given("the team's Jira project is {string} and repos merge into {string}", function (key: string, branch: string) {
  s.projectKeys = [key]; s.defaultBranches = { 'org/repo': branch };
});
Given('change failure rate counts significant bugs', function () { process.env.CFR_SOURCE = 'bugs'; });
Given('change failure rate is linked to deployments', function () { process.env.CFR_SOURCE = 'linked'; });

Given('these pull requests:', function (t: DataTable) {
  s.prs = t.hashes().map((r): PullRequest => ({
    repo: 'org/repo', number: Number(r.pr), title: yes(r.revert) ? 'Revert "x"' : `change ${r.pr}`, author: r.author || 'a',
    createdAt: iso(r.opened), firstReviewAt: blank(r['first review']) ? (Number(r.reviews ?? 0) > 0 ? iso(r.opened) : null) : iso(r['first review']),
    approvedAt: null, mergedAt: blank(r.merged) ? null : iso(r.merged), closedAt: null, additions: 10, deletions: 5, changedFiles: 1,
    reviewers: Number(r.reviews ?? 0) > 0 ? ['b'] : [], reviewCount: Number(r.reviews ?? 0),
    jiraKeys: blank(r.tickets) ? [] : r.tickets.split(',').map((x) => x.trim()), areas: blank(r.areas) ? [] : r.areas.split('+').map((x) => x.trim()),
    isHotfix: yes(r.hotfix), draft: yes(r.draft), branch: `b${r.pr}`, baseBranch: r.base || 'main',
    reviewComments: Number(r.comments ?? 0), isRevert: yes(r.revert), firstCommitAt: blank(r['first commit']) ? null : iso(r['first commit']),
  }));
});
Given('these deploys:', function (t: DataTable) {
  s.deploys = t.hashes().map((r) => ({ repo: 'org/repo', at: iso(r.at), ref: 'x', success: yes(r.success) }));
});
Given('these work items:', function (t: DataTable) {
  s.items = t.hashes().map((r): WorkItem => ({
    key: r.key, type: r.type, status: blank(r.resolved) ? 'To Do' : 'Done', statusCategory: blank(r.resolved) ? 'todo' : 'done',
    priority: r.priority || null, reporter: null, assignee: null, created: iso(r.created), resolved: blank(r.resolved) ? null : iso(r.resolved),
    points: blank(r.points) ? null : Number(r.points), epic: r.epic || null, inSprint: yes(r.sprint), labels: blank(r.labels) ? [] : [r.labels],
  }));
});
Given('these commits on main:', function (t: DataTable) {
  s.mainCommits = t.hashes().map((r): MainCommit => ({ repo: 'org/repo', sha: r.sha, at: iso(r.at), merge: yes(r.merge), viaPr: yes(r['via pr']) }));
});
Given('these epics:', function (t: DataTable) {
  s.epics = t.hashes().map((r): Epic => ({ key: r.key, summary: r.key, status: blank(r.closed) ? 'In Progress' : 'Done', statusCategory: blank(r.closed) ? 'inprogress' : 'done',
    created: '2026-06-01T00:00:00Z', started: null, resolved: blank(r.closed) ? null : iso(r.closed), childCount: 0, childDone: 0, due: r.due || null }));
});
Given('these incidents:', function (t: DataTable) {
  s.incidents = t.hashes().map((r) => ({ firedAt: iso(r.fired), resolvedAt: blank(r.resolved) ? null : iso(r.resolved) }));
});

Given('a closed sprint from {word} to {word} with these finished tickets:', function (from: string, to: string, t: DataTable) {
  const start = `${from}T00:00:00.000Z`, end = `${to}T00:00:00.000Z`;
  s.sprints = [{ id: 7, name: 'ABC Sprint 7', board: 'ABC', goal: 'g', start, end, state: 'closed', issues: t.hashes().map((r) => ({
    key: r.key, summary: r.key, type: 'Story', status: 'Done', statusCategory: 'done' as const, points: r.points ? Number(r.points) : null, assignee: null,
    hasAcceptanceCriteria: true, created: `${r.created}T09:00:00.000Z`, resolved: `${r.resolved}T12:00:00.000Z`, addedToSprintAt: null, sprintIds: [7], inProgressSince: null })) }];
});
Given('these labelled bugs:', function (t: DataTable) {
  s.items = t.hashes().map((r) => ({ key: r.key, type: 'Bug', status: 'To Do', statusCategory: 'todo' as const, priority: 'Medium', reporter: null, assignee: null,
    created: iso(r.created), resolved: null, points: null, epic: null, inSprint: false, labels: r.labels ? [r.labels] : [] }));
});
Then(/^(\w+) notes "([^"]+)"$/, function (id: string, note: string) { assert.equal(m(id).note, note); });

// Sprint tickets built from status histories: category from the status name, start = first in-progress status,
// resolved = when it reached Done.
Given('these ticket histories:', function (t: DataTable) {
  const cat = (st: string) => (/^done$/i.test(st) ? 'done' : /^to do$/i.test(st) ? 'new' : 'indeterminate');
  const byKey = new Map<string, { at: string; to: string; category: string }[]>();
  for (const r of t.hashes()) byKey.set(r.key, [...(byKey.get(r.key) ?? []), { at: iso(r.at), to: r.status, category: cat(r.status) }]);
  const issues = [...byKey.entries()].map(([key, h]) => {
    const done = h.find((x) => x.category === 'done');
    return { key, summary: key, type: 'Story', status: h[h.length - 1].to, statusCategory: (done ? 'done' : 'inprogress') as 'done' | 'inprogress', points: 1, assignee: null,
      hasAcceptanceCriteria: true, created: h[0].at, resolved: done?.at ?? null, addedToSprintAt: null, sprintIds: [1],
      inProgressSince: h.find((x) => x.category === 'indeterminate')?.at ?? null, statusHistory: h };
  });
  s.sprints = [{ id: 1, name: 'ABC Sprint 1', board: 'ABC', goal: 'g', start: '2026-09-01T00:00:00.000Z', end: '2026-09-30T00:00:00.000Z', state: 'closed', issues }];
});

When('the reports are calculated', async function () {
  const { REPORTS, hygiene } = await import('../../src/reports.js');
  groups = [...Object.values(REPORTS), hygiene].flatMap((fn) => fn(s).groups);
  measures = groups.flatMap((g: { measures: Measure[] }) => g.measures);
});

const m = (id: string) => { const x = measures.find((y) => y.id === id); assert.ok(x, `no measure ${id}`); return x!; };
Then(/^(\w+) is (\d+) of (\d+), ([\d.]+)%$/, function (id: string, num: string, den: string, pct: string) {
  const x = m(id);
  assert.deepEqual({ num: x.num, den: x.den, value: x.value }, { num: Number(num), den: Number(den), value: Number(pct) }, id);
});
Then(/^(\w+) is ([\d.]+) (days|hours) from (\d+) items$/, function (id: string, v: string, unit: string, n: string) {
  const x = m(id);
  assert.deepEqual({ value: x.value, unit: x.unit, den: x.den }, { value: Number(v), unit, den: Number(n) }, id);
});
Then(/^(\w+) is not measured$/, function (id: string) { assert.equal(m(id).value, null, `${id} should be null, not ${m(id).value}`); });
Then(/^(\w+) lists (.+)$/, function (id: string, list: string) { assert.deepEqual(m(id).failing, list.split(',').map((x) => x.trim())); });
Then(/^(\w+) (meets|misses) its target of (under|over) ([\d.]+)$/, function (id: string, verdict: string, dir: string, v: string) {
  const x = m(id);
  assert.deepEqual(x.target, { op: dir === 'under' ? '<' : '>', value: Number(v) });
  assert.equal(x.met, verdict === 'meets');
});

Then(/^the time in "([^"]+)" is (\d+) hours, "([^"]+)" (\d+), "([^"]+)" (\d+) and "([^"]+)" (\d+)$/, function (s1: string, h1: string, s2: string, h2: string, s3: string, h3: string, s4: string, h4: string) {
  const a = [s1, h1, s2, h2, s3, h3, s4, h4];
  const heat = groups.find((g) => g.heatmap)?.heatmap as { status: string; hours: number }[];
  for (let k = 0; k < a.length; k += 2) assert.equal(heat.find((h) => h.status === a[k])?.hours, Number(a[k + 1]), a[k]);
});
Then('the flow distribution is {int} features, {int} defects, {int} risks and {int} debt', function (f: number, d: number, r: number, debt: number) {
  const dist = groups.find((g) => g.distribution)?.distribution as { kind: string; items: number }[];
  assert.deepEqual(Object.fromEntries(dist.map((x) => [x.kind, x.items])), { Features: f, Defects: d, Risks: r, Debt: debt });
});
Then(/^flow_velocity is ([\d.]+) items a week from (\d+) done$/, function (v: string, n: string) {
  const x = m('flow_velocity'); assert.deepEqual({ value: x.value, num: x.num }, { value: Number(v), num: Number(n) });
});

// Security alerts: opened and closed as dates, state open / fixed / dismissed.
Given('these security alerts:', function (t: DataTable) {
  s.security.alerts = t.hashes().map((r, k) => ({ repo: `org/${r.repo || 'repo'}`, kind: (r.kind || 'dependency') as 'dependency', number: k + 1, severity: r.severity as 'high',
    title: r.title, state: r.state as 'open', createdAt: iso(r.opened), closedAt: blank(r.closed) ? null : iso(r.closed) }));
});
Given('scanning is turned on like this:', function (t: DataTable) {
  const v = (x: string) => (x === 'on' ? true : x === 'off' ? false : null);
  s.security.coverage = Object.fromEntries(t.hashes().map((r) => [`org/${r.repo}`, { dependency: v(r.dependency), secret: v(r.secret), code: v(r.code) }]));
});
Then(/^(\w+) counts (\d+)$/, function (id: string, n: string) { assert.equal(m(id).value, Number(n), id); });
Then(/^(\w+) shows these, one per line:$/, function (id: string, t: DataTable) { assert.deepEqual(m(id).failing, t.raw().map((r) => r[0].trim())); });

// Support: times as "YYYY-MM-DD HH:MM" in UTC; lists comma separated.
const at = (v: string) => new Date(`${v.trim().replace(' ', 'T')}:00Z`).toISOString();
const saved: { wh?: typeof import('../../src/config.js').config.workingHours; tz?: number; weekend?: number[]; sla?: Record<string, { response: string; resolution: string }> } = {};
After(async function () {
  const { config } = await import('../../src/config.js');
  if (saved.wh) { config.workingHours = saved.wh; config.tzOffset = saved.tz!; config.weekend = saved.weekend!; }
  if (saved.sla) config.jira.supportSla = saved.sla;
  delete saved.wh; delete saved.sla;
});
Given(/^the working day is (\d\d):(\d\d) to (\d\d):(\d\d) UTC with Saturday and Sunday off$/, async function (h1: string, m1: string, h2: string, m2: string) {
  const { config } = await import('../../src/config.js');
  saved.wh ??= config.workingHours; saved.tz ??= config.tzOffset; saved.weekend ??= config.weekend;
  config.workingHours = { start: +h1 + +m1 / 60, end: +h2 + +m2 / 60 }; config.tzOffset = 0; config.weekend = [6, 0];
});
Given('support SLAs are {string}', async function (v: string) {
  const { config } = await import('../../src/config.js');
  saved.sla ??= config.jira.supportSla;
  config.jira.supportSla = Object.fromEntries(v.split(',').map((x) => { const [p, d] = x.split('='); const [a, b] = d.split('/'); return [p.trim().toLowerCase(), { response: a, resolution: b }]; }));
});
Given('these support tickets:', function (t: DataTable) {
  s.support = t.hashes().map((r) => ({ key: r.key, priority: r.priority || null, created: at(r.created),
    firstResponse: blank(r['first response']) ? null : at(r['first response']), resolved: blank(r.resolved) ? null : at(r.resolved),
    reopened: yes(r.reopened), duplicate: yes(r.duplicate), changes: blank(r['status changes']) ? [] : r['status changes'].split(',').map(at) }));
});

// Definition of Ready and Done: sprint tickets built by hand. estimated blank = at creation; path = the statuses the
// ticket went through, from when it started, an hour apart.
const defsSaved: { lanes?: unknown; done?: string[] } = {};
After(async function () {
  const { config } = await import('../../src/config.js');
  if (defsSaved.lanes) { config.github.lanes = defsSaved.lanes as typeof config.github.lanes; delete defsSaved.lanes; }
  if (defsSaved.done) { config.definitions.done = defsSaved.done; delete defsSaved.done; }
});
Given("the team's repos have a tests lane", async function () {
  const { config } = await import('../../src/config.js');
  defsSaved.lanes ??= config.github.lanes; config.github.lanes = [{ area: 'backend', patterns: ['api/'] }, { area: 'tests', patterns: ['test/'] }];
});
Given('the Definition of Done also needs a release', async function () {
  const { config } = await import('../../src/config.js');
  defsSaved.done ??= config.definitions.done; config.definitions.done = [...config.definitions.done, 'released'];
});
Given('these sprint tickets:', function (t: DataTable) {
  const issues = t.hashes().map((r) => {
    const started = blank(r.started) ? null : `${r.started}T09:00:00.000Z`, resolved = blank(r.resolved) ? null : `${r.resolved}T12:00:00.000Z`;
    const path = blank(r.path) ? [] : r.path.split('>').map((x) => x.trim());
    const statusHistory = started ? path.map((to, k) => ({ at: new Date(Date.parse(started) + k * 3_600_000).toISOString(), to, category: to === 'Done' ? 'done' : to === 'To Do' ? 'new' : 'indeterminate' })) : [];
    return { key: r.key, summary: r.key, type: r.type, status: resolved ? 'Done' : started ? 'In Progress' : 'To Do', statusCategory: (resolved ? 'done' : started ? 'inprogress' : 'todo') as 'done',
      points: blank(r.points) ? null : Number(r.points), assignee: null, hasAcceptanceCriteria: yes(r.ac), created: '2026-08-20T09:00:00.000Z', resolved, addedToSprintAt: null, sprintIds: [1],
      inProgressSince: started, epic: r.epic || null, estimatedAt: blank(r.estimated) ? null : `${r.estimated}T09:00:00.000Z`, ...(statusHistory.length ? { statusHistory } : {}) };
  });
  s.sprints = [{ id: 1, name: 'ABC Sprint 1', board: 'ABC', goal: 'g', start: '2026-09-01T00:00:00.000Z', end: '2026-09-30T00:00:00.000Z', state: 'closed', issues }];
});
Then('the tickets are ready or not:', async function (t: DataTable) {
  const { readiness } = await import('../../src/definitions.js');
  assert.deepEqual(s.sprints[0].issues.map((i) => { const v = readiness(i); return [i.key, v.ok ? 'ready' : v.missing.join(', ')]; }), t.raw().map((r) => r.map((x) => x.trim())));
});
Then('the done tickets are done properly or not:', async function (t: DataTable) {
  const { doneness, doneContext } = await import('../../src/definitions.js');
  const ctx = doneContext(s.sprints[0].issues, s.prs, s.deploys);
  assert.deepEqual(s.sprints[0].issues.map((i) => { const v = doneness(i, ctx); return [i.key, !v ? 'not judged' : v.ok ? 'done' : v.missing.join(', ')]; }), t.raw().map((r) => r.map((x) => x.trim())));
});
