# Houston metric definitions

How each team is performing: 10 headline measures in five areas: planning, execution, quality, stability and support,
and security. This file is generated
from the code (`npm run metrics-doc`); every definition below is the text the measure itself carries.

## The score

- **Score** = headline targets met ÷ headline targets judged, as a percentage, for the period (7, 30 or 90 days).
- A headline is **judged** when it has a value and enough items to trust it: at least 10 for a rate, 5 for a median. Smaller samples are shown, marked "small sample", and not scored.
- **Trend**: the same measure or score for the period just before, like for like.
- **Needs attention**: a headline target missed this period and the one before.
- **Drill-down** measures explain a headline. They have their own targets where one makes sense, and never count in the score.
- DORA tiers (Elite, High, Medium, Low) label the four DORA measures; they do not change the score.

## Conventions

- Reviews: only a person other than the author counts. Bots (GitHub type Bot, logins ending [bot], `GITHUB_BOTS`) are left out.
- Work start: the first move into any status Jira classes as In Progress, whatever its name. The full ticket history is read.
- Medians, not averages, so one outlier does not move a team number. "Work item" means any Jira issue except sub-tasks.
- Working time: `WORKING_HOURS` on days not in `WEEKEND`, in `TZ_OFFSET_HOURS` (now 8:00 to 18:00, UTC+0).
- "Not measured" means there was nothing to count (0 of 0), never 0%.

## Planning

Did we deliver what we planned, and how much changed after we planned it?

| Measure | Why it matters | How it is calculated | Target |
|---|---|---|---|
| **`sprint_completion` Sprint completion** | Whether the team delivers what it commits to. Low completion makes every plan built on it unreliable. | Committed story points done ÷ committed story points, over sprints that closed in the period. Committed = estimated items in the sprint before it started. | Over 80% |
| ↳ `unplanned_work` Unplanned work | Work that did not exist when the sprint was planned. A common reason sprints are missed. | Story points finished on tickets created after their sprint started ÷ story points finished, sprints that closed in the period. Pulling in an existing ticket is scope change; a ticket that did not exist at planning is unplanned work. | Under 20% |
| ↳ `scope_added` Scope added mid-sprint | Existing work pulled into a sprint after it started. Changes the plan the team committed to. | Items added after the sprint started ÷ items in the sprint, sprints that closed in the period. | Under 15% |
| ↳ `carry_over` Work carried over | Work not finished by the end of its sprint and rolled into the next. | Items in a sprint that were not done by its end ÷ items in the sprint, sprints that closed in the period. They roll into the next sprint. |  |

## Execution

Does work flow and reach users fast, and where is time wasted?

| Measure | Why it matters | How it is calculated | Target |
|---|---|---|---|
| **`deploy_frequency` Deployment frequency** | How often value reaches users. Teams that release often release smaller, safer changes and learn faster. | Successful runs of the production deploy workflow (GITHUB_DEPLOY_WORKFLOW) per week in the period. | Over 1 |
| **`lead_time` Lead time for changes** | How long a change takes from first commit to running in production. The clearest single measure of speed. | Median days from a PR's first commit (author date) to the first successful production deploy of its repo after merge, PRs merged in the period. | Under 7 days |
| ↳ `stage_coding` Coding time | Time spent writing a change before it is opened for review. Long coding time usually means big changes. | Median hours from a PR's first commit (author date) to the PR being opened. PRs without commit dates count from when they were opened. |  |
| ↳ `stage_review` Review time | Time a change waits for and goes through review. Often the biggest and easiest part of lead time to cut. | Median hours from PR opened to merged. |  |
| ↳ `stage_deploy` Waiting to deploy | Time finished work waits to be released. Pure waste: the work is done but no one can use it. | Median hours from merge to the first successful production deploy of its repo. |  |
| **`flow_efficiency` Flow efficiency** | The share of a ticket's time spent being worked on rather than waiting. The one number that says whether work flows. | Working hours in active statuses ÷ all working hours from first start to done, tickets resolved in the period. Working hours: 08:00 to 18:00 on working days, so nights and weekends count as neither. Waiting: blocked, ready for review, ready for qa, awaiting deploy, ready for release, waiting, on hold, or back in to do. | Over 40% |
| ↳ `flow_time` Flow time | How long work items take from being raised to done. | Median days from a work item being created to done, items completed in the period. Jira resolution is the end: production release per ticket is not linked. | Under 14 days |
| ↳ `flow_load` Flow load | Work in progress now. Too much at once means context switching and everything finishing later. | Work items in an in-progress status now (sub-tasks excluded): the work in progress. Too much means context switching; the right level differs by team. |  |
| ↳ `flow_velocity` Flow velocity | Work items finished per week. A trend for the team, not a comparison between teams. | Work items completed per week in the period (sub-tasks excluded), whatever their size. Useful as a trend, not against other teams. |  |
| ↳ `pickup_time` Time to first review | How long a change waits for its first review. | Median days from PR opened to the first review or review comment by someone else, PRs merged in the period. | Under 1 days |
| ↳ `review_time` Review to merge | How long from first review to merge. | Median days from first review to merge, PRs merged in the period. | Under 1.5 days |
| ↳ `pr_size` PR size | Lines changed per pull request. Big changes get slow, shallow reviews and hide bugs. | Median lines changed (additions + deletions) per PR merged in the period. | Under 400 |
| ↳ `reviewer_load` Review concentration | The share of reviews done by the busiest reviewer. High means one person is the bottleneck. | Reviews done by the busiest reviewer ÷ all reviews on PRs merged in the period. High means one person is the bottleneck. No names are shown. | Under 40% |
| ↳ `ci_failure_rate` CI failure rate (main) | How often the build on the main branch fails. A red main blocks everyone. | Failed CI runs on the default branch ÷ finished CI runs on the default branch, in the period. A red main blocks everyone. | Under 10% |

## Quality

Are we shipping good work, or creating rework?

| Measure | Why it matters | How it is calculated | Target |
|---|---|---|---|
| **`defect_leakage` Defect leakage** | The share of bugs customers find rather than the team. The quality outcome customers actually feel. | Bugs created in the period found in production ÷ bugs found in production or before release (labels production/prod/escaped/customer vs qa/staging/test/uat). | Under 20% |
| ↳ `bugs_per_change` Bugs per change | Bugs raised for the amount of change shipped. Rising means quality is slipping as the team goes faster. | Bugs created ÷ PRs merged to the default branch, in the period. All priorities. | Under 30% |
| ↳ `qa_rejection` QA rejection rate | Work sent back from testing. Each rejection is rework and delay. | Tickets sent back from QA (qa, in qa, testing, in testing) to earlier work ÷ tickets that entered QA, in the period. Moving on to a queue such as Awaiting Deploy is not a rejection. | Under 15% |
| ↳ `pr_review_rate` PR review rate | Code merged without anyone else reviewing it. Unreviewed code is where most escaped bugs come from. | Merged PRs with at least one review by someone other than the author ÷ merged PRs. | Over 95% |
| ↳ `quality_gate_pass` Quality gate passing | Whether new code passes the SonarQube quality gate the team set for itself. | Teams whose SonarQube quality gate passes, latest scan. | Over 99% |
| ↳ `new_code_coverage` Coverage on new code | How much of the code written now is covered by tests. New code, so legacy code does not count against the team. | SonarQube coverage on new code, latest scan (the median team when several). | Over 70% |
| ↳ `test_pass_rate` Automated test pass rate | Automated tests passing. Failing tests either catch real bugs or have stopped being trusted. | Tests passed ÷ tests run over the last 30 days of Testmo automation runs (the median team when several). | Over 97% |
| **`bug_workload` Bug workload** | The share of finished work that is bug fixing: the cost of poor quality in time not spent on features. | Bugs resolved ÷ all work items resolved (sub-tasks excluded), in the period. By count, not points. | Under 20% |
| ↳ `bug_lead_time` Bug lead time | How long bugs take to fix once raised. | Median days from bug created to resolved, bugs resolved in the period. | Under 14 days |
| ↳ `bug_fix_find` Bug fix vs find rate | Bugs fixed against bugs found. Under 100% means the bug backlog is growing. | Bugs resolved in the period ÷ bugs created in the period. Above 100% means the backlog of bugs is shrinking. | Over 80% |
| ↳ `revert_ratio` Code revert ratio | Changes undone after merging. Each revert is work thrown away. | Merged revert PRs (GitHub's revert button: title "Revert …" or branch revert-N-…) ÷ merged PRs. | Under 5% |

## Stability and support

How often do things break, how fast do we recover, and are customers helped in time?

| Measure | Why it matters | How it is calculated | Target |
|---|---|---|---|
| **`change_failure_rate` Change failure rate** | How often a change to production breaks something and needs a fix. Speed only counts if this stays low. | (Hotfix or revert PRs + failed deploys) ÷ (merged PRs + failed deploys), in the period. A hotfix has "hotfix" or "revert" in its title or branch. | Under 10% |
| ↳ `incidents` Incidents | Production incidents (Sev0 to Sev2) in the period. | Sev0 to Sev2 incidents (Azure Monitor alerts) fired in the period. |  |
| ↳ `server_errors` Server errors | Requests that failed with a server error. Users see these as errors on screen. | Requests answered with a 5xx server error ÷ all requests, last 30 days (Application Insights). | Under 1% |
| ↳ `availability` Availability | How much of the time the service answered its availability tests. | Availability from Application Insights availability tests, last 30 days. Not measured when there are no tests. | Over 99.9% |
| **`time_to_restore` Time to restore** | How fast service comes back after an incident. Failures happen; recovering fast is what users notice. | Median hours from alert fired to alert resolved, Sev0 to Sev2 incidents fired in the period (Azure Monitor). | Under 24 hours |
| ↳ `incidents_out_of_hours` Incidents outside working hours | Incidents that fired at night or at the weekend: someone is pulled out of bed, with no on-call rota to share it. | Sev0 to Sev2 incidents (Azure Monitor) fired outside 08:00 to 18:00 or at the weekend. With no on-call tool, this counts incidents, not who responded. |  |
| **`sla_resolution` Resolved within SLA** | Whether customers' support requests are resolved within the time agreed for their priority. | Tickets resolved within the SLA for their priority (SUPPORT_SLA, working time: 08:00 to 18:00 on working days). Judged once: when resolved, or when the goal passes unmet. | Over 95% |
| ↳ `sla_response` First response within SLA | Whether customers get a first answer within the agreed time. Silence is what customers mind most. | Tickets answered within the SLA for their priority (SUPPORT_SLA, working time: 08:00 to 18:00 on working days). Judged once: when first answered, or when the goal passes unmet. First response: the first comment by someone other than the reporter, or the first status change by a person. | Over 95% |
| ↳ `support_response_time` Time to first response | How long customers wait for a first answer. | Median working hours from a ticket being raised to its first response, tickets first answered in the period. |  |
| ↳ `support_resolution_time` Time to resolve | How long customers wait for a fix. | Median working hours from a ticket being raised to it being resolved, tickets resolved in the period. |  |
| ↳ `support_per_week` Support tickets per week | How much support arrives. Rising volume explains slower delivery before anyone asks. | Support tickets created in the period ÷ weeks in the period: tickets in the team's support project, or support issue types and labels in its own project. |  |
| ↳ `support_open` Open support tickets | Support requests not yet resolved. A growing queue means customers waiting. | Support tickets not resolved at the end of the period, oldest listed first with their age. |  |
| ↳ `support_share` Support share of work finished | The share of the team's finished work that is support. A plan that ignores it will be missed. | Support tickets resolved ÷ (support tickets resolved + the team's own work items resolved), in the period. A count of items, not hours: a big story and a quick support answer count one each. | Under 20% |
| ↳ `support_repeat` Reopened or duplicate | Tickets reopened after being resolved, or raised again as duplicates: fixes that did not hold. | Support tickets resolved in the period that had been reopened after an earlier resolution, or are linked as a duplicate of another ticket: a fix that did not hold, or the same problem raised again. | Under 20% |
| ↳ `support_out_of_hours` Support work outside working hours | Support work done at night or at the weekend. Invisible in delivery numbers, and it burns people out. | Status changes on support tickets made by people (not automation) outside 08:00 to 18:00 or at the weekend, in local time (TZ_OFFSET_HOURS, WORKING_HOURS, WEEKEND). Team total only: Houston does not keep who made them. | Under 10% |

## Security

Are serious security issues fixed in time?

| Measure | Why it matters | How it is calculated | Target |
|---|---|---|---|
| **`security_on_time` Critical and high fixed on time** | Whether serious security issues (vulnerable libraries, flaws in the team's code, leaked secrets) are fixed within their deadline. What auditors ask. | Critical and high alerts fixed within their deadline (critical 7 days, high 30 days). Each alert is judged once, when it is fixed or when its deadline passes, whichever is first, in the period. Still open at the deadline counts as late even if dismissed later. Dismissed before the deadline is left out and listed separately. | Over 95% |
| ↳ `security_overdue` Overdue now | Open security issues already past their fix deadline: the list to work through first. | Open alerts past their deadline at the end of the period, any severity with a deadline. Each is listed with its age. | Under 1 |
| ↳ `secrets_open` Leaked secrets not yet revoked | Leaked passwords and keys not yet revoked. Anyone who has seen the code can use them until then. | Secrets (passwords, keys, tokens) found in code and not yet revoked, at the end of the period. Houston stores only the secret type, never the secret. | Under 1 |
| ↳ `security_fix_critical` Time to fix, critical | How long critical security issues stay open. | Median days from a critical alert being opened to it being fixed (for a leaked secret: revoked), alerts fixed in the period. | Under 7 days |
| ↳ `security_fix_high` Time to fix, high | How long high severity security issues stay open. | Median days from a high alert being opened to it being fixed (for a leaked secret: revoked), alerts fixed in the period. | Under 30 days |
| ↳ `security_open_critical_high` Open critical and high | Critical and high security issues open now, within their deadline or not. | Open critical and high alerts at the end of the period, within their deadline or not. |  |
| ↳ `security_dismissed` Dismissed instead of fixed | Security issues dismissed rather than fixed. Sometimes right, but it must be visible. | Alerts dismissed in the period (false positive, won't fix, used in tests, or auto-dismissed). Shown so dismissals are seen, not hidden. |  |
| ↳ `scan_dependency` Dependency scanning | Repos checked for vulnerable libraries. A repo with scanning off looks safe when it is not. | Team repos with Dependabot alerts turned on. A repo with scanning off shows no alerts, so it looks safe when it is not. | Over 99% |
| ↳ `scan_secret` Secret scanning | Repos checked for leaked passwords and keys. | Team repos with secret scanning turned on. A repo with scanning off shows no alerts, so it looks safe when it is not. | Over 99% |
| ↳ `scan_code` Code scanning | Repos checked for security flaws in the team's own code. | Team repos with code scanning turned on. A repo with scanning off shows no alerts, so it looks safe when it is not. | Over 99% |

## Settings that change a number

- Change failure rate: `CFR_SOURCE=hotfix` (default: hotfix or revert PRs and failed deploys), `bugs` (significant bugs per deploy), or `linked`. Significant priorities: `JIRA_SIGNIFICANT_PRIORITIES`.
- Waiting statuses for flow efficiency: `JIRA_WAIT_STATUSES`. QA statuses: `JIRA_QA_STATUSES`. Debt and risk labels for what was delivered: `FLOW_DEBT_LABELS`, `FLOW_RISK_LABELS`.
- Bugs found in production vs before release: `BUG_PROD_LABELS`, `BUG_QA_LABELS`, or `JIRA_BUG_ENV_FIELD`.
- Support tickets: every ticket in `SUPPORT_PROJECTS`, or support issue types (`SUPPORT_ISSUE_TYPES`) and labels (`SUPPORT_LABELS`) in the team's own project. SLAs: `SUPPORT_SLA` (priority=response/resolution, h hours or d working days). First response: the first comment by someone other than the reporter, or the first status change by a person. Only times are stored, never names or comment text.
- Security deadlines: `SECURITY_DEADLINE_DAYS` (default critical 7, high 30, medium 90; low has no deadline). A leaked secret is fixed only when revoked; its value is never stored.

## Current sprint

- Working days: days from sprint start to end not in `WEEKEND`. Committed: points of items in the sprint before it started. Done: points of items resolved by now.
- Outlook: projected = done ÷ working days elapsed × working days in the sprint. On track if projected ≥ scope, at risk if ≥ 80% of scope, otherwise off track.
- Burndown: remaining = scope that day − done by that day. Jira does not report items removed from a sprint, so scope only rises.
- Blocked or waiting now: open items flagged in Jira (the Impediment flag), or in a waiting status (`JIRA_WAIT_STATUSES`). Blocked (flagged, or a status with blocked, on hold or impediment in its name) first, then the longest waiting. Working days since flagged or since entering the status.
- Ageing work: in progress more than 3× the team's median cycle time for tickets of the same size.

## Data checks

Not performance, but whether the numbers can be trusted: `npm run check` after a collect, and the Data checks page. They include data hygiene over the last 90 days:
commits reaching main through a PR, merges with a PR, PRs linked to a ticket of the team's project, and tickets estimated, in a sprint and in an epic.

## Known limits

1. Committed and carried over come from the Jira changelog. Items removed from a sprint before it closes are not seen, so commitment can look better than it was.
2. Deploy frequency counts successful runs of the named deploy workflow (`GITHUB_DEPLOY_WORKFLOW`). Manual deploys are invisible.
3. Server errors and availability are the last 30 days as collected, not the selected period.
4. Nothing here measures effort or capability, only outcomes that left a trace in the tools. The measures are team level; Houston keeps no per person numbers.
