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
  // Time zone for working days and weekends, hours from UTC (UAE: 4).
  tzOffset: Number(process.env.TZ_OFFSET_HOURS ?? 0),
  // How to tell production bugs from bugs caught before release, for defect leakage: labels, or a field's value.
  bugs: {
    prodLabels: (process.env.BUG_PROD_LABELS ?? 'production,prod,escaped,customer').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
    qaLabels: (process.env.BUG_QA_LABELS ?? 'qa,staging,test,uat').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
    envField: process.env.JIRA_BUG_ENV_FIELD ?? '',   // optional custom field holding the environment
  },
  // Working week. UAE: Saturday and Sunday off since 2022.
  // Working day in local time, for "outside working hours": HH:MM-HH:MM.
  workingHours: (() => { const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(process.env.WORKING_HOURS ?? '08:00-18:00'); return m ? { start: +m[1] + +m[2] / 60, end: +m[3] + +m[4] / 60 } : { start: NaN, end: NaN }; })(),
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
    // Service accounts that GitHub does not mark as bots, whose reviews and comments are not a person's review
    bots: (process.env.GITHUB_BOTS ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
    // Days to fix a security alert, by severity. A severity left out (low by default) has no deadline.
    securityDeadlines: Object.fromEntries((process.env.SECURITY_DEADLINE_DAYS ?? 'critical:7,high:30,medium:90').split(',').filter(Boolean)
      .map((x) => { const [k, v] = x.split(':'); return [k.trim().toLowerCase(), Number(v)] as const; }).filter(([, v]) => Number.isFinite(v) && v > 0)) as Partial<Record<'critical' | 'high' | 'medium' | 'low', number>>,
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
    // Support tickets. SUPPORT_PROJECTS: a separate support project per team ("OSSI:OSSSUP"); every ticket in it counts.
    // A team without one: tickets in its own project count when their type is a support type or they carry a support label.
    supportProjects: Object.fromEntries(pairs(process.env.SUPPORT_PROJECTS).map((p) => [p.name, p.id])) as Record<string, string>,
    supportTypes: (process.env.SUPPORT_ISSUE_TYPES ?? 'Support,Incident,Service Request').split(',').map((x) => x.trim()).filter(Boolean),
    supportLabels: (process.env.SUPPORT_LABELS ?? 'support').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
    // SLAs per priority, response/resolution, in working time: "Highest=4h/1d,High=8h/2d". 1d = one working day.
    supportSla: Object.fromEntries((process.env.SUPPORT_SLA ?? 'Highest=2h/1d,High=4h/2d,Medium=1d/5d,Low=2d/10d').split(',').filter((x) => x.includes('='))
      .map((x) => { const [p, v] = x.split('='); const [resp, res] = v.split('/'); return [p.trim().toLowerCase(), { response: resp?.trim() ?? '', resolution: res?.trim() ?? '' }]; })) as Record<string, { response: string; resolution: string }>,
    // Which priorities count as significant (serious bugs, and the bug based change failure rate)
    significant: (process.env.JIRA_SIGNIFICANT_PRIORITIES ?? 'Highest,Blocker,Critical,P1').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
    days: Number(process.env.JIRA_DAYS ?? 90),
    // Statuses where work waits rather than moves (flow efficiency, queued work), and QA statuses (QA rejection).
    waitStatuses: (process.env.JIRA_WAIT_STATUSES ?? 'Blocked,Ready for Review,Ready for QA,Awaiting Deploy,Ready for Release,Waiting,On Hold').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
    // Flow distribution: labels that make a ticket debt or risk work (bugs are defects, everything else features)
    debtLabels: (process.env.FLOW_DEBT_LABELS ?? 'tech-debt,techdebt,debt,refactor,refactoring,maintenance,upgrade').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
    riskLabels: (process.env.FLOW_RISK_LABELS ?? 'security,risk,compliance,vulnerability,audit').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
    qaStatuses: (process.env.JIRA_QA_STATUSES ?? 'QA,In QA,Testing,In Testing').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
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
  for (const [b, k] of Object.entries(c.jira.supportProjects)) { check('SUPPORT_PROJECTS board', b, BOARD); check('SUPPORT_PROJECTS key', k, /^[A-Z][A-Z0-9_]{0,31}$/); }
  for (const t of c.jira.supportTypes) check('SUPPORT_ISSUE_TYPES', t, /^[\w .-]{1,60}$/);
  for (const [p, v] of Object.entries(c.jira.supportSla)) for (const d of [v.response, v.resolution]) check(`SUPPORT_SLA ${p}`, d, /^\d+(\.\d+)?[hd]$/);
  if (!(c.workingHours.start >= 0 && c.workingHours.end <= 24 && c.workingHours.start < c.workingHours.end)) out.push('WORKING_HOURS: use HH:MM-HH:MM, e.g. 08:00-18:00');
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
  if (!Number.isFinite(c.tzOffset) || c.tzOffset < -12 || c.tzOffset > 14) out.push('TZ_OFFSET_HOURS must be between -12 and 14');
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
