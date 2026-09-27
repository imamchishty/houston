// OpenAPI 3.1 description of Houston's API, served at /api/openapi.json.
// Backstage, the IDP, or any client can generate a typed client from it. A BDD scenario fails if a route
// is served but missing here, or documented but not served.

const board = { name: 'board', in: 'path', required: true, description: 'Team (Jira board) name, e.g. OSSI', schema: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,31}$' } };
const json = (description: string, schema: object = { type: 'object' }) => ({ description, content: { 'application/json': { schema } } });
const notFound = { 404: json('No data for this team') };
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
      bearer: { type: 'http', scheme: 'bearer', description: 'Read-only API token from HOUSTON_API_TOKENS. Team level only unless the token name is a people viewer.' },
    },
    schemas: { Finding, Summary, Rag, Band },
  },
  paths: {
    '/api/dashboard': { get: { summary: 'Home page status: counts by band, data freshness, every team at a glance, and the biggest gains across teams. Team level only', responses: { 200: json('Dashboard') } } },
    '/api/dora': { get: { summary: 'The four DORA metrics for one team or all: headline value, previous period, DORA tier, explanation and a daily series with a 7 day average',
      parameters: [{ name: 'team', in: 'query', schema: { type: 'string', default: 'all' } }, { name: 'days', in: 'query', schema: { type: 'integer', enum: [7, 30, 90], default: 30 } }],
      responses: { 200: json('DORA metrics'), 400: json('Invalid period'), 404: json('No such team') } } },
    '/api/reports/quality': { get: { summary: 'Quality: bug creation, prevention, resolution, workload and code churn. Every rate with its counts, target and failing items, plus the same per team', parameters: [{ name: 'team', in: 'query', schema: { type: 'string', default: 'all' } }, { name: 'days', in: 'query', schema: { type: 'integer', enum: [7, 30, 90], default: 30 } }], responses: { 200: json('Quality report'), 400: json('Invalid period'), 404: json('No such team') } } },
    '/api/reports/predictability': { get: { summary: 'Predictability: sprint completion, scope added, code traceability and ticket hygiene, with counts, targets and failing items', parameters: [{ name: 'team', in: 'query', schema: { type: 'string', default: 'all' } }, { name: 'days', in: 'query', schema: { type: 'integer', enum: [7, 30, 90], default: 30 } }], responses: { 200: json('Predictability report'), 400: json('Invalid period'), 404: json('No such team') } } },
    '/api/reports/efficiency': { get: { summary: 'Efficiency: PR lead time, pickup, review time, PR size and cycle time, with targets', parameters: [{ name: 'team', in: 'query', schema: { type: 'string', default: 'all' } }, { name: 'days', in: 'query', schema: { type: 'integer', enum: [7, 30, 90], default: 30 } }], responses: { 200: json('Efficiency report'), 400: json('Invalid period'), 404: json('No such team') } } },
    '/api/sprints/current': { get: { summary: 'The sprint in progress per team: working days and points left, outlook, burndown, status breakdown, work in progress, cycle time, velocity. Assignees for people viewers only', parameters: [{ name: 'team', in: 'query', schema: { type: 'string', default: 'all' } }], responses: { 200: json('Current sprints'), 404: json('No such team, or no sprint in progress') } } },
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
    '/api/openapi.json': { get: { summary: 'This document', responses: { 200: json('OpenAPI document') } } },
  },
});
