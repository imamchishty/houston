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
  flaggedSince?: string | null; // flagged in Jira (the Impediment flag) since then, and still flagged; null if not
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
  branch?: string;             // head branch of the run
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
  security?: { alerts: SecurityAlert[]; coverage: Record<string, ScanCoverage> };
}

// A GitHub security alert: a vulnerable dependency (Dependabot), a leaked secret (secret scanning) or a flaw in the
// team's own code (code scanning). Never the secret itself: only its type, where, and when.
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export interface SecurityAlert {
  repo: string; kind: 'dependency' | 'secret' | 'code'; number: number;
  severity: Severity;             // leaked secrets are always critical
  title: string;                  // package and advisory, rule, or secret type
  state: 'open' | 'fixed' | 'dismissed';
  createdAt: string; closedAt: string | null;   // fixed or dismissed at
}
// Whether each scanner is turned on for a repo. null: Houston could not tell (usually a missing token permission).
export interface ScanCoverage { dependency: boolean | null; secret: boolean | null; code: boolean | null }

// A commit on a repo's default branch. viaPr: GitHub associates it with a merged pull request
// (true for merge, squash and rebase merges alike); false means it was pushed or merged without a PR.
export interface MainCommit { repo: string; sha: string; at: string; merge: boolean; viaPr: boolean }

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

// Azure: production health, incidents and cost per team.
export interface AzureSnapshot {
  board: string;
  capturedAt: string;
  ops: {
    requests30d: number;
    failedRate: number;        // % of requests failed, last 30 days
    p95LatencyMs: number;
    availability: number | null; // % of availability test results passed, last 30 days; null when no tests run
    incidents30d: number;      // sev0 to sev2 alerts fired
    medianRestoreMin: number | null; // DORA 4: alert fired to resolved
    incidents?: { firedAt: string; resolvedAt: string | null; severity: string }[]; // last 90 days, for the time to restore trend
  } | null;
}

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

// Support tickets from plain Jira. Plain Jira has no SLA clock, so Houston keeps the times it needs and measures SLAs
// itself (SUPPORT_SLA, in working time). Changes are status changes made by people (automation left out), kept as
// times only: never who made them.
export interface SupportTicket {
  key: string; priority: string | null; created: string; resolved: string | null;
  reopened: boolean;              // resolved, then reopened (its resolution cleared)
  duplicate: boolean;             // linked as a duplicate of another ticket
  firstResponse: string | null;   // first comment by someone other than the reporter, or first status change by a person
  changes: string[];              // times of status changes made by people
}
export interface SupportSnapshot { board: string; project: string; capturedAt: string; tickets: SupportTicket[] }
