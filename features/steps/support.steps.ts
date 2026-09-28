import assert from 'node:assert/strict';
import { Given, When, Then, After } from '@cucumber/cucumber';
import type { SupportTicket } from '../../src/types.js';

// Reading one ticket as Jira returns it: only people's actions, only times.
let issue: any, ticket: SupportTicket;
const t = (hhmm: string) => `2026-06-01T${hhmm}:00.000+0000`;
Given('a Jira support ticket raised by {string} with a comment by {string} at {word}, an automation status change at {word}, a comment by {string} at {word} and a status change by {string} at {word}',
  function (reporter: string, c1: string, t1: string, t2: string, c2: string, t3: string, c3: string, t4: string) {
    const person = (id: string) => ({ accountId: id, accountType: 'atlassian', displayName: `Name of ${id}` });
    issue = { key: 'SUP-1', fields: { priority: { name: 'High' }, created: t('09:00'), resolutiondate: null, issuelinks: [], reporter: person(reporter),
      comment: { comments: [{ author: person(c1), created: t(t1), body: 'secret customer text' }, { author: person(c2), created: t(t3), body: 'agent reply text' }] } },
      changelog: { histories: [{ author: { accountId: 'bot', accountType: 'app' }, created: t(t2), items: [{ field: 'status' }] }, { author: person(c3), created: t(t4), items: [{ field: 'status' }] }] } };
  });
When('it is read from Jira', async function () { ticket = (await import('../../src/collectors/support.js')).toTicket(issue); });
Then('its first response is {word}', function (hhmm: string) { assert.equal(ticket.firstResponse, new Date(t(hhmm)).toISOString()); });
Then('it keeps {int} status change time and no names or comment text', function (n: number) {
  assert.equal(ticket.changes.length, n);
  const j = JSON.stringify(ticket);
  for (const x of ['cust-1', 'agent-7', 'Name of', 'secret customer text', 'agent reply text']) assert.ok(!j.includes(x), x);
});

// Which tickets are support.
const keep: { sp?: Record<string, string>; p?: Record<string, string> } = {};
After(async function () { const { config } = await import('../../src/config.js'); if (keep.sp) { config.jira.supportProjects = keep.sp; config.jira.projects = keep.p!; delete keep.sp; } });
const setup = async () => { const { config } = await import('../../src/config.js'); keep.sp ??= config.jira.supportProjects; keep.p ??= config.jira.projects; return config; };
Then('a team with its own support project {string} searches {string}', async function (sp: string, jql: string) {
  const c = await setup(); c.jira.supportProjects = { OSSI: sp }; c.jira.projects = { OSSI: 'OSS' };
  assert.equal((await import('../../src/collectors/support.js')).supportJql('OSSI', 90), jql);
});
Then('a team without one searches its own project {string} for support issue types or labels', async function (key: string) {
  const c = await setup(); c.jira.supportProjects = {}; c.jira.projects = { OSSI: key };
  const jql = (await import('../../src/collectors/support.js')).supportJql('OSSI', 90);
  assert.ok(jql.startsWith(`project = "${key}" AND (issuetype in ("Support", "Incident", "Service Request") OR labels in ("support")) AND`), jql);
});
Given('a Jira support ticket whose resolution was cleared after being set, linked as duplicating {string}', function (other: string) {
  issue = { key: 'SUP-2', fields: { priority: null, created: t('09:00'), resolutiondate: t('12:00'), reporter: null, comment: { comments: [] },
    issuelinks: [{ type: { name: 'Duplicate', inward: 'is duplicated by', outward: 'duplicates' }, outwardIssue: { key: other } }] },
    changelog: { histories: [{ author: { accountType: 'atlassian' }, created: t('10:00'), items: [{ field: 'resolution', from: null, to: '10000', toString: 'Done' }] },
      { author: { accountType: 'atlassian' }, created: t('11:00'), items: [{ field: 'resolution', from: '10000', fromString: 'Done', to: null, toString: null }] }] } };
});
Then('it is marked reopened and duplicate', function () { assert.deepEqual([ticket.reopened, ticket.duplicate], [true, true]); });

// An upgrade before the first nightly run: no support data stored yet.
let stash: unknown[] | null = null;
Given('no support data has been collected yet', async function () {
  const { store } = await import('../../src/store/index.js'); stash = store.support(); store.saveSupport([]);
});
After(async function () { if (stash) { const { store } = await import('../../src/store/index.js'); store.saveSupport(stash as any); stash = null; } });
Then('support SLAs are left out of the score until support data is collected', function (this: any) {
  for (const t of JSON.parse(this.res.body).teams) assert.ok(!t.measures.some((m: { id: string }) => m.id === 'sla_resolution'), t.board);
});
