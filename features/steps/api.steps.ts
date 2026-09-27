import assert from 'node:assert/strict';
import { Given, When, Then } from '@cucumber/cucumber';
import { HoustonWorld, houston } from '../support/world.js';

Given('an API token {string} of {string}', function (this: HoustonWorld, name: string, token: string) {
  this.auth = { ...this.auth, tokens: [...(this.auth.tokens ?? []), { name, token }] }; this.app = undefined;
});
const tokenOf = (w: HoustonWorld, name: string) => w.auth.tokens!.find((t) => t.name === name)!.token;
When('{string} requests {string} with its token', async function (this: HoustonWorld, name: string, url: string) {
  await this.request('GET', url, { headers: { authorization: `Bearer ${tokenOf(this, name)}` } });
});
When('{string} posts to {string} with its token', async function (this: HoustonWorld, name: string, url: string) {
  await this.request('POST', url, { headers: { authorization: `Bearer ${tokenOf(this, name)}`, 'X-Requested-With': 'houston', 'content-type': 'application/json' }, body: '{}' });
});
When('a caller presents the token {string} for {string}', async function (this: HoustonWorld, token: string, url: string) {
  await this.request('GET', url, { headers: { authorization: `Bearer ${token}` } });
});

Then('the summary has a score, a band, area scores and DORA tiers', function (this: HoustonWorld) {
  const s = JSON.parse(this.res!.body);
  assert.equal(typeof s.score, 'number');
  assert.ok(['Healthy', 'Watch', 'Needs attention'].includes(s.band), s.band);
  assert.ok(s.areas.length >= 3, 'area scores');
  assert.ok(s.dora.length >= 3 && s.dora.every((d: { tier: string }) => ['Elite', 'High', 'Medium', 'Low'].includes(d.tier)), 'DORA tiers');
});

Then('the OpenAPI document lists exactly the routes Houston serves', async function (this: HoustonWorld) {
  await this.app!.ready();
  const served = new Set(((this.app as unknown as { houstonRoutes: string[] }).houstonRoutes)
    .map((r) => r.replace(/:(\w+)/g, '{$1}')));
  const doc = JSON.parse(this.res!.body) as { paths: Record<string, Record<string, unknown>> };
  const documented = new Set(Object.entries(doc.paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`)));
  assert.deepEqual([...served].filter((r) => !documented.has(r)), [], 'served but not documented');
  assert.deepEqual([...documented].filter((r) => !served.has(r)), [], 'documented but not served');
});

// Bands
Then('a score of {int} is {string}', async function (score: number, band: string) {
  const { bandFor } = await import('../../src/metrics.js');
  assert.equal(bandFor(score), band);
});
Then('the gains are in descending order', function (this: HoustonWorld) {
  const g = JSON.parse(this.res!.body).gains.map((x: { gain: number }) => x.gain);
  assert.ok(g.length > 0);
  assert.deepEqual(g, [...g].sort((a: number, b: number) => b - a));
});
Then('the sprint gains add up to no more than {int} minus the sprint score', function (this: HoustonWorld, full: number) {
  const s = JSON.parse(this.res!.body);
  const sprintGains = s.gains.filter((x: { area: string }) => x.area === 'Sprint process').reduce((t: number, x: { gain: number }) => t + x.gain, 0);
  assert.ok(sprintGains <= full - s.score + 2, `${sprintGains} vs ${full - s.score}`); // rounding
});
void houston;
