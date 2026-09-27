import type { DocsSnapshot, AzureSnapshot } from './types.js';

// Incident write-ups: for each incident in the window, is there a post-incident page in Confluence?
// Pages classified as incident: title or label contains "incident", "postmortem", "post-incident", "RCA".
export interface IncidentLog { incidents30d: number; writeUps30d: number; missing: number; latestWriteUp: string | null; verdict: string; }

export function incidentLog(az: AzureSnapshot | undefined, docs: DocsSnapshot | undefined): IncidentLog | null {
  if (!az?.ops) return null;
  const since = Date.now() - 30 * 86_400_000;
  const pages = (docs?.pages ?? []).filter((p) => /incident|postmortem|post-incident|\bRCA\b/i.test(`${p.title} ${p.labels.join(' ')}`) && new Date(p.createdAt).getTime() >= since);
  const missing = Math.max(0, az.ops.incidents30d - pages.length);
  return {
    incidents30d: az.ops.incidents30d, writeUps30d: pages.length, missing,
    latestWriteUp: pages.map((p) => p.createdAt).sort().pop() ?? null,
    verdict: az.ops.incidents30d === 0 ? 'No Sev0 to Sev2 incidents in 30 days.'
      : missing === 0 ? `${pages.length} write-ups for ${az.ops.incidents30d} incidents. Every incident is logged.`
      : `${az.ops.incidents30d} incidents in 30 days, ${pages.length} written up. ${missing} incidents have no post-incident page. In a regulated environment an incident without a record is a finding, not a gap.`,
  };
}
