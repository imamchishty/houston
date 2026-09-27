# Houston metric definitions

Every number Houston shows is computed from these formulas and nothing else. If a number looks wrong,
check the formula here, then the raw records at `/api/teams/<board>/evidence/<ruleId>`, then the mapping in `.env`.

Reviews: only a person other than the author counts. Bots (GitHub type Bot, logins ending [bot], GITHUB_BOTS) are left out of every review measure.
Work start: the first move into any status Jira classes as In Progress (status category), whatever its name. The full ticket history is read, not only the last 100 changes.
Small samples: a rate from fewer than 10 items, or a median from fewer than 5, is marked "Small sample".
Data checks: `npm run check` after a collect, and the Data checks page, flag setups that would make a correct formula give a wrong number.

Conventions. "Work item" means any Jira issue in the sprint except sub-tasks. "Committed" means in the sprint
before its start date, from the issue changelog. "Cycle time" is first move to In Progress until resolution date.
"Median" is used everywhere instead of average because one huge outlier should not move the team number.
Scores: green earns the rule's full weight, amber half, red none. Score = earned / possible × 100.
RAG thresholds are inclusive at the boundary.

## Planning: sprint checks (Jira)

| Rule | Formula | Amber | Red |
|---|---|---|---|
| commit_completion | points done by the sprint's end ÷ points committed, committed = estimated items in sprint before start. A ticket finished after the sprint closed is not done in that sprint | below 80% | below 60% |
| carry_over | items whose sprint history includes an earlier sprint ÷ work items | 20% | 40% |
| scope_added_mid_sprint | items whose Sprint field was set after sprint start ÷ work items | 15% | 30% |
| no_estimate | work items with empty story points ÷ work items | 10% | 25% |
| no_acceptance_criteria | stories with no AC ÷ stories. AC = custom field non-empty, else description matches "acceptance criteria", "Given/When/Then" or "AC:" | 15% | 35% |
| unassigned | count of In Progress items with no assignee | 1 | 3 |
| stale_in_progress | count of items in progress at sprint end (now for the active sprint), from the status history, in progress more than 3x the team's median cycle time for their size (5 days where the size has no history) | 2 | 4 |
| cycle_time_vs_size | done items with cycle time > max(2 × team median for that point size, median + 2 days) ÷ done items with a cycle time. Team medians learned from all sprints on the board | 15% | 30% |
| sprint_goal | 1 if the sprint goal has more than 10 characters, else 0. Information only, not scored | missing | missing |

## DORA and Flow checks (GitHub)

Window: last GITHUB_DAYS (default 90). "Merged PR" excludes drafts. Reviews and comments by the author are ignored.

| Rule | Formula | Amber | Red |
|---|---|---|---|
| pickup_time | median of (first review or review comment by someone else − PR created), merged PRs, days | 1 | 2 |
| review_time | median of (merged − first review), days | 1.5 | 3 |
| pr_size | median of (additions + deletions), merged PRs | 400 | 800 |
| stale_prs | count of open non-draft PRs older than 72 hours. Information only, not scored | 3 | 6 |
| no_jira_link | merged PRs with no key of the team's Jira project in title, branch or body ÷ merged PRs | 10% | 30% |
| reviewer_load | reviews by the top reviewer ÷ all reviews on merged PRs | 40% | 60% |
| lane_crossing | engineers with 5+ merged PRs who merged work in both frontend and backend paths (any repo, GITHUB_LANES) ÷ those engineers | below 25% | below 10% |
| ci_red_rate | failed CI runs ÷ (success + failure) on each repo's default branch, workflows not matching the deploy name. Feature branch runs left out | 10% | 25% |
| deploy_frequency | successful runs of the deploy workflow ÷ weeks in window | below 1/week | below 1/month |
| lead_time | median of (first successful deploy of the PR's own repo after merge − PR created), days. A repo with no deploys of its own falls back to the team's deploys | 7 | 30 |
| change_failure | the Quality report's change failure rate (CFR_SOURCE: hotfix, bugs or linked) over 90 days; the DORA section uses the same calculation | 15% | 30% |

Time to restore (DORA 4) is not computed until incident data is connected.

## Quality (SonarQube, Testmo, Jira)

| Rule | Formula | Amber | Red |
|---|---|---|---|
| quality_gate | Sonar alert_status, 1 if OK | fail | fail |
| coverage | Sonar coverage. Information only, not scored: legacy code drags it down | below 60% | below 40% |
| new_code_coverage | Sonar new_coverage (new code period as set in Sonar) | below 70% | below 50% |
| vulnerabilities | Sonar vulnerabilities count | 1 | 5 |
| sonar_bugs | Sonar bugs count. Information only, not scored: not adjusted for codebase size | 10 | 30 |
| duplication | Sonar duplicated_lines_density | 5% | 10% |
| test_pass_rate | Testmo tests passed ÷ tests run, pooled over automation runs in the last 30 days. Not measured with no runs | below 97% | below 90% |
| test_runs | Testmo automation runs in the last 30 days | below 20 | below 8 |
| automation_share | automated tests ÷ (automated + manual cases) | below 50% | below 30% |

## Features (Jira epics)

| Rule | Formula | Amber | Red |
|---|---|---|---|
| feature_lead_time | median of (resolved − created) for epics resolved in the last 180 days, days | 45 | 90 |
| feature_wip | count of epics in the In Progress status category | 3 | 5 |

## Documentation (Confluence)

| Rule | Formula | Amber | Red |
|---|---|---|---|
| stale_docs | pages last edited over 90 days ago ÷ pages in the team's spaces | 40% | 70% |
| runbook_coverage | pages classified runbook ÷ repos configured for the team | below 1 | below 0.5 |
| adr_activity | pages classified ADR created in the last 90 days. Information only, not scored | below 2 | 0 |

Classification: a page is an ADR or runbook if its title or a label contains one of the markers in `.env`.

## Production (Azure)

| Rule | Formula | Amber | Red |
|---|---|---|---|
| failed_requests | App Insights requests with a 5xx result code ÷ requests, 30 days (4xx are not failures) | 1% | 3% |
| availability | App Insights availability test results passed ÷ results, 30 days. Not measured when there are no availability tests | below 99.9% | below 99.5% |
| incidents | Sev0 to Sev2 alerts fired in 30 days, filtered to the team's resource group | 2 | 5 |
| time_to_restore | median (alert resolved − alert fired), hours. DORA 4 | 1h | 24h |
| cloud_cost | Cost Management actual cost for the resource group, last full calendar month, USD converted at 3.6725 | informational | |


## Per person

Jira: done tickets, points, median cycle time, tickets over the size norm (same rule as cycle_time_vs_size),
In Progress over 5 days in the latest sprint, tickets that carried over.
GitHub: PRs authored and merged, lines changed, median PR size, reviews given, share of all reviews,
median hours to first review as a reviewer, lanes touched, cross lane PRs, PRs without a ticket, hotfixes.
Confluence: pages created and edited, ADRs and runbooks created, in the last 90 days.

Identity: names are joined with the PEOPLE mapping. An unmapped GitHub login appears as a separate person.

## Headcount gate

Open only when all three hold: commit_completion ≥ 80% in each of the last three sprints, no_estimate = 0% in each
of the last three sprints, new_code_coverage ≥ 70%.

## Known limits

1. Jira changelog is the source for "committed" and "carried over". If the team removes items from a sprint before closing it, commitment looks better than it was. The action log baseline is taken at the moment of acceptance to make that visible.
2. Cycle time needs an In Progress status transition. Teams that jump To Do → Done have no cycle time and the rule is skipped, not scored.
3. Deploy frequency counts successful runs of the named workflow. Manual or pipeline-less deploys are invisible.
4. Lane crossing is only as accurate as GITHUB_LANES.
5. Nothing here measures effort or capability, only output that left a trace in the tools.

## 90 day window

Set WINDOW_START. Targets: commit_completion ≥ 80%, no_estimate = 0%, no_acceptance_criteria ≤ 10%, stale_in_progress ≤ 1,
new_code_coverage ≥ 70%, pickup_time ≤ 1 day, PRs reviewed by someone else ≥ 95%. "At start" is the last sprint before the window opened for sprint targets, and the value the nightly snapshot recorded on the window's first day for the others.
On track = targets met ≥ (targets × share of the window elapsed).

## Cost facts

Team monthly cost (TEAM_MONTHLY_COST), the configured offshore equivalent (OFFSHORE_MONTHLY_COST), their ratio, and epics
resolved in the last 90 days. Output per engineer is not compared across teams: story points are sized differently by
every team and pull request counts reward splitting work.

## Area reports: DORA, Flow, Quality, Security, Support, Planning

Served by `/api/reports/{dora,flow,quality,security,support,planning}?team=&days=` and shown on the pages of the same names. Each measure lives in exactly one area.
Every rate is shown with its counts. "Not measured" means there was nothing to count (0 of 0), never 0%.
The period is the last 7, 30 or 90 days; an item counts when its date (merged, created, resolved, fired) falls inside it.

### DORA

| Measure | Definition | Target |
|---|---|---|
| `deploy_frequency` Deployment frequency | Successful runs of the production deploy workflow (GITHUB_DEPLOY_WORKFLOW) per week in the period. | over 1 |
| `lead_time` Lead time for changes (median) | Median days from a PR's first commit (author date) to the first successful production deploy of its repo after merge, PRs merged in the period. | under 7 days |
| `change_failure_rate` Change failure rate | (Hotfix or revert PRs + failed deploys) ÷ (merged PRs + failed deploys), in the period. A hotfix has "hotfix" or "revert" in its title or branch. | under 10% |
| `time_to_restore` Time to restore (median) | Median hours from alert fired to alert resolved, Sev0 to Sev2 incidents fired in the period (Azure Monitor). | under 24 hours |
| `stage_coding` Coding time (median) | Median hours from a PR's first commit (author date) to the PR being opened. 0 of 0 PRs have commit dates. |  |
| `stage_review` Review time (median) | Median hours from PR opened to merged. |  |
| `stage_deploy` Waiting to deploy (median) | Median hours from merge to the first successful production deploy of its repo. |  |

### Flow

| Measure | Definition | Target |
|---|---|---|
| `pr_cycle_hours` PR cycle time (median) | Median hours from PR opened to merged, leaving out weekend days (Sat, Sun, UTC+0). PRs merged in the period. | under 60 hours |
| `pickup_time` Time to first review (median) | Median days from PR opened to the first review or review comment by someone else, PRs merged in the period. | under 1 days |
| `review_time` Review to merge (median) | Median days from first review to merge, PRs merged in the period. | under 1.5 days |
| `pr_size` PR size (median) | Median lines changed (additions + deletions) per PR merged in the period. | under 400 |
| `flow_efficiency` Flow efficiency | Working hours in active statuses ÷ all working hours from first start to done, tickets resolved in the period. Waiting: blocked, ready for review, ready for qa, awaiting deploy, ready for release, waiting, on hold, or back in to do. Weekends left out. | over 40% |
| `flow_efficiency_request` Flow efficiency from request | Active working hours ÷ all working hours from the ticket being created to done, so time waiting in the backlog counts too (the Flow Framework's definition). Usually far lower than flow efficiency from start, which is the part the team controls. |  |
| `flow_velocity` Flow velocity | Work items completed per week in the period (sub-tasks excluded), whatever their size. Useful as a trend, not against other teams. |  |
| `flow_time` Flow time (median) | Median days from a work item being created to done, items completed in the period. Jira resolution is the end: production release per ticket is not linked. | under 14 days |
| `flow_load` Flow load | Work items in an in-progress status now (sub-tasks excluded): the work in progress. Too much means context switching; the right level differs by team. |  |
| `cycle_time` Cycle time (median) | Median days from moving to In Progress to resolved, sprint tickets resolved in the period. | under 5 days |

### Quality

| Measure | Definition | Target |
|---|---|---|
| `bugs_per_change` Bugs per change | Bugs created ÷ PRs merged to the default branch, in the period. All priorities. | under 30% |
| `defect_leakage` Defect leakage | Bugs created in the period found in production ÷ bugs found in production or before release (labels production/prod/escaped/customer vs qa/staging/test/uat). | under 20% |
| `pr_review_rate` PR review rate | Merged PRs with at least one review by someone other than the author ÷ merged PRs. | over 95% |
| `qa_rejection` QA rejection rate | Tickets sent back from QA (qa, in qa, testing, in testing) to earlier work ÷ tickets that entered QA, in the period. Moving on to a queue such as Awaiting Deploy is not a rejection. | under 15% |
| `pr_review_comment_rate` PR review comment rate | Merged PRs with at least one review comment, or a review with a written body, by someone other than the author ÷ merged PRs. | over 50% |
| `quality_gate_pass` Quality gate passing | Teams whose SonarQube quality gate passes, latest scan. | over 99% |
| `new_code_coverage` Coverage on new code | SonarQube coverage on new code, latest scan (the median team when several). | over 70% |
| `test_pass_rate` Automated test pass rate | Tests passed ÷ tests run over the last 30 days of Testmo automation runs (the median team when several). | over 97% |
| `bug_lead_time` Bug lead time (median) | Median days from bug created to resolved, bugs resolved in the period. | under 14 days |
| `bug_fix_find` Bug fix vs find rate | Bugs resolved in the period ÷ bugs created in the period. Above 100% means the backlog of bugs is shrinking. | over 80% |
| `bug_workload` Bug workload | Bugs resolved ÷ all work items resolved (sub-tasks excluded), in the period. By count, not points. | under 20% |
| `revert_ratio` Code revert ratio | Merged revert PRs (GitHub's revert button: title "Revert …" or branch revert-N-…) ÷ merged PRs. | under 5% |

### Security

| Measure | Definition | Target |
|---|---|---|
| `security_on_time` Critical and high fixed on time | Critical and high alerts fixed within their deadline (critical 7 days, high 30 days). Each alert is judged once, when it is fixed or when its deadline passes, whichever is first, in the period. Still open at the deadline counts as late even if dismissed later. Dismissed before the deadline is left out and listed separately. | over 95% |
| `security_fix_critical` Time to fix, critical (median) | Median days from a critical alert being opened to it being fixed (for a leaked secret: revoked), alerts fixed in the period. | under 7 days |
| `security_fix_high` Time to fix, high (median) | Median days from a high alert being opened to it being fixed (for a leaked secret: revoked), alerts fixed in the period. | under 30 days |
| `security_overdue` Overdue now | Open alerts past their deadline at the end of the period, any severity with a deadline. Each is listed with its age. | under 1 |
| `security_open_critical_high` Open critical and high | Open critical and high alerts at the end of the period, within their deadline or not. |  |
| `secrets_open` Leaked secrets not yet revoked | Secrets (passwords, keys, tokens) found in code and not yet revoked, at the end of the period. Houston stores only the secret type, never the secret. | under 1 |
| `vulnerabilities` SonarQube vulnerabilities | SonarQube open vulnerabilities, latest scan, all teams together (not the selected period). | under 1 |
| `security_dismissed` Dismissed instead of fixed | Alerts dismissed in the period (false positive, won't fix, used in tests, or auto-dismissed). Shown so dismissals are seen, not hidden. |  |
| `scan_dependency` Dependency scanning | Team repos with Dependabot alerts turned on. A repo with scanning off shows no alerts, so it looks safe when it is not. | over 99% |
| `scan_secret` Secret scanning | Team repos with secret scanning turned on. A repo with scanning off shows no alerts, so it looks safe when it is not. | over 99% |
| `scan_code` Code scanning | Team repos with code scanning turned on. A repo with scanning off shows no alerts, so it looks safe when it is not. | over 99% |

### Support

| Measure | Definition | Target |
|---|---|---|
| `support_per_week` Support tickets per week | Support tickets created in the period ÷ weeks in the period: tickets in the team's support project, or support issue types and labels in its own project. |  |
| `support_share` Support share of work finished | Support tickets resolved ÷ (support tickets resolved + the team's own work items resolved), in the period. A count of items, not hours: a big story and a quick support answer count one each. | under 20% |
| `support_open` Open support tickets | Support tickets not resolved at the end of the period, oldest listed first with their age. |  |
| `sla_response` First response within SLA | Tickets answered within the SLA for their priority (SUPPORT_SLA, working time: 08:00 to 18:00 on working days). Judged once: when first answered, or when the goal passes unmet. First response: the first comment by someone other than the reporter, or the first status change by a person. | over 95% |
| `support_response_time` Time to first response (median) | Median working hours from a ticket being raised to its first response, tickets first answered in the period. |  |
| `sla_resolution` Resolved within SLA | Tickets resolved within the SLA for their priority (SUPPORT_SLA, working time: 08:00 to 18:00 on working days). Judged once: when resolved, or when the goal passes unmet. | over 95% |
| `support_resolution_time` Time to resolve (median) | Median working hours from a ticket being raised to it being resolved, tickets resolved in the period. |  |
| `support_out_of_hours` Support work outside working hours | Status changes on support tickets made by people (not automation) outside 08:00 to 18:00 or at the weekend, in local time (TZ_OFFSET_HOURS, WORKING_HOURS, WEEKEND). Team total only: Houston does not keep who made them. | under 10% |
| `incidents_out_of_hours` Incidents outside working hours | Sev0 to Sev2 incidents (Azure Monitor) fired outside 08:00 to 18:00 or at the weekend. With no on-call tool, this counts incidents, not who responded. |  |
| `support_repeat` Reopened or duplicate | Support tickets resolved in the period that had been reopened after an earlier resolution, or are linked as a duplicate of another ticket: a fix that did not hold, or the same problem raised again. | under 20% |

### Planning

| Measure | Definition | Target |
|---|---|---|
| `sprint_completion` Sprint completion | Committed story points done ÷ committed story points, over sprints that closed in the period. Committed = estimated items in the sprint before it started. | over 80% |
| `unplanned_work` Unplanned work | Story points finished on tickets created after their sprint started ÷ story points finished, sprints that closed in the period. Pulling in an existing ticket is scope change; a ticket that did not exist at planning is unplanned work. | under 20% |
| `scope_added` Scope added mid-sprint | Items added after the sprint started ÷ items in the sprint, sprints that closed in the period. | under 15% |
| `use_of_branches` Use of branches | Non-merge commits on the default branch that arrived through a merged PR ÷ all non-merge commits on the default branch, in the period. GitHub links each commit to its PR, whatever the merge strategy. | over 95% |
| `merged_with_pr` Merged branches with PR | PRs merged to the default branch ÷ (those PRs + plain git merges on the default branch with no PR), in the period. | over 95% |
| `prs_traceable` PRs traceable to a ticket | Merged PRs whose title, branch or body contains a ticket key of the team's Jira project ÷ merged PRs. | over 90% |
| `tickets_estimated` Estimates on tickets | Work items closed in the period that have story points ÷ work items closed (sub-tasks excluded). | over 90% |
| `tickets_in_sprint` Tickets in sprints | Work items closed in the period that were ever in a sprint ÷ work items closed (sub-tasks excluded). | over 80% |
| `tickets_in_epic` Tickets in epics | Work items closed in the period that belong to an epic ÷ work items closed (sub-tasks and bugs excluded: bugs are often not feature work). | over 80% |
| `epics_with_due_date` Due dates on epics | Epics closed in the period that had a due date ÷ epics closed. |  |

Security deadlines: `SECURITY_DEADLINE_DAYS` (default `critical:7,high:30,medium:90`; low has no deadline). Needs the GitHub token to read Dependabot, code scanning and secret scanning alerts. A leaked secret is fixed only when revoked; its value is never stored.

Support: plain Jira tickets in `SUPPORT_PROJECTS` (every ticket), or in the team's own project when the issue type is in `SUPPORT_ISSUE_TYPES` or a label is in `SUPPORT_LABELS`. SLAs from `SUPPORT_SLA` (priority=response/resolution, h hours or d working days), measured in working time: `WORKING_HOURS` on days not in `WEEKEND`, in `TZ_OFFSET_HOURS`. First response: the first comment by someone other than the reporter, or the first status change by a person. Only times are stored, never names or comment text.

Change failure rate: `CFR_SOURCE=hotfix` (default) or `bugs`. Significant priorities: `JIRA_SIGNIFICANT_PRIORITIES`.
14-day churn is not measured: it needs line-level history the GitHub API does not provide.

## Current sprint

- Working days: days from sprint start to end not in `WEEKEND`. Left = total - elapsed (elapsed counts days started before now).
- Committed: points of items in the sprint before it started. Scope: points of every item in the sprint now. Done: points of items resolved by now.
- Outlook: projected = done ÷ working days elapsed × working days in the sprint. On track if projected ≥ scope, at risk if ≥ 80% of scope, otherwise off track.
- Burndown: remaining = scope that day - done by that day, per working day. Ideal falls evenly from committed to 0. Jira does not report items removed from a sprint, so scope only rises.
- Bug trend: bugs in the team's Jira project created and resolved each working day of the sprint.

## Flow

| Measure | Definition | Target |
|---|---|---|
| `pr_cycle_hours` PR cycle time (median) | Median hours from PR opened to merged, leaving out weekend days (Sat, Sun, UTC+0). PRs merged in the period. | under 60 hours |
| `pickup_time` Time to first review (median) | Median days from PR opened to the first review or review comment by someone else, PRs merged in the period. | under 1 days |
| `review_time` Review to merge (median) | Median days from first review to merge, PRs merged in the period. | under 1.5 days |
| `pr_size` PR size (median) | Median lines changed (additions + deletions) per PR merged in the period. | under 400 |
| `flow_efficiency` Flow efficiency | Working hours in active statuses ÷ all working hours from first start to done, tickets resolved in the period. Waiting: blocked, ready for review, ready for qa, awaiting deploy, ready for release, waiting, on hold, or back in to do. Weekends left out. | over 40% |
| `flow_efficiency_request` Flow efficiency from request | Active working hours ÷ all working hours from the ticket being created to done, so time waiting in the backlog counts too (the Flow Framework's definition). Usually far lower than flow efficiency from start, which is the part the team controls. |  |
| `flow_velocity` Flow velocity | Work items completed per week in the period (sub-tasks excluded), whatever their size. Useful as a trend, not against other teams. |  |
| `flow_time` Flow time (median) | Median days from a work item being created to done, items completed in the period. Jira resolution is the end: production release per ticket is not linked. | under 14 days |
| `flow_load` Flow load | Work items in an in-progress status now (sub-tasks excluded): the work in progress. Too much means context switching; the right level differs by team. |  |
| `cycle_time` Cycle time (median) | Median days from moving to In Progress to resolved, sprint tickets resolved in the period. | under 5 days |

### Quality

| Measure | Definition | Target |
|---|---|---|
| `bugs_per_change` Bugs per change | Bugs created ÷ PRs merged to the default branch, in the period. All priorities. | under 30% |
| `defect_leakage` Defect leakage | Bugs created in the period found in production ÷ bugs found in production or before release (labels production/prod/escaped/customer vs qa/staging/test/uat). | under 20% |
| `pr_review_rate` PR review rate | Merged PRs with at least one review by someone other than the author ÷ merged PRs. | over 95% |
| `qa_rejection` QA rejection rate | Tickets sent back from QA (qa, in qa, testing, in testing) to earlier work ÷ tickets that entered QA, in the period. Moving on to a queue such as Awaiting Deploy is not a rejection. | under 15% |
| `pr_review_comment_rate` PR review comment rate | Merged PRs with at least one review comment, or a review with a written body, by someone other than the author ÷ merged PRs. | over 50% |
| `quality_gate_pass` Quality gate passing | Teams whose SonarQube quality gate passes, latest scan. | over 99% |
| `new_code_coverage` Coverage on new code | SonarQube coverage on new code, latest scan (the median team when several). | over 70% |
| `test_pass_rate` Automated test pass rate | Tests passed ÷ tests run over the last 30 days of Testmo automation runs (the median team when several). | over 97% |
| `bug_lead_time` Bug lead time (median) | Median days from bug created to resolved, bugs resolved in the period. | under 14 days |
| `bug_fix_find` Bug fix vs find rate | Bugs resolved in the period ÷ bugs created in the period. Above 100% means the backlog of bugs is shrinking. | over 80% |
| `bug_workload` Bug workload | Bugs resolved ÷ all work items resolved (sub-tasks excluded), in the period. By count, not points. | under 20% |
| `revert_ratio` Code revert ratio | Merged revert PRs (GitHub's revert button: title "Revert …" or branch revert-N-…) ÷ merged PRs. | under 5% |

### Security

| Measure | Definition | Target |
|---|---|---|
| `security_on_time` Critical and high fixed on time | Critical and high alerts fixed within their deadline (critical 7 days, high 30 days). Each alert is judged once, when it is fixed or when its deadline passes, whichever is first, in the period. Still open at the deadline counts as late even if dismissed later. Dismissed before the deadline is left out and listed separately. | over 95% |
| `security_fix_critical` Time to fix, critical (median) | Median days from a critical alert being opened to it being fixed (for a leaked secret: revoked), alerts fixed in the period. | under 7 days |
| `security_fix_high` Time to fix, high (median) | Median days from a high alert being opened to it being fixed (for a leaked secret: revoked), alerts fixed in the period. | under 30 days |
| `security_overdue` Overdue now | Open alerts past their deadline at the end of the period, any severity with a deadline. Each is listed with its age. | under 1 |
| `security_open_critical_high` Open critical and high | Open critical and high alerts at the end of the period, within their deadline or not. |  |
| `secrets_open` Leaked secrets not yet revoked | Secrets (passwords, keys, tokens) found in code and not yet revoked, at the end of the period. Houston stores only the secret type, never the secret. | under 1 |
| `vulnerabilities` SonarQube vulnerabilities | SonarQube open vulnerabilities, latest scan, all teams together (not the selected period). | under 1 |
| `security_dismissed` Dismissed instead of fixed | Alerts dismissed in the period (false positive, won't fix, used in tests, or auto-dismissed). Shown so dismissals are seen, not hidden. |  |
| `scan_dependency` Dependency scanning | Team repos with Dependabot alerts turned on. A repo with scanning off shows no alerts, so it looks safe when it is not. | over 99% |
| `scan_secret` Secret scanning | Team repos with secret scanning turned on. A repo with scanning off shows no alerts, so it looks safe when it is not. | over 99% |
| `scan_code` Code scanning | Team repos with code scanning turned on. A repo with scanning off shows no alerts, so it looks safe when it is not. | over 99% |

### Support

| Measure | Definition | Target |
|---|---|---|
| `support_per_week` Support tickets per week | Support tickets created in the period ÷ weeks in the period: tickets in the team's support project, or support issue types and labels in its own project. |  |
| `support_share` Support share of work finished | Support tickets resolved ÷ (support tickets resolved + the team's own work items resolved), in the period. A count of items, not hours: a big story and a quick support answer count one each. | under 20% |
| `support_open` Open support tickets | Support tickets not resolved at the end of the period, oldest listed first with their age. |  |
| `sla_response` First response within SLA | Tickets answered within the SLA for their priority (SUPPORT_SLA, working time: 08:00 to 18:00 on working days). Judged once: when first answered, or when the goal passes unmet. First response: the first comment by someone other than the reporter, or the first status change by a person. | over 95% |
| `support_response_time` Time to first response (median) | Median working hours from a ticket being raised to its first response, tickets first answered in the period. |  |
| `sla_resolution` Resolved within SLA | Tickets resolved within the SLA for their priority (SUPPORT_SLA, working time: 08:00 to 18:00 on working days). Judged once: when resolved, or when the goal passes unmet. | over 95% |
| `support_resolution_time` Time to resolve (median) | Median working hours from a ticket being raised to it being resolved, tickets resolved in the period. |  |
| `support_out_of_hours` Support work outside working hours | Status changes on support tickets made by people (not automation) outside 08:00 to 18:00 or at the weekend, in local time (TZ_OFFSET_HOURS, WORKING_HOURS, WEEKEND). Team total only: Houston does not keep who made them. | under 10% |
| `incidents_out_of_hours` Incidents outside working hours | Sev0 to Sev2 incidents (Azure Monitor) fired outside 08:00 to 18:00 or at the weekend. With no on-call tool, this counts incidents, not who responded. |  |
| `support_repeat` Repeat issues | Resolved tickets whose component had another ticket in the 30 days before: the same problem coming back because its cause was not fixed. Only tickets with a component count. | under 20% |

### Planning

| Measure | Definition | Target |
|---|---|---|
| `sprint_completion` Sprint completion | Committed story points done ÷ committed story points, over sprints that closed in the period. Committed = estimated items in the sprint before it started. | over 80% |
| `unplanned_work` Unplanned work | Story points finished on tickets created after their sprint started ÷ story points finished, sprints that closed in the period. Pulling in an existing ticket is scope change; a ticket that did not exist at planning is unplanned work. | under 20% |
| `scope_added` Scope added mid-sprint | Items added after the sprint started ÷ items in the sprint, sprints that closed in the period. | under 15% |
| `use_of_branches` Use of branches | Non-merge commits on the default branch that arrived through a merged PR ÷ all non-merge commits on the default branch, in the period. GitHub links each commit to its PR, whatever the merge strategy. | over 95% |
| `merged_with_pr` Merged branches with PR | PRs merged to the default branch ÷ (those PRs + plain git merges on the default branch with no PR), in the period. | over 95% |
| `prs_traceable` PRs traceable to a ticket | Merged PRs whose title, branch or body contains a ticket key of the team's Jira project ÷ merged PRs. | over 90% |
| `tickets_estimated` Estimates on tickets | Work items closed in the period that have story points ÷ work items closed (sub-tasks excluded). | over 90% |
| `tickets_in_sprint` Tickets in sprints | Work items closed in the period that were ever in a sprint ÷ work items closed (sub-tasks excluded). | over 80% |
| `tickets_in_epic` Tickets in epics | Work items closed in the period that belong to an epic ÷ work items closed (sub-tasks and bugs excluded: bugs are often not feature work). | over 80% |
| `epics_with_due_date` Due dates on epics | Epics closed in the period that had a due date ÷ epics closed. |  |

Security deadlines: `SECURITY_DEADLINE_DAYS` (default `critical:7,high:30,medium:90`; low has no deadline). Needs the GitHub token to read Dependabot, code scanning and secret scanning alerts. A leaked secret is fixed only when revoked; its value is never stored.

Support: plain Jira tickets in `SUPPORT_PROJECTS` (every ticket), or in the team's own project when the issue type is in `SUPPORT_ISSUE_TYPES` or a label is in `SUPPORT_LABELS`. SLAs from `SUPPORT_SLA` (priority=response/resolution, h hours or d working days), measured in working time: `WORKING_HOURS` on days not in `WEEKEND`, in `TZ_OFFSET_HOURS`. First response: the first comment by someone other than the reporter, or the first status change by a person. Only times are stored, never names or comment text.

Change failure rate: `CFR_SOURCE=hotfix` (default) or `bugs`. Significant priorities: `JIRA_SIGNIFICANT_PRIORITIES`.
14-day churn is not measured: it needs line-level history the GitHub API does not provide.

## Current sprint

- Working days: days from sprint start to end not in `WEEKEND`. Left = total - elapsed (elapsed counts days started before now).
- Committed: points of items in the sprint before it started. Scope: points of every item in the sprint now. Done: points of items resolved by now.
- Outlook: projected = done ÷ working days elapsed × working days in the sprint. On track if projected ≥ scope, at risk if ≥ 80% of scope, otherwise off track.
- Burndown: remaining = scope that day - done by that day, per working day. Ideal falls evenly from committed to 0. Jira does not report items removed from a sprint, so scope only rises.
- Bug trend: bugs in the team's Jira project created and resolved each working day of the sprint.

## Flow

| Measure | Definition | Target |
|---|---|---|
| `pr_cycle_hours` PR cycle time (median) | Median hours from PR opened to merged, leaving out weekend days (Sat, Sun, UTC+0). PRs merged in the period. | under 60 hours |
| `pickup_time` Time to first review (median) | Median days from PR opened to the first review or review comment by someone else, PRs merged in the period. | under 1 days |
| `review_time` Review to merge (median) | Median days from first review to merge, PRs merged in the period. | under 1.5 days |
| `pr_size` PR size (median) | Median lines changed (additions + deletions) per PR merged in the period. | under 400 |
| `flow_efficiency` Flow efficiency | Working hours in active statuses ÷ all working hours from first start to done, tickets resolved in the period. Waiting: blocked, ready for review, ready for qa, awaiting deploy, ready for release, waiting, on hold, or back in to do. Weekends left out. | over 40% |
| `flow_efficiency_request` Flow efficiency from request | Active working hours ÷ all working hours from the ticket being created to done, so time waiting in the backlog counts too (the Flow Framework's definition). Usually far lower than flow efficiency from start, which is the part the team controls. |  |
| `flow_velocity` Flow velocity | Work items completed per week in the period (sub-tasks excluded), whatever their size. Useful as a trend, not against other teams. |  |
| `flow_time` Flow time (median) | Median days from a work item being created to done, items completed in the period. Jira resolution is the end: production release per ticket is not linked. | under 14 days |
| `flow_load` Flow load | Work items in an in-progress status now (sub-tasks excluded): the work in progress. Too much means context switching; the right level differs by team. |  |
| `cycle_time` Cycle time (median) | Median days from moving to In Progress to resolved, sprint tickets resolved in the period. | under 5 days |

### Quality

| Measure | Definition | Target |
|---|---|---|
| `bugs_per_change` Bugs per change | Bugs created ÷ PRs merged to the default branch, in the period. All priorities. | under 30% |
| `defect_leakage` Defect leakage | Bugs created in the period found in production ÷ bugs found in production or before release (labels production/prod/escaped/customer vs qa/staging/test/uat). | under 20% |
| `pr_review_rate` PR review rate | Merged PRs with at least one review by someone other than the author ÷ merged PRs. | over 95% |
| `qa_rejection` QA rejection rate | Tickets sent back from QA (qa, in qa, testing, in testing) to earlier work ÷ tickets that entered QA, in the period. Moving on to a queue such as Awaiting Deploy is not a rejection. | under 15% |
| `pr_review_comment_rate` PR review comment rate | Merged PRs with at least one review comment, or a review with a written body, by someone other than the author ÷ merged PRs. | over 50% |
| `quality_gate_pass` Quality gate passing | Teams whose SonarQube quality gate passes, latest scan. | over 99% |
| `new_code_coverage` Coverage on new code | SonarQube coverage on new code, latest scan (the median team when several). | over 70% |
| `test_pass_rate` Automated test pass rate | Tests passed ÷ tests run over the last 30 days of Testmo automation runs (the median team when several). | over 97% |
| `bug_lead_time` Bug lead time (median) | Median days from bug created to resolved, bugs resolved in the period. | under 14 days |
| `bug_fix_find` Bug fix vs find rate | Bugs resolved in the period ÷ bugs created in the period. Above 100% means the backlog of bugs is shrinking. | over 80% |
| `bug_workload` Bug workload | Bugs resolved ÷ all work items resolved (sub-tasks excluded), in the period. By count, not points. | under 20% |
| `revert_ratio` Code revert ratio | Merged revert PRs (GitHub's revert button: title "Revert …" or branch revert-N-…) ÷ merged PRs. | under 5% |

### Security

| Measure | Definition | Target |
|---|---|---|
| `security_on_time` Critical and high fixed on time | Critical and high alerts fixed within their deadline (critical 7 days, high 30 days). Each alert is judged once, when it is fixed or when its deadline passes, whichever is first, in the period. Still open at the deadline counts as late even if dismissed later. Dismissed before the deadline is left out and listed separately. | over 95% |
| `security_fix_critical` Time to fix, critical (median) | Median days from a critical alert being opened to it being fixed (for a leaked secret: revoked), alerts fixed in the period. | under 7 days |
| `security_fix_high` Time to fix, high (median) | Median days from a high alert being opened to it being fixed (for a leaked secret: revoked), alerts fixed in the period. | under 30 days |
| `security_overdue` Overdue now | Open alerts past their deadline at the end of the period, any severity with a deadline. Each is listed with its age. | under 1 |
| `security_open_critical_high` Open critical and high | Open critical and high alerts at the end of the period, within their deadline or not. |  |
| `secrets_open` Leaked secrets not yet revoked | Secrets (passwords, keys, tokens) found in code and not yet revoked, at the end of the period. Houston stores only the secret type, never the secret. | under 1 |
| `vulnerabilities` SonarQube vulnerabilities | SonarQube open vulnerabilities, latest scan, all teams together (not the selected period). | under 1 |
| `security_dismissed` Dismissed instead of fixed | Alerts dismissed in the period (false positive, won't fix, used in tests, or auto-dismissed). Shown so dismissals are seen, not hidden. |  |
| `scan_dependency` Dependency scanning | Team repos with Dependabot alerts turned on. A repo with scanning off shows no alerts, so it looks safe when it is not. | over 99% |
| `scan_secret` Secret scanning | Team repos with secret scanning turned on. A repo with scanning off shows no alerts, so it looks safe when it is not. | over 99% |
| `scan_code` Code scanning | Team repos with code scanning turned on. A repo with scanning off shows no alerts, so it looks safe when it is not. | over 99% |

### Planning

| Measure | Definition | Target |
|---|---|---|
| `sprint_completion` Sprint completion | Committed story points done ÷ committed story points, over sprints that closed in the period. Committed = estimated items in the sprint before it started. | over 80% |
| `unplanned_work` Unplanned work | Story points finished on tickets created after their sprint started ÷ story points finished, sprints that closed in the period. Pulling in an existing ticket is scope change; a ticket that did not exist at planning is unplanned work. | under 20% |
| `scope_added` Scope added mid-sprint | Items added after the sprint started ÷ items in the sprint, sprints that closed in the period. | under 15% |
| `use_of_branches` Use of branches | Non-merge commits on the default branch that arrived through a merged PR ÷ all non-merge commits on the default branch, in the period. GitHub links each commit to its PR, whatever the merge strategy. | over 95% |
| `merged_with_pr` Merged branches with PR | PRs merged to the default branch ÷ (those PRs + plain git merges on the default branch with no PR), in the period. | over 95% |
| `prs_traceable` PRs traceable to a ticket | Merged PRs whose title, branch or body contains a ticket key of the team's Jira project ÷ merged PRs. | over 90% |
| `tickets_estimated` Estimates on tickets | Work items closed in the period that have story points ÷ work items closed (sub-tasks excluded). | over 90% |
| `tickets_in_sprint` Tickets in sprints | Work items closed in the period that were ever in a sprint ÷ work items closed (sub-tasks excluded). | over 80% |
| `tickets_in_epic` Tickets in epics | Work items closed in the period that belong to an epic ÷ work items closed (sub-tasks and bugs excluded: bugs are often not feature work). | over 80% |
| `epics_with_due_date` Due dates on epics | Epics closed in the period that had a due date ÷ epics closed. |  |

Security deadlines: `SECURITY_DEADLINE_DAYS` (default `critical:7,high:30,medium:90`; low has no deadline). Needs the GitHub token to read Dependabot, code scanning and secret scanning alerts. A leaked secret is fixed only when revoked; its value is never stored.

Change failure rate: `CFR_SOURCE=hotfix` (default) or `bugs`. Significant priorities: `JIRA_SIGNIFICANT_PRIORITIES`.
14-day churn is not measured: it needs line-level history the GitHub API does not provide.

## Current sprint

- Working days: days from sprint start to end not in `WEEKEND`. Left = total - elapsed (elapsed counts days started before now).
- Committed: points of items in the sprint before it started. Scope: points of every item in the sprint now. Done: points of items resolved by now.
- Outlook: projected = done ÷ working days elapsed × working days in the sprint. On track if projected ≥ scope, at risk if ≥ 80% of scope, otherwise off track.
- Burndown: remaining = scope that day - done by that day, per working day. Ideal falls evenly from committed to 0. Jira does not report items removed from a sprint, so scope only rises.
- Bug trend: bugs in the team's Jira project created and resolved each working day of the sprint.

## Flow

| Measure | Definition | Target |
|---|---|---|
| `pr_cycle_hours` PR cycle time (median) | Median hours from PR opened to merged, leaving out weekend days (Sat, Sun, UTC+0). PRs merged in the period. | under 60 hours |
| `pickup_time` Time to first review (median) | Median days from PR opened to the first review or review comment by someone else, PRs merged in the period. | under 1 days |
| `review_time` Review to merge (median) | Median days from first review to merge, PRs merged in the period. | under 1.5 days |
| `pr_size` PR size (median) | Median lines changed (additions + deletions) per PR merged in the period. | under 400 |
| `flow_efficiency` Flow efficiency | Working hours in active statuses ÷ all working hours from first start to done, tickets resolved in the period. Waiting: blocked, ready for review, ready for qa, awaiting deploy, ready for release, waiting, on hold, or back in to do. Weekends left out. | over 40% |
| `flow_efficiency_request` Flow efficiency from request | Active working hours ÷ all working hours from the ticket being created to done, so time waiting in the backlog counts too (the Flow Framework's definition). Usually far lower than flow efficiency from start, which is the part the team controls. |  |
| `flow_velocity` Flow velocity | Work items completed per week in the period (sub-tasks excluded), whatever their size. Useful as a trend, not against other teams. |  |
| `flow_time` Flow time (median) | Median days from a work item being created to done, items completed in the period. Jira resolution is the end: production release per ticket is not linked. | under 14 days |
| `flow_load` Flow load | Work items in an in-progress status now (sub-tasks excluded): the work in progress. Too much means context switching; the right level differs by team. |  |
| `cycle_time` Cycle time (median) | Median days from moving to In Progress to resolved, sprint tickets resolved in the period. | under 5 days |

### Quality

| Measure | Definition | Target |
|---|---|---|
| `bugs_per_change` Bugs per change | Bugs created ÷ PRs merged to the default branch, in the period. All priorities. | under 30% |
| `defect_leakage` Defect leakage | Bugs created in the period found in production ÷ bugs found in production or before release (labels production/prod/escaped/customer vs qa/staging/test/uat). | under 20% |
| `pr_review_rate` PR review rate | Merged PRs with at least one review by someone other than the author ÷ merged PRs. | over 95% |
| `qa_rejection` QA rejection rate | Tickets sent back from QA (qa, in qa, testing, in testing) to earlier work ÷ tickets that entered QA, in the period. Moving on to a queue such as Awaiting Deploy is not a rejection. | under 15% |
| `pr_review_comment_rate` PR review comment rate | Merged PRs with at least one review comment, or a review with a written body, by someone other than the author ÷ merged PRs. | over 50% |
| `quality_gate_pass` Quality gate passing | Teams whose SonarQube quality gate passes, latest scan. | over 99% |
| `new_code_coverage` Coverage on new code | SonarQube coverage on new code, latest scan (the median team when several). | over 70% |
| `vulnerabilities` Open vulnerabilities | SonarQube open vulnerabilities, latest scan, all teams together. | under 1 |
| `test_pass_rate` Automated test pass rate | Tests passed ÷ tests run over the last 30 days of Testmo automation runs (the median team when several). | over 97% |
| `bug_lead_time` Bug lead time (median) | Median days from bug created to resolved, bugs resolved in the period. | under 14 days |
| `bug_fix_find` Bug fix vs find rate | Bugs resolved in the period ÷ bugs created in the period. Above 100% means the backlog of bugs is shrinking. | over 80% |
| `bug_workload` Bug workload | Bugs resolved ÷ all work items resolved (sub-tasks excluded), in the period. By count, not points. | under 20% |
| `revert_ratio` Code revert ratio | Merged revert PRs (GitHub's revert button: title "Revert …" or branch revert-N-…) ÷ merged PRs. | under 5% |

### Planning

| Measure | Definition | Target |
|---|---|---|
| `sprint_completion` Sprint completion | Committed story points done ÷ committed story points, over sprints that closed in the period. Committed = estimated items in the sprint before it started. | over 80% |
| `unplanned_work` Unplanned work | Story points finished on tickets created after their sprint started ÷ story points finished, sprints that closed in the period. Pulling in an existing ticket is scope change; a ticket that did not exist at planning is unplanned work. | under 20% |
| `scope_added` Scope added mid-sprint | Items added after the sprint started ÷ items in the sprint, sprints that closed in the period. | under 15% |
| `use_of_branches` Use of branches | Non-merge commits on the default branch that arrived through a merged PR ÷ all non-merge commits on the default branch, in the period. GitHub links each commit to its PR, whatever the merge strategy. | over 95% |
| `merged_with_pr` Merged branches with PR | PRs merged to the default branch ÷ (those PRs + plain git merges on the default branch with no PR), in the period. | over 95% |
| `prs_traceable` PRs traceable to a ticket | Merged PRs whose title, branch or body contains a ticket key of the team's Jira project ÷ merged PRs. | over 90% |
| `tickets_estimated` Estimates on tickets | Work items closed in the period that have story points ÷ work items closed (sub-tasks excluded). | over 90% |
| `tickets_in_sprint` Tickets in sprints | Work items closed in the period that were ever in a sprint ÷ work items closed (sub-tasks excluded). | over 80% |
| `tickets_in_epic` Tickets in epics | Work items closed in the period that belong to an epic ÷ work items closed (sub-tasks and bugs excluded: bugs are often not feature work). | over 80% |
| `epics_with_due_date` Due dates on epics | Epics closed in the period that had a due date ÷ epics closed. |  |

Change failure rate: `CFR_SOURCE=hotfix` (default) or `bugs`. Significant priorities: `JIRA_SIGNIFICANT_PRIORITIES`.
14-day churn is not measured: it needs line-level history the GitHub API does not provide.

## Current sprint

- Working days: days from sprint start to end not in `WEEKEND`. Left = total - elapsed (elapsed counts days started before now).
- Committed: points of items in the sprint before it started. Scope: points of every item in the sprint now. Done: points of items resolved by now.
- Outlook: projected = done ÷ working days elapsed × working days in the sprint. On track if projected ≥ scope, at risk if ≥ 80% of scope, otherwise off track.
- Burndown: remaining = scope that day - done by that day, per working day. Ideal falls evenly from committed to 0. Jira does not report items removed from a sprint, so scope only rises.
- Bug trend: bugs in the team's Jira project created and resolved each working day of the sprint.

## Flow

- Status history: every status change from the Jira changelog, read in full. Flow runs from the first move into an
  in-progress status to resolution, in working hours (weekends left out, in the team's time zone).
- Waiting statuses: `JIRA_WAIT_STATUSES` (default Blocked, Ready for Review, Ready for QA, Awaiting Deploy, Ready for Release,
  Waiting, On Hold), and any to-do status after work started. Everything else in progress is active.
- QA statuses: `JIRA_QA_STATUSES` (default QA, In QA, Testing, In Testing). Sent back = from a QA status to a to-do status or to
  an in-progress status that is neither QA nor waiting.
- Lead time stages: coding = first commit (author date) to PR opened; review = opened to merged; waiting to deploy = merged to
  the first successful deploy of its repo. The weekly chart sums hours, so stages add up to the whole.
- Flow distribution: bugs are defects; `FLOW_RISK_LABELS` risks; `FLOW_DEBT_LABELS` debt; everything else features.
- Work in progress age on the sprint board: flagged when over 3x the team's median cycle time for that ticket size (each ticket
  counted once in the median). Queued: open sprint items in a waiting status.

## Simple dashboard

Four questions per team, last 30 days, built from the measures above: delivering what it promised (sprint completion:
Yes at 80% or more, Partly at 60%, else No); current sprint on track (outlook); quality (change failure rate and defect
leakage: Yes if both meet target, Partly if one, No if neither); speed (DORA lead time tier: Elite or High Yes, Medium
Partly, Low No; nothing released while work was finished is No). "Not enough data" when there is nothing to measure or
the sample is small. Alerts: amber when a target is missed in the last 30 days, red when also missed the 30 days before.

## Cost to build a feature

An estimate, not accounting. Rates: RATE_FTE_DAY, RATE_CONTRACTOR_DAY for names in CONTRACTORS, RATE_OVERRIDES per person.

1. Person sprint cost = day rate × working days in the sprint (WEEKEND excluded). Everyone on TEAM_ROSTER plus every assignee.
2. Split across the tickets that person touched in the sprint (In Progress or Done, sub-tasks excluded), weighted by story points.
   Unestimated tickets weigh the team's median ticket size.
3. Feature cost = sum over tickets whose epic (JIRA_EPIC_FIELD, or a parent epic) is that feature, every sprint they were in. Split FTE and contractor.
4. No feature = tickets with no epic. Not on tickets = sprint cost of people who touched no ticket that sprint.
   Team cost = on features + no feature + not on tickets.
5. Cost per point = team cost ÷ points done in the sprints seen (each ticket once, latest status).
6. To complete = remaining points × cost per point. Remaining = open tickets seen in sprints + (epic children not done − those), the latter at median size.
   Done features: zero. Estimated total = spent + to complete.

Only aggregates are served. Day rates are shown to HOUSTON_PEOPLE_VIEWERS only; individual rates never.

## DORA tiers

The four DORA metrics also show a DORA tier (Elite, High, Medium, Low), from the DORA State of DevOps research bands:
deploy frequency (7+ a week, 1+ a week, monthly or more, less), lead time (under 1 day, 1 week, 1 month, more),
change failure (5%, 10%, 15%, more), time to restore (under 1 hour, 1 day, 1 week, more). The bands are approximate.

## Incident log

incidents = Sev0 to Sev2 alerts in 30 days (Azure). write-ups = Confluence pages created in 30 days whose title or labels
contain incident, postmortem, post-incident or RCA. missing = incidents − write-ups, floor 0.

## Active days

A weekday counts as active for a person if any of these carries their name and that date: ticket moved to In Progress,
ticket resolved, ticket added to a sprint, PR opened, PR merged, review given. Weekend days (WEEKEND, Saturday and Sunday by default) excluded.
Window 42 days. This is a trace count, not attendance, not hours, and it must not be used as either.
