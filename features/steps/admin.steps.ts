import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Given, When, Then, After, type DataTable } from '@cucumber/cucumber';
import { HoustonWorld, houston } from '../support/world.js';

const H = { 'X-Requested-With': 'houston', 'content-type': 'application/json' };
const admin = (w: HoustonWorld) => ({ user: w.auth.admin?.user ?? 'admin', pass: w.auth.admin?.pass ?? '' });
const body = (w: HoustonWorld) => JSON.parse(w.res!.body);

// Everything a scenario changes is put back: connection settings, fetch, mode, saved teams, the report path.
const real = { fetch: globalThis.fetch };
let saved: Record<string, unknown> | null = null;
After(async function () {
  const c = houston.config;
  globalThis.fetch = real.fetch;
  if (saved) { Object.assign(c.jira, saved.jira); Object.assign(c.github, saved.github); Object.assign(c.sonar, saved.sonar); Object.assign(c.testmo, saved.testmo); Object.assign(c.azure, saved.azure); c.mode = saved.mode as string; saved = null; }
  delete process.env.HOUSTON_TEST_REPORT;
  if (existsSync(join(c.dataDir, 'settings.json'))) (await import('../../src/admin/settings.js')).resetSettings();
  const f = join(c.dataDir, 'team-setup.json');
  if (existsSync(f)) { rmSync(f); (await import('../../src/admin/teamSetup.js')).applySavedTeams(); }
});
const keep = () => {
  const c = houston.config;
  saved ??= { jira: { ...c.jira }, github: { ...c.github }, sonar: { ...c.sonar }, testmo: { ...c.testmo }, azure: { ...c.azure }, mode: c.mode };
};

Given('the admin account is {string} with password {string}', function (this: HoustonWorld, user: string, pass: string) {
  this.auth = { ...this.auth, admin: { user, pass } }; this.app = undefined;
});
Given('there is no admin account', function (this: HoustonWorld) { this.auth = { ...this.auth, admin: undefined }; this.app = undefined; });
Given('Houston runs in live mode', function () { keep(); houston.config.mode = 'live'; });
Given('an API token {string} is set up', function (this: HoustonWorld, name: string) {
  this.auth = { ...this.auth, tokens: [{ name, token: 'a'.repeat(40) }] }; this.app = undefined;
});
When('the {string} token requests {string}', async function (this: HoustonWorld, _name: string, url: string) {
  await this.request('GET', url, { headers: { authorization: `Bearer ${'a'.repeat(40)}` } });
});
When('the admin requests {string}', async function (this: HoustonWorld, url: string) { await this.request('GET', url, admin(this)); });
When('someone tries the admin password wrong {int} times', async function (this: HoustonWorld, n: number) {
  for (let i = 0; i < n; i++) await this.request('GET', '/api/admin/status', { user: admin(this).user, pass: 'wrong' });
});
Then('the admin is signed in as {string}', function (this: HoustonWorld, u: string) { assert.equal(body(this).user, u); });
Then('the error says {string}', function (this: HoustonWorld, s: string) { assert.ok(body(this).error.includes(s), body(this).error); });
Then('the admin page warns that the password is weak', function (this: HoustonWorld) { assert.equal(body(this).weakPassword, true); });

// A fake upstream for the connection checks. Known token values, so the test can prove none comes back.
const TOKENS = { jira: 'JIRA-SECRET-TOKEN-1234567890', github: 'ghp_SECRETSECRETSECRET1234567890', sonar: 'squ_SECRET0987654321', testmo: 'TESTMO-SECRET-5555' };
const routes: { match: string; status?: number; json: unknown; headers?: Record<string, string> }[] = [];
function fake() {
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input), r = routes.find((x) => url.includes(x.match));
    if (!r) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { 'content-type': 'application/json', ...(r.headers ?? {}) } });
  }) as typeof fetch;
}
function connect() {
  keep(); routes.length = 0;
  const c = houston.config;
  Object.assign(c.jira, { baseUrl: 'https://jira.test', email: 'bot@m42.test', token: TOKENS.jira });
  Object.assign(c.github, { api: 'https://ghe.test/api/v3', token: TOKENS.github });
  Object.assign(c.sonar, { url: 'https://sonar.test', token: TOKENS.sonar });
  Object.assign(c.testmo, { url: 'https://testmo.test', token: TOKENS.testmo });
  Object.assign(c.azure, { tenant: '', client: '', secret: '' });
  fake();
}
Given('Jira, GitHub, SonarQube and Testmo are connected with known tokens', function () {
  connect();
  routes.push({ match: 'jira.test/rest/api/2/myself', json: { displayName: 'Houston Bot' } }, { match: 'jira.test/wiki/rest/api/space', json: { results: [] } },
    { match: 'sonar.test/api/authentication/validate', json: { valid: true } }, { match: 'testmo.test/api/v1/projects', json: {} });
});
Given("GitHub's token has the scopes {string} and expires on {word}", function (scopes: string, day: string) {
  routes.unshift({ match: 'ghe.test/api/v3/user', json: { login: 'houston-bot' }, headers: { 'x-oauth-scopes': scopes, 'github-authentication-token-expiration': `${day} 00:00:00 UTC` } });
});
Given('Testmo rejects its token', function () { routes.unshift({ match: 'testmo.test/api/v1/projects', status: 401, json: { message: `bad token ${TOKENS.testmo}` } }); });
// As the admin page sends it: no body, so no JSON content type.
When('the admin checks the connections', async function (this: HoustonWorld) { await this.request('POST', '/api/admin/connections/check', { ...admin(this), headers: { 'X-Requested-With': 'houston' } }); });
Then('no token value appears in the response', function (this: HoustonWorld) {
  for (const [k, v] of Object.entries(TOKENS)) assert.ok(!this.res!.body.includes(v), `${k} token leaked`);
});
const check = (w: HoustonWorld, source: string) => { const c = (body(w).checks as any[]).find((x) => x.source === source); assert.ok(c, `no check for ${source}`); return c; };
Then('{string} works, signed in as {string}', function (this: HoustonWorld, s: string, who: string) { const c = check(this, s); assert.equal(c.ok, true); assert.ok(c.detail.includes(who), c.detail); });
Then('{string} is missing {string}', function (this: HoustonWorld, s: string, list: string) { assert.deepEqual(check(this, s).missing, list.split(',').map((x) => x.trim())); });
Then('{string} expires on {word}', function (this: HoustonWorld, s: string, day: string) { assert.equal(check(this, s).expires?.slice(0, 10), day); });
Then('{string} is failing with {string}', function (this: HoustonWorld, s: string, msg: string) { const c = check(this, s); assert.equal(c.ok, false); assert.equal(c.detail, msg); });
Then('{string} is not set', function (this: HoustonWorld, s: string) { const c = check(this, s); assert.equal(c.configured, false); assert.equal(c.ok, null); });

// Team setup
const teamRow = (t: DataTable) => t.hashes()[0];
When('the admin saves a team:', async function (this: HoustonWorld, t: DataTable) {
  await this.request('POST', '/api/admin/teams', { ...admin(this), headers: H, body: JSON.stringify(teamRow(t)) });
});
When('the admin tests a team:', async function (this: HoustonWorld, t: DataTable) {
  await this.request('POST', '/api/admin/teams/test', { ...admin(this), headers: H, body: JSON.stringify(teamRow(t)) });
});
When('the admin removes the team {string}', async function (this: HoustonWorld, name: string) {
  await this.request('DELETE', `/api/admin/teams/${encodeURIComponent(name)}`, { ...admin(this), headers: { 'X-Requested-With': 'houston' } });
});
Then('the problems include {string}', function (this: HoustonWorld, p: string) { assert.ok(body(this).problems.includes(p), JSON.stringify(body(this).problems)); });
Then('Houston now collects {string} and {string} for {string}', function (a: string, b: string, team: string) {
  assert.deepEqual(houston.config.github.repos.find((r) => r.name === team)?.repos, [a, b]);
  assert.equal(houston.config.jira.boards.find((x) => x.name === team)?.id, 42);
});
Then('Houston now collects {string} for {string}', function (a: string, team: string) {
  assert.deepEqual(houston.config.github.repos.find((r) => r.name === team)?.repos, [a]);
  assert.equal(houston.config.jira.boards.find((x) => x.name === team)?.id, 43);
});
Then('Houston no longer collects anything for {string}', function (team: string) {
  const c = houston.config;
  assert.ok(!c.jira.boards.some((x) => x.name === team) && !c.github.repos.some((x) => x.name === team) && !(team in c.jira.projects));
});
Then('the team list shows {string} set up in the admin page', async function (this: HoustonWorld, team: string) {
  const res = this.res; await this.request('GET', '/api/admin/teams', admin(this));
  assert.equal((body(this) as any[]).find((x) => x.name === team)?.source, 'admin'); this.res = res;
});
Then('the change log shows {string}, {string} and {string} for {string} by {string}', async function (this: HoustonWorld, a: string, b: string, c: string, team: string, by: string) {
  await this.request('GET', '/api/admin/log', admin(this));
  const rows = (body(this) as any[]).filter((r) => r.detail?.name === team).slice(0, 3);
  assert.deepEqual(rows.map((r) => r.action), [a, b, c]);
  assert.ok(rows.every((r) => r.user === by));
});
Given("Jira's board {int} is {string} with the project {string}", function (id: number, name: string, key: string) {
  connect();
  routes.push({ match: `jira.test/rest/agile/1.0/board/${id}/project`, json: { values: [{ key }] } },
    { match: `jira.test/rest/agile/1.0/board/${id}/sprint`, json: { values: [] } }, { match: `jira.test/rest/agile/1.0/board/${id}`, json: { name, type: 'scrum' } });
});
Then('the check {string} failed with {string}', function (this: HoustonWorld, s: string, msg: string) { const c = check(this, s); assert.equal(c.ok, false); assert.equal(c.detail, msg); });

// Test report
Given('a test report from commit {string} with {int} of {int} scenarios passing', function (commit: string, passed: number, total: number) {
  const f = join(mkdtempSync(join(tmpdir(), 'houston-report-')), 'test-report.json');
  const scen = (k: number) => ({ name: `S${k}`, status: k < passed ? 'passed' : 'failed', ms: 1, steps: ['Given x'] });
  writeFileSync(f, JSON.stringify({ generatedAt: '2026-09-27T10:00:00Z', build: { version: '0.1.0', build: '7', commit, builtAt: '2026-09-27T10:00:00Z', local: false, dirty: false },
    bdd: { passed, failed: total - passed, skipped: 0, scenarios: total, features: 1, ms: 5, ok: passed === total }, unit: { ok: true, ms: 1, output: '' },
    audit: { ok: true, vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0 } }, featureList: [{ name: 'F', file: 'features/f.feature', description: '', scenarios: Array.from({ length: total }, (_, k) => scen(k)) }] }));
  process.env.HOUSTON_TEST_REPORT = f;
});
Given('there is no test report', function () { process.env.HOUSTON_TEST_REPORT = join(tmpdir(), 'houston-no-such-report.json'); });
Then('the test report shows {int} of {int} scenarios passed', function (this: HoustonWorld, p: number, n: number) { const b = body(this); assert.equal(b.available, true); assert.deepEqual([b.bdd.passed, b.bdd.scenarios], [p, n]); });
Then('it is marked as a different build', function (this: HoustonWorld) { assert.equal(body(this).sameBuild, false); });
Then('it says there is no test report', function (this: HoustonWorld) { assert.equal(body(this).available, false); assert.match(body(this).message, /npm run report/); });

// SLAs and working week
When('the admin saves SLAs {string} with a working day of {word} to {word}', async function (this: HoustonWorld, sla: string, start: string, end: string) {
  const supportSla = sla.split(',').map((x) => { const [priority, d] = x.split('='); const [response, resolution] = d.split('/'); return { priority, response, resolution }; });
  await this.request('POST', '/api/admin/settings', { ...admin(this), headers: H, body: JSON.stringify({ supportSla, workingHours: `${start}-${end}`, tzOffset: 4, weekend: ['sat', 'sun'], supportTypes: ['Support'], supportLabels: ['support'] }) });
});
When('the admin resets the settings', async function (this: HoustonWorld) {
  await this.request('DELETE', '/api/admin/settings', { ...admin(this), headers: { 'X-Requested-With': 'houston' } });
});
Then('support tickets are now judged against {string} {word} to respond and {word} to resolve', function (p: string, r: string, s: string) {
  assert.deepEqual(houston.config.jira.supportSla[p], { response: r, resolution: s });
});
Then('support tickets are not judged against {string}', function (p: string) { assert.equal(houston.config.jira.supportSla[p], undefined); });
Then('the working day is {word} to {word}', function (a: string, b: string) {
  const h = (x: string) => { const [hh, mm] = x.split(':').map(Number); return hh + mm / 60; };
  assert.deepEqual(houston.config.workingHours, { start: h(a), end: h(b) });
});
Then('the change log shows {string} by {string}', async function (this: HoustonWorld, action: string, by: string) {
  await this.request('GET', '/api/admin/log', admin(this));
  const row = (body(this) as any[]).find((r) => r.action === action);
  assert.ok(row && row.user === by, JSON.stringify(body(this)).slice(0, 300));
});
