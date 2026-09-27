import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInfo } from '../version.js';

// The test report written by scripts/test-report.mjs at build time and shipped in the image. The live service never
// runs tests; it shows what was proven for the version it is. reports/ sits in the project root, like build-info.json.
const FILE = () => process.env.HOUSTON_TEST_REPORT ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'reports', 'test-report.json');

export function testReport() {
  const f = FILE();
  if (!existsSync(f)) return { available: false as const, message: 'No test report in this build. Run "npm run report" (the deploy script does this before building the image).' };
  const r = JSON.parse(readFileSync(f, 'utf8'));
  const running = buildInfo();
  // Same build when the commits match; a local run with uncommitted changes is never an exact match.
  const sameBuild = !!r.build?.commit && r.build.commit === running.commit && !r.build.dirty;
  return { available: true as const, sameBuild, running, ...r };
}
