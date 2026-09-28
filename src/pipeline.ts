import { config } from './config.js';
import { collectJira } from './collectors/jira.js';
import { demoSprints } from './collectors/demo.js';
import { store } from './store/index.js';
import { collectQuality, demoQuality } from './collectors/quality.js';
import { collectGithub } from './collectors/github.js';
import { demoGithub } from './collectors/githubDemo.js';
import { collectEpics, demoEpics } from './collectors/epics.js';
import { collectAzure, demoAzure } from './collectors/azure.js';
import { collectProjects, demoProjects } from './collectors/projects.js';
import { collectSupport, demoSupport } from './collectors/support.js';
import { recordValues, backup } from './store/history.js';
import { recordLastMonth } from './monthly.js';
import { slice, flatMeasures, REPORTS } from './reports.js';
import { boards, score } from './performance.js';

export async function collect() {
  const sprints = config.mode === 'demo' ? demoSprints() : await collectJira();
  store.saveSprints(sprints);
  store.saveProjects(config.mode === 'demo' ? demoProjects(sprints) : await collectProjects());
  store.saveSupport(config.mode === 'demo' ? demoSupport() : await collectSupport());
  store.saveQuality(config.mode === 'demo' ? demoQuality(sprints) : await collectQuality(sprints));
  store.saveGithub(config.mode === 'demo' ? demoGithub() : config.github.token ? await collectGithub() : []);
  const epics: Record<string, import('./types.js').Epic[]> = {};
  for (const b of config.mode === 'demo' ? [{ name: 'OSSI' }, { name: 'PLAT' }] : config.jira.boards) {
    epics[b.name] = config.mode === 'demo' ? demoEpics(b.name, b.name === 'OSSI') : await collectEpics(b.name);
  }
  store.saveEpics(epics);
  store.saveAzure(config.mode === 'demo' ? demoAzure() : config.azure.client ? await collectAzure() : []);
  return sprints;
}

export async function run() {
  const sprints = await collect();
  snapshot();
  return sprints;
}

// Today's score and every measure (last 30 days) into the history database, then a backup copy. The score has the
// id "score"; measures are prefixed "r:". Runs after every collect; a second run on the same day replaces that day's rows.
export function snapshot(day = new Date().toISOString().slice(0, 10)) {
  const bs = boards();
  for (const board of bs) {
    const ms = Object.values(REPORTS).flatMap((fn) => flatMeasures(fn(slice(board, 30))));
    const sc = score(new Map(ms.map((m) => [m.id, m])));
    recordValues(day, board, [
      ...(sc.pct == null ? [] : [{ metric: 'score', value: sc.pct, met: null }]),
      ...ms.filter((m) => m.value != null).map((m) => ({ metric: `r:${m.id}`, value: m.value!, met: m.met })),
    ]);
  }
  if (bs.length) { recordLastMonth(); backup(day); }
}
