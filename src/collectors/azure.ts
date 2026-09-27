import { config } from '../config.js';
import type { AzureSnapshot, Epic } from '../types.js';

// Client credentials token for a given scope. Reader roles only; Houston never writes to Azure.
async function token(scope: string): Promise<string> {
  const { tenant, client, secret } = config.azure;
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: client, client_secret: secret, scope }),
  });
  if (!res.ok) throw new Error(`Azure auth ${res.status}: ${await res.text()}`);
  return (await res.json() as any).access_token;
}

async function appInsightsQuery(appId: string, kql: string) {
  const t = await token('https://api.applicationinsights.io/.default');
  const res = await fetch(`https://api.applicationinsights.io/v1/apps/${appId}/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: kql }),
  });
  if (!res.ok) throw new Error(`App Insights ${res.status}: ${await res.text()}`);
  const rows = (await res.json() as any).tables?.[0]?.rows?.[0] ?? [];
  return rows as any[];
}

async function logQuery(kql: string) {
  const t = await token('https://api.loganalytics.io/.default');
  const res = await fetch(`https://api.loganalytics.io/v1/workspaces/${config.azure.workspace}/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: kql }),
  });
  if (!res.ok) throw new Error(`Log Analytics ${res.status}: ${await res.text()}`);
  return ((await res.json() as any).tables?.[0]?.rows ?? []) as any[][];
}

async function ops(appId: string, rg: string | undefined): Promise<AzureSnapshot['ops']> {
  const [requests, failed, p95] = await appInsightsQuery(appId,
    `requests | where timestamp > ago(30d) | summarize total=count(), failed=countif(success == false), p95=percentile(duration, 95) | project total, failed, p95`);
  const [avail] = await appInsightsQuery(appId,
    `availabilityResults | where timestamp > ago(30d) | summarize pct=100.0 * countif(success == true) / count() | project pct`).catch(() => [null]);
  let incidents30d = 0, medianRestoreMin: number | null = null;
  if (config.azure.workspace) {
    const rows = await logQuery(
      `AlertsManagementResources | where TimeGenerated > ago(30d) | where Severity in ("Sev0","Sev1","Sev2")${rg ? ` | where tostring(Properties.essentials.targetResourceGroup) =~ "${rg}"` : ''}
       | extend fired=todatetime(Properties.essentials.startDateTime), resolved=todatetime(Properties.essentials.monitorConditionResolvedDateTime)
       | summarize n=count(), med=percentile(datetime_diff('minute', resolved, fired), 50)`).catch(() => [] as any[][]);
    if (rows[0]) { incidents30d = Number(rows[0][0] ?? 0); medianRestoreMin = rows[0][1] != null ? Number(rows[0][1]) : null; }
  }
  return { requests30d: Number(requests ?? 0), failedRate: requests ? Math.round((Number(failed) / Number(requests)) * 1000) / 10 : 0,
    p95LatencyMs: Math.round(Number(p95 ?? 0)), availability: avail != null ? Math.round(Number(avail) * 10) / 10 : 100, incidents30d, medianRestoreMin };
}

async function cloudCost(rg: string): Promise<number> {
  const t = await token('https://management.azure.com/.default');
  const now = new Date(); const from = new Date(now.getFullYear(), now.getMonth() - 1, 1), to = new Date(now.getFullYear(), now.getMonth(), 0);
  const res = await fetch(`https://management.azure.com/subscriptions/${config.azure.subscription}/resourceGroups/${rg}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'ActualCost', timeframe: 'Custom', timePeriod: { from: from.toISOString(), to: to.toISOString() },
      dataset: { granularity: 'None', aggregation: { totalCost: { name: 'Cost', function: 'Sum' } } } }),
  });
  if (!res.ok) throw new Error(`Cost Management ${res.status}: ${await res.text()}`);
  const body = await res.json() as any;
  const cost = Number(body.properties?.rows?.[0]?.[0] ?? 0);
  const currency = body.properties?.rows?.[0]?.[1] ?? 'AED';
  return currency === 'USD' ? cost * 3.6725 : cost;
}

export function costBlock(cloudMonthAed: number, board: string, epics: Epic[]): AzureSnapshot['cost'] {
  const team = config.azure.teamCost.find((t) => t.name === board)?.aed ?? null;
  const since = Date.now() - 90 * 86_400_000;
  const shipped = epics.filter((e) => e.resolved && new Date(e.resolved).getTime() >= since).length;
  const quarter = (cloudMonthAed + (team ?? 0)) * 3;
  return { cloudMonthAed: Math.round(cloudMonthAed), teamMonthAed: team, featuresShipped90d: shipped, costPerFeatureAed: shipped ? Math.round(quarter / shipped) : null };
}

export async function collectAzure(epics: Record<string, Epic[]>): Promise<AzureSnapshot[]> {
  const out: AzureSnapshot[] = [];
  const boards = new Set([...config.azure.appInsights.map((x) => x.name), ...config.azure.resourceGroups.map((x) => x.name)]);
  for (const board of boards) {
    const appId = config.azure.appInsights.find((x) => x.name === board)?.id;
    const rg = config.azure.resourceGroups.find((x) => x.name === board)?.id;
    out.push({ board, capturedAt: new Date().toISOString(),
      ops: appId ? await ops(appId, rg) : null,
      cost: rg ? costBlock(await cloudCost(rg), board, epics[board] ?? []) : null });
  }
  return out;
}

export function demoAzure(epics: Record<string, Epic[]>): AzureSnapshot[] {
  return [
    { board: 'OSSI', capturedAt: new Date().toISOString(), ops: { requests30d: 1_840_000, failedRate: 2.9, p95LatencyMs: 1840, availability: 98.1, incidents30d: 7, medianRestoreMin: 310 }, cost: costBlock(142_000, 'OSSI', epics.OSSI ?? []) },
    { board: 'PLAT', capturedAt: new Date().toISOString(), ops: { requests30d: 9_200_000, failedRate: 0.3, p95LatencyMs: 420, availability: 99.95, incidents30d: 1, medianRestoreMin: 42 }, cost: costBlock(310_000, 'PLAT', epics.PLAT ?? []) },
  ];
}
