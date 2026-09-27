import { config } from '../config.js';
import { token as azureToken, appInsightsRows } from '../collectors/azure.js';
import type { TeamInput } from './teamSetup.js';

// Connection health for the admin page. Read-only calls, 10 seconds each. Tokens are used, never returned: a result
// holds only whether it worked, what it found (a name, a count, a date) and which permissions are missing.
// Upstream error bodies are not passed on either, only the status code, since some echo request details back.
export interface Check { source: string; configured: boolean; ok: boolean | null; detail: string; expires?: string | null; missing?: string[] }

const TIMEOUT = 10_000;
class Http extends Error { constructor(public status: number) { super(`HTTP ${status}`); } }
async function get(url: string, headers: Record<string, string>): Promise<{ body: any; headers: Headers; status: number }> {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) { await res.body?.cancel(); throw new Http(res.status); }
  return { body: await res.json().catch(() => null), headers: res.headers, status: res.status };
}
const why = (e: unknown) => e instanceof Http ? (e.status === 401 ? 'Token rejected (401): expired, revoked or wrong' : e.status === 403 ? 'Signed in, but not allowed (403): the token is missing a permission'
  : e.status === 404 ? 'Not found (404)' : `Failed (HTTP ${e.status})`) : (e as Error)?.name === 'TimeoutError' ? 'No answer within 10 seconds' : 'Could not connect';

const jiraAuth = () => ({ Authorization: config.jira.email ? 'Basic ' + Buffer.from(`${config.jira.email}:${config.jira.token}`).toString('base64') : `Bearer ${config.jira.token}` });
const ghAuth = () => ({ Authorization: `Bearer ${config.github.token}`, 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github+json' });
const sonarAuth = () => ({ Authorization: 'Basic ' + Buffer.from(`${config.sonar.token}:`).toString('base64') });
const testmoAuth = () => ({ Authorization: `Bearer ${config.testmo.token}` });
const enc = encodeURIComponent;
const has = { jira: () => !!(config.jira.baseUrl && config.jira.token), github: () => !!config.github.token, sonar: () => !!(config.sonar.url && config.sonar.token),
  testmo: () => !!(config.testmo.url && config.testmo.token), azure: () => !!(config.azure.tenant && config.azure.client && config.azure.secret) };
const notSet = (source: string, vars: string): Check => ({ source, configured: false, ok: null, detail: `Not connected: ${vars} not set` });

// GitHub classic tokens list their scopes in a header. "repo" includes security alerts; "read:org" is implied by the org admin scopes.
export function githubScopes(header: string | null): { missing: string[] | null } {
  if (header == null) return { missing: null }; // fine-grained token or app: GitHub does not list permissions
  const s = new Set(header.split(',').map((x) => x.trim()).filter(Boolean));
  const missing: string[] = [];
  if (!s.has('repo')) missing.push('repo');
  if (!s.has('repo') && !s.has('security_events')) missing.push('security_events');
  if (!['read:org', 'write:org', 'admin:org'].some((x) => s.has(x))) missing.push('read:org');
  return { missing };
}

export async function checkConnections(): Promise<Check[]> {
  const run = async (source: string, configured: boolean, vars: string, fn: () => Promise<Omit<Check, 'source' | 'configured'>>): Promise<Check> => {
    if (!configured) return notSet(source, vars);
    try { return { source, configured, ...(await fn()) }; } catch (e) { return { source, configured, ok: false, detail: why(e) }; }
  };
  return Promise.all([
    run('Jira', has.jira(), 'JIRA_BASE_URL and JIRA_API_TOKEN', async () => {
      const { body } = await get(`${config.jira.baseUrl}/rest/api/2/myself`, jiraAuth());
      return { ok: true, detail: `Signed in as ${String(body?.displayName ?? 'the service account').slice(0, 80)}` };
    }),
    run('Confluence', has.jira(), 'JIRA_BASE_URL and JIRA_API_TOKEN (Confluence uses the Jira credentials)', async () => {
      await get(`${config.jira.baseUrl}/wiki/rest/api/space?limit=1`, jiraAuth());
      return { ok: true, detail: 'Spaces readable' };
    }),
    run('GitHub', has.github(), 'GITHUB_TOKEN', async () => {
      const { body, headers } = await get(`${config.github.api}/user`, ghAuth());
      const { missing } = githubScopes(headers.get('x-oauth-scopes'));
      const exp = headers.get('github-authentication-token-expiration'), expires = exp ? new Date(exp.replace(' UTC', 'Z').replace(' ', 'T')).toISOString() : null;
      const soon = expires && Date.parse(expires) - Date.now() < 14 * 86_400_000;
      return { ok: !missing?.length && !soon, expires, missing: missing ?? undefined,
        detail: `Signed in as ${String(body?.login ?? 'token').slice(0, 60)}. ${missing == null ? 'Fine-grained token: GitHub does not list its permissions; the data checks show any repo whose security alerts could not be read.' : missing.length ? `Missing permissions: ${missing.join(', ')}.` : 'All permissions present.'}${soon ? ' Expires within 14 days.' : ''}` };
    }),
    run('SonarQube', has.sonar(), 'SONAR_URL and SONAR_TOKEN', async () => {
      const { body } = await get(`${config.sonar.url}/api/authentication/validate`, sonarAuth());
      return body?.valid ? { ok: true, detail: 'Token valid' } : { ok: false, detail: 'Token rejected: expired, revoked or wrong' };
    }),
    run('Testmo', has.testmo(), 'TESTMO_URL and TESTMO_TOKEN', async () => {
      await get(`${config.testmo.url}/api/v1/projects`, testmoAuth());
      return { ok: true, detail: 'Projects readable' };
    }),
    run('Azure', has.azure(), 'AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET', async () => {
      await azureToken('https://management.azure.com/.default');
      return { ok: true, detail: 'Service principal signs in. Its secret\'s expiry is not visible to Houston: check the app registration in Entra ID.' };
    }),
    run('Claude Code telemetry', has.azure() && !!config.claude.appInsights, 'CLAUDE_OTEL_APPINSIGHTS (and the Azure settings)', async () => {
      const rows = await appInsightsRows(config.claude.appInsights, 'customMetrics | where timestamp > ago(7d) and name startswith "claude_code." | take 1');
      return { ok: true, detail: rows.length ? 'Receiving usage data' : 'Connected, but no Claude Code usage in the last 7 days' };
    }),
    Promise.resolve<Check>(config.teamsWebhook ? { source: 'Microsoft Teams', configured: true, ok: null, detail: 'Webhook set. Not tested here: a test would post a message to the channel.' } : notSet('Microsoft Teams', 'TEAMS_WEBHOOK')),
  ]);
}

// Test a team's setup before saving it: one read-only call per source, saying what was found.
export async function testTeam(t: TeamInput): Promise<Check[]> {
  const out: Check[] = [];
  // fn says what it found; a failed check it can explain returns { ok: false, detail } instead of throwing.
  const one = async (source: string, configured: boolean, vars: string, fn: () => Promise<string | { ok: false; detail: string }>) => {
    if (!configured) { out.push(notSet(source, vars)); return; }
    try { const r = await fn(); out.push(typeof r === 'string' ? { source, configured, ok: true, detail: r } : { source, configured, ...r }); }
    catch (e) { out.push({ source, configured, ok: false, detail: why(e) }); }
  };
  await one(`Jira board ${t.jiraBoardId}`, has.jira(), 'JIRA_BASE_URL and JIRA_API_TOKEN', async () => {
    const base = `${config.jira.baseUrl}/rest/agile/1.0/board/${enc(String(t.jiraBoardId))}`;
    const [{ body: b }, { body: p }, { body: sp }] = await Promise.all([get(base, jiraAuth()), get(`${base}/project`, jiraAuth()), get(`${base}/sprint?state=closed,active&maxResults=50`, jiraAuth())]);
    const name = String(b?.name ?? '').slice(0, 60), keys: string[] = (p?.values ?? []).map((x: any) => String(x.key));
    if (!keys.includes(t.jiraProject)) return { ok: false, detail: `Board "${name}" found, but project ${t.jiraProject} is not on it (it has ${keys.join(', ') || 'no projects'})` };
    const closed = (sp?.values ?? []).filter((x: any) => x.state === 'closed').map((x: any) => String(x.completeDate ?? x.endDate ?? '')).sort();
    return `Board "${name}" (${String(b?.type ?? '')}), project ${t.jiraProject} found, ${(sp?.values ?? []).length} sprints${closed.length ? `, last closed ${closed[closed.length - 1].slice(0, 10)}` : ''}`;
  });
  const supportKey = t.supportProject || t.jiraProject;
  await one(`Support tickets in ${supportKey}`, has.jira(), 'JIRA_BASE_URL and JIRA_API_TOKEN', async () => {
    const { supportJqlFor } = await import('../collectors/support.js');
    const jql = supportJqlFor(supportKey, !!t.supportProject && t.supportProject !== t.jiraProject, 90);
    const { body } = await get(`${config.jira.baseUrl}/rest/api/2/search?jql=${enc(jql)}&maxResults=0`, jiraAuth());
    return `${Number(body?.total ?? 0)} support tickets in the last 90 days or still open${t.supportProject ? '' : ` (issue types ${config.jira.supportTypes.join(', ')} or labels ${config.jira.supportLabels.join(', ')})`}`;
  });
  for (const r of t.repos) await one(`GitHub ${r}`, has.github(), 'GITHUB_TOKEN', async () => {
    const path = r.split('/').map(enc).join('/');
    const { body } = await get(`${config.github.api}/repos/${path}`, ghAuth());
    const sec = await fetch(`${config.github.api}/repos/${path}/dependabot/alerts?per_page=1`, { headers: ghAuth(), signal: AbortSignal.timeout(TIMEOUT) }).then(async (x) => { await x.body?.cancel(); return x.status; }).catch(() => 0);
    return `Default branch ${String(body?.default_branch ?? '?').slice(0, 60)}; security alerts ${sec === 200 ? 'readable' : sec === 404 ? 'turned off for this repo' : 'not readable: the token needs security_events'}`;
  });
  if (t.sonarProject) await one(`SonarQube ${t.sonarProject}`, has.sonar(), 'SONAR_URL and SONAR_TOKEN', async () => {
    const { body } = await get(`${config.sonar.url}/api/components/show?component=${enc(t.sonarProject)}`, sonarAuth());
    return `Project "${String(body?.component?.name ?? t.sonarProject).slice(0, 80)}"`;
  });
  if (t.testmoProject) await one(`Testmo ${t.testmoProject}`, has.testmo(), 'TESTMO_URL and TESTMO_TOKEN', async () => {
    const { body } = await get(`${config.testmo.url}/api/v1/projects/${enc(t.testmoProject)}`, testmoAuth());
    return `Project "${String(body?.result?.name ?? body?.name ?? t.testmoProject).slice(0, 80)}"`;
  });
  for (const k of t.confluenceSpaces) await one(`Confluence ${k}`, has.jira(), 'JIRA_BASE_URL and JIRA_API_TOKEN', async () => {
    const { body } = await get(`${config.jira.baseUrl}/wiki/rest/api/space/${enc(k)}`, jiraAuth());
    return `Space "${String(body?.name ?? k).slice(0, 80)}"`;
  });
  if (t.resourceGroup) await one(`Azure ${t.resourceGroup}`, has.azure() && !!config.azure.subscription, 'the Azure settings and AZURE_SUBSCRIPTION_ID', async () => {
    const tok = await azureToken('https://management.azure.com/.default');
    const { body } = await get(`https://management.azure.com/subscriptions/${enc(config.azure.subscription)}/resourcegroups/${enc(t.resourceGroup)}?api-version=2021-04-01`, { Authorization: `Bearer ${tok}` });
    return `Resource group in ${String(body?.location ?? '?').slice(0, 40)}`;
  });
  if (t.appInsights) await one('Application Insights', has.azure(), 'the Azure settings', async () => {
    const rows = await appInsightsRows(t.appInsights, 'requests | where timestamp > ago(1d) | take 1');
    return rows.length ? 'Receiving requests' : 'Connected, no requests in the last day';
  });
  return out;
}
