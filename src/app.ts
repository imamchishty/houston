import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { run } from './pipeline.js';
import { buildInfo } from './version.js';
import { dashboard } from './dashboard.js';
import { dataQuality } from './dataQuality.js';
import { monthlyReport, monthlyMarkdown, monthOf } from './monthly.js';
import { PERIODS, type Period } from './reports.js';
import { boards, performance, HEADLINES } from './performance.js';
import { weeklyNote } from './note.js';
import { polish } from './polish.js';
import { ask, chatSettings } from './chat.js';
import { currentSprint, currentSprints } from './sprintNow.js';
import { openapi } from './openapi.js';
import { metricCatalogue } from './metrics.js';
import { history } from './store/history.js';
import { timingSafeEqual, createHash } from 'node:crypto';
import { allTeams, applySavedTeams, deleteTeam, normalise, problems, saveTeam, savedTeams } from './admin/teamSetup.js';
import { checkConnections, testTeam, type Check } from './admin/connections.js';
import { testReport } from './admin/testReport.js';
import { allocation } from './admin/allocation.js';
import { applySavedSettings, currentSettings, normaliseSettings, resetSettings, saveSettings, settingsProblems } from './admin/settings.js';
import { adminLog, logAdmin } from './store/history.js';

const here = dirname(fileURLToPath(import.meta.url));

// People sign in with basic auth. Machines (the IDP, Backstage, reporting) use read-only API tokens:
// HOUSTON_API_TOKENS=backstage:<token>,reporting:<token>. A token is team level only, unless its name is a people viewer.
export interface AuthOptions { user: string; pass: string; viewers: string[]; tokens?: { name: string; token: string }[]; admin?: { user: string; pass: string } }
export const parseTokens = (v: string | undefined) => (v ?? '').split(',').map((x) => x.trim()).filter((x) => x.includes(':'))
  .map((x) => { const i = x.indexOf(':'); return { name: x.slice(0, i).trim(), token: x.slice(i + 1).trim() }; });
export const authFromEnv = (): AuthOptions => ({
  user: process.env.HOUSTON_USER ?? '', pass: process.env.HOUSTON_PASSWORD ?? '',
  viewers: (process.env.HOUSTON_PEOPLE_VIEWERS ?? '').split(',').map((x) => x.trim()).filter(Boolean),
  tokens: parseTokens(process.env.HOUSTON_API_TOKENS),
  admin: { user: process.env.HOUSTON_ADMIN_USER ?? '', pass: process.env.HOUSTON_ADMIN_PASSWORD ?? '' },
});

// The admin account. Its password is never in the code: HOUSTON_ADMIN_USER and HOUSTON_ADMIN_PASSWORD, from .env
// locally and Key Vault when live. A weak password is allowed in demo mode (with a warning on the admin page) and
// turns the admin section off anywhere else; the rest of Houston keeps working.
const COMMON = new Set(['password', 'password1', 'password123', 'admin', 'admin123', 'admin1234', 'admin12345', 'administrator', 'changeme', 'letmein', 'welcome', 'welcome1', 'qwerty', 'qwerty123', '123456', '12345678', '123456789', 'houston', 'houston123', 'p@ssw0rd', 'passw0rd']);
export function weakPassword(user: string, pass: string) {
  const p = pass.toLowerCase();
  return pass.length < 14 || COMMON.has(p) || (!!user && p.includes(user.toLowerCase())) || /^(.)\1+$/.test(pass) || new Set(pass).size < 6;
}
export function adminState(a: AuthOptions['admin']): { enabled: boolean; weak: boolean; reason: string } {
  if (!a?.user || !a.pass) return { enabled: false, weak: false, reason: 'The admin section is off: HOUSTON_ADMIN_USER and HOUSTON_ADMIN_PASSWORD are not set.' };
  const weak = weakPassword(a.user, a.pass);
  if (weak && config.mode !== 'demo') return { enabled: false, weak, reason: 'The admin section is off: HOUSTON_ADMIN_PASSWORD is too weak for live use. Use at least 14 characters, not a common password and not containing the user name.' };
  return { enabled: true, weak, reason: '' };
}

// The whole HTTP app, without listening. index.ts serves it; the BDD suite drives it with inject().
// Throttles and lockouts live inside, so every instance starts clean.
export function buildApp(opts: { auth?: AuthOptions; logger?: boolean } = {}) {
  // Small bodies only: the one POST with a body is an action log entry.
  const app = Fastify({ logger: opts.logger ?? true, bodyLimit: 16 * 1024 });
  applySavedTeams(); // teams set up in the admin page
  applySavedSettings(); // and SLAs and the working week
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
    // The admin section: always its own sign-in, even when the rest of Houston is open (demo mode without a password).
    if ((req.routeOptions.url ?? '').startsWith('/api/admin/')) {
      const st = adminState(auth.admin);
      if (!st.enabled) return reply.code(403).send({ error: st.reason });
      if (locked(req.ip)) return reply.code(429).send({ error: 'Too many failed sign-ins, try again later' });
      const h = req.headers.authorization ?? '';
      const dec = /^Basic /i.test(h) ? Buffer.from(h.slice(6), 'base64').toString() : '', k = dec.indexOf(':');
      if (k < 0 || !same(dec.slice(0, k), auth.admin!.user) || !same(dec.slice(k + 1), auth.admin!.pass)) {
        if (h) failed(req.ip);
        return reply.code(401).header('WWW-Authenticate', 'Basic realm="Houston admin"').send({ error: 'Admin sign-in required' });
      }
      failures.delete(req.ip);
      (req as any).houstonUser = auth.admin!.user; (req as any).houstonAdmin = true;
      return;
    }
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
      (req as any).houstonUser = match;
      return;
    }
    const decoded = Buffer.from(hdr.replace(/^Basic /, ''), 'base64').toString();
    const i = decoded.indexOf(':');
    const u = decoded.slice(0, i), p = decoded.slice(i + 1); // passwords may contain ':'
    const isAdmin = i >= 0 && adminState(auth.admin).enabled && same(u, auth.admin!.user) && same(p, auth.admin!.pass);
    if (i < 0 || (!isAdmin && (!same(u, auth.user) || !same(p, auth.pass)))) {
      if (hdr) failed(req.ip);
      return reply.code(401).header('WWW-Authenticate', 'Basic realm="Houston"').send('Sign in');
    }
    failures.delete(req.ip);
    (req as any).houstonUser = u;
  });

  // Constant time compare of fixed length digests: reveals neither content nor length.
  const digest = (s: string) => createHash('sha256').update(s).digest();
  const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));
  function canSeePeople(user: string | undefined) {
    if (!auth.pass || !auth.viewers.length) return true; // no auth, or no viewer list: everyone signed in may see names
    return !!user && auth.viewers.includes(user);
  }
  const namedFor = (req: { houstonUser?: string }) => canSeePeople(req.houstonUser);

  const known = (team: string) => team === 'all' || boards().includes(team);
  const period = (v: unknown): Period | null => { const d = Number(v ?? 30); return (PERIODS as readonly number[]).includes(d) ? (d as Period) : null; };

  // Every team: its score and one plain sentence. What the IDP lists.
  app.get('/api/teams', async () => boards().map((board) => { const p = performance(board, 30); return { board, score: p.score, summary: p.summary }; }));

  // How one team (or "all") is performing: the 10 headline measures in five areas with their drill-down, the score
  // (share of headline targets met) and its trend, and missed targets worst first. Team level only.
  app.get<{ Params: { board: string }; Querystring: { days?: string } }>('/api/teams/:board', async (req, reply) => {
    const days = period(req.query.days);
    if (!days) return reply.code(400).send({ error: `days must be one of ${PERIODS.join(', ')}` });
    if (!known(req.params.board)) return reply.code(404).send({ error: 'No such team' });
    return performance(req.params.board, days);
  });

  // The weekly note: what changed, why, and what is likely next, in plain English. The same text the Friday post sends.
  app.get<{ Params: { board: string } }>('/api/teams/:board/note', async (req, reply) => {
    if (!known(req.params.board)) return reply.code(404).send({ error: 'No such team' });
    const n = weeklyNote(req.params.board);
    if (!n) return reply.code(404).send({ error: 'Nothing to judge yet' });
    const { lines, polished } = await polish(n);
    return { ...n, lines, polished, rules: polished ? n.lines : undefined };
  });

  // Ask Houston: a question about a team or all teams, answered from Houston's numbers via Compass. People only
  // (API tokens cannot POST); at most 30 questions an hour from one address, since each one calls Compass twice.
  const asked = new Map<string, number[]>();
  app.get('/api/chat', async () => chatSettings());
  app.post<{ Body: { question?: unknown; team?: unknown } }>('/api/chat', async (req, reply) => {
    if (!chatSettings().enabled) return reply.code(503).send({ error: 'Ask Houston is off: set COMPASS_URL and COMPASS_KEY' });
    const q = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    if (!q || q.length > 500) return reply.code(400).send({ error: 'question: 1 to 500 characters' });
    const scope = typeof req.body?.team === 'string' && known(req.body.team) ? req.body.team : 'all';
    const now = Date.now(), recent = (asked.get(req.ip) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= 30) return reply.code(429).send({ error: 'Too many questions in an hour, try again later' });
    asked.set(req.ip, [...recent, now]); if (asked.size > 10_000) asked.clear();
    return ask(q, scope);
  });

  // The score and headline measures by day, for trends. Kept across deploys in the history database.
  app.get<{ Params: { board: string }; Querystring: { days?: string } }>('/api/teams/:board/history', async (req, reply) => {
    if (!known(req.params.board)) return reply.code(404).send({ error: 'No such team' });
    const days = Math.min(Math.max(Number(req.query.days) || 365, 1), 3650);
    return { board: req.params.board, ...history(req.params.board, ['score', ...HEADLINES.map((h) => `r:${h}`)], days) };
  });

  // One refresh at a time, at most every 5 minutes: each one calls every upstream API and uses their rate limits.
  let refreshing: Promise<unknown> | null = null, lastRefresh = 0;
  app.post('/api/refresh', async (_req, reply) => {
    if (refreshing) return reply.code(409).send({ error: 'A refresh is already running' });
    if (Date.now() - lastRefresh < 5 * 60 * 1000) return reply.code(429).send({ error: 'Refreshed less than 5 minutes ago' });
    refreshing = run();
    try { await refreshing; lastRefresh = Date.now(); return { refreshed: true, mode: config.mode }; }
    finally { refreshing = null; }
  });

  // The home page: every team on the headline measures, worst first, and what needs attention. Team level only.
  app.get('/api/dashboard', async () => dashboard());

  // The monthly report: one calendar month for a team or all, against the month before, with six months of trend.
  const monthFilter = (q: { team?: string; month?: string }, reply: any) => {
    const team = q.team ?? 'all', month = q.month ?? monthOf(Date.now());
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { reply.code(400).send({ error: 'month must be YYYY-MM' }); return null; }
    if (!known(team)) { reply.code(404).send({ error: 'No such team' }); return null; }
    return { team, month };
  };
  app.get<{ Querystring: { team?: string; month?: string } }>('/api/monthly', async (req, reply) => {
    const f = monthFilter(req.query, reply); if (!f) return;
    return monthlyReport(f.team, f.month);
  });
  app.get<{ Querystring: { team?: string; month?: string } }>('/api/monthly.md', async (req, reply) => {
    const f = monthFilter(req.query, reply); if (!f) return;
    reply.type('text/markdown').send(monthlyMarkdown(monthlyReport(f.team, f.month)));
  });

  // Checks on the collected data: setups that would make a correct formula give a wrong number, and data hygiene.
  app.get('/api/data-quality', async () => dataQuality());

  // The sprint in progress, per team: days and points left, outlook, burndown, work in flight. Assignees only for people viewers.
  app.get<{ Querystring: { team?: string; sprint?: string } }>('/api/sprints/current', async (req, reply) => {
    const team = req.query.team ?? 'all';
    const sprintId = req.query.sprint != null ? Number(req.query.sprint) : undefined;
    if (sprintId != null && !Number.isInteger(sprintId)) return reply.code(400).send({ error: 'sprint must be a sprint id' });
    if (team === 'all') return currentSprints(namedFor(req as any));
    if (!known(team)) return reply.code(404).send({ error: 'No such team' });
    return currentSprint(team, namedFor(req as any), Date.now(), sprintId) ?? reply.code(404).send({ error: sprintId != null ? 'No such sprint' : 'No sprint in progress' });
  });

  // The API contract, for the IDP and anyone else integrating.
  app.get('/api/openapi.json', async () => openapi(buildInfo().version));

  // What every metric means, why it matters and how it is calculated. Powers the "What is this?" links and the Metrics page.
  app.get('/api/metrics', async () => metricCatalogue());

  app.get('/api/health', async () => ({ ok: true }));

  // Which build is running: CI run number, commit, and when it was built. Shown in the UI footer.
  const build = buildInfo();
  app.get('/api/version', async () => build);

  // ---------- Admin ----------
  // Only the admin account reaches these (see the onRequest hook). Token values are never read out or accepted here:
  // tokens stay in Key Vault, and the admin page shows only whether each connection works.
  const who = (req: unknown) => (req as { houstonUser?: string }).houstonUser ?? 'admin';
  let lastCheck: { checkedAt: string; checks: Check[] } | null = null;
  app.get('/api/admin/status', async (req) => ({ user: who(req), weakPassword: adminState(auth.admin).weak, mode: config.mode, teams: allTeams().length, savedTeams: savedTeams().length }));
  app.get('/api/admin/tests', async () => testReport());
  app.get('/api/admin/connections', async () => lastCheck ?? { checkedAt: null, checks: [] });
  app.post('/api/admin/connections/check', async (req) => {
    lastCheck = { checkedAt: new Date().toISOString(), checks: await checkConnections() };
    logAdmin(who(req), 'connections checked', lastCheck.checks.map((c) => ({ source: c.source, ok: c.ok })));
    return lastCheck;
  });
  app.get('/api/admin/teams', async () => allTeams());
  app.post('/api/admin/teams/test', async (req, reply) => {
    const t = normalise(req.body), p = problems(t);
    if (p.length) return reply.code(400).send({ error: 'Fix these first', problems: p });
    return { checks: await testTeam(t) };
  });
  app.post('/api/admin/teams', async (req, reply) => {
    const t = normalise(req.body), p = problems(t);
    if (p.length) return reply.code(400).send({ error: 'Not saved', problems: p });
    const before = allTeams().find((x) => x.name === t.name) ?? null;
    const saved = saveTeam(t, who(req));
    logAdmin(who(req), before ? 'team changed' : 'team added', { name: t.name, before: before && { ...before, source: undefined }, after: t });
    return saved;
  });
  app.delete<{ Params: { name: string } }>('/api/admin/teams/:name', async (req, reply) => {
    const before = savedTeams().find((x) => x.name === req.params.name);
    if (!before || !deleteTeam(req.params.name)) return reply.code(404).send({ error: 'No team set up in the admin page with that name' });
    logAdmin(who(req), 'team removed', { name: req.params.name, before });
    return { removed: req.params.name, restoredFromEnv: allTeams().some((x) => x.name === req.params.name) };
  });
  // Support SLAs per priority, the working week, and how support tickets are found. Applied at once, logged.
  app.get('/api/admin/settings', async () => currentSettings());
  app.post('/api/admin/settings', async (req, reply) => {
    const s = normaliseSettings(req.body), p = settingsProblems(s);
    if (p.length) return reply.code(400).send({ error: 'Not saved', problems: p });
    const before = currentSettings().settings;
    saveSettings(s);
    logAdmin(who(req), 'settings changed', { name: 'settings', before, after: s });
    return currentSettings();
  });
  app.delete('/api/admin/settings', async (req) => {
    resetSettings();
    logAdmin(who(req), 'settings reset to .env', { name: 'settings' });
    return currentSettings();
  });
  // Allocation, admin only: who is working on what, what has stopped moving, what finished against the team's normal,
  // and the sprint's rough person-days. Traces, never effort or output totals; every row is a ticket to ask about.
  app.get<{ Params: { board: string } }>('/api/admin/allocation/:board', async (req, reply) => {
    if (req.params.board === 'all' || !known(req.params.board)) return reply.code(404).send({ error: 'No such team' });
    return allocation(req.params.board) ?? reply.code(404).send({ error: 'No sprints for this team' });
  });
  app.get('/api/admin/log', async () => adminLog());

    return app;
}
