// Normalised model. Every collector (Jira today, GitHub and Confluence next) maps into this.

export interface Issue {
  key: string;
  summary: string;
  type: string;            // Story, Bug, Task, Sub-task...
  status: string;
  statusCategory: 'todo' | 'inprogress' | 'done';
  points: number | null;
  assignee: string | null;
  hasAcceptanceCriteria: boolean;
  created: string;         // ISO
  resolved: string | null; // ISO
  addedToSprintAt: string | null; // ISO, when the issue entered this sprint
  sprintIds: number[];     // every sprint this issue has been in (carry-over detection)
  inProgressSince: string | null;
  epic?: string | null;     // parent epic (feature) key, for cost per feature
  // Every status change, oldest first: when, the status entered, and its Jira category (new / indeterminate / done).
  statusHistory?: { at: string; to: string; category: string }[];
}

export interface Sprint {
  id: number;
  name: string;
  board: string;           // team display name
  goal: string | null;
  start: string;
  end: string;
  state: 'closed' | 'active' | 'future';
  issues: Issue[];
  // team median cycle time (days) per story point size, learned from history. Set by the pipeline.
  baseline?: Record<string, number>;
}

export type Rag = 'green' | 'amber' | 'red';

export interface Finding {
  ruleId: string;
  title: string;
  area: 'delivery' | 'hygiene' | 'ownership' | 'flow' | 'quality' | 'docs' | 'features' | 'ops';
  value: number;
  unit: '%' | 'count' | 'days' | 'ratio';
  rag: Rag;
  message: string;         // plain English, one sentence, with the number in it
  action: string;          // what the team should do about it
  evidence: string[];      // issue keys backing the finding
  weight?: number;         // share of the area score: green earns all of it, amber half, red none
}

export interface Scorecard {
  board: string;
  sprintId: number;
  sprintName: string;
  sprintEnd: string;
  score: number;           // 0 to 100
  rag: Rag;
  findings: Finding[];
  generatedAt: string;
}

// Quality snapshot per team, from SonarQube and Testmo. Latest state, refreshed nightly.
export interface QualitySnapshot {
  board: string;
  capturedAt: string;
  sonar: {
    projectKey: string;
    qualityGate: 'OK' | 'ERROR' | 'NONE';
    bugs: number;
    vulnerabilities: number;
    securityHotspots: number;
    codeSmells: number;
    coverage: number;          // %
    newCoverage: number | null; // % on new code
    duplicatedLines: number;   // %
    techDebtHours: number;
  } | null;
  testmo: {
    projectId: number;
    lastRunPassRate: number;   // %
    runsLast30d: number;
    failedTestsLastRun: number;
    automatedShare: number;    // % of tests automated
    flakyTests: number;
  } | null;
  escapedBugs: number;         // bugs created after release in the last sprint, from Jira
  reopened: number;            // tickets reopened in the last sprint, from Jira
}

export type { PersonStats } from './people.js';

// GitHub, one PR normalised. Collected from GitHub Enterprise Server (or github.com), last N days.
export interface PullRequest {
  repo: string;
  number: number;
  title: string;
  author: string;
  createdAt: string;
  firstReviewAt: string | null;   // first review or review comment by someone other than the author
  approvedAt: string | null;
  mergedAt: string | null;
  closedAt: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewers: string[];            // people who left a review
  reviewCount: number;
  jiraKeys: string[];             // e.g. OSSI-1234 found in title, branch or body
  areas: string[];                // lane mapping from paths: frontend, backend, infra, tests, docs, other
  isHotfix: boolean;              // branch or title marks it as hotfix or revert
  draft: boolean;
  branch?: string;                // head branch name
  baseBranch?: string;            // branch it merges into
  reviewComments?: number;        // review comments and non-empty review bodies by someone other than the author
  isRevert?: boolean;             // GitHub revert PR ('Revert "..."' title or revert-NNN branch)
  firstCommitAt?: string | null;  // earliest commit author date in the PR (survives rebases), for coding time
  botReviews?: number;            // reviews and comments by bots, left out of every review measure (for the data check)
}

export interface Deploy {
  repo: string;
  at: string;
  ref: string;                    // tag or sha
  success: boolean;
}

export interface CiRun {
  repo: string;
  at: string;
  conclusion: 'success' | 'failure' | 'cancelled' | 'other';
  durationMin: number;
}

export interface GithubSnapshot {
  board: string;
  since: string;
  until: string;
  repos: string[];
  prs: PullRequest[];
  deploys: Deploy[];
  ci: CiRun[];
  defaultBranches?: Record<string, string>;   // repo -> default branch
  mainCommits?: MainCommit[];                  // commits on the default branch in the window
}

// A commit on a repo's default branch. viaPr: GitHub associates it with a merged pull request
// (true for merge, squash and rebase merges alike); false means it was pushed or merged without a PR.
export interface MainCommit { repo: string; sha: string; at: string; merge: boolean; viaPr: boolean }

// Confluence: pages in the team's spaces, for docs health and for who writes what.
export interface DocPage {
  id: string;
  title: string;
  space: string;
  type: 'adr' | 'runbook' | 'design' | 'other';   // from labels or title
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  labels: string[];
  url: string;
}
export interface DocsSnapshot { board: string; spaces: string[]; capturedAt: string; pages: DocPage[]; }

// Jira epics for feature lead time. An epic is a feature from the product team's point of view.
export interface Epic {
  key: string;
  summary: string;
  status: string;
  statusCategory: 'todo' | 'inprogress' | 'done';
  created: string;
  started: string | null;    // first move to In Progress
  resolved: string | null;
  childCount: number;
  childDone: number;
  due?: string | null;       // Jira due date, set from the roadmap
}

// Action log: what was done about a recommendation, by whom, and whether the number moved.
export interface Action {
  id: string;
  board: string;
  recId: string;
  title: string;
  status: 'accepted' | 'rejected' | 'done';
  owner: string;
  note: string;
  at: string;
  baseline: Record<string, number>; // rule values at the time, to compare later
}

// Azure: production health, incidents and cost per team.
export interface AzureSnapshot {
  board: string;
  capturedAt: string;
  ops: {
    requests30d: number;
    failedRate: number;        // % of requests failed, last 30 days
    p95LatencyMs: number;
    availability: number;      // % of availability test results passed, last 30 days
    incidents30d: number;      // sev0 to sev2 alerts fired
    medianRestoreMin: number | null; // DORA 4: alert fired to resolved
    incidents?: { firedAt: string; resolvedAt: string | null; severity: string }[]; // last 90 days, for the time to restore trend
  } | null;
  cost: {
    cloudMonthAed: number;     // last full month, cloud only, for the team's resource group
    teamMonthAed: number | null; // people cost from config
    featuresShipped90d: number;  // from epics
    costPerFeatureAed: number | null; // (cloud + team) × 3 ÷ features in 90 days
  } | null;
}

// Claude Code usage per person over the window, from Claude Code's OpenTelemetry metrics in Application Insights.
export interface ClaudeUser {
  name: string;               // canonical person (PEOPLE maps emails), or the email if unmapped
  email: string;
  activeDays: number;         // days with any Claude Code activity
  sessions: number;
  activeHours: number;
  linesAdded: number; linesRemoved: number;
  commits: number; pullRequests: number;
  editsAccepted: number; editsRejected: number;
  apiEquivalentUsd: number;   // tokens priced at API rates. On a seat plan this is NOT billed
}
export interface ClaudeSnapshot { board: string; capturedAt: string; days: number; users: ClaudeUser[] }

// Every work item in a team's Jira project created or resolved in the window, whether or not it was in a sprint.
// The source for bug metrics and ticket hygiene. Epics are in Epic[], not here.
export interface WorkItem {
  key: string; type: string; status: string; statusCategory: 'todo' | 'inprogress' | 'done';
  priority: string | null; reporter: string | null; assignee: string | null;
  created: string; resolved: string | null;
  points: number | null; epic: string | null; inSprint: boolean;
  labels?: string[];          // Jira labels, lower case
  env?: string | null;        // JIRA_BUG_ENV_FIELD value, if configured
}
export interface ProjectSnapshot { board: string; project: string; since: string; until: string; items: WorkItem[] }
