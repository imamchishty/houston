import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { config, configProblems } from '../config.js';
import { store } from '../store/index.js';

// Teams set up in the admin page. Saved in the data folder (so they survive deploys, like history) and applied over
// the teams in .env: a team saved here replaces the .env team of the same name; deleting it brings the .env one back.
// Every value is checked with the same rules as .env, because it ends up in API paths and queries the same way.
export interface TeamSetup {
  name: string;                       // board name used everywhere in Houston
  jiraBoardId: number;
  jiraProject: string;                // Jira project key
  repos: string[];                    // owner/name
  sonarProject: string;               // '' when none
  testmoProject: string;              // numeric id as text, '' when none
  resourceGroup: string;              // Azure, '' when none
  appInsights: string;                // Application Insights app id, '' when none
  confluenceSpaces: string[];
  roster: string[];                   // people on the team, as the rest of Houston names them
  updatedAt: string; updatedBy: string;
}
export type TeamInput = Omit<TeamSetup, 'updatedAt' | 'updatedBy'>;

const FILE = () => join(config.dataDir, 'team-setup.json');
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
// The .env names in configProblems' messages, as the admin form calls those fields.
const LABELS: [string, string][] = [['JIRA_BOARDS name', 'Team name'], ['JIRA_BOARDS id', 'Jira board id'], ['JIRA_PROJECTS board', 'Team name'], ['JIRA_PROJECTS key', 'Jira project key'],
  ['GITHUB_REPOS board', 'Team name'], ['GITHUB_REPOS repo', 'GitHub repo (owner/name)'], ['SONAR_PROJECTS key', 'SonarQube project key'], ['TESTMO_PROJECTS id', 'Testmo project id (a number)'],
  ['CONFLUENCE_SPACES key', 'Confluence space key'], ['AZURE_APPINSIGHTS app id', 'Application Insights app id'], ['AZURE_RESOURCE_GROUPS', 'Azure resource group']];
const PERSON = /^[\p{L}\p{M}][\p{L}\p{M} .'-]{0,59}$/u;

// The teams as .env defines them, captured once so saved teams can be laid over them and removed again.
const BASE = clone({
  boards: config.jira.boards, projects: config.jira.projects, repos: config.github.repos, sonar: config.sonar.projects,
  testmo: config.testmo.projects, rgs: config.azure.resourceGroups, ai: config.azure.appInsights, spaces: config.confluence.spaces, roster: config.roster,
});

export function savedTeams(): TeamSetup[] {
  try { return existsSync(FILE()) ? (JSON.parse(readFileSync(FILE(), 'utf8')) as TeamSetup[]) : []; } catch { return []; }
}
function writeTeams(list: TeamSetup[]) {
  mkdirSync(config.dataDir, { recursive: true });
  const tmp = FILE() + '.tmp';
  writeFileSync(tmp, JSON.stringify(list, null, 2));
  renameSync(tmp, FILE()); // all or nothing: a crash never leaves half a file
}

// Normalise what the form sent: trim, drop blanks, the right types. Anything else in the body is ignored.
export function normalise(b: any): TeamInput {
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const list = (v: unknown) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\n,]/) : []).map((x) => s(x)).filter(Boolean);
  return {
    name: s(b?.name), jiraBoardId: Number(b?.jiraBoardId), jiraProject: s(b?.jiraProject).toUpperCase(), repos: list(b?.repos),
    sonarProject: s(b?.sonarProject), testmoProject: s(b?.testmoProject), resourceGroup: s(b?.resourceGroup), appInsights: s(b?.appInsights),
    confluenceSpaces: list(b?.confluenceSpaces), roster: list(b?.roster),
  };
}

// What would be wrong with the configuration if this team were saved. Empty means it is fine.
export function problems(t: TeamInput): string[] {
  const out: string[] = [];
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(t.name)) out.push('Team name: letters, digits, - and _, starting with a letter, up to 32');
  if (!t.jiraProject) out.push('Jira project key is required');
  if (!Number.isInteger(t.jiraBoardId) || t.jiraBoardId <= 0) out.push('Jira board id must be a number');
  if (t.repos.length > 50) out.push('At most 50 repos');
  if (t.roster.length > 100) out.push('At most 100 people');
  for (const p of t.roster) if (!PERSON.test(p)) out.push(`Roster: "${p.slice(0, 60)}" is not a name`);
  // The rest: exactly the .env rules, run on the configuration as it would be.
  const c = clone(config) as typeof config;
  layer(c, [...savedTeams().filter((x) => x.name !== t.name), { ...t, updatedAt: '', updatedBy: '' }]);
  const envOnly = new Set(configProblems(config));
  for (const p of configProblems(c)) if (!envOnly.has(p)) out.push(LABELS.reduce((x, [env, label]) => x.replace(env, label), p));
  return [...new Set(out)];
}

// Lay saved teams over the .env teams, into c.
function layer(c: typeof config, teams: TeamSetup[]) {
  const names = new Set(teams.map((t) => t.name)), keep = <T extends { name: string }>(xs: T[]) => clone(xs).filter((x) => !names.has(x.name));
  c.jira.boards = [...keep(BASE.boards), ...teams.map((t) => ({ name: t.name, id: t.jiraBoardId }))];
  c.jira.projects = { ...Object.fromEntries(Object.entries(BASE.projects).filter(([n]) => !names.has(n))), ...Object.fromEntries(teams.map((t) => [t.name, t.jiraProject])) };
  c.github.repos = [...keep(BASE.repos), ...teams.filter((t) => t.repos.length).map((t) => ({ name: t.name, repos: t.repos }))];
  c.sonar.projects = [...keep(BASE.sonar), ...teams.filter((t) => t.sonarProject).map((t) => ({ name: t.name, id: t.sonarProject }))];
  c.testmo.projects = [...keep(BASE.testmo), ...teams.filter((t) => t.testmoProject).map((t) => ({ name: t.name, id: t.testmoProject }))];
  c.azure.resourceGroups = [...keep(BASE.rgs), ...teams.filter((t) => t.resourceGroup).map((t) => ({ name: t.name, id: t.resourceGroup }))];
  c.azure.appInsights = [...keep(BASE.ai), ...teams.filter((t) => t.appInsights).map((t) => ({ name: t.name, id: t.appInsights }))];
  c.confluence.spaces = [...keep(BASE.spaces), ...teams.filter((t) => t.confluenceSpaces.length).map((t) => ({ name: t.name, spaces: t.confluenceSpaces }))];
  c.roster = [...keep(BASE.roster), ...teams.filter((t) => t.roster.length).map((t) => ({ name: t.name, people: t.roster }))];
}

// Apply the saved teams to the running configuration. Called at startup and after every change.
export const applySavedTeams = () => layer(config, savedTeams());

export function saveTeam(t: TeamInput, by: string): TeamSetup {
  const row: TeamSetup = { ...t, updatedAt: new Date().toISOString(), updatedBy: by };
  writeTeams([...savedTeams().filter((x) => x.name !== t.name), row].sort((a, b) => a.name.localeCompare(b.name)));
  applySavedTeams();
  return row;
}
export function deleteTeam(name: string): boolean {
  const list = savedTeams(); if (!list.some((x) => x.name === name)) return false;
  writeTeams(list.filter((x) => x.name !== name));
  applySavedTeams();
  return true;
}

// Every team Houston knows, and where its setup comes from.
export function allTeams() {
  const saved = new Map(savedTeams().map((t) => [t.name, t]));
  // Demo mode makes up its teams without any setup: list them too, marked as demo.
  const demo = config.mode === 'demo' ? [...new Set(store.scorecards().map((c) => c.board))].filter((n) => !config.jira.boards.some((b) => b.name === n)).map((name) => ({ name, id: 0 })) : [];
  return [...config.jira.boards, ...demo].map((b) => {
    const s = saved.get(b.name);
    return s ? { ...s, source: 'admin' as const } : {
      name: b.name, jiraBoardId: b.id, jiraProject: config.jira.projects[b.name] ?? b.name,
      repos: config.github.repos.find((r) => r.name === b.name)?.repos ?? [], sonarProject: config.sonar.projects.find((p) => p.name === b.name)?.id ?? '',
      testmoProject: config.testmo.projects.find((p) => p.name === b.name)?.id ?? '', resourceGroup: config.azure.resourceGroups.find((p) => p.name === b.name)?.id ?? '',
      appInsights: config.azure.appInsights.find((p) => p.name === b.name)?.id ?? '', confluenceSpaces: config.confluence.spaces.find((p) => p.name === b.name)?.spaces ?? [],
      roster: config.roster.find((r) => r.name === b.name)?.people ?? [], source: b.id ? 'env' as const : 'demo' as const,
    };
  });
}
