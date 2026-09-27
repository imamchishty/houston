import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { store } from './store/index.js';
import { run } from './pipeline.js';
import { buildInfo } from './version.js';
import { boardData } from './board.js';
import { teamSummary } from './summary.js';
import { dashboard } from './dashboard.js';
import { dataQuality } from './dataQuality.js';
import { diagFor } from './diag.js';
import { simpleDashboard } from './simple.js';
import { doraSeries, PERIODS } from './dora.js';
import { slice, quality, predictability, efficiency, perTeam, flatMeasures, withPrevious, type Period } from './reports.js';
import { currentSprint, currentSprints } from './sprintNow.js';
import { openapi } from './openapi.js';
import { featureCosts } from './cost.js';
import { costRates, claudeReport } from './claude.js';
import { metricCatalogue, bandFor } from './metrics.js';
import { history, valueOn } from './store/history.js';
import { rules } from './rules/sprintRules.js';
import { peopleStats } from './people.js';
import { learnBaseline } from './cycle.js';
import { scoreQuality } from './rules/qualityRules.js';
import { recommend, headcountGate } from './recommend.js';
import { scoreFlow } from './rules/flowRules.js';
import { githubPeople } from './githubPeople.js';
import { rosterFor } from './identity.js';
import { notifyBoard, md } from './teams.js';
import { sprintInsights, heatmap, headline } from './insights.js';
import { windowStatus } from './window.js';
import { outputBench } from './outputBench.js';
import { activity } from './activity.js';
import { incidentLog } from './incidents.js';
import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { z } from 'zod';
import type { Action } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));

// People sign in with basic auth. Machines (the IDP, Backstage, reporting) use read-only API tokens:
// HOUSTON_API_TOKENS=backstage:<token>,reporting:<token>. A token is team level only, unless its name is a people viewer.
export interface AuthOptions { user: string; pass: string; viewers: string[]; tokens?: { name: string; token: string }[] }
export const parseTokens = (v: string | undefined) => (v ?? '').split(',').map((x) => x.trim()).filter((x) => x.includes(':'))
  .map((x) => { const i = x.indexOf(':'); return { name: x.slice(0, i).trim(), token: x.slice(i + 1).trim() }; });
export const authFromEnv = (): AuthOptions => ({
  user: process.env.HOUSTON_USER ?? '', pass: process.env.HOUSTON_PASSWORD ?? '',
  viewers: (process.env.HOUSTON_PEOPLE_VIEWERS ?? '').split(',').map((x) => x.trim()).filter(Boolean),
  tokens: parseTokens(process.env.HOUSTON_API_TOKENS),
});

// The whole HTTP app, without listening. index.ts serves it; the BDD suite drives it with inject().
// Throttles and lockouts live inside, so every instance starts clean.
export function buildApp(opts: { auth?: AuthOptions; logger?: boolean } = {}) {
  // Small bodies only: the one POST with a body is an action log entry.
  const app = Fastify({ logger: opts.logger ?? true, bodyLimit: 16 * 1024 });
  // Every API route, so the OpenAPI document can be checked against what is really served.
  const routes: string[] = [];
  app.addHook('onRoute', (r) => { if (r.url.startsWith('/api/')) for (const m of [r.method].flat()) if (m !== 'HEAD') routes.push(`${m} ${r.url}`); });
  app.decorate('houstonRoutes', routes);

  // Security headers on every response. The UI has no inline script or style, so the CSP can be strict.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('Cache-Control', 'no-store');
    if (config.publicUrl.startsWith('https://')) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  });

  // Errors: log the detail (upstream responses can be verbose), return a generic message.
  app.setErrorHandler((err: { statusCode?: number; message: string }, req, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) req.log.error(err);
    reply.code(status).send({ error: status >= 500 ? 'Internal error, see the server log' : err.message });
  });

  app.register(fastifyStatic, { root: join(here, 'ui'), prefix: '/' });

  // Basic auth when HOUSTON_PASSWORD is set (required outside demo mode). Per person data only for HOUSTON_PEOPLE_VIEWERS.
  const auth = opts.auth ?? authFromEnv();

  // Failed sign-ins per client address: 10 in 15 minutes, then locked for the rest of the window.
  const failures = new Map<string, { n: number; since: number }>();
  const WINDOW_MS = 15 * 60 * 1000, MAX_FAILURES = 10;
  function locked(ip: string) {
    const f = failures.get(ip);
    if (f && Date.now() - f.since > WINDOW_MS) { failures.delete(ip); return false; }
    return !!f && f.n >= MAX_FAILURES;
  }
  function failed(ip: string) {
    const f = failures.get(ip);
    failures.set(ip, f ? { ...f, n: f.n + 1 } : { n: 1, since: Date.now() });
    if (failures.size > 10000) failures.clear(); // bound memory under a spray from many addresses
  }

  app.addHook('onRequest', async (req, reply) => {
    // State changing requests must come from Houston's own page or a script, not a cross-site form.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'houston')
      return reply.code(403).send({ error: 'Missing X-Requested-With: houston header' });
    if (!auth.pass || req.routeOptions.url === '/api/health') return; // probes run without credentials
    if (locked(req.ip)) return reply.code(429).send({ error: 'Too many failed sign-ins, try again later' });
    const hdr = req.headers.authorization ?? '';
    if (/^Bearer /i.test(hdr)) {
      const presented = hdr.slice(7).trim();
      // Check every token, so the time taken does not reveal which one nearly matched.
      const match = (auth.tokens ?? []).reduce<string | null>((m, t) => (same(presented, t.token) ? t.name : m), null);
      if (!match) { failed(req.ip); return reply.code(401).send({ error: 'Invalid API token' }); }
      failures.delete(req.ip);
      if (req.method !== 'GET' && req.method !== 'HEAD') return reply.code(403).send({ error: 'API tokens are read-only' });
      if (PEOPLE_ROUTES.has(req.routeOptions.url ?? '') && !canSeePeople(match)) return reply.code(403).send({ error: 'Per person data is restricted' });
      (req as any).houstonUser = match;
      return;
    }
    const decoded = Buffer.from(hdr.replace(/^Basic /, ''), 'base64').toString();
    const i = decoded.indexOf(':');
    const u = decoded.slice(0, i), p = decoded.slice(i + 1); // passwords may contain ':'
    if (i < 0 || !same(u, auth.user) || !same(p, auth.pass)) {
      if (hdr) failed(req.ip);
      return reply.code(401).header('WWW-Authenticate', 'Basic realm="Houston"').send('Sign in');
    }
    failures.delete(req.ip);
    // Match on the route that will run, not the raw URL: /api/teams/X/%70eople decodes to the people route.
    if (PEOPLE_ROUTES.has(req.routeOptions.url ?? '') && !canSeePeople(u)) return reply.code(403).send({ error: 'Per person data is restricted' });
    (req as any).houstonUser = u;
  });

  const PEOPLE_ROUTES = new Set(['/api/teams/:board/people']);

  // Constant time compare of fixed length digests: reveals neither content nor length.
  const digest = (s: string) => createHash('sha256').update(s).digest();
  const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));
  function canSeePeople(user: string | undefined) {
    if (!auth.pass || !auth.viewers.length) return true; // no auth, or no viewer list: everyone signed in may see names
    return !!user && auth.viewers.includes(user);
  }
  const namedFor = (req: { houstonUser?: string }) => canSeePeople(req.houstonUser);

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
    return { board: req.params.board, latest: cards[0], history: cards,
      quality: q ? { ...scoreQuality(q), capturedAt: q.capturedAt } : null,
      flow: g ? { ...scoreFlow(g), since: g.since, until: g.until, repos: g.repos } : null,
      docs: boardData(req.params.board).docs, features: boardData(req.params.board).features, ops: boardData(req.params.board).ops,
      actions: store.actions().filter((a) => a.board === req.params.board),
      insights: sprintInsights([...cards].reverse()), heatmap: heatmap([...cards].reverse()),
      window: windowStatus([...cards].reverse(), boardData(req.params.board).flow?.findings, boardData(req.params.board).quality?.findings,
        Object.fromEntries([quality, predictability, efficiency].flatMap((fn) => flatMeasures(fn(slice(req.params.board, 30)))).map((m) => [m.id, m.value])),
        (rule, source, day) => valueOn(req.params.board, source === 'report' ? `r:${rule}` : rule, day)),
      output: outputBench(req.params.board, store.epics()[req.params.board] ?? []),
      incidents: incidentLog(store.azure().find((x) => x.board === req.params.board), store.docs().find((x) => x.board === req.params.board)) };
  });

  // Markdown digest for the sprint retro. Paste into Confluence or post to Teams.
  // Shared with the whole team, so names are left out. People viewers can add ?named=1 for their own copy.
  app.get<{ Params: { board: string }; Querystring: { named?: string } }>('/api/teams/:board/digest.md', async (req, reply) => {
    const cards = store.scorecards().filter((c) => c.board === req.params.board).sort((a, b) => b.sprintId - a.sprintId);
    if (!cards.length) return reply.code(404).send('No scorecards');
    const c = cards[0];
    const prev = cards[1];
    const gaps = c.findings.filter((f) => f.rag !== 'green');
    const bdd = boardData(req.params.board);
    const recs = recommend({ card: c, history: bdd.history, quality: bdd.quality, people: bdd.people, flow: bdd.flow, github: bdd.github, docs: bdd.docs, docsPeople: bdd.docsPeople, features: bdd.features, diag: diagFor(req.params.board), named: req.query.named === '1' && namedFor(req as any) });
    const lines = [
      `# ${c.board}: ${md(c.sprintName)}`,
      '',
      `Sprint health: ${c.score}, ${bandFor(c.score).toLowerCase()}${prev ? ` (previous sprint ${prev.score})` : ''}`,
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
    const bd = boardData(req.params.board);
    const ctx = { card: bd.latest, history: bd.history, quality: bd.quality, people: bd.people, flow: bd.flow, github: bd.github, docs: bd.docs, docsPeople: bd.docsPeople, features: bd.features, diag: diagFor(req.params.board), named: namedFor(req as any) };
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
    // Raw records carry assignees, authors and reviewers: those are per person data too.
    if (!namedFor(req as any)) return { finding: f, formula: `See METRICS.md, rule ${f.ruleId}`, records: {
      issues: issues.map(({ assignee, ...i }) => i), prs: prs.map(({ author, reviewers, ...p }) => p),
      pages: pages.map(({ createdBy, updatedBy, ...p }) => p), epics } };
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
  const ActionBody = z.object({
    recId: z.string().regex(/^[\w-]{1,64}$/),
    title: z.string().max(200).optional(),
    status: z.enum(['accepted', 'rejected', 'done']),
    owner: z.string().trim().min(1).max(100),
    note: z.string().max(2000).optional(),
  }).strict();
  app.post<{ Params: { board: string } }>('/api/teams/:board/actions', async (req, reply) => {
    const parsed = ActionBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid action: ' + parsed.error.issues.map((i) => `${i.path.join('.') || 'body'} ${i.message}`).join('; ') });
    if (!store.scorecards().some((c) => c.board === req.params.board)) return reply.code(404).send({ error: 'No such board' });
    const { recId, title, status, owner, note } = parsed.data;
    const b = boardData(req.params.board);
    const baseline: Record<string, number> = {};
    for (const f of [...(b.latest?.findings ?? []), ...(b.flow?.findings ?? []), ...(b.quality?.findings ?? [])]) baseline[f.ruleId] = f.value;
    const a: Action = { id: randomUUID(), board: req.params.board, recId, title: title ?? recId, status, owner, note: note ?? '', at: new Date().toISOString(), baseline };
    store.saveActions([...store.actions(), a]);
    return a;
  });

  // Post the digest headline to Teams. The Friday job does this for every board: `tsx src/cli.ts notify`.
  const lastNotify = new Map<string, number>();
  app.post<{ Params: { board: string } }>('/api/teams/:board/notify', async (req, reply) => {
    if (Date.now() - (lastNotify.get(req.params.board) ?? 0) < 60 * 1000) return reply.code(429).send({ error: 'Posted less than a minute ago' });
    lastNotify.set(req.params.board, Date.now());
    const r = await notifyBoard(req.params.board);
    if (r.reason === 'No scorecards') return reply.code(404).send({ error: 'No data' });
    return r;
  });

  app.get('/api/rules', async () =>
    rules.map(({ evaluate, ...r }) => r),
  );

  // One refresh at a time, at most every 5 minutes: each one calls every upstream API and uses their rate limits.
  let refreshing: Promise<unknown> | null = null, lastRefresh = 0;
  app.post('/api/refresh', async (_req, reply) => {
    if (refreshing) return reply.code(409).send({ error: 'A refresh is already running' });
    if (Date.now() - lastRefresh < 5 * 60 * 1000) return reply.code(429).send({ error: 'Refreshed less than 5 minutes ago' });
    refreshing = run();
    try { const cards = (await refreshing) as Awaited<ReturnType<typeof run>>; lastRefresh = Date.now(); return { scored: cards.length, mode: config.mode }; }
    finally { refreshing = null; }
  });

  // Cost to build each feature. Aggregates only: no per person cost. Rates are shown to people viewers only.
  app.get<{ Params: { board: string } }>('/api/teams/:board/costs', async (req, reply) => {
    const b = boardData(req.params.board);
    if (!b.sprints.length) return reply.code(404).send({ error: 'No sprints' });
    const { fteDay, contractorDay } = config.cost;
    if (!fteDay && !contractorDay) return { configured: false, reason: 'Set RATE_FTE_DAY and RATE_CONTRACTOR_DAY in .env' };
    const report = featureCosts({ sprints: b.sprints, epics: b.raw.epics, rates: costRates(), roster: rosterFor(req.params.board), weekend: config.weekend });
    return { configured: true, ...report,
      rates: namedFor(req as any) ? { fteDay, contractorDay, contractors: config.cost.contractors.length, overrides: Object.keys(config.cost.overrides).length } : null };
  });

  // Every day's scores, sprint scores kept beyond Jira's window, and cost over time.
  app.get<{ Params: { board: string }; Querystring: { days?: string } }>('/api/teams/:board/history', async (req) => {
    const days = Math.min(Math.max(Number(req.query.days) || 365, 1), 3650);
    return { board: req.params.board, ...history(req.params.board, days) };
  });

  // Claude seats, cost and usage. Team level for everyone; per person and "not using" only for people viewers.
  app.get<{ Params: { board: string } }>('/api/teams/:board/claude', async (req, reply) => {
    if (!store.scorecards().some((c) => c.board === req.params.board)) return reply.code(404).send({ error: 'No such board' });
    return { board: req.params.board, ...claudeReport(req.params.board, namedFor(req as any)) };
  });

  // The home page: every team's status, what needs attention, and whether the data is fresh. Team level only.
  app.get('/api/dashboard', async () => dashboard());

  // The simple dashboard: each team in plain English, four questions answered Yes / Partly / No. Team level only.
  app.get('/api/dashboard/simple', async () => simpleDashboard());

  // Checks on the collected data for setups that would make a correct formula give a wrong number.
  app.get('/api/data-quality', async () => dataQuality());

  // The four DORA metrics: headline, change on the previous period, DORA tier, and a daily series. One team or all.
  app.get<{ Querystring: { team?: string; days?: string } }>('/api/dora', async (req, reply) => {
    const team = req.query.team ?? 'all', days = Number(req.query.days ?? 30);
    if (!(PERIODS as readonly number[]).includes(days)) return reply.code(400).send({ error: `days must be one of ${PERIODS.join(', ')}` });
    if (team !== 'all' && !store.scorecards().some((c) => c.board === team)) return reply.code(404).send({ error: 'No such team' });
    return doraSeries(team, days as (typeof PERIODS)[number]);
  });

  // Filters shared by every report: team (or all) and period. Returns null after replying with the error.
  const filters = (q: { team?: string; days?: string }, reply: any): { team: string; days: Period } | null => {
    const team = q.team ?? 'all', days = Number(q.days ?? 30);
    if (!(PERIODS as readonly number[]).includes(days)) { reply.code(400).send({ error: `days must be one of ${PERIODS.join(', ')}` }); return null; }
    if (team !== 'all' && !store.scorecards().some((c) => c.board === team)) { reply.code(404).send({ error: 'No such team' }); return null; }
    return { team, days: days as Period };
  };
  // Quality, Predictability and Efficiency reports: grouped measures with counts and targets, plus the same
  // measures per team so the report can show a team scorecard. Team level only.
  for (const [name, fn] of [['quality', quality], ['predictability', predictability], ['efficiency', efficiency]] as const) {
    app.get<{ Querystring: { team?: string; days?: string } }>(`/api/reports/${name}`, async (req, reply) => {
      const f = filters(req.query, reply); if (!f) return;
      const s = slice(f.team, f.days);
      return { report: name, team: f.team, days: f.days, from: new Date(s.from).toISOString().slice(0, 10), to: new Date(s.to - 1).toISOString().slice(0, 10),
        ...withPrevious(f.team, f.days, fn), teams: perTeam(f.team, f.days, (x) => ({ measures: flatMeasures(fn(x)).map(({ failing, how, ...m }) => m) })) };
    });
  }

  // The sprint in progress, per team: days and points left, outlook, burndown, work in flight. Assignees only for people viewers.
  app.get<{ Querystring: { team?: string; sprint?: string } }>('/api/sprints/current', async (req, reply) => {
    const team = req.query.team ?? 'all';
    const sprintId = req.query.sprint != null ? Number(req.query.sprint) : undefined;
    if (sprintId != null && !Number.isInteger(sprintId)) return reply.code(400).send({ error: 'sprint must be a sprint id' });
    if (team === 'all') return currentSprints(namedFor(req as any));
    if (!store.scorecards().some((c) => c.board === team)) return reply.code(404).send({ error: 'No such team' });
    return currentSprint(team, namedFor(req as any), Date.now(), sprintId) ?? reply.code(404).send({ error: sprintId != null ? 'No such sprint' : 'No sprint in progress' });
  });

  // One team on one card, for the IDP. Team level only: safe for any signed in user or API token.
  app.get<{ Params: { board: string } }>('/api/teams/:board/summary', async (req, reply) => {
    const s = teamSummary(req.params.board);
    return s ?? reply.code(404).send({ error: `No scorecards for ${req.params.board}` });
  });

  // The API contract, for the IDP and anyone else integrating.
  app.get('/api/openapi.json', async () => openapi(buildInfo().version));

  // What every metric means, why it matters and how it is calculated. Powers the "What is this?" links and the Metrics page.
  app.get('/api/metrics', async () => metricCatalogue());

  app.get('/api/health', async () => ({ ok: true }));

  // Which build is running: CI run number, commit, and when it was built. Shown in the UI footer.
  const build = buildInfo();
  app.get('/api/version', async () => build);

    return app;
}
