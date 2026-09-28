import { config } from '../config.js';
import type { AzureSnapshot } from '../types.js';

// KQL string literal: escape backslash and quote so a value cannot end the string.
const kqlString = (s: string) => s.replace(/[\\"]/g, (c) => '\\' + c);

// Client credentials token for a given scope. Reader roles only; Houston never writes to Azure.
export async function token(scope: string): Promise<string> {
  const { tenant, client, secret } = config.azure;
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: client, client_secret: secret, scope }),
  });
  if (!res.ok) throw new Error(`Azure auth ${res.status}: ${await res.text()}`);
  return (await res.json() as any).access_token;
}

async function appInsightsQuery(appId: string, kql: string) {
  const t = await token('https://api.applicationinsights.io/.default');
  const res = await fetch(`https://api.applicationinsights.io/v1/apps/${encodeURIComponent(appId)}/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: kql }),
  });
  if (!res.ok) throw new Error(`App Insights ${res.status}: ${await res.text()}`);
  const rows = (await res.json() as any).tables?.[0]?.rows?.[0] ?? [];
  return rows as any[];
}

// Every row of an Application Insights query, as objects keyed by column name.
export async function appInsightsRows(appId: string, kql: string): Promise<Record<string, unknown>[]> {
  const t = await token('https://api.applicationinsights.io/.default');
  const res = await fetch(`https://api.applicationinsights.io/v1/apps/${encodeURIComponent(appId)}/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: kql }),
  });
  if (!res.ok) throw new Error(`App Insights ${res.status}: ${await res.text()}`);
  const table = (await res.json() as any).tables?.[0];
  const cols: string[] = (table?.columns ?? []).map((c: { name: string }) => c.name);
  return (table?.rows ?? []).map((r: unknown[]) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
}

async function logQuery(kql: string) {
  const t = await token('https://api.loganalytics.io/.default');
  const res = await fetch(`https://api.loganalytics.io/v1/workspaces/${encodeURIComponent(config.azure.workspace)}/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: kql }),
  });
  if (!res.ok) throw new Error(`Log Analytics ${res.status}: ${await res.text()}`);
  return ((await res.json() as any).tables?.[0]?.rows ?? []) as any[][];
}

async function ops(appId: string, rg: string | undefined): Promise<AzureSnapshot['ops']> {
  const [requests, failed, p95] = await appInsightsQuery(appId,
    `requests | where timestamp > ago(30d) | summarize total=count(), failed=countif(toint(resultCode) >= 500), p95=percentile(duration, 95) | project total, failed, p95`);
  const [avail] = await appInsightsQuery(appId,
    `availabilityResults | where timestamp > ago(30d) | summarize pct=100.0 * countif(success == true) / count() | project pct`).catch(() => [null]);
  let incidents30d = 0, medianRestoreMin: number | null = null;
  let incidents: NonNullable<AzureSnapshot['ops']>['incidents'] = [];
  if (config.azure.workspace) {
    const rows = await logQuery(
      `AlertsManagementResources | where TimeGenerated > ago(30d) | where Severity in ("Sev0","Sev1","Sev2")${rg ? ` | where tostring(Properties.essentials.targetResourceGroup) =~ "${kqlString(rg)}"` : ''}
       | extend fired=todatetime(Properties.essentials.startDateTime), resolved=todatetime(Properties.essentials.monitorConditionResolvedDateTime)
       | summarize n=count(), med=percentile(datetime_diff('minute', resolved, fired), 50)`).catch(() => [] as any[][]);
    if (rows[0]) { incidents30d = Number(rows[0][0] ?? 0); medianRestoreMin = rows[0][1] != null ? Number(rows[0][1]) : null; }
    // Each incident over 90 days, so the dashboard can chart time to restore over time.
    const list = await logQuery(
      `AlertsManagementResources | where TimeGenerated > ago(90d) | where Severity in ("Sev0","Sev1","Sev2")${rg ? ` | where tostring(Properties.essentials.targetResourceGroup) =~ "${kqlString(rg)}"` : ''}
       | project fired=todatetime(Properties.essentials.startDateTime), resolved=todatetime(Properties.essentials.monitorConditionResolvedDateTime), Severity
       | order by fired asc | take 1000`).catch(() => [] as any[][]);
    incidents = list.filter((r) => r[0]).map((r) => ({ firedAt: new Date(r[0]).toISOString(), resolvedAt: r[1] ? new Date(r[1]).toISOString() : null, severity: String(r[2] ?? '') }));
  }
  // No availability tests means not measured (null), never a false 100%.
  return { requests30d: Number(requests ?? 0), failedRate: requests ? Math.round((Number(failed) / Number(requests)) * 1000) / 10 : 0,
    p95LatencyMs: Math.round(Number(p95 ?? 0)), availability: avail != null ? Math.round(Number(avail) * 10) / 10 : null, incidents30d, medianRestoreMin, incidents };
}

export async function collectAzure(): Promise<AzureSnapshot[]> {
  const out: AzureSnapshot[] = [];
  const boards = new Set([...config.azure.appInsights.map((x) => x.name), ...config.azure.resourceGroups.map((x) => x.name)]);
  for (const board of boards) {
    const appId = config.azure.appInsights.find((x) => x.name === board)?.id;
    const rg = config.azure.resourceGroups.find((x) => x.name === board)?.id;
    out.push({ board, capturedAt: new Date().toISOString(),
      ops: appId ? await ops(appId, rg) : null });
  }
  return out;
}

// Demo incidents over 90 days, deterministic: OSSI about one every 4 days, hours to restore; PLAT rare, under an hour.
function demoIncidents(every: number, restoreMin: number, seed: number) {
  let s = seed; const r = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const out: { firedAt: string; resolvedAt: string | null; severity: string }[] = [];
  for (let t = Date.now() - 90 * 86_400_000; t < Date.now(); t += every * 86_400_000 * (0.4 + r() * 1.2)) {
    const mins = restoreMin * (0.3 + r() * 1.6);
    out.push({ firedAt: new Date(t).toISOString(), resolvedAt: new Date(t + mins * 60_000).toISOString(), severity: r() < 0.2 ? 'Sev1' : 'Sev2' });
  }
  return out;
}

export function demoAzure(): AzureSnapshot[] {
  return [
    { board: 'OSSI', capturedAt: new Date().toISOString(), ops: { requests30d: 1_840_000, failedRate: 2.9, p95LatencyMs: 1840, availability: 98.1, incidents30d: 7, medianRestoreMin: 310, incidents: demoIncidents(4.3, 310, 11) } },
    { board: 'PLAT', capturedAt: new Date().toISOString(), ops: { requests30d: 9_200_000, failedRate: 0.3, p95LatencyMs: 420, availability: 99.95, incidents30d: 1, medianRestoreMin: 42, incidents: demoIncidents(25, 42, 12) } },
  ];
}
