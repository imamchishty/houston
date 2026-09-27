import { store } from './store/index.js';
import { peopleStats } from './people.js';
import { scoreQuality } from './rules/qualityRules.js';
import { scoreFlow } from './rules/flowRules.js';
import { githubPeople } from './githubPeople.js';
import { rosterFor } from './identity.js';
import { scoreDocs, docsPeople } from './rules/docsRules.js';
import { scoreFeatures } from './rules/featureRules.js';
import { scoreOps } from './rules/opsRules.js';

// Everything Houston knows about one board, assembled once per request.
export function boardData(board: string) {
  const history = store.scorecards().filter((c) => c.board === board).sort((a, b) => a.sprintId - b.sprintId);
  const sprints = store.sprints().filter((s) => s.board === board);
  const q = store.quality().find((x) => x.board === board);
  const g = store.github().find((x) => x.board === board);
  const d = store.docs().find((x) => x.board === board);
  const epics = store.epics()[board] ?? [];
  const az = store.azure().find((x) => x.board === board);
  return {
    ops: az ? scoreOps(az) : null,
    history, sprints, latest: history[history.length - 1],
    quality: q ? scoreQuality(q) : null,
    flow: g ? scoreFlow(g) : null,
    docs: d ? scoreDocs(d, g?.repos.length ?? 1) : null,
    features: epics.length ? scoreFeatures(epics) : null,
    people: peopleStats(sprints),
    github: g ? githubPeople(g, rosterFor(board)) : [],
    docsPeople: d ? docsPeople(d) : [],
    raw: { sprints, github: g, docs: d, epics },
  };
}
