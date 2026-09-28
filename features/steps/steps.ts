import assert from 'node:assert/strict';
import { Given, When, Then } from '@cucumber/cucumber';
import { HoustonWorld, houston } from '../support/world.js';

const HOUSTON_HEADER = { 'X-Requested-With': 'houston', 'content-type': 'application/json' };
const mentioned = (text: string) => houston.names.filter((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text));

// Setup
Given('Houston is running with user {string} and password {string}', function (this: HoustonWorld, user: string, pass: string) {
  this.auth = { ...this.auth, user, pass }; this.app = undefined;
});
Given('the people viewers are {string}', function (this: HoustonWorld, list: string) {
  this.auth = { ...this.auth, viewers: list.split(',').map((x) => x.trim()) }; this.app = undefined;
});
Given('a Teams webhook is listening', async function (this: HoustonWorld) {
  await this.listen(); houston.config.teamsWebhook = this.webhook!.url;
});
Given('no Teams webhook is configured', function () { houston.config.teamsWebhook = ''; });
Given("Houston's public address is {string}", function (url: string) { houston.config.publicUrl = url; });

// Requests
When('an anonymous visitor requests {string}', async function (this: HoustonWorld, url: string) { await this.request('GET', url); });
When('the user requests {string}', async function (this: HoustonWorld, url: string) { await this.request('GET', url, this.signedIn()); });
When('someone tries {int} wrong passwords', async function (this: HoustonWorld, n: number) {
  for (let i = 0; i < n; i++) await this.request('GET', '/api/teams', { user: this.auth.user, pass: 'wrong' });
});
When('the user posts to {string}', async function (this: HoustonWorld, url: string) {
  await this.request('POST', url, { ...this.signedIn(), headers: HOUSTON_HEADER, body: '{}' });
});
When('the user posts to {string} without the Houston header', async function (this: HoustonWorld, url: string) {
  await this.request('POST', url, { ...this.signedIn(), headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
});
When('the user posts a {int} character body to {string}', async function (this: HoustonWorld, n: number, url: string) {
  await this.request('POST', url, { ...this.signedIn(), headers: HOUSTON_HEADER, body: JSON.stringify({ note: 'a'.repeat(n) }) });
});
When('the Friday digest is sent', async function (this: HoustonWorld) { this.notified = await houston.notifyAll(); });

// Responses
Then('the response status is {int}', function (this: HoustonWorld, s: number) { assert.equal(this.res!.statusCode, s, this.res!.body.slice(0, 300)); });
Then('the response status is not {int}', function (this: HoustonWorld, s: number) { assert.notEqual(this.res!.statusCode, s); });
Then('the response body is exactly {string}', function (this: HoustonWorld, b: string) { assert.equal(this.res!.body, b); });
Then('the response contains {string}', function (this: HoustonWorld, t: string) { assert.ok(this.res!.body.includes(t), `expected "${t}"`); });
Then('the response does not contain {string}', function (this: HoustonWorld, t: string) { assert.ok(!this.res!.body.includes(t), `did not expect "${t}"`); });
Then('the {string} header contains {string}', function (this: HoustonWorld, h: string, t: string) { assert.ok(String(this.res!.headers[h] ?? '').includes(t), `${h}: ${this.res!.headers[h]}`); });
Then('the {string} header is {string}', function (this: HoustonWorld, h: string, v: string) { assert.equal(this.res!.headers[h], v); });

// Privacy
Then("the response mentions none of the team's names", function (this: HoustonWorld) {
  assert.deepEqual(mentioned(this.res!.body), [], 'names leaked');
});
Then("the response mentions some of the team's names", function (this: HoustonWorld) {
  assert.ok(mentioned(this.res!.body).length > 0, 'expected names for a people viewer');
});
Then('no evidence record has the fields {string}', function (this: HoustonWorld, list: string) {
  const fields = list.split(',').map((x) => x.trim());
  const records = Object.values(JSON.parse(this.res!.body).records as Record<string, object[]>).flat();
  assert.ok(records.length > 0, 'expected some evidence records');
  for (const r of records) for (const f of fields) assert.ok(!(f in r), `record has ${f}`);
});

// Teams
Then('Teams receives {int} cards', function (this: HoustonWorld, n: number) { assert.equal(this.webhook!.cards.length, n); });
Then("no card mentions any of the team's names", function (this: HoustonWorld) {
  assert.deepEqual(mentioned(JSON.stringify(this.webhook!.cards)), [], 'names in Teams cards');
});
Then('every card links to {string}', function (this: HoustonWorld, prefix: string) {
  for (const c of this.webhook!.cards) assert.ok(c.text.includes(prefix), c.text);
});
Then('every card gives the share of targets met', function (this: HoustonWorld) {
  for (const c of this.webhook!.cards) assert.match(c.text, /\*\*\d+% of targets met\*\* \(\d+ of \d+\)/, c.text);
});
Then('every board reports {string}', function (this: HoustonWorld, reason: string) {
  assert.ok(this.notified!.length > 0);
  for (const r of this.notified!) assert.equal((r as { reason?: string }).reason, reason);
});

// Version
Then('the version matches package.json', function (this: HoustonWorld) { assert.equal(JSON.parse(this.res!.body).version, this.pkgVersion); });
Then('the version has a commit and a build time', function (this: HoustonWorld) {
  const v = JSON.parse(this.res!.body);
  assert.match(v.commit ?? '', /^[0-9a-f]{7}$/); assert.ok(!Number.isNaN(Date.parse(v.builtAt)), 'builtAt is a date');
});
