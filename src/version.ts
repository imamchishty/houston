import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Which build is running. Written by scripts/stamp.mjs at build time (npm run build, npm run dev, Docker, CI).
export interface BuildInfo { version: string; build: string | null; commit: string | null; builtAt: string | null; local: boolean; dirty: boolean }

// build-info.json sits in the project root: one level up from src/ in dev, from dist/ in the container.
const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'build-info.json');

export function buildInfo(): BuildInfo {
  try { return JSON.parse(readFileSync(file, 'utf8')) as BuildInfo; }
  catch { return { version: 'unknown', build: null, commit: null, builtAt: null, local: true, dirty: false }; }
}
