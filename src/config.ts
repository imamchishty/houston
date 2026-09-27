import 'dotenv/config';

const pairs = (v: string | undefined) =>
  (v ?? '').split(',').filter(Boolean).map((s) => { const [name, id] = s.split(':'); return { name: name.trim(), id: id.trim() }; });

const lanes = (v: string | undefined) =>
  (v ?? '').split(';').filter(Boolean).map((l) => { const [area, pats] = l.split('='); return { area: area.trim(), patterns: pats.split(',').map((x) => x.trim()) }; });

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
    history: Number(process.env.SPRINT_HISTORY ?? 6),
  },
};
