import { config } from '../config.js';
import { canonical } from '../identity.js';
import type { DocPage, DocsSnapshot } from '../types.js';

// Confluence Cloud REST, same credentials as Jira (site is <jira base>/wiki).
async function cf<T>(path: string): Promise<T> {
  const { baseUrl, email, token } = config.jira;
  const auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
  const res = await fetch(`${baseUrl}/wiki${path}`, { headers: { Authorization: auth, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Confluence ${res.status} on ${path}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export function classify(title: string, labels: string[]): DocPage['type'] {
  const t = title.toLowerCase(), l = labels.map((x) => x.toLowerCase());
  const hit = (m: string[]) => m.some((k) => t.includes(k) || l.includes(k));
  if (hit(config.confluence.adr)) return 'adr';
  if (hit(config.confluence.runbook)) return 'runbook';
  if (hit(['design', 'architecture', 'rfc', 'proposal'])) return 'design';
  return 'other';
}

export async function collectConfluence(): Promise<DocsSnapshot[]> {
  const out: DocsSnapshot[] = [];
  for (const b of config.confluence.spaces) {
    const pages: DocPage[] = [];
    for (const space of b.spaces) {
      let start = 0;
      for (;;) {
        const page = await cf<any>(`/rest/api/content?spaceKey=${encodeURIComponent(space)}&type=page&status=current&limit=100&start=${start}&expand=version,history,metadata.labels`);
        for (const p of page.results) {
          const labels = (p.metadata?.labels?.results ?? []).map((x: any) => x.name as string);
          pages.push({
            id: p.id, title: p.title, space,
            type: classify(p.title, labels),
            createdAt: p.history?.createdDate, createdBy: canonical(p.history?.createdBy?.displayName) ?? 'unknown',
            updatedAt: p.version?.when, updatedBy: canonical(p.version?.by?.displayName) ?? 'unknown',
            labels, url: `${config.jira.baseUrl}/wiki${p._links?.webui ?? ''}`,
          });
        }
        if (!page._links?.next) break;
        start += page.results.length;
      }
    }
    out.push({ board: b.name, spaces: b.spaces, capturedAt: new Date().toISOString(), pages });
  }
  return out;
}

export function demoConfluence(): DocsSnapshot[] {
  const day = 86_400_000, now = Date.now();
  const mk = (i: number, title: string, type: DocPage['type'], by: string, ageDays: number, updatedDays: number): DocPage => ({
    id: String(i), title, space: 'OSSI', type, createdAt: new Date(now - ageDays * day).toISOString(), createdBy: by,
    updatedAt: new Date(now - updatedDays * day).toISOString(), updatedBy: by, labels: [type], url: '#',
  });
  const ossi: DocPage[] = [
    mk(1, 'Ossi architecture overview', 'design', 'Dinesh', 410, 380),
    mk(2, 'ADR-001 Use Postgres', 'adr', 'Dinesh', 400, 400),
    mk(3, 'Ossi API runbook', 'runbook', 'Aisha', 300, 210),
    mk(4, 'Sprint notes', 'other', 'Karim', 20, 6), mk(5, 'Retro 12', 'other', 'Karim', 34, 34),
    mk(6, 'Onboarding', 'other', 'Priya', 250, 250), mk(7, 'Release checklist', 'other', 'Fatima', 120, 95),
    mk(8, 'Ossi web runbook', 'runbook', 'Priya', 280, 280), mk(10, 'Incident 2026-09-12 API outage', 'other', 'Aisha', 15, 15), mk(9, 'FHIR mapping notes', 'design', 'Rahul', 60, 45),
  ];
  const plat = Array.from({ length: 30 }, (_, i) => mk(100 + i, i % 5 === 0 ? `ADR-0${i} decision` : i % 4 === 0 ? `runbook ${i}` : `page ${i}`, i % 5 === 0 ? 'adr' : i % 4 === 0 ? 'runbook' : 'other', ['Lena', 'Yusuf', 'Mei', 'Sam'][i % 4], 200 - i * 5, 10 + i * 2));
  return [{ board: 'OSSI', spaces: ['OSSI'], capturedAt: new Date().toISOString(), pages: ossi }, { board: 'PLAT', spaces: ['PLAT'], capturedAt: new Date().toISOString(), pages: plat }];
}
