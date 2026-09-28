import assert from 'node:assert/strict';
import { Given, When, Then, After } from '@cucumber/cucumber';
import { HoustonWorld, houston } from '../support/world.js';

// A fake Compass for chat: the first call is the plan (which lookups), the second the answer. Records both.
let calls: { messages: { role: string; content: string }[] }[] = [];
let plan: unknown = { calls: [{ tool: 'performance', args: { team: 'OSSI', days: 30 } }] }, answerMode: 'facts' | 'invent' = 'facts';
const real = globalThis.fetch;
After(function () { globalThis.fetch = real; houston.config.compass = { url: '', key: '', model: 'gpt-4o' }; });

function configure() {
  calls = []; answerMode = 'facts';
  houston.config.compass = { url: 'https://compass.test/v1', key: 'k'.repeat(30), model: 'test-model' };
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); calls.push(body);
    const content = body.response_format ? JSON.stringify(plan) : answerFrom(body.messages[1].content);
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}
// An answer that uses two numbers from the facts, or one that invents 999.
function answerFrom(user: string): string {
  const facts = user.slice(user.indexOf('FACTS: ') + 7);
  const nums = [...new Set(facts.match(/\d+(?:\.\d+)?/g) ?? [])];
  return answerMode === 'invent' ? `About 999 points are done, with ${nums[0]} days left.` : `The sprint has ${nums[0]} and ${nums[1]} in its numbers, and it is going as the facts say.`;
}
Given('Compass is configured for chat', function () { configure(); });
Given(/^Compass is configured for chat, choosing the "(\w+)" lookup(?: for team "(\w+)")? and answering (from the facts|with an invented number)$/, function (tool: string, team: string | undefined, mode: string) {
  configure(); plan = { calls: [{ tool, args: { team: team ?? 'OSSI', days: 30 } }] }; answerMode = mode === 'from the facts' ? 'facts' : 'invent';
});
Given('Compass is configured for chat, choosing a lookup that does not exist', function () { configure(); plan = { calls: [{ tool: 'payroll', args: {} }] }; });
When('the user asks {string} about {string}', async function (this: HoustonWorld, q: string, team: string) {
  await this.request('POST', '/api/chat', { ...this.signedIn(), headers: { 'X-Requested-With': 'houston', 'content-type': 'application/json' }, body: JSON.stringify({ question: q, team }) });
});
When('the {string} token asks {string}', async function (this: HoustonWorld, _name: string, q: string) {
  await this.request('POST', '/api/chat', { headers: { authorization: `Bearer ${'a'.repeat(40)}`, 'X-Requested-With': 'houston', 'content-type': 'application/json' }, body: JSON.stringify({ question: q, team: 'OSSI' }) });
});
const body = (w: HoustonWorld) => JSON.parse(w.res!.body);
Then('the answer is a refusal and Compass was not called', function (this: HoustonWorld) {
  assert.equal(body(this).refused, true); assert.match(body(this).answer, /teams, not people/); assert.equal(calls.length, 0);
});
Then('the answer came from Compass and every number in it is in the facts', function (this: HoustonWorld) {
  const a = body(this); assert.ok(!a.fromFacts && !a.refused, JSON.stringify(a));
  assert.equal(calls.length, 2);
  const facts = new Set((calls[1].messages[1].content.match(/\d+(?:\.\d+)?/g) ?? []).map(Number));
  for (const n of a.answer.match(/\d+(?:\.\d+)?/g) ?? []) assert.ok(facts.has(Number(n)), `invented ${n}`);
});
Then('the answer is based on {string}', function (this: HoustonWorld, title: string) { assert.ok(body(this).basedOn.some((b: { title: string }) => b.title === title), JSON.stringify(body(this).basedOn)); });
Then("the answer is Houston's own words from the facts", function (this: HoustonWorld) {
  const a = body(this); assert.equal(a.fromFacts, true); assert.match(a.answer, /^Here is what Houston found/); assert.ok(!a.answer.includes('999'));
});
Then('the lookup ran for {string}', function (this: HoustonWorld, team: string) {
  const facts = JSON.parse(calls[1].messages[1].content.slice(calls[1].messages[1].content.indexOf('FACTS: ') + 7));
  const first = Object.values(facts[0])[0] as { team: string };
  assert.equal(first.team, team);
});
