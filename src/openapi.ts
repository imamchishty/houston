// OpenAPI 3.1 description of Houston's API, served at /api/openapi.json.
// Backstage, the IDP, or any client can generate a typed client from it. A BDD scenario fails if a route
// is served but missing here, or documented but not served.

const board = { name: 'board', in: 'path', required: true, description: 'Team (Jira board) name, e.g. OSSI', schema: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,31}$' } };
const json = (description: string, schema: object = { type: 'object' }) => ({ description, content: { 'application/json': { schema } } });
const notFound = { 404: json('No data for this team') };
const adminOnly = [{ admin: [] }];
const adminResponses = (what: string) => ({ 200: json(what), 401: json('Admin sign-in required'), 403: json('Admin section off: no admin account, or a weak password outside demo mode') });
const TeamInput = { type: 'object', required: ['name', 'jiraBoardId', 'jiraProject'], properties: {
  name: { type: 'string' }, jiraBoardId: { type: 'integer' }, jiraProject: { type: 'string' }, repos: { type: 'array', items: { type: 'string' } },
  sonarProject: { type: 'string' }, testmoProject: { type: 'string' }, resourceGroup: { type: 'string' }, appInsights: { type: 'string' },
  confluenceSpaces: { type: 'array', items: { type: 'string' } }, roster: { type: 'array', items: { type: 'string' } } } };
const peopleOnly = 'Per person data. Needs a people viewer (HOUSTON_PEOPLE_VIEWERS); others get 403.';

const Rag = { type: 'string', enum: ['green', 'amber', 'red'] };
const Band = { type: 'string', enum: ['Healthy', 'Watch', 'Needs attention'] };
const Finding = {
  type: 'object', required: ['ruleId', 'title', 'value', 'unit', 'rag', 'message', 'action', 'evidence'],
  properties: {
    ruleId: { type: 'string' }, title: { type: 'string' }, area: { type: 'string' }, value: { type: 'number' },
    unit: { type: 'string', enum: ['%', 'count', 'days', 'ratio'] }, rag: Rag, message: { type: 'string' }, action: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } }, weight: { type: 'number' },
  },
};
const Summary = {
  type: 'object',
  properties: {
    board: { type: 'string' }, sprint: { type: 'string' }, score: { type: 'number' }, band: Band, change: { type: 'number' },
    areas: { type: 'array', items: { type: 'object', properties: { area: { type: 'string' }, name: { type: 'string' }, score: { type: 'number' }, band: Band } } },
    dora: { type: 'array', items: { type: 'object', properties: { metric: { type: 'string' }, title: { type: 'string' }, value: { type: 'number' }, unit: { type: 'string' }, tier: { type: 'string', enum: ['Elite', 'High', 'Medium', 'Low'] } } } },
    gains: { type: 'array', items: { type: 'object', properties: { metric: { type: 'string' }, title: { type: 'string' }, area: { type: 'string' }, gain: { type: 'number' } } } },
    headcountGateOpen: { type: 'boolean' },
    claude: { type: ['object', 'null'], properties: { seats: { type: 'number' }, seatCostMonthly: { type: 'number' }, adoptionPct: { type: ['number', 'null'] }, acceptanceRate: { type: ['number', 'null'] } } },
    cost: { type: ['object', 'null'], properties: { currency: { type: 'string' }, sprints: { type: 'number' }, teamCost: { type: 'number' }, aiCost: { type: 'number' }, onFeaturesPct: { type: 'number' }, costPerPoint: { type: ['number', 'null'] } } },
    links: { type: 'object', properties: { ui: { type: 'string' }, digest: { type: 'string' }, api: { type: 'string' } } },
  },
};

export const openapi = (version: string) => ({
  openapi: '3.1.0',
  info: {
    title: 'Houston API', version,
    description: 'Engineering health for each team: scores, findings, recommendations, cost to build features, and history. '
      + 'People sign in with basic auth; machines use a read-only bearer token from HOUSTON_API_TOKENS. '
      + 'Every POST needs the header X-Requested-With: houston, and API tokens cannot POST.',
  },
  security: [{ basic: [] }, { bearer: [] }],
  components: {
    securitySchemes: {
      basic: { type: 'http', scheme: 'basic', description: 'HOUSTON_USER and HOUSTON_PASSWORD' },
      admin: { type: 'http', scheme: 'basic', description: 'HOUSTON_ADMIN_USER and HOUSTON_ADMIN_PASSWORD. Only for /api/admin/*; API tokens are refused there.' },
      bearer: { type: 'http', scheme: 'bearer', description: 'Read-only API token from HOUSTON_API_TOKENS. Team level only unless the token name is a people viewer.' },
    },
    schemas: { Finding, Summary, Rag, Band },
  },
  paths: {
    '/api/dashboard': { get: { summary: 'Home page status: counts by band, data freshness, every team at a glance, and the biggest gains across teams. Team level only', responses: { 200: json('Dashboard') } } },
    '/api/dora': { get: { summary: 'The four DORA metrics for one team or all: headline value, previous period, DORA tier, explanation and a daily series with a 7 day average',
      parameters: [{ name: 'team', in: 'query', schema: { type: 'string', default: 'all' } }, { name: 'days', in: 'query', schema: { type: 'integer', enum: [7, 30, 90], default: 30 } }],
      responses: { 200: json('DORA metrics'), 400: json('Invalid period'), 404: json('No such team') } } },
    '/api/reports/dora': { get: { summary: 'DORA: deployment frequency, lead time, change failure rate, time to restore, and lead time by stage. Counts, targets and failing items, and the same per team', parameters: [{ name: 'team', in: 'query', schema: { type: 'string', default: 'all' } }, { name: 'days', in: 'query', schema: { type: 'integer', enum: [7, 30, 90], default: 30 } }], responses: { 200: json('Report'), 400: json('Invalid period'), 404: json('No such team') } } },
    '/api/reports/flow': { get: { summary: 'Flow: the Flow Framework (velocity, time, efficiency, load, distribution), where work waits, cycle time and pull request flow', parameters: [{ name: 'team', in: 'query', schema: { type: 'string', default: 'all' } }, { name: 'days', in: 'query', schema: { type: 'integer', enum: [7, 30, 90], default: 30 } }], responses: { 200: json('Report'), 400: json('Invalid period'), 404: json('No such team') } } },
    '/api/reports/quality': { get: { summary: 'Quality: bugs per change, defect leakage, prevention (reviews, QA rejection), code quality (Sonar, Testmo), bug fixing and workload, reverts', parameters: [{ name: 'team', in: 'query', schema: { type: 'string', default: 'all' } }, { name: 'days', in: 'query', schema: { type: 'integer', enum: [7, 30, 90], default: 30 } }], responses: { 200: json('Report'), 400: json('Invalid period'), 404: json('No such team') } } },
    '/api/reports/security': { get: { summary: 'Security: critical and high alerts fixed on time, time to fix, overdue and open alerts, leaked secrets, SonarQube vulnerabilities, and scanning coverage per repo', parameters: [{ name: 'team', in: 'query', schema: { type: 'string', default: 'all' } }, { name: 'days', in: 'query', schema: { type: 'integer', enum: [7, 30, 90], default: 30 } }], responses: { 200: json('Report'), 400: json('Invalid period'), 404: json('No such team') } } },
    '/api/reports/planning': { get: { summary: 'Planning: sprint completion, unplanned work, scope added, code traceability and ticket hygiene', parameters: [{ name: 'team', in: 'query', schema: { type: 'string', default: 'all' } }, { name: 'days', in: 'query', schema: { type: 'integer', enum: [7, 30, 90], default: 30 } }], responses: { 200: json('Report'), 400: json('Invalid period'), 404: json('No such team') } } },
    '/api/sprints/current': { get: { summary: 'The sprint in progress per team: working days and points left, outlook, burndown, status breakdown, work in progress, cycle time, velocity. Assignees for people viewers only', parameters: [{ name: 'team', in: 'query', schema: { type: 'string', default: 'all' } }, { name: 'sprint', in: 'query', description: 'A past sprint id (needs team)', schema: { type: 'integer' } }], responses: { 200: json('Current sprints'), 400: json('Invalid sprint'), 404: json('No such team, or no sprint') } } },
    '/api/dashboard/simple': { get: { summary: 'Each team in plain English: four questions (delivering what it promised, sprint on track, quality, speed) answered Yes / Partly / No / Not enough data, what to fix first, and what keeps getting worse. Team level only', responses: { 200: json('Simple dashboard', { type: 'array', items: { type: 'object' } }) } } },
    '/api/monthly': { get: { summary: 'Monthly report: key numbers for one calendar month against the month before, what improved and got worse, six months of trend, sprints closed, features shipped, incidents. Team level only',
      parameters: [{ name: 'team', in: 'query', schema: { type: 'string', default: 'all' } }, { name: 'month', in: 'query', description: 'YYYY-MM, default this month', schema: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' } }],
      responses: { 200: json('Monthly report'), 400: json('Invalid month'), 404: json('No such team') } } },
    '/api/monthly.md': { get: { summary: 'The monthly report as Markdown, for Confluence or email', parameters: [{ name: 'team', in: 'query', schema: { type: 'string', default: 'all' } }, { name: 'month', in: 'query', schema: { type: 'string' } }],
      responses: { 200: { description: 'Markdown', content: { 'text/markdown': { schema: { type: 'string' } } } }, 400: json('Invalid month'), 404: json('No such team') } } },
    '/api/data-quality': { get: { summary: 'Checks on the collected data: field ids that match nothing, a deploy workflow with no runs, bot review share, hotfix naming, unresolved alerts. Each says which measures it affects', responses: { 200: json('Data checks', { type: 'array', items: { type: 'object' } }) } } },
    '/api/teams': { get: { summary: 'Every team: latest score, trend and top gaps', responses: { 200: json('Teams', { type: 'array', items: { type: 'object' } }) } } },
    '/api/teams/{board}': { get: { summary: 'Everything about one team: scorecards, areas, window, output, incidents', parameters: [board], responses: { 200: json('Team'), ...notFound } } },
    '/api/teams/{board}/summary': { get: { summary: 'One team on one card, for an IDP. Team level only', parameters: [board], responses: { 200: json('Summary', { $ref: '#/components/schemas/Summary' }), ...notFound } } },
    '/api/teams/{board}/digest.md': { get: { summary: 'Markdown retro digest. No names unless ?named=1 and a people viewer', parameters: [board, { name: 'named', in: 'query', schema: { type: 'string', enum: ['1'] } }],
      responses: { 200: { description: 'Markdown', content: { 'text/markdown': { schema: { type: 'string' } } } }, ...notFound } } },
    '/api/teams/{board}/recommendations': { get: { summary: 'Ranked recommendations and the headcount gate. Names only for people viewers', parameters: [board], responses: { 200: json('Recommendations'), ...notFound } } },
    '/api/teams/{board}/people': { get: { summary: 'Per person Jira, GitHub, Confluence and activity stats', description: peopleOnly, parameters: [board], responses: { 200: json('People'), 403: json('Not a people viewer'), ...notFound } } },
    '/api/teams/{board}/evidence/{ruleId}': { get: { summary: 'The raw records behind one finding. Assignees and authors only for people viewers', parameters: [board, { name: 'ruleId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: json('Evidence'), 404: json('No such finding') } } },
    '/api/teams/{board}/actions': {
      get: { summary: 'Action log, with how each number has moved since', parameters: [board], responses: { 200: json('Actions', { type: 'array', items: { type: 'object' } }) } },
      post: { summary: 'Record accepting, rejecting or finishing a recommendation', parameters: [board],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['recId', 'status', 'owner'], properties: {
          recId: { type: 'string', pattern: '^[\\w-]{1,64}$' }, title: { type: 'string', maxLength: 200 }, status: { type: 'string', enum: ['accepted', 'rejected', 'done'] },
          owner: { type: 'string', minLength: 1, maxLength: 100 }, note: { type: 'string', maxLength: 2000 } } } } } },
        responses: { 200: json('Recorded'), 400: json('Invalid'), 403: json('Missing X-Requested-With header, or an API token'), ...notFound } },
    },
    '/api/teams/{board}/costs': { get: { summary: 'Cost to build each feature, FTE and contractor, and estimate to complete. Aggregates only; day rates for people viewers', parameters: [board], responses: { 200: json('Costs'), ...notFound } } },
    '/api/teams/{board}/claude': { get: { summary: 'Claude seats, seat cost, adoption and Claude Code usage. Per person and who is not using it only for people viewers', parameters: [board], responses: { 200: json('Claude usage'), ...notFound } } },
    '/api/teams/{board}/history': { get: { summary: 'Daily area scores, every sprint scored, and cost over time', parameters: [board, { name: 'days', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 3650, default: 365 } }], responses: { 200: json('History') } } },
    '/api/teams/{board}/notify': { post: { summary: 'Post the digest headline to Teams now', parameters: [board], responses: { 200: json('Result'), 429: json('Posted less than a minute ago'), ...notFound } } },
    '/api/rules': { get: { summary: 'Sprint rules, thresholds and weights', responses: { 200: json('Rules', { type: 'array', items: { type: 'object' } }) } } },
    '/api/metrics': { get: { summary: 'Every metric: why it matters, how it is calculated, thresholds, DORA bands', responses: { 200: json('Metrics', { type: 'array', items: { type: 'object' } }) } } },
    '/api/refresh': { post: { summary: 'Collect and score now. One at a time, at most every 5 minutes', responses: { 200: json('Scored'), 409: json('Already running'), 429: json('Too soon') } } },
    '/api/health': { get: { summary: 'Liveness. No sign in needed', security: [], responses: { 200: json('OK', { type: 'object', properties: { ok: { type: 'boolean' } } }) } } },
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
    '/api/admin/log': { get: { summary: 'Admin: what admins changed, who and when', security: adminOnly, responses: adminResponses('Change log') } },
    '/api/openapi.json': { get: { summary: 'This document', responses: { 200: json('OpenAPI document') } } },
  },
});
