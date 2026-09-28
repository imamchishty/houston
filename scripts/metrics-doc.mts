// Writes METRICS.md from the measures themselves (definitions, targets, why they matter), so the document cannot
// drift from the numbers. Run: npm run metrics-doc
import { writeFileSync } from 'node:fs';
import { metricCatalogue } from '../src/metrics.js';
import { AREAS } from '../src/performance.js';
import { config } from '../src/config.js';

const cat = metricCatalogue(), cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const out: string[] = [
  '# Houston metric definitions', '',
  'How each team is performing: 10 headline measures in five areas: planning, execution, quality, stability and support,',
  'and security. This file is generated',
  'from the code (`npm run metrics-doc`); every definition below is the text the measure itself carries.', '',
  '## The score', '',
  '- **Score** = headline targets met ÷ headline targets judged, as a percentage, for the period (7, 30 or 90 days).',
  '- A headline is **judged** when it has a value and enough items to trust it: at least 10 for a rate, 5 for a median. Smaller samples are shown, marked "small sample", and not scored.',
  '- **Trend**: the same measure or score for the period just before, like for like.',
  '- **Needs attention**: a headline target missed this period and the one before.',
  '- **Drill-down** measures explain a headline. They have their own targets where one makes sense, and never count in the score.',
  '- DORA tiers (Elite, High, Medium, Low) label the four DORA measures; they do not change the score.', '',
  '## Conventions', '',
  '- Reviews: only a person other than the author counts. Bots (GitHub type Bot, logins ending [bot], `GITHUB_BOTS`) are left out.',
  '- Work start: the first move into any status Jira classes as In Progress, whatever its name. The full ticket history is read.',
  '- Medians, not averages, so one outlier does not move a team number. "Work item" means any Jira issue except sub-tasks.',
  `- Working time: \`WORKING_HOURS\` on days not in \`WEEKEND\`, in \`TZ_OFFSET_HOURS\` (now ${config.workingHours.start}:00 to ${config.workingHours.end}:00, UTC${config.tzOffset >= 0 ? '+' : ''}${config.tzOffset}).`,
  '- "Not measured" means there was nothing to count (0 of 0), never 0%.', '',
];
for (const a of AREAS) {
  out.push(`## ${a.title}`, '', `${a.question}`, '', '| Measure | Why it matters | How it is calculated | Target |', '|---|---|---|---|');
  for (const h of a.headlines) for (const m of cat.filter((x) => x.id === h || x.explains === h))
    out.push(`| ${m.headline ? '**' : '↳ '}\`${m.id}\` ${cell(m.name)}${m.headline ? '**' : ''} | ${cell(m.why)} | ${cell(m.how)} | ${m.target ?? ''} |`);
  out.push('');
}
out.push(
  '## Settings that change a number', '',
  '- Change failure rate: `CFR_SOURCE=hotfix` (default: hotfix or revert PRs and failed deploys), `bugs` (significant bugs per deploy), or `linked`. Significant priorities: `JIRA_SIGNIFICANT_PRIORITIES`.',
  '- Waiting statuses for flow efficiency: `JIRA_WAIT_STATUSES`. QA statuses: `JIRA_QA_STATUSES`. Debt and risk labels for what was delivered: `FLOW_DEBT_LABELS`, `FLOW_RISK_LABELS`.',
  '- Bugs found in production vs before release: `BUG_PROD_LABELS`, `BUG_QA_LABELS`, or `JIRA_BUG_ENV_FIELD`.',
  '- Support tickets: every ticket in `SUPPORT_PROJECTS`, or support issue types (`SUPPORT_ISSUE_TYPES`) and labels (`SUPPORT_LABELS`) in the team\'s own project. SLAs: `SUPPORT_SLA` (priority=response/resolution, h hours or d working days). First response: the first comment by someone other than the reporter, or the first status change by a person. Only times are stored, never names or comment text.',
  '- Security deadlines: `SECURITY_DEADLINE_DAYS` (default critical 7, high 30, medium 90; low has no deadline). A leaked secret is fixed only when revoked; its value is never stored.', '',
  '## Current sprint', '',
  '- Working days: days from sprint start to end not in `WEEKEND`. Committed: points of items in the sprint before it started. Done: points of items resolved by now.',
  '- Outlook: projected = done ÷ working days elapsed × working days in the sprint. On track if projected ≥ scope, at risk if ≥ 80% of scope, otherwise off track.',
  '- Burndown: remaining = scope that day − done by that day. Jira does not report items removed from a sprint, so scope only rises.',
  '- Blocked or waiting now: open items flagged in Jira (the Impediment flag), or in a waiting status (`JIRA_WAIT_STATUSES`). Blocked (flagged, or a status with blocked, on hold or impediment in its name) first, then the longest waiting. Working days since flagged or since entering the status.',
  '- Ageing work: in progress more than 3× the team\'s median cycle time for tickets of the same size.', '',
  '## Data checks', '',
  'Not performance, but whether the numbers can be trusted: `npm run check` after a collect, and the Data checks page. They include data hygiene over the last 90 days:',
  'commits reaching main through a PR, merges with a PR, PRs linked to a ticket of the team\'s project, and tickets estimated, in a sprint and in an epic.', '',
  '## Known limits', '',
  '1. Committed and carried over come from the Jira changelog. Items removed from a sprint before it closes are not seen, so commitment can look better than it was.',
  '2. Deploy frequency counts successful runs of the named deploy workflow (`GITHUB_DEPLOY_WORKFLOW`). Manual deploys are invisible.',
  '3. Server errors and availability are the last 30 days as collected, not the selected period.',
  '4. Nothing here measures effort or capability, only outcomes that left a trace in the tools. The measures are team level; Houston keeps no per person numbers.', '',
);
writeFileSync('METRICS.md', out.join('\n'));
console.log(`METRICS.md: ${cat.length} measures`);
