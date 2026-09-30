import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { config, configProblems } from '../config.js';
import { store } from '../store/index.js';
import { DONE_CHECKS, READY_CHECKS } from '../definitions.js';

// Settings edited in the admin page: support SLAs per priority (any priority names: P0, P1, Highest, ...), the working
// week they are measured in, how support tickets are found, and which Definition of Ready and Done checks apply. Saved in the data folder (they survive deploys) and applied over .env, exactly as teams are; "reset"
// deletes the file and the .env values come back. Checked with the same rules as .env before saving.
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export interface Settings {
  workingHours: string;                                  // HH:MM-HH:MM, local time
  weekend: string[];                                     // day names: sat, sun
  tzOffset: number;                                      // hours from UTC
  supportSla: { priority: string; response: string; resolution: string }[];  // durations: 4h, 2d (working days)
  supportTypes: string[]; supportLabels: string[];
  readyChecks: string[]; doneChecks: string[];            // Definition of Ready / Done: ids from src/definitions.ts
  maxPoints: number;                                     // Ready: the biggest ticket that fits a sprint
}

const FILE = () => join(config.dataDir, 'settings.json');
const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const fromConfig = (c: typeof config): Settings => ({
  workingHours: `${hhmm(c.workingHours.start)}-${hhmm(c.workingHours.end)}`,
  weekend: c.weekend.map((d) => DAYS[d]).filter(Boolean), tzOffset: c.tzOffset,
  supportSla: Object.entries(c.jira.supportSla).map(([priority, v]) => ({ priority, ...v })),
  supportTypes: [...c.jira.supportTypes], supportLabels: [...c.jira.supportLabels],
  readyChecks: [...c.definitions.ready], doneChecks: [...c.definitions.done], maxPoints: c.definitions.maxPoints,
});
// The .env values, captured once, so a reset can bring them back.
const ENV = JSON.parse(JSON.stringify(fromConfig(config))) as Settings;
const definitionsOf = (s: Settings) => ({ readyChecks: s.readyChecks, doneChecks: s.doneChecks, maxPoints: s.maxPoints });

export function savedSettings(): Settings | null {
  // A file saved before the definitions existed keeps the .env definitions.
  try { return existsSync(FILE()) ? { ...definitionsOf(ENV), ...(JSON.parse(readFileSync(FILE(), 'utf8')) as Settings) } : null; } catch { return null; }
}
// Saved settings as typed (priority names keep their case: P0, Highest); otherwise the .env values in use.
export const currentSettings = () => ({ checks: { ready: READY_CHECKS, done: DONE_CHECKS }, settings: savedSettings() ?? fromConfig(config), source: savedSettings() ? 'admin' as const : 'env' as const, env: ENV,
  // Priorities seen on support tickets, so a missing SLA is easy to spot.
  prioritiesSeen: [...new Set(store.support().flatMap((s) => s.tickets.map((t) => t.priority ?? 'none')))].sort() });

// Tidy what the form sent: trim, drop blanks, the right types. Anything else is ignored.
export function normaliseSettings(b: any): Settings {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const list = (v: unknown) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\n,]/) : []).map(str).filter(Boolean);
  return {
    workingHours: str(b?.workingHours), weekend: list(b?.weekend).map((d) => d.toLowerCase().slice(0, 3)), tzOffset: Number(b?.tzOffset),
    supportSla: (Array.isArray(b?.supportSla) ? b.supportSla : []).map((r: any) => ({ priority: str(r?.priority), response: str(r?.response).toLowerCase(), resolution: str(r?.resolution).toLowerCase() })).filter((r: any) => r.priority || r.response || r.resolution),
    supportTypes: list(b?.supportTypes), supportLabels: list(b?.supportLabels).map((x) => x.toLowerCase()),
    // Left out of the request: keep what is in force (a form that only edits SLAs does not switch the checks off).
    readyChecks: Array.isArray(b?.readyChecks) ? list(b.readyChecks) : [...config.definitions.ready],
    doneChecks: Array.isArray(b?.doneChecks) ? list(b.doneChecks) : [...config.definitions.done],
    maxPoints: b?.maxPoints == null || b.maxPoints === '' ? config.definitions.maxPoints : Number(b.maxPoints),
  };
}

function layer(c: typeof config, s: Settings) {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(s.workingHours);
  c.workingHours = m ? { start: +m[1] + +m[2] / 60, end: +m[3] + +m[4] / 60 } : { start: NaN, end: NaN };
  c.weekend = s.weekend.map((d) => DAYS.indexOf(d as (typeof DAYS)[number]));
  c.tzOffset = s.tzOffset;
  c.jira.supportSla = Object.fromEntries(s.supportSla.map((r) => [r.priority.toLowerCase(), { response: r.response, resolution: r.resolution }]));
  c.jira.supportTypes = [...s.supportTypes]; c.jira.supportLabels = [...s.supportLabels];
  c.definitions.ready = [...s.readyChecks]; c.definitions.done = [...s.doneChecks]; c.definitions.maxPoints = s.maxPoints;
}

export function settingsProblems(s: Settings): string[] {
  const out: string[] = [];
  if (!/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(s.workingHours)) out.push('Working day: use HH:MM-HH:MM, e.g. 08:00-18:00');
  if (s.weekend.length > 6) out.push('Weekend: leave at least one working day');
  if (!Number.isFinite(s.tzOffset)) out.push('Time zone: hours from UTC, e.g. 4 for the UAE');
  const seen = new Set<string>();
  for (const r of s.supportSla) {
    if (!/^[\w .-]{1,40}$/.test(r.priority)) out.push(`SLA priority "${r.priority.slice(0, 40)}": letters, digits, spaces, . and -`);
    if (seen.has(r.priority.toLowerCase())) out.push(`SLA priority "${r.priority}" appears twice`);
    seen.add(r.priority.toLowerCase());
    for (const [what, d] of [['respond', r.response], ['resolve', r.resolution]] as const) if (!/^\d+(\.\d+)?[hd]$/.test(d)) out.push(`SLA ${r.priority}: time to ${what} "${d}" should look like 4h or 2d`);
  }
  if (s.supportSla.length > 20) out.push('At most 20 priorities');
  if (!s.supportTypes.length && !s.supportLabels.length) out.push('Support tickets: give at least one issue type or label (teams with a separate support project are not affected)');
  // Then the .env rules, on the configuration as it would be.
  const c = JSON.parse(JSON.stringify(config)) as typeof config; layer(c, s);
  const before = new Set(configProblems(config));
  for (const p of configProblems(c)) if (!before.has(p)) out.push(p);
  return [...new Set(out)];
}

function write(s: Settings) {
  mkdirSync(config.dataDir, { recursive: true });
  const tmp = FILE() + '.tmp'; writeFileSync(tmp, JSON.stringify(s, null, 2)); renameSync(tmp, FILE());
}
export function applySavedSettings() { const s = savedSettings(); layer(config, s ?? ENV); }
export function saveSettings(s: Settings) { write(s); applySavedSettings(); }
export function resetSettings() { if (existsSync(FILE())) rmSync(FILE()); applySavedSettings(); }
