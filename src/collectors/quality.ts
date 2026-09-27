import { config } from '../config.js';
import { sonarFor } from './sonar.js';
import { testmoFor } from './testmo.js';
import type { QualitySnapshot, Sprint } from '../types.js';

// Escaped bugs: Bug tickets created during the latest sprint. Reopened: done tickets that went back to in progress.
function jiraQuality(sprints: Sprint[], board: string) {
  const latest = sprints.filter((s) => s.board === board).sort((a, b) => b.id - a.id)[0];
  if (!latest) return { escapedBugs: 0, reopened: 0 };
  const escapedBugs = latest.issues.filter((i) => i.type === 'Bug' && i.created >= latest.start).length;
  const reopened = latest.issues.filter((i) => i.resolved && i.statusCategory !== 'done').length;
  return { escapedBugs, reopened };
}

export async function collectQuality(sprints: Sprint[]): Promise<QualitySnapshot[]> {
  const boards = [...new Set(sprints.map((s) => s.board))];
  const out: QualitySnapshot[] = [];
  for (const board of boards) {
    const sonarKey = config.sonar.projects.find((p) => p.name === board)?.id;
    const testmoId = config.testmo.projects.find((p) => p.name === board)?.id;
    out.push({
      board,
      capturedAt: new Date().toISOString(),
      sonar: sonarKey && config.sonar.token ? await sonarFor(sonarKey) : null,
      testmo: testmoId && config.testmo.token ? await testmoFor(Number(testmoId)) : null,
      ...jiraQuality(sprints, board),
    });
  }
  return out;
}

export function demoQuality(sprints: Sprint[]): QualitySnapshot[] {
  const q = (board: string, weak: boolean): QualitySnapshot => ({
    board,
    capturedAt: new Date().toISOString(),
    sonar: {
      projectKey: `m42-${board.toLowerCase()}`,
      qualityGate: weak ? 'ERROR' : 'OK',
      bugs: weak ? 47 : 6, vulnerabilities: weak ? 9 : 0, securityHotspots: weak ? 14 : 2,
      codeSmells: weak ? 1210 : 180, coverage: weak ? 31.4 : 78.2, newCoverage: weak ? 12.0 : 84.5,
      duplicatedLines: weak ? 11.8 : 2.1, techDebtHours: weak ? 412 : 38,
    },
    testmo: {
      projectId: weak ? 12 : 7, lastRunPassRate: weak ? 88.5 : 99.2, runsLast30d: weak ? 6 : 41,
      failedTestsLastRun: weak ? 23 : 1, automatedShare: weak ? 22 : 71, flakyTests: weak ? 15 : 2,
    },
    ...jiraQuality(sprints, board),
  });
  return [q('OSSI', true), q('PLAT', false)];
}
