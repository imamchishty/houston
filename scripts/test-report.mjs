// Runs the tests and writes reports/test-report.json: what was proven for this build, shown on the admin page.
// BDD: every feature and scenario with its steps and result (from Cucumber's JSON output). Unit tests: pass or fail.
// npm audit: vulnerabilities by severity. The report carries build-info.json, so the admin page can tell whether
// it belongs to the version that is running.
//
//   npm run report                 run everything, then write the report
//   npm run report -- --existing   use reports/cucumber.json from a BDD run that already happened (CI)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const existing = process.argv.includes('--existing');
mkdirSync('reports', { recursive: true });
const run = (cmd, args, env = {}) => {
  const t = Date.now();
  const r = spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, ms: Date.now() - t };
};

// Stamp first, so the report and the image carry the same build.
run('node', ['scripts/stamp.mjs']);
const build = JSON.parse(readFileSync('build-info.json', 'utf8'));

const unit = run('npm', ['test', '--silent']);
let bddRun = { code: 0, ms: 0 };
if (!existing || !existsSync('reports/cucumber.json')) bddRun = run('npm', ['run', 'bdd', '--silent']);
const audit = run('npm', ['audit', '--json']);

const features = existsSync('reports/cucumber.json') ? JSON.parse(readFileSync('reports/cucumber.json', 'utf8')) : [];
const statusOf = (steps) => (steps.some((s) => s.result?.status === 'failed') ? 'failed' : steps.some((s) => ['undefined', 'ambiguous', 'pending'].includes(s.result?.status)) ? 'failed'
  : steps.every((s) => s.result?.status === 'passed' || (s.hidden && s.result?.status !== 'failed')) ? 'passed' : 'skipped');
const bdd = features.map((f) => ({
  name: f.name, file: f.uri, description: (f.description ?? '').trim(),
  scenarios: (f.elements ?? []).filter((e) => e.type === 'scenario').map((e) => {
    const steps = (e.steps ?? []).filter((s) => !s.hidden);
    const failed = steps.find((s) => s.result?.status === 'failed');
    return { name: e.name, line: e.line, status: statusOf(e.steps ?? []), ms: Math.round(steps.reduce((t, s) => t + (s.result?.duration ?? 0), 0) / 1e6),
      steps: steps.map((s) => `${s.keyword.trim()} ${s.name}`), error: failed ? String(failed.result.error_message ?? '').split('\n').slice(0, 6).join('\n') : undefined };
  }),
}));
const all = bdd.flatMap((f) => f.scenarios);
let vulns = null;
try { vulns = JSON.parse(audit.out).metadata?.vulnerabilities ?? null; } catch { /* audit output was not JSON */ }

const report = {
  generatedAt: new Date().toISOString(), build,
  bdd: { passed: all.filter((s) => s.status === 'passed').length, failed: all.filter((s) => s.status === 'failed').length, skipped: all.filter((s) => s.status === 'skipped').length,
    scenarios: all.length, features: bdd.length, ms: bddRun.ms, ok: all.length > 0 && all.every((s) => s.status === 'passed') },
  unit: { ok: unit.code === 0, ms: unit.ms, output: unit.out.trim().split('\n').slice(-10).join('\n') },
  audit: { ok: !!vulns && (vulns.high ?? 0) + (vulns.critical ?? 0) === 0, vulnerabilities: vulns },
  featureList: bdd,
};
writeFileSync('reports/test-report.json', JSON.stringify(report));
console.log(`test report: ${report.bdd.passed}/${report.bdd.scenarios} scenarios passed, unit ${report.unit.ok ? 'ok' : 'FAILED'}, audit ${report.audit.ok ? 'ok' : 'FINDINGS'} -> reports/test-report.json`);
process.exit(report.bdd.ok && report.unit.ok && report.audit.ok ? 0 : 1);
