import assert from 'node:assert/strict';
import { demoSprints } from './collectors/demo.js';
import { demoGithub } from './collectors/githubDemo.js';
import { demoConfluence } from './collectors/confluence.js';
import { scoreSprint } from './rules/engine.js';
import { learnBaseline } from './cycle.js';
import { peopleStats } from './people.js';
import { scoreFlow } from './rules/flowRules.js';
import { githubPeople } from './githubPeople.js';
import { docsPeople } from './rules/docsRules.js';
import { recommend, headcountGate } from './recommend.js';
import { config } from './config.js';

// OSSI is the struggling demo team: its recommendations name people, so it shows whether names leak.
const sprints = demoSprints().filter((s) => s.board === 'OSSI');
const baseline = learnBaseline(sprints);
const history = sprints.map((s) => scoreSprint({ ...s, baseline })).sort((a, b) => a.sprintId - b.sprintId);
const g = demoGithub().find((x) => x.board === 'OSSI')!;
const d = demoConfluence().find((x) => x.board === 'OSSI');
const people = peopleStats(sprints);
const github = githubPeople(g, config.roster.find((r) => r.name === 'OSSI')?.people ?? []);
const ctx = { card: history[history.length - 1], history, quality: null, people, flow: scoreFlow(g), github, docsPeople: d ? docsPeople(d) : [] };

const text = (rs: ReturnType<typeof recommend>) => rs.map((r) => [r.why, ...r.what].join(' ')).join(' ');
const names = [...new Set([...people.map((p) => p.name), ...github.map((p) => p.name)])].filter(Boolean);

const named = recommend(ctx);
assert.ok(named.length > 0, 'struggling team gets recommendations');
assert.ok(names.some((n) => text(named).includes(n)), 'people viewers see names');

const shared = recommend({ ...ctx, named: false });
assert.deepEqual(shared.map((r) => r.id), named.map((r) => r.id), 'same recommendations either way');
for (const n of names) assert.ok(!new RegExp(`\\b${n}\\b`).test(text(shared)), `shared recommendations leak ${n}`);
assert.ok(text(shared).includes('names in the people view'), 'shared text points to the people view');

const gate = headcountGate(ctx);
assert.equal(gate.criteria.length, 3);
assert.equal(gate.ready, false, 'OSSI demo is not ready for headcount');

// Teams headline: built from the store, never names a person from a recommendation.
const { store } = await import('./store/index.js');
const { run } = await import('./pipeline.js');
const { digestHeadline } = await import('./teams.js');
if (!store.scorecards().length) await run();
const h = digestHeadline('OSSI');
assert.ok(h && h.title.startsWith('Houston: OSSI'), 'headline built');
assert.ok(h!.lines[h!.lines.length - 1].includes('/api/teams/OSSI/digest.md'), 'links to the digest');
assert.equal(digestHeadline('NOPE'), null);

console.log('recommend ok');
