import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import type { Scorecard, Finding, Rag } from '../types.js';
import type { CostReport } from '../cost.js';

// History that survives the nightly re-collect. The JSON store holds "now"; this holds every day since go-live.
//
// Durability:
// - Each night's snapshot is one transaction. A crash mid-write loses that night's write, never earlier history.
// - Re-running the same day replaces that day (upsert), so a retried job does not double count.
// - A consistent copy goes to <data>/backups/history-YYYY-MM-DD.db after each snapshot; the last HOUSTON_BACKUP_DAYS are kept.
// - Rollback journal, not WAL: WAL needs shared memory, which network shares such as Azure Files do not provide.

export interface AreaScore { area: string; score: number; rag: Rag }

let db: DatabaseSync | null = null;
const file = () => join(config.dataDir, 'history.db');

// Schema changes are numbered steps, applied once each, in order, recorded in PRAGMA user_version.
// Never edit a step that has shipped: add a new one. Before any step runs on an existing database, a copy is saved,
// and an older Houston refuses a newer database instead of writing to a schema it does not know.
export const MIGRATIONS: string[] = [
  // 1: first schema
  `CREATE TABLE IF NOT EXISTS area_scores (day TEXT NOT NULL, board TEXT NOT NULL, area TEXT NOT NULL, score REAL NOT NULL, rag TEXT NOT NULL,
     PRIMARY KEY (day, board, area));
   CREATE TABLE IF NOT EXISTS metric_values (day TEXT NOT NULL, board TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL, rag TEXT NOT NULL,
     PRIMARY KEY (day, board, metric));
   CREATE TABLE IF NOT EXISTS sprint_scorecards (board TEXT NOT NULL, sprint_id INTEGER NOT NULL, sprint_name TEXT NOT NULL, sprint_end TEXT NOT NULL,
     score REAL NOT NULL, rag TEXT NOT NULL, card TEXT NOT NULL, updated TEXT NOT NULL, PRIMARY KEY (board, sprint_id));
   CREATE TABLE IF NOT EXISTS team_costs (day TEXT NOT NULL, board TEXT NOT NULL, currency TEXT NOT NULL, team_cost REAL NOT NULL, on_features REAL NOT NULL,
     no_feature REAL NOT NULL, not_on_tickets REAL NOT NULL, cost_per_point REAL, PRIMARY KEY (day, board));
   CREATE TABLE IF NOT EXISTS feature_costs (day TEXT NOT NULL, board TEXT NOT NULL, feature TEXT NOT NULL, status TEXT NOT NULL, spent REAL NOT NULL,
     fte REAL NOT NULL, contractor REAL NOT NULL, to_complete REAL NOT NULL, total REAL NOT NULL, PRIMARY KEY (day, board, feature));`,
];

export const schemaVersion = () => (open().prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

function migrate(d: DatabaseSync) {
  const current = (d.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (current > MIGRATIONS.length)
    throw new Error(`history.db is schema ${current}, this Houston knows ${MIGRATIONS.length}. Deploy the newer version or restore a backup; not writing to it.`);
  if (current === MIGRATIONS.length) return;
  const hasData = (d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n > 0;
  if (hasData) {
    const dir = join(config.dataDir, 'backups');
    mkdirSync(dir, { recursive: true });
    const copy = join(dir, `history-before-schema-${MIGRATIONS.length}-${new Date().toISOString().slice(0, 10)}.db`);
    if (!existsSync(copy)) d.prepare('VACUUM INTO ?').run(copy);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    d.exec('BEGIN IMMEDIATE');
    try { d.exec(MIGRATIONS[v]); d.exec(`PRAGMA user_version = ${v + 1}`); d.exec('COMMIT'); }
    catch (e) { d.exec('ROLLBACK'); throw e; }
  }
}

function open(): DatabaseSync {
  if (db) return db;
  mkdirSync(config.dataDir, { recursive: true });
  const d = new DatabaseSync(file());
  d.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 10000;
  `);
  try { migrate(d); } catch (e) { d.close(); throw e; }
  db = d;
  return db;
}

export function closeHistory() { db?.close(); db = null; }

// One board's snapshot for one day, in a single transaction.
export function recordDay(input: { day: string; board: string; areas: AreaScore[]; findings: Finding[]; sprints: Scorecard[]; cost: CostReport | null }) {
  const d = open();
  const now = new Date().toISOString();
  d.exec('BEGIN IMMEDIATE');
  try {
    const area = d.prepare('INSERT OR REPLACE INTO area_scores (day, board, area, score, rag) VALUES (?, ?, ?, ?, ?)');
    for (const a of input.areas) area.run(input.day, input.board, a.area, a.score, a.rag);
    const metric = d.prepare('INSERT OR REPLACE INTO metric_values (day, board, metric, value, rag) VALUES (?, ?, ?, ?, ?)');
    for (const f of input.findings) metric.run(input.day, input.board, f.ruleId, f.value, f.rag);
    // Sprints are kept for good: Jira only gives back the last SPRINT_HISTORY, this keeps every one ever scored.
    const sprint = d.prepare('INSERT OR REPLACE INTO sprint_scorecards (board, sprint_id, sprint_name, sprint_end, score, rag, card, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const c of input.sprints) sprint.run(c.board, c.sprintId, c.sprintName, c.sprintEnd, c.score, c.rag, JSON.stringify(c), now);
    if (input.cost) {
      const c = input.cost;
      d.prepare('INSERT OR REPLACE INTO team_costs (day, board, currency, team_cost, on_features, no_feature, not_on_tickets, cost_per_point) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(input.day, input.board, c.currency, c.teamCost, c.onFeatures, c.noFeature, c.notOnTickets, c.costPerPoint);
      const fc = d.prepare('INSERT OR REPLACE INTO feature_costs (day, board, feature, status, spent, fte, contractor, to_complete, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const f of c.features) fc.run(input.day, input.board, f.key, f.status, f.spent, f.fte, f.contractor, f.toComplete, f.total);
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

// Consistent copy of the whole database, then drop copies older than the retention window.
export function backup(day: string, keep = Number(process.env.HOUSTON_BACKUP_DAYS ?? 30)) {
  const dir = join(config.dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('backup day must be YYYY-MM-DD');
  const target = join(dir, `history-${day}.db`);
  if (existsSync(target)) rmSync(target); // VACUUM INTO will not overwrite
  open().prepare('VACUUM INTO ?').run(target); // bound, not built into the SQL
  const copies = readdirSync(dir).filter((f) => /^history-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  for (const old of copies.slice(0, Math.max(0, copies.length - keep))) rmSync(join(dir, old));
  return target;
}

// Reads for the API and UI.
export function history(board: string, days = 365) {
  const d = open();
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return {
    areas: d.prepare('SELECT day, area, score, rag FROM area_scores WHERE board = ? AND day >= ? ORDER BY day, area').all(board, since),
    sprints: d.prepare('SELECT sprint_id AS sprintId, sprint_name AS sprintName, sprint_end AS sprintEnd, score, rag FROM sprint_scorecards WHERE board = ? ORDER BY sprint_end').all(board),
    costs: d.prepare('SELECT day, currency, team_cost AS teamCost, on_features AS onFeatures, no_feature AS noFeature, not_on_tickets AS notOnTickets, cost_per_point AS costPerPoint FROM team_costs WHERE board = ? AND day >= ? ORDER BY day').all(board, since),
    features: d.prepare('SELECT day, feature, status, spent, to_complete AS toComplete, total FROM feature_costs WHERE board = ? AND day >= ? ORDER BY feature, day').all(board, since),
    firstDay: (d.prepare('SELECT MIN(day) AS first FROM area_scores WHERE board = ?').get(board) as { first: string | null }).first,
  };
}

// Metric values over time, for one board and metric.
export function metricHistory(board: string, metric: string, days = 365) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return open().prepare('SELECT day, value, rag FROM metric_values WHERE board = ? AND metric = ? AND day >= ? ORDER BY day').all(board, metric, since);
}
