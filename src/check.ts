// npm run check: tests every configured connection and prints what Houston can see. Run this before the first collect.
import { config, configProblems } from './config.js';
import { applySavedTeams } from './admin/teamSetup.js';
import { applySavedSettings } from './admin/settings.js';
applySavedTeams();
applySavedSettings();

const ok = (m: string) => console.log(`  ok   ${m}`);
const bad = (m: string) => console.log(`  FAIL ${m}`);
const skip = (m: string) => console.log(`  skip ${m}`);

async function jira() {
  console.log('Jira');
  if (!config.jira.token) return skip('JIRA_API_TOKEN not set');
  const auth = config.jira.email ? 'Basic ' + Buffer.from(`${config.jira.email}:${config.jira.token}`).toString('base64') : `Bearer ${config.jira.token}`;
  const me = await fetch(`${config.jira.baseUrl}/rest/api/2/myself`, { headers: { Authorization: auth } });
  if (!me.ok) return bad(`auth ${me.status}. Check JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN`);
  ok(`signed in as ${(await me.json() as any).displayName}`);
  for (const b of config.jira.boards) {
    const r = await fetch(`${config.jira.baseUrl}/rest/agile/1.0/board/${b.id}/sprint?state=closed,active&maxResults=5`, { headers: { Authorization: auth } });
    if (!r.ok) { bad(`board ${b.name} (${b.id}): ${r.status}`); continue; }
    const v = (await r.json() as any).values;
    ok(`board ${b.name}: ${v.length} sprints visible, latest "${v[v.length - 1]?.name}"`);
    const first = v[0];
    if (first) {
      const i = await fetch(`${config.jira.baseUrl}/rest/agile/1.0/sprint/${first.id}/issue?maxResults=1&fields=${config.jira.pointsField},description`, { headers: { Authorization: auth } });
      const issue = (await i.json() as any).issues?.[0];
      if (issue) {
        const pts = issue.fields[config.jira.pointsField];
        pts === undefined ? bad(`${config.jira.pointsField} not on issues. Find the story points field id in Jira admin and set JIRA_POINTS_FIELD`) : ok(`story points field ${config.jira.pointsField} present`);
      }
    }
  }
}

async function github() {
  console.log('GitHub');
  if (!config.github.token) return skip('GITHUB_TOKEN not set');
  const h = { Authorization: `Bearer ${config.github.token}`, Accept: 'application/vnd.github+json' };
  const me = await fetch(`${config.github.api}/user`, { headers: h });
  if (!me.ok) return bad(`auth ${me.status} at ${config.github.api}. GHES needs /api/v3 on the end`);
  ok(`signed in as ${(await me.json() as any).login}`);
  for (const b of config.github.repos) for (const repo of b.repos) {
    const r = await fetch(`${config.github.api}/repos/${repo}/pulls?state=all&per_page=1`, { headers: h });
    if (!r.ok) { bad(`${repo}: ${r.status}. Token needs read access to this repo`); continue; }
    const prs = await r.json() as any[];
    ok(`${repo}: reachable, latest PR #${prs[0]?.number ?? 'none'} by ${prs[0]?.user?.login ?? '?'}`);
    const w = await fetch(`${config.github.api}/repos/${repo}/actions/workflows`, { headers: h });
    if (w.ok) {
      const names = ((await w.json() as any).workflows ?? []).map((x: any) => x.name);
      const dep = names.filter((n: string) => n.toLowerCase().includes(config.github.deployWorkflow.toLowerCase()));
      dep.length ? ok(`${repo}: deploy workflow matched "${dep.join('", "')}"`) : bad(`${repo}: no workflow name contains "${config.github.deployWorkflow}". Workflows: ${names.join(', ') || 'none'}. Set GITHUB_DEPLOY_WORKFLOW`);
    }
  }
  if (!config.github.lanes.length) bad('GITHUB_LANES not set, lane crossing check will be empty');
}

async function sonar() {
  console.log('SonarQube');
  if (!config.sonar.token) return skip('SONAR_TOKEN not set');
  const h = { Authorization: 'Basic ' + Buffer.from(`${config.sonar.token}:`).toString('base64') };
  for (const p of config.sonar.projects) {
    const r = await fetch(`${config.sonar.url}/api/measures/component?component=${encodeURIComponent(p.id)}&metricKeys=coverage,alert_status`, { headers: h });
    if (!r.ok) { bad(`${p.name} (${p.id}): ${r.status}`); continue; }
    const m = (await r.json() as any).component.measures;
    ok(`${p.name}: gate ${m.find((x: any) => x.metric === 'alert_status')?.value}, coverage ${m.find((x: any) => x.metric === 'coverage')?.value}%`);
  }
}

async function testmo() {
  console.log('Testmo');
  if (!config.testmo.token) return skip('TESTMO_TOKEN not set');
  for (const p of config.testmo.projects) {
    const r = await fetch(`${config.testmo.url}/api/v1/projects/${p.id}/automation/runs?per_page=1`, { headers: { Authorization: `Bearer ${config.testmo.token}` } });
    if (!r.ok) { bad(`${p.name} (${p.id}): ${r.status}`); continue; }
    const run = (await r.json() as any).result?.[0];
    ok(`${p.name}: latest run ${run?.name ?? 'none'}, ${run?.tests_passed_count ?? '?'} passed of ${run?.tests_count ?? '?'}`);
  }
}

async function azure() {
  console.log('Azure');
  if (!config.azure.client) return skip('AZURE_CLIENT_ID not set');
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.azure.tenant)}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: config.azure.client, client_secret: config.azure.secret, scope: 'https://management.azure.com/.default' }) });
  if (!res.ok) return bad(`service principal auth ${res.status}. Check tenant, client id, secret`);
  const t = (await res.json() as any).access_token; ok('service principal signed in');
  for (const rg of config.azure.resourceGroups) {
    const r = await fetch(`https://management.azure.com/subscriptions/${config.azure.subscription}/resourceGroups/${rg.id}?api-version=2021-04-01`, { headers: { Authorization: `Bearer ${t}` } });
    r.ok ? ok(`resource group ${rg.id} readable`) : bad(`resource group ${rg.id}: ${r.status}. Needs Reader`);
  }
  if (!config.azure.appInsights.length) bad('AZURE_APPINSIGHTS not set, no production health');
  if (!config.azure.workspace) bad('AZURE_LOG_WORKSPACE not set, no incidents or time to restore');
}

console.log(`Houston connection check, mode=${config.mode}\n`);
console.log('Config'); { const p = configProblems(); p.length ? p.forEach(bad) : ok('values look valid'); }
await jira(); await github(); await sonar(); await testmo(); await azure();
console.log('Teams'); config.teamsWebhook ? ok('webhook set') : skip('TEAMS_WEBHOOK not set');
console.log('If anything says FAIL, fix it before npm run collect.');

// Data quality: needs collected data. Run npm run collect first, then npm run check again.
const { dataQuality } = await import('./dataQuality.js');
const dq = dataQuality();
if (!dq.length) console.log('\nData quality: nothing collected yet. Run npm run collect, then npm run check again.');
else {
  console.log('\nData quality (from the last collect)');
  for (const c of dq) (c.status === 'ok' ? ok : c.status === 'fail' ? bad : (m: string) => console.log(`  WARN ${m}`))(`${c.area}: ${c.check}. ${c.detail}${c.status !== 'ok' && c.affects.length ? ` Affects: ${c.affects.join(', ')}.` : ''}`);
}
