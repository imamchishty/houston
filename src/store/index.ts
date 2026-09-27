import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import type { ClaudeSnapshot, AzureSnapshot, Action, DocsSnapshot, Epic, GithubSnapshot, QualitySnapshot, Scorecard, Sprint } from '../types.js';

// JSON file store. Same interface can be backed by Postgres in phase 2.
const file = (name: string) => join(config.dataDir, `${name}.json`);

function read<T>(name: string, fallback: T): T {
  const p = file(name);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : fallback;
}
function write(name: string, data: unknown) {
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(file(name), JSON.stringify(data, null, 2));
}

export const store = {
  saveSprints: (s: Sprint[]) => write('sprints', s),
  sprints: () => read<Sprint[]>('sprints', []),
  saveScorecards: (s: Scorecard[]) => write('scorecards', s),
  scorecards: () => read<Scorecard[]>('scorecards', []),
  saveQuality: (q: QualitySnapshot[]) => write('quality', q),
  quality: () => read<QualitySnapshot[]>('quality', []),
  saveGithub: (g: GithubSnapshot[]) => write('github', g),
  github: () => read<GithubSnapshot[]>('github', []),
  saveDocs: (d: DocsSnapshot[]) => write('docs', d),
  docs: () => read<DocsSnapshot[]>('docs', []),
  saveEpics: (e: Record<string, Epic[]>) => write('epics', e),
  // No prototype, so a board named 'constructor' or '__proto__' is just missing, not an inherited function.
  epics: () => Object.assign(Object.create(null), read<Record<string, Epic[]>>('epics', {})) as Record<string, Epic[] | undefined>,
  saveAzure: (a: AzureSnapshot[]) => write('azure', a),
  azure: () => read<AzureSnapshot[]>('azure', []),
  saveClaude: (c: ClaudeSnapshot[]) => write('claude', c),
  claude: () => read<ClaudeSnapshot[]>('claude', []),
  actions: () => read<Action[]>('actions', []),
  saveActions: (a: Action[]) => write('actions', a),
};
