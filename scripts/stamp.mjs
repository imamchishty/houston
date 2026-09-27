// Writes build-info.json: which build this is, shown in the UI footer and at /api/version.
// CI: run number, commit and build time from the environment. Docker: the same, passed as build args.
// Locally: the last commit and its time, flagged if there are uncommitted changes.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const git = (...args) => {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
};
const env = (...names) => names.map((n) => process.env[n]).find((v) => v) ?? null;

const ci = !!env('CI', 'BUILD_NUMBER');
const info = {
  version: JSON.parse(readFileSync('package.json', 'utf8')).version,
  build: env('BUILD_NUMBER', 'GITHUB_RUN_NUMBER'),
  commit: (env('GIT_SHA', 'GITHUB_SHA') ?? git('rev-parse', 'HEAD') ?? '').slice(0, 7) || null,
  builtAt: env('BUILD_TIME') ?? (ci ? new Date().toISOString() : git('log', '-1', '--format=%cI')) ?? new Date().toISOString(),
  local: !ci,
  dirty: !ci && !!git('status', '--porcelain'),
};
writeFileSync('build-info.json', JSON.stringify(info, null, 2) + '\n');
console.log(`build-info: ${info.version} build ${info.build ?? 'local'} ${info.commit ?? 'no commit'}${info.dirty ? ' (uncommitted changes)' : ''} ${info.builtAt}`);
