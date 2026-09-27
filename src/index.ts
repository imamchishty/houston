import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { store } from './store/index.js';
import { run } from './pipeline.js';
import { rules } from './rules/sprintRules.js';
import { peopleStats } from './people.js';
import { learnBaseline } from './cycle.js';
import { scoreQuality } from './rules/qualityRules.js';
import { recommend, headcountGate } from './recommend.js';
import { scoreFlow } from './rules/flowRules.js';
import { githubPeople } from './githubPeople.js';
import { rosterFor } from './identity.js';
import { scoreDocs, docsPeople } from './rules/docsRules.js';
import { scoreFeatures } from './rules/featureRules.js';
import { scoreOps } from './rules/opsRules.js';
import { postToTeams } from './teams.js';
import { sprintInsights, heatmap, headline } from './insights.js';
import { windowStatus } from './window.js';
import { outputBench } from './outputBench.js';
import { activity } from './activity.js';
import { incidentLog } from './incidents.js';
import { randomUUID } from 'node:crypto';
import type { Action } from './types.js';

// Everything Houston knows about one board, assembled once per request.
function boardData(board: string) {
  const history = store.scorecards().filter((c) => c.board === board).sort((a, b) => a.sprintId - b.sprintId);
  const sprints = store.sprints().filter((s) => s.board === board);
  const q = store.quality().find((x) => x.board === board);
  const g = store.github().find((x) => x.board === board);
  const d = store.docs().find((x) => x.board === board);
  const epics = store.epics()[board] ?? [];
  const az = store.azure().find((x) => x.board === board);
  return {
    ops: az ? scoreOps(az) : null,
    history, sprints, latest: history[history.length - 1],
    quality: q ? scoreQuality(q) : null,
    flow: g ? scoreFlow(g) : null,
    docs: d ? scoreDocs(d, g?.repos.length ?? 1) : null,
    features: epics.length ? scoreFeatures(epics) : null,
    people: peopleStats(sprints),
    github: g ? githubPeople(g, rosterFor(board)) : [],
    docsPeople: d ? docsPeople(d) : [],
    raw: { sprints, github: g, docs: d, epics },
  };
}

const app = Fastify({ logger: true });
const here = dirname(fileURLToPath(import.meta.url));

app.register(fastifyStatic, { root: join(here, 'ui'), prefix: '/' });

// Basic auth when HOUSTON_PASSWORD is set. Per person data only for HOUSTON_PEOPLE_VIEWERS.
const auth = { user: process.env.HOUSTON_USER ?? '', pass: process.env.HOUSTON_PASSWORD ?? '', viewers: (process.env.HOUSTON_PEOPLE_VIEWERS ?? '').split(',').map((x) => x.trim()).filter(Boolean) };
app.addHook('onRequest', async (req, reply) => {
  if (!auth.pass) return;
  const hdr = req.headers.authorization ?? '';
  const [u, p] = Buffer.from(hdr.replace(/^Basic /, ''), 'base64').toString().split(':');
  if (u !== auth.user || p !== auth.pass) return reply.code(401).header('WWW-Authenticate', 'Basic realm="Houston"').send('Sign in');
  if (req.url.includes('/people') && auth.viewers.length && !auth.viewers.includes(u)) return reply.code(403).send({ error: 'Per person data is restricted' });
});

// Every team's latest scorecard plus trend. This is what the Backstage plugin will call.
app.get('/api/teams', async () => {
  const cards = store.scorecards();
  const byBoard = new Map<string, typeof cards>();
  for (const c of cards) byBoard.set(c.board, [...(byBoard.get(c.board) ?? []), c]);
  return [...byBoard.entries()].map(([board, list]) => {
    const sorted = list.sort((a, b) => a.sprintId - b.sprintId);
    const latest = sorted[sorted.length - 1];
    const q = store.quality().find((x) => x.board === board);
    const quality = q ? scoreQuality(q) : null;
    const g = store.github().find((x) => x.board === board);
    const flow = g ? scoreFlow(g) : null;
    return {
      board,
      score: latest.score,
      flowScore: flow?.score ?? null,
      flowRag: flow?.rag ?? null,
      docsScore: boardData(board).docs?.score ?? null,
      opsScore: boardData(board).ops?.score ?? null,
      featuresScore: boardData(board).features?.score ?? null,
      qualityScore: quality?.score ?? null,
      qualityRag: quality?.rag ?? null,
      rag: latest.rag,
      sprint: latest.sprintName,
      trend: sorted.map((c) => ({ sprint: c.sprintName, score: c.score, rag: c.rag })),
      topGaps: latest.findings.filter((f) => f.rag !== 'green').slice(0, 3),
      headline: headline(sorted, { flow: flow?.score, quality: quality?.score, features: boardData(board).features?.score }),
      delta: sorted.length > 1 ? latest.score - sorted[sorted.length - 2].score : 0,
    };
  });
});

app.get<{ Params: { board: string } }>('/api/teams/:board', async (req, reply) => {
  const cards = store.scorecards().filter((c) => c.board === req.params.board).sort((a, b) => b.sprintId - a.sprintId);
  if (!cards.length) return reply.code(404).send({ error: `No scorecards for ${req.params.board}` });
  const q = store.quality().find((x) => x.board === req.params.board);
  const g = store.github().find((x) => x.board === req.params.board);
  const sprintsB = store.sprints().filter((x) => x.board === req.params.board); const gB = g;
  return { board: req.params.board, latest: cards[0], history: cards,
    quality: q ? { ...scoreQuality(q), capturedAt: q.capturedAt } : null,
    flow: g ? { ...scoreFlow(g), since: g.since, until: g.until, repos: g.repos } : null,
    docs: boardData(req.params.board).docs, features: boardData(req.params.board).features, ops: boardData(req.params.board).ops,
    actions: store.actions().filter((a) => a.board === req.params.board),
    insights: sprintInsights([...cards].reverse()), heatmap: heatmap([...cards].reverse()),
    window: windowStatus([...cards].reverse(), boardData(req.params.board).flow?.findings, boardData(req.params.board).quality?.findings),
    output: (() => { const all = [...new Set(store.sprints().map((x) => x.board))].map((bd) => ({ board: bd, ppe: outputBench(bd, store.sprints().filter((x) => x.board === bd), store.github().find((x) => x.board === bd), store.epics()[bd] ?? [], []).pointsPerEngineerPerSprint }));
      return outputBench(req.params.board, sprintsB, gB, store.epics()[req.params.board] ?? [], all); })(),
    incidents: incidentLog(store.azure().find((x) => x.board === req.params.board), store.docs().find((x) => x.board === req.params.board)) };
});

// Markdown digest for the sprint retro. Paste into Confluence or post to Teams.
app.get<{ Params: { board: string } }>('/api/teams/:board/digest.md', async (req, reply) => {
  const cards = store.scorecards().filter((c) => c.board === req.params.board).sort((a, b) => b.sprintId - a.sprintId);
  if (!cards.length) return reply.code(404).send('No scorecards');
  const c = cards[0];
  const prev = cards[1];
  const gaps = c.findings.filter((f) => f.rag !== 'green');
  const sprintsB = store.sprints().filter((s) => s.board === req.params.board);
  const qs = store.quality().find((x) => x.board === req.params.board);
  const gB = store.github().find((x) => x.board === req.params.board);
  const bdd = boardData(req.params.board);
  const recs = recommend({ card: c, history: bdd.history, quality: bdd.quality, people: bdd.people, flow: bdd.flow, github: bdd.github, docs: bdd.docs, docsPeople: bdd.docsPeople, features: bdd.features });
  const lines = [
    `# ${c.board}: ${c.sprintName}`,
    '',
    `Health score: ${c.score} (${c.rag})${prev ? `, previous sprint ${prev.score}` : ''}`,
    '',
    '## Fix these first',
    '',
    ...gaps.slice(0, 3).flatMap((f) => [`**${f.title}**`, f.message, `Do this: ${f.action}`, f.evidence.length ? `Issues: ${f.evidence.join(', ')}` : '', '']),
    '## Recommendations',
    '',
    ...recs.flatMap((r, i) => [`### ${i + 1}. ${r.title} (${r.owner}, ${r.horizon})`, r.why, '', ...r.what.map((w) => `- ${w}`), '']),
    '## All checks',
    '',
    '| Check | Result | Status |', '|---|---|---|',
    ...c.findings.map((f) => `| ${f.title} | ${f.value}${f.unit === '%' ? '%' : ''} | ${f.rag} |`),
  ];
  reply.type('text/markdown').send(lines.join('\n'));
});

// Per person stats for one board. Put this behind auth in production.
app.get<{ Params: { board: string } }>('/api/teams/:board/people', async (req, reply) => {
  const sprints = store.sprints().filter((s) => s.board === req.params.board);
  if (!sprints.length) return reply.code(404).send({ error: `No sprints for ${req.params.board}` });
  const g = store.github().find((x) => x.board === req.params.board);
  const jira = peopleStats(sprints);
  return { board: req.params.board, baseline: learnBaseline(sprints), people: jira,
    github: g ? githubPeople(g, [...jira.map((p) => p.name), ...rosterFor(req.params.board)]) : [],
    docs: boardData(req.params.board).docsPeople,
    activity: activity(sprints, g) };
});

// Ranked recommendations and the headcount gate for one team.
app.get<{ Params: { board: string } }>('/api/teams/:board/recommendations', async (req, reply) => {
  const history = store.scorecards().filter((c) => c.board === req.params.board).sort((a, b) => a.sprintId - b.sprintId);
  if (!history.length) return reply.code(404).send({ error: `No scorecards for ${req.params.board}` });
  const sprints = store.sprints().filter((s) => s.board === req.params.board);
  const qs = store.quality().find((x) => x.board === req.params.board);
  const g = store.github().find((x) => x.board === req.params.board);
  const bd = boardData(req.params.board);
  const ctx = { card: bd.latest, history: bd.history, quality: bd.quality, people: bd.people, flow: bd.flow, github: bd.github, docs: bd.docs, docsPeople: bd.docsPeople, features: bd.features };
  return { board: req.params.board, recommendations: recommend(ctx), headcountGate: headcountGate(ctx) };
});

// Evidence: the raw records behind one finding, so any number can be checked by hand.
app.get<{ Params: { board: string; ruleId: string } }>('/api/teams/:board/evidence/:ruleId', async (req, reply) => {
  const b = boardData(req.params.board);
  const all = [...(b.latest?.findings ?? []), ...(b.flow?.findings ?? []), ...(b.quality?.findings ?? []), ...(b.docs?.findings ?? []), ...(b.features?.findings ?? [])];
  const f = all.find((x) => x.ruleId === req.params.ruleId);
  if (!f) return reply.code(404).send({ error: 'No such finding' });
  const keys = new Set(f.evidence.map((e) => e.split(' ')[0]));
  const issues = b.raw.sprints.flatMap((s) => s.issues).filter((i) => keys.has(i.key));
  const prs = (b.raw.github?.prs ?? []).filter((p) => keys.has(`${p.repo.split('/')[1]}#${p.number}`));
  const pages = (b.raw.docs?.pages ?? []).filter((p) => keys.has(p.title.split(' ')[0]) || f.evidence.includes(p.title));
  const epics = b.raw.epics.filter((e) => keys.has(e.key));
  return { finding: f, formula: `See METRICS.md, rule ${f.ruleId}`, records: { issues, prs, pages, epics } };
});

// Action log: record what was done about a recommendation and freeze the numbers at that moment.
app.get<{ Params: { board: string } }>('/api/teams/:board/actions', async (req) => {
  const b = boardData(req.params.board);
  const now: Record<string, number> = {};
  for (const f of [...(b.latest?.findings ?? []), ...(b.flow?.findings ?? []), ...(b.quality?.findings ?? [])]) now[f.ruleId] = f.value;
  return store.actions().filter((a) => a.board === req.params.board).map((a) => ({
    ...a,
    movement: Object.entries(a.baseline).map(([rule, was]) => ({ rule, was, now: now[rule] ?? null })).filter((m) => m.now != null && m.now !== m.was),
  }));
});
app.post<{ Params: { board: string }; Body: { recId: string; title: string; status: Action['status']; owner: string; note?: string } }>('/api/teams/:board/actions', async (req, reply) => {
  const { recId, title, status, owner, note } = req.body ?? ({} as any);
  if (!recId || !status || !owner) return reply.code(400).send({ error: 'recId, status and owner required' });
  const b = boardData(req.params.board);
  const baseline: Record<string, number> = {};
  for (const f of [...(b.latest?.findings ?? []), ...(b.flow?.findings ?? []), ...(b.quality?.findings ?? [])]) baseline[f.ruleId] = f.value;
  const a: Action = { id: randomUUID(), board: req.params.board, recId, title: title ?? recId, status, owner, note: note ?? '', at: new Date().toISOString(), baseline };
  store.saveActions([...store.actions(), a]);
  return a;
});

// Post the digest headline to Teams. Schedule: curl -X POST .../notify on Fridays, or call from the nightly job.
app.post<{ Params: { board: string } }>('/api/teams/:board/notify', async (req, reply) => {
  const b = boardData(req.params.board);
  if (!b.latest) return reply.code(404).send({ error: 'No data' });
  const gaps = [...b.latest.findings, ...(b.flow?.findings ?? []), ...(b.quality?.findings ?? [])].filter((f) => f.rag === 'red').slice(0, 3);
  const lines = [
    `Sprint ${b.latest.score} (${b.latest.rag})${b.flow ? `, flow ${b.flow.score}` : ''}${b.quality ? `, quality ${b.quality.score}` : ''}${b.features ? `, features ${b.features.score}` : ''}`,
    ...gaps.map((f) => `**${f.title}**: ${f.message}`),
    `Full digest: /api/teams/${req.params.board}/digest.md`,
  ];
  return postToTeams(`Houston: ${b.latest.board}, ${b.latest.sprintName}`, lines);
});

app.get('/api/rules', async () =>
  rules.map(({ evaluate, ...r }) => r),
);

app.post('/api/refresh', async () => {
  const cards = await run();
  return { scored: cards.length, mode: config.mode };
});

app.get('/api/health', async () => ({ ok: true, mode: config.mode, scorecards: store.scorecards().length }));

async function main() {
  if (!store.scorecards().length) await run();
  await app.listen({ port: config.port, host: '0.0.0.0' });
}
main();
