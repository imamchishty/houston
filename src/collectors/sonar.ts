import { config } from '../config.js';
import type { QualitySnapshot } from '../types.js';

// SonarQube Web API. Token as basic auth username, empty password.
const METRICS = 'bugs,vulnerabilities,security_hotspots,code_smells,coverage,new_coverage,duplicated_lines_density,sqale_index,alert_status';

export async function sonarFor(projectKey: string): Promise<QualitySnapshot['sonar']> {
  const { url, token } = config.sonar;
  const res = await fetch(`${url}/api/measures/component?component=${encodeURIComponent(projectKey)}&metricKeys=${METRICS}`, {
    headers: { Authorization: 'Basic ' + Buffer.from(`${token}:`).toString('base64') },
  });
  if (!res.ok) throw new Error(`Sonar ${res.status} for ${projectKey}: ${await res.text()}`);
  const body = await res.json() as any;
  const m: Record<string, string> = {};
  for (const x of body.component.measures) m[x.metric] = x.value ?? x.period?.value ?? x.periods?.[0]?.value;
  const n = (k: string) => Number(m[k] ?? 0);
  return {
    projectKey,
    qualityGate: (m.alert_status as any) ?? 'NONE',
    bugs: n('bugs'),
    vulnerabilities: n('vulnerabilities'),
    securityHotspots: n('security_hotspots'),
    codeSmells: n('code_smells'),
    coverage: n('coverage'),
    newCoverage: m.new_coverage != null ? Number(m.new_coverage) : null,
    duplicatedLines: n('duplicated_lines_density'),
    techDebtHours: Math.round(n('sqale_index') / 60),
  };
}
