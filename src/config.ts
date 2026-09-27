import 'dotenv/config';

const pairs = (v: string | undefined) =>
  (v ?? '').split(',').filter(Boolean).map((s) => { const [name, id] = s.split(':'); return { name: name.trim(), id: id.trim() }; });

const lanes = (v: string | undefined) =>
  (v ?? '').split(';').filter(Boolean).map((l) => { const [area, pats] = l.split('='); return { area: area.trim(), patterns: pats.split(',').map((x) => x.trim()) }; });

const demo = (process.env.HOUSTON_MODE ?? 'demo') === 'demo';

export const config = {
  window: { start: process.env.WINDOW_START ?? ((process.env.HOUSTON_MODE ?? 'demo') === 'demo' ? '2026-09-01' : ''), days: Number(process.env.WINDOW_DAYS ?? 90) },
  offshoreCost: pairs(process.env.OFFSHORE_MONTHLY_COST ?? ((process.env.HOUSTON_MODE ?? 'demo') === 'demo' ? 'OSSI:280000' : '')).map((p) => ({ name: p.name, aed: Number(p.id) })),
  azure: {
    tenant: process.env.AZURE_TENANT_ID ?? '', client: process.env.AZURE_CLIENT_ID ?? '', secret: process.env.AZURE_CLIENT_SECRET ?? '',
    subscription: process.env.AZURE_SUBSCRIPTION_ID ?? '', workspace: process.env.AZURE_LOG_WORKSPACE ?? '',
    appInsights: pairs(process.env.AZURE_APPINSIGHTS), resourceGroups: pairs(process.env.AZURE_RESOURCE_GROUPS),
    teamCost: pairs(process.env.TEAM_MONTHLY_COST ?? ((process.env.HOUSTON_MODE ?? 'demo') === 'demo' ? 'OSSI:850000,PLAT:520000' : '')).map((p) => ({ name: p.name, aed: Number(p.id) })),
  },
  teamsWebhook: process.env.TEAMS_WEBHOOK ?? '',
  // Feature cost. Loaded day rates: FTE = salary, benefits and overhead per working day; contractor = the day rate paid.
  cost: {
    currency: process.env.COST_CURRENCY ?? 'AED',
    fteDay: Number(process.env.RATE_FTE_DAY ?? (demo ? 2400 : 0)),
    contractorDay: Number(process.env.RATE_CONTRACTOR_DAY ?? (demo ? 1400 : 0)),
    contractors: (process.env.CONTRACTORS ?? (demo ? 'Rahul|Priya|Sam' : '')).split('|').map((x) => x.trim()).filter(Boolean),
    overrides: Object.fromEntries((process.env.RATE_OVERRIDES ?? '').split(';').filter((x) => x.includes('=')).map((x) => { const [n, r] = x.split('='); return [n.trim(), Number(r)]; })) as Record<string, number>,
  },
  // Claude on a seat plan (Team). Billed cost = seats x seat price. Usage comes from Claude Code's OpenTelemetry
  // metrics, exported to Application Insights (CLAUDE_USAGE.md). CLAUDE_SEATS lists seat holders; empty = everyone on the roster.
  claude: {
    seatMonthly: Number(process.env.CLAUDE_SEAT_MONTHLY ?? (demo ? 550 : 0)),   // in COST_CURRENCY
    seats: (process.env.CLAUDE_SEATS ?? '').split('|').map((x) => x.trim()).filter(Boolean),
    appInsights: process.env.CLAUDE_OTEL_APPINSIGHTS ?? '',                      // App Insights app id receiving the metrics
    days: Number(process.env.CLAUDE_DAYS ?? 30),
    usdRate: Number(process.env.USD_TO_CURRENCY ?? 3.6725),                     // for the API-equivalent value
  },
  // Working week. UAE: Saturday and Sunday off since 2022.
  weekend: (process.env.WEEKEND ?? 'sat,sun').split(',').map((d) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(d.trim().toLowerCase())),
  publicUrl: (process.env.HOUSTON_URL ?? '').replace(/\/+$/, ''), // how people reach Houston, for links in Teams posts
  confluence: {
    spaces: (process.env.CONFLUENCE_SPACES ?? '').split(',').filter(Boolean).map((s) => { const [name, list] = s.split(':'); return { name: name.trim(), spaces: list.split('|').map((x) => x.trim()) }; }),
    adr: (process.env.CONFLUENCE_ADR_MARKERS ?? 'adr,decision-record').split(',').map((x) => x.trim().toLowerCase()),
    runbook: (process.env.CONFLUENCE_RUNBOOK_MARKERS ?? 'runbook,playbook').split(',').map((x) => x.trim().toLowerCase()),
  },
  roster: (process.env.TEAM_ROSTER ?? ((process.env.HOUSTON_MODE ?? 'demo') === 'demo' ? 'OSSI:Aisha|Rahul|Omar|Priya|Tom|Fatima|Karim|Dinesh,PLAT:Lena|Yusuf|Mei|Sam' : ''))
    .split(',').filter(Boolean).map((s) => { const [name, list] = s.split(':'); return { name: name.trim(), people: list.split('|').map((x) => x.trim()) }; }),
  github: {
    api: process.env.GITHUB_API ?? 'https://api.github.com',
    token: process.env.GITHUB_TOKEN ?? '',
    repos: (process.env.GITHUB_REPOS ?? '').split(',').filter(Boolean).map((s) => { const [name, list] = s.split(':'); return { name: name.trim(), repos: list.split('|').map((r) => r.trim()) }; }),
    days: Number(process.env.GITHUB_DAYS ?? 90),
    lanes: lanes(process.env.GITHUB_LANES),
    deployWorkflow: process.env.GITHUB_DEPLOY_WORKFLOW ?? 'deploy',
  },
  sonar: { url: process.env.SONAR_URL ?? '', token: process.env.SONAR_TOKEN ?? '', projects: pairs(process.env.SONAR_PROJECTS) },
  testmo: { url: process.env.TESTMO_URL ?? '', token: process.env.TESTMO_TOKEN ?? '', projects: pairs(process.env.TESTMO_PROJECTS) },
  mode: process.env.HOUSTON_MODE ?? 'demo',
  port: Number(process.env.PORT ?? 4000),
  dataDir: process.env.HOUSTON_DATA_DIR ?? './data',
  jira: {
    baseUrl: process.env.JIRA_BASE_URL ?? '',
    email: process.env.JIRA_EMAIL ?? '',
    token: process.env.JIRA_API_TOKEN ?? '',
    boards: (process.env.JIRA_BOARDS ?? '')
      .split(',')
      .filter(Boolean)
      .map((s) => {
        const [name, id] = s.split(':');
        return { name: name.trim(), id: Number(id) };
      }),
    acField: process.env.JIRA_AC_FIELD || null,
    pointsField: process.env.JIRA_POINTS_FIELD ?? 'customfield_10016',
    epicField: process.env.JIRA_EPIC_FIELD ?? 'customfield_10014', // Epic Link on Jira Cloud company-managed projects
    sprintField: process.env.JIRA_SPRINT_FIELD ?? 'customfield_10020', // Sprint field on Jira Cloud
    // Jira project key per board, when it differs from the board name: "OSSI:OSS,PLAT:PLATFORM"
    projects: Object.fromEntries(pairs(process.env.JIRA_PROJECTS).map((p) => [p.name, p.id])) as Record<string, string>,
    // Which priorities count as significant (serious bugs, and the bug based change failure rate)
    significant: (process.env.JIRA_SIGNIFICANT_PRIORITIES ?? 'Highest,Blocker,Critical,P1').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
    days: Number(process.env.JIRA_DAYS ?? 90),
    history: Number(process.env.SPRINT_HISTORY ?? 6),
  },
};

// Values from .env end up in API paths and in JQL/KQL. Reject anything that does not look like what it claims to be,
// so a typo fails at startup with a clear message instead of turning into a broken or injected query.
export function configProblems(c = config): string[] {
  const out: string[] = [];
  const check = (what: string, v: string, re: RegExp) => { if (v && !re.test(v)) out.push(`${what}: "${v}" is not valid`); };
  const BOARD = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/, GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const [b, k] of Object.entries(c.jira.projects)) { check('JIRA_PROJECTS board', b, BOARD); check('JIRA_PROJECTS key', k, /^[A-Z][A-Z0-9_]{0,31}$/); }
  if (!Number.isInteger(c.jira.days) || c.jira.days < 7 || c.jira.days > 365) out.push('JIRA_DAYS must be 7 to 365');
  for (const b of c.jira.boards) { check('JIRA_BOARDS name', b.name, BOARD); if (!Number.isInteger(b.id) || b.id <= 0) out.push(`JIRA_BOARDS id for ${b.name} must be a number`); }
  for (const r of c.github.repos) { check('GITHUB_REPOS board', r.name, BOARD); for (const x of r.repos) check('GITHUB_REPOS repo', x, /^[\w.-]+\/[\w.-]+$/); }
  for (const p of c.sonar.projects) check('SONAR_PROJECTS key', p.id, /^[\w.:-]+$/);
  for (const p of c.testmo.projects) check('TESTMO_PROJECTS id', p.id, /^\d+$/);
  for (const s of c.confluence.spaces) for (const k of s.spaces) check('CONFLUENCE_SPACES key', k, /^~?[A-Za-z0-9_]+$/);
  check('AZURE_TENANT_ID', c.azure.tenant, /^([0-9a-f-]{36}|[\w.-]+\.[a-z]{2,})$/i);
  check('AZURE_SUBSCRIPTION_ID', c.azure.subscription, GUID);
  check('AZURE_LOG_WORKSPACE', c.azure.workspace, GUID);
  for (const a of c.azure.appInsights) check('AZURE_APPINSIGHTS app id', a.id, GUID);
  for (const r of c.azure.resourceGroups) check('AZURE_RESOURCE_GROUPS', r.id, /^[\w().-]{1,90}$/);
  for (const [k, v] of [['JIRA_BASE_URL', c.jira.baseUrl], ['GITHUB_API', c.github.api], ['SONAR_URL', c.sonar.url], ['TESTMO_URL', c.testmo.url], ['HOUSTON_URL', c.publicUrl]] as const)
    check(k, v, /^https?:\/\/[^\s"'<>]+$/);
  for (const [k, v] of [['RATE_FTE_DAY', c.cost.fteDay], ['RATE_CONTRACTOR_DAY', c.cost.contractorDay], ...Object.entries(c.cost.overrides).map(([n, r]) => [`RATE_OVERRIDES ${n}`, r] as const)] as const)
    if (!Number.isFinite(v) || v < 0) out.push(`${k} must be a number, 0 or more`);
  check('CLAUDE_OTEL_APPINSIGHTS', c.claude.appInsights, GUID);
  if (!Number.isFinite(c.claude.seatMonthly) || c.claude.seatMonthly < 0) out.push('CLAUDE_SEAT_MONTHLY must be a number, 0 or more');
  if (!Number.isInteger(c.claude.days) || c.claude.days < 1 || c.claude.days > 90) out.push('CLAUDE_DAYS must be 1 to 90');
  if (c.weekend.some((d) => d < 0)) out.push('WEEKEND: use day names like sat,sun');
  for (const t of (process.env.HOUSTON_API_TOKENS ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const i = t.indexOf(':'), name = t.slice(0, i), token = t.slice(i + 1);
    if (i < 1 || !/^[\w-]{1,40}$/.test(name)) out.push('HOUSTON_API_TOKENS: use name:token pairs, names letters, digits, - and _');
    else if (token.length < 32) out.push(`HOUSTON_API_TOKENS: the token for ${name} must be at least 32 characters (openssl rand -hex 32)`);
  }
  // Outside demo mode Houston holds per person data and API tokens: it does not start without a password.
  if (c.mode !== 'demo' && !process.env.HOUSTON_PASSWORD) out.push('HOUSTON_PASSWORD must be set outside demo mode');
  return out;
}

export function assertConfig() {
  const p = configProblems();
  if (p.length) { console.error('Houston config problems:\n' + p.map((x) => `  - ${x}`).join('\n')); process.exit(1); }
}
