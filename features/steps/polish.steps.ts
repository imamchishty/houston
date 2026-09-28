import assert from 'node:assert/strict';
import { Given, When, Then, After } from '@cucumber/cucumber';
import { houston } from '../support/world.js';
import type { Note } from '../../src/note.js';

// A fake Compass: records what it was sent, answers as the scenario says.
const KEY = 'compass-secret-key-0123456789';
let calls: { headers: Record<string, string>; body: any }[] = [], mode = 'faithful', result: { lines: string[]; polished: boolean }, note: Note;
const real = globalThis.fetch;
After(async function () { globalThis.fetch = real; houston.config.compass = { url: '', key: '', model: 'gpt-4o' }; (await import('../../src/polish.js')).clearPolishCache(); });

// Rephrase: same numbers and headings, different words around them.
const rephrase = (lines: string[]) => lines.map((l) => l.replace(' over the last 30 days', ' in the past 30 days').replace('What moved with it:', 'Alongside it,').replace('has just started:', 'is one day in:'));
const setup = async (m: string) => {
  mode = m; calls = [];
  houston.config.compass = { url: 'https://compass.test/v1', key: KEY, model: 'test-model' };
  (await import('../../src/polish.js')).clearPolishCache();
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); calls.push({ headers: init?.headers as Record<string, string>, body });
    if (mode === 'down') return new Response('gateway timeout', { status: 504 });
    const lines: string[] = body.messages[1].content.split('\n\n');
    const out = mode === 'faithful' ? rephrase(lines) : mode === 'changes' ? lines.map((l) => l.replace(/(\d+)% of targets met/, (_s, n) => `${Number(n) + 10}% of targets met`)) : [...lines.slice(0, -1), lines[lines.length - 1] + ' About 3 more items are at risk.'];
    return new Response(JSON.stringify({ choices: [{ message: { content: out.join('\n\n') } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
};
Given('Compass is configured and answers by rephrasing the note faithfully', async () => setup('faithful'));
Given('Compass is configured and answers with a note that changes a number', async () => setup('changes'));
Given('Compass is configured and answers with a note that adds a number', async () => setup('adds'));
Given('Compass is configured and is down', async () => setup('down'));
When('the note for {string} is polished', async function (board: string) {
  const { weeklyNote } = await import('../../src/note.js'); const { polish } = await import('../../src/polish.js');
  note = weeklyNote(board)!; result = await polish(note);
});
When('the note for {string} is polished twice', async function (board: string) {
  const { weeklyNote } = await import('../../src/note.js'); const { polish } = await import('../../src/polish.js');
  note = weeklyNote(board)!; result = await polish(note); result = await polish(note);
});
Then('the polished note is used, with every number of the rules note', function () {
  assert.equal(result.polished, true);
  assert.notDeepEqual(result.lines, note.lines);
  const nums = (t: string[]) => (t.join('\n').match(/\d+(?:\.\d+)?%?/g) ?? []).sort();
  assert.deepEqual(nums(result.lines), nums(note.lines));
  assert.ok(!JSON.stringify(result).includes(KEY));
});
Then('the rules note is used', function () { assert.equal(result.polished, false); assert.deepEqual(result.lines, note.lines); });
Then("Compass was called once, with the key as a bearer token, and the request held only the note's lines", function () {
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.Authorization, `Bearer ${KEY}`);
  assert.equal(calls[0].body.messages[1].content, note.lines.join('\n\n'));
  assert.equal(calls[0].body.messages.length, 2);
});
