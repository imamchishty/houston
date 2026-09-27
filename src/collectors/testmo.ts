import { config } from '../config.js';
import type { QualitySnapshot } from '../types.js';

// Testmo REST API v1. Bearer token. Pulls automation runs for the project.
async function testmo<T>(path: string): Promise<T> {
  const res = await fetch(`${config.testmo.url}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${config.testmo.token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Testmo ${res.status} on ${path}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function testmoFor(projectId: number): Promise<QualitySnapshot['testmo']> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const runs = await testmo<any>(`/projects/${encodeURIComponent(projectId)}/automation/runs?per_page=100`);
  // Newest first by date, whatever order the API returns. Pass rate pools every run in 30 days: one flaky run
  // cannot swing it, and no runs means not measured.
  const all = [...(runs.result as any[])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const recent = all.filter((r) => r.created_at >= since);
  const last = all[0];
  const total = last ? last.tests_count ?? 0 : 0;
  const pooledTotal = recent.reduce((t, r) => t + (r.tests_count ?? 0), 0), pooledPassed = recent.reduce((t, r) => t + (r.tests_passed_count ?? 0), 0);
  // Testmo counts manual cases separately; automated share = automated tests / (automated + manual cases)
  const cases = await testmo<any>(`/projects/${encodeURIComponent(projectId)}/cases?per_page=1`);
  const manual = cases.meta?.total ?? 0;
  return {
    projectId,
    lastRunPassRate: pooledTotal ? Math.round((pooledPassed / pooledTotal) * 1000) / 10 : 0,
    runsLast30d: recent.length,
    failedTestsLastRun: last ? last.tests_failed_count ?? 0 : 0,
    automatedShare: total + manual ? Math.round((total / (total + manual)) * 100) : 0,
    flakyTests: last ? last.tests_retried_count ?? 0 : 0,
  };
}
