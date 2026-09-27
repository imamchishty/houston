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

export async function collect() {
  const sprints = config.mode === 'demo' ? demoSprints() : await collectJira();
  store.saveSprints(sprints);
  store.saveQuality(config.mode === 'demo' ? demoQuality(sprints) : await collectQuality(sprints));
  store.saveGithub(config.mode === 'demo' ? demoGithub() : config.github.token ? await collectGithub() : []);
  store.saveDocs(config.mode === 'demo' ? demoConfluence() : config.confluence.spaces.length ? await collectConfluence() : []);
  const epics: Record<string, import('./types.js').Epic[]> = {};
  for (const b of config.mode === 'demo' ? [{ name: 'OSSI' }, { name: 'PLAT' }] : config.jira.boards) {
    epics[b.name] = config.mode === 'demo' ? demoEpics(b.name, b.name === 'OSSI') : await collectEpics(b.name);
  }
  store.saveEpics(epics);
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
  return score();
}
