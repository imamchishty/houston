import assert from 'node:assert/strict';
import { Given, Then, type DataTable } from '@cucumber/cucumber';
import type { GithubSnapshot, QualitySnapshot } from '../../src/types.js';
import type { Slice } from '../../src/reports.js';

// A hand-built slice for one team over August 2026, with only what each scenario sets.
const empty = (): Slice => ({ from: Date.parse('2026-08-01T00:00:00Z'), to: Date.parse('2026-09-01T00:00:00Z'), boards: ['ABC'], prs: [], deploys: [], mainCommits: [], items: [], epics: [], sprints: [],
  incidents: [], quality: [], security: { alerts: [], coverage: {} }, support: [], supportConnected: false, ci: [], ops: [], projectKeys: ['ABC'], defaultBranches: { 'org/api': 'main' } });
let s: Slice = empty();
const measure = async (report: 'production' | 'flow' | 'quality', id: string) => {
  const { REPORTS, flatMeasures } = await import('../../src/reports.js');
  return flatMeasures(REPORTS[report](s)).find((m) => m.id === id)!;
};

Given('production data with no availability tests', function () { s = { ...empty(), ops: [{ failedRate: 0.5, availability: null, requests30d: 1000 }] }; });
Then('availability is not measured, and server errors are', async function () {
  assert.equal((await measure('production', 'availability')).value, null);
  assert.equal((await measure('production', 'server_errors')).value, 0.5);
});

Given('CI runs:', function (t: DataTable) {
  const ci: GithubSnapshot['ci'] = [];
  for (const r of t.hashes()) for (const [c, n] of [['success', r.success], ['failure', r.failure]] as const) for (let k = 0; k < Number(n); k++) ci.push({ repo: 'org/api', at: '2026-08-10T00:00:00Z', conclusion: c, durationMin: 5, branch: r.branch });
  s = { ...empty(), ci };
});
Then('the CI failure rate is {int}%', async function (v: number) { assert.equal((await measure('flow', 'ci_failure_rate')).value, v); });

Given('a Testmo project with no runs in 30 days', function () {
  s = { ...empty(), quality: [{ board: 'ABC', capturedAt: '', sprintId: 1, sonar: null, escapedBugs: 0, reopened: 0,
    testmo: { projectId: 1, lastRunPassRate: 0, runsLast30d: 0, failedTestsLastRun: 0, automatedShare: 0, flakyTests: 0 } } as unknown as QualitySnapshot] };
});
Then('the test pass rate is not measured', async function () { assert.equal((await measure('quality', 'test_pass_rate')).value, null); });

