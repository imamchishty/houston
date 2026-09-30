// OpenAPI 3.1 description of Houston's API, served at /api/openapi.json.
// Backstage, the IDP, or any client can generate a typed client from it. A BDD scenario fails if a route
// is served but missing here, or documented but not served.

const board = { name: 'board', in: 'path', required: true, description: 'Team (Jira board) name, e.g. OSSI, or "all" for every team together', schema: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,31}$' } };
const json = (description: string, schema: object = { type: 'object' }) => ({ description, content: { 'application/json': { schema } } });
const notFound = { 404: json('No such team') };
const adminOnly = [{ admin: [] }];
const adminResponses = (what: string) => ({ 200: json(what), 401: json('Admin sign-in required'), 403: json('Admin section off: no admin account, or a weak password outside demo mode') });
const TeamInput = { type: 'object', required: ['name', 'jiraBoardId', 'jiraProject'], properties: {
  name: { type: 'string' }, jiraBoardId: { type: 'integer' }, jiraProject: { type: 'string' }, supportProject: { type: 'string' }, repos: { type: 'array', items: { type: 'string' } },
  sonarProject: { type: 'string' }, testmoProject: { type: 'string' }, resourceGroup: { type: 'string' }, appInsights: { type: 'string' }, } };

const Measure = { type: 'object', required: ['id', 'title', 'value', 'unit', 'target', 'met'], properties: {
  id: { type: 'string' }, title: { type: 'string' }, value: { type: ['number', 'null'], description: 'null when there was nothing to measure (0 of 0 is not 0%)' },
  unit: { type: 'string', enum: ['%', 'days', 'hours', 'count'] }, num: { type: ['number', 'null'] }, den: { type: ['number', 'null'] },
  target: { type: ['object', 'null'], properties: { op: { type: 'string', enum: ['<', '>'] }, value: { type: 'number' } } }, met: { type: ['boolean', 'null'] },
  previous: { type: ['number', 'null'] }, trend: { type: ['string', 'null'], enum: ['better', 'worse', 'same', null] }, smallSample: { type: 'boolean' },
  how: { type: 'string' }, failing: { type: 'array', items: { type: 'string' } } } };
const Score = { type: 'object', properties: { met: { type: 'integer' }, of: { type: 'integer' }, pct: { type: ['integer', 'null'], description: 'Share of headline targets met' },
  previousPct: { type: ['integer', 'null'] }, trend: { type: ['string', 'null'] } } };
const Performance = { type: 'object', properties: {
  team: { type: 'string' }, days: { type: 'integer' }, from: { type: 'string' }, to: { type: 'string' }, score: Score, summary: { type: 'string' },
  missed: { type: 'array', items: { type: 'object' }, description: 'Headline targets missed, worst first' },
  areas: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, question: { type: 'string' },
    headlines: { type: 'array', items: { type: 'object', properties: { measure: Measure, missedTwice: { type: 'boolean' }, drill: { type: 'array', items: Measure }, extras: { type: 'object' } } } } } } } } };
const days = { name: 'days', in: 'query', schema: { type: 'integer', enum: [7, 30, 90], default: 30 } };
const team = { name: 'team', in: 'query', schema: { type: 'string', default: 'all' } };

export const openapi = (version: string) => ({
  openapi: '3.1.0',
  info: {
    title: 'Houston API', version,
    description: 'How each team is performing: 10 headline measures (speed, quality, stability and support, flow, security), the share of targets met, '
      + 'trends, drill-down and a monthly report. People sign in with basic auth; machines use a read-only bearer token from HOUSTON_API_TOKENS. '
      + 'Every POST needs the header X-Requested-With: houston, and API tokens cannot POST.',
  },
  security: [{ basic: [] }, { bearer: [] }],
  components: {
    securitySchemes: {
      basic: { type: 'http', scheme: 'basic', description: 'HOUSTON_USER and HOUSTON_PASSWORD' },
      admin: { type: 'http', scheme: 'basic', description: 'HOUSTON_ADMIN_USER and HOUSTON_ADMIN_PASSWORD. Only for /api/admin/*; API tokens are refused there.' },
      bearer: { type: 'http', scheme: 'bearer', description: 'Read-only API token from HOUSTON_API_TOKENS. Team level only.' },
    },
    schemas: { Measure, Score, Performance },
  },
  paths: {
    '/api/dashboard': { get: { summary: 'Every team on the 10 headline measures, alphabetical, with score, trend, a plain summary and what missed its target two periods running', responses: { 200: json('Dashboard') } } },
    '/api/teams': { get: { summary: 'Every team: score and a plain summary, last 30 days', responses: { 200: json('Teams') } } },
    '/api/teams/{board}': { get: { summary: 'How one team (or all) is performing: headline measures by area with drill-down, score and trend, missed targets worst first', parameters: [board, days], responses: { 200: json('Performance', Performance), 400: json('Invalid period'), ...notFound } } },
    '/api/chat': {
      get: { summary: 'Whether Ask Houston is on (needs Compass)', responses: { 200: json('Settings') } },
      post: { summary: 'Ask Houston a question about a team or all teams, answered from its own numbers via Compass. Questions about people are refused; every number in the answer is checked against the facts', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['question'], properties: { question: { type: 'string', maxLength: 500 }, team: { type: 'string', default: 'all' } } } } } }, responses: { 200: json('Answer'), 400: json('Bad question'), 429: json('Too many questions'), 503: json('Compass not configured') } },
    },
    '/api/teams/{board}/note': { get: { summary: 'The weekly note: what changed, why (the drill-down measure that moved with it), and what is likely next for the sprint in progress. Plain English, exact numbers, no names', parameters: [board], responses: { 200: json('Note'), ...notFound } } },
    '/api/teams/{board}/definitions': { get: { summary: 'Ready and Done over time: the Definition of Ready and Done in force, and per closed sprint the share of tickets started when ready and finished properly done, with what was missed most', parameters: [board], responses: { 200: json('Definitions'), ...notFound } } },
    '/api/teams/{board}/history': { get: { summary: 'Score and headline measures by day, kept across deploys', parameters: [board, { name: 'days', in: 'query', schema: { type: 'integer', default: 365 } }], responses: { 200: json('History'), ...notFound } } },
    '/api/monthly': { get: { summary: 'Monthly report: score and headline measures for one calendar month against the month before, six months of trend, and what was delivered', parameters: [team, { name: 'month', in: 'query', schema: { type: 'string', pattern: '^\\d{4}-\\d{2}$' } }], responses: { 200: json('Monthly report'), 400: json('Invalid month'), ...notFound } } },
    '/api/monthly.md': { get: { summary: 'The monthly report as Markdown', parameters: [team, { name: 'month', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Markdown', content: { 'text/markdown': {} } }, 400: json('Invalid month'), ...notFound } } },
    '/api/sprints/current': { get: { summary: 'The sprint in progress: days and points left, outlook, burndown. Assignees only for people viewers', parameters: [team, { name: 'sprint', in: 'query', schema: { type: 'integer' } }], responses: { 200: json('Sprint'), 400: json('Invalid sprint'), ...notFound } } },
    '/api/data-quality': { get: { summary: 'Checks on the collected data, and data hygiene (tickets estimated, PRs linked to tickets), that decide whether the numbers can be trusted', responses: { 200: json('Checks') } } },
    '/api/refresh': { post: { summary: 'Collect now (at most every 5 minutes)', responses: { 200: json('Refreshed'), 409: json('Already running'), 429: json('Too soon') } } },
    '/api/metrics': { get: { summary: 'What each measure means, why it matters, how it is calculated, its target, and which headline it explains', responses: { 200: json('Catalogue') } } },
    '/api/health': { get: { summary: 'Liveness, no sign-in needed', security: [], responses: { 200: json('OK') } } },
    '/api/version': { get: { summary: 'Build number, commit and build time', responses: { 200: json('Version') } } },
    '/api/admin/status': { get: { summary: 'Admin: who is signed in, and whether the admin password is weak (allowed in demo mode only)', security: adminOnly, responses: adminResponses('Status') } },
    '/api/admin/tests': { get: { summary: 'Admin: the test report shipped with this build (BDD scenarios by feature, unit tests, npm audit), and whether it matches the running build', security: adminOnly, responses: adminResponses('Test report') } },
    '/api/admin/connections': { get: { summary: 'Admin: the last connection check (never token values)', security: adminOnly, responses: adminResponses('Connection checks') } },
    '/api/admin/connections/check': { post: { summary: 'Admin: check every connection now: works or not, token expiry, missing permissions', security: adminOnly, responses: adminResponses('Connection checks') } },
    '/api/admin/teams': {
      get: { summary: 'Admin: every team and its setup, and whether it comes from the admin page, .env or demo data', security: adminOnly, responses: adminResponses('Teams') },
      post: { summary: 'Admin: add or change a team. Checked with the same rules as .env; logged', security: adminOnly, requestBody: { required: true, content: { 'application/json': { schema: TeamInput } } }, responses: { ...adminResponses('Saved team'), 400: json('Problems with the setup') } },
    },
    '/api/admin/teams/test': { post: { summary: 'Admin: test a team setup before saving: one read-only call per source, saying what was found', security: adminOnly, requestBody: { required: true, content: { 'application/json': { schema: TeamInput } } }, responses: { ...adminResponses('Checks'), 400: json('Problems with the setup') } } },
    '/api/admin/teams/{name}': { delete: { summary: 'Admin: remove a team set up in the admin page (a .env team of the same name comes back); logged', security: adminOnly, parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }], responses: { ...adminResponses('Removed'), 404: json('Not set up in the admin page') } } },
    '/api/admin/settings': {
      get: { summary: 'Admin: support SLAs per priority, the working week, how support tickets are found; where they come from (admin page or .env) and the priorities seen on tickets', security: adminOnly, responses: adminResponses('Settings') },
      post: { summary: 'Admin: change them. Checked with the same rules as .env, applied at once, logged', security: adminOnly, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { ...adminResponses('Settings'), 400: json('Problems') } },
      delete: { summary: 'Admin: go back to the .env values; logged', security: adminOnly, responses: adminResponses('Settings') },
    },
    '/api/admin/allocation/{board}': { get: { summary: 'Admin only: who is working on what now, items that have stopped moving, work finished against the team\'s own normal for its size, lanes worked in, last recorded trace, and the sprint\'s rough person-days and cost (RATE_DAY). Traces, not effort; no totals per person, no ranking', security: adminOnly, parameters: [board], responses: { ...adminResponses('Allocation'), 404: json('No such team') } } },
    '/api/admin/log': { get: { summary: 'Admin: what admins changed, who and when', security: adminOnly, responses: adminResponses('Change log') } },
    '/api/openapi.json': { get: { summary: 'This document', responses: { 200: json('OpenAPI document') } } },
  },
});
