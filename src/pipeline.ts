import { config } from './config.js';
import { collectJira } from './collectors/jira.js';
import { demoSprints } from './collectors/demo.js';
import { scoreSprint } from './rules/engine.js';
import { store } from './store/index.js';
import { learnBaseline } from './cycle.js';
import { collectQuality, demoQuality } from './collectors/quality.js';
import { collectGithub } from './collectors/github.js';
import { demoGithub } from './collectors/githubDemo.js';
import { collectConfluence, demoConfluence } from './collectors/confluence.js';
import { collectEpics, demoEpics } from './collectors/epics.js';
import { collectAzure, demoAzure } from './collectors/azure.js';
import { collectClaude, demoClaude } from './collectors/claude.js';
import { collectProjects, demoProjects } from './collectors/projects.js';
import { boardData } from './board.js';
import { featureCosts } from './cost.js';
import { costRates } from './claude.js';
import { rosterFor } from './identity.js';
import { recordDay, backup } from './store/history.js';

export async function collect() {
  const sprints = config.mode === 'demo' ? demoSprints() : await collectJira();
  store.saveSprints(sprints);
  store.saveProjects(config.mode === 'demo' ? demoProjects(sprints) : await collectProjects());
  store.saveQuality(config.mode === 'demo' ? demoQuality(sprints) : await collectQuality(sprints));
  store.saveGithub(config.mode === 'demo' ? demoGithub() : config.github.token ? await collectGithub() : []);
  store.saveDocs(config.mode === 'demo' ? demoConfluence() : config.confluence.spaces.length ? await collectConfluence() : []);
  const epics: Record<string, import('./types.js').Epic[]> = {};
  for (const b of config.mode === 'demo' ? [{ name: 'OSSI' }, { name: 'PLAT' }] : config.jira.boards) {
    epics[b.name] = config.mode === 'demo' ? demoEpics(b.name, b.name === 'OSSI') : await collectEpics(b.name);
  }
  store.saveEpics(epics);
  store.saveClaude(config.mode === 'demo' ? demoClaude() : await collectClaude());
  store.saveAzure(config.mode === 'demo' ? demoAzure(epics) : config.azure.client ? await collectAzure(epics) : []);
  return sprints;
}

export function score() {
  const sprints = store.sprints();
  const boards = [...new Set(sprints.map((s) => s.board))];
  const baselines = Object.fromEntries(boards.map((b) => [b, learnBaseline(sprints.filter((s) => s.board === b))]));
  const cards = sprints.map((s) => scoreSprint({ ...s, baseline: baselines[s.board] }));
  store.saveScorecards(cards);
  return cards;
}

export async function run() {
  await collect();
  const cards = score();
  snapshot();
  return cards;
}

// Today's scores, metric values and feature costs into the history database, then a backup copy.
// Runs after every collect; a second run on the same day replaces that day's rows.
export function snapshot(day = new Date().toISOString().slice(0, 10)) {
  const boards = [...new Set(store.scorecards().map((c) => c.board))];
  for (const board of boards) {
    const b = boardData(board);
    if (!b.latest) continue;
    const areas = [
      { area: 'sprint', score: b.latest.score, rag: b.latest.rag },
      ...(['flow', 'quality', 'features', 'ops', 'docs'] as const).flatMap((k) => (b[k] ? [{ area: k, score: b[k]!.score, rag: b[k]!.rag }] : [])),
    ];
    const findings = [b.latest, b.flow, b.quality, b.features, b.ops, b.docs].flatMap((x) => x?.findings ?? []);
    const cost = config.cost.fteDay || config.cost.contractorDay
      ? featureCosts({ sprints: b.sprints, epics: b.raw.epics, rates: costRates(), roster: rosterFor(board), weekend: config.weekend })
      : null;
    recordDay({ day, board, areas, findings, sprints: b.history, cost });
  }
  if (boards.length) backup(day);
}
