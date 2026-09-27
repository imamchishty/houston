# Houston metric definitions

Every number Houston shows is computed from these formulas and nothing else. If a number looks wrong,
check the formula here, then the raw records at `/api/teams/<board>/evidence/<ruleId>`, then the mapping in `.env`.

Conventions. "Work item" means any Jira issue in the sprint except sub-tasks. "Committed" means in the sprint
before its start date, from the issue changelog. "Cycle time" is first move to In Progress until resolution date.
"Median" is used everywhere instead of average because one huge outlier should not move the team number.
Scores: green earns the rule's full weight, amber half, red none. Score = earned / possible × 100.
RAG thresholds are inclusive at the boundary.

## Sprint process (Jira)

| Rule | Formula | Amber | Red |
|---|---|---|---|
| commit_completion | points done ÷ points committed, committed = estimated items in sprint before start | below 80% | below 60% |
| carry_over | items whose sprint history includes an earlier sprint ÷ work items | 20% | 40% |
| scope_added_mid_sprint | items whose Sprint field was set after sprint start ÷ work items | 15% | 30% |
| no_estimate | work items with empty story points ÷ work items | 10% | 25% |
| no_acceptance_criteria | stories with no AC ÷ stories. AC = custom field non-empty, else description matches "acceptance criteria", "Given/When/Then" or "AC:" | 15% | 35% |
| unassigned | count of In Progress items with no assignee | 1 | 3 |
| stale_in_progress | count of In Progress items over 5 days (measured at sprint end, or now for active sprint) | 2 | 4 |
| bug_share | Bug type items ÷ work items | 25% | 40% |
| cycle_time_vs_size | done items with cycle time > max(2 × team median for that point size, median + 2 days) ÷ done items with a cycle time. Team medians learned from all sprints on the board | 15% | 30% |
| sprint_goal | 1 if the sprint goal has more than 10 characters, else 0 | missing | missing |

## Flow and DORA (GitHub)

Window: last GITHUB_DAYS (default 90). "Merged PR" excludes drafts. Reviews and comments by the author are ignored.

| Rule | Formula | Amber | Red |
|---|---|---|---|
| pickup_time | median of (first review or review comment by someone else − PR created), merged PRs, days | 1 | 2 |
| review_time | median of (merged − first review), days | 1.5 | 3 |
| pr_size | median of (additions + deletions), merged PRs | 400 | 800 |
| stale_prs | count of open non-draft PRs older than 72 hours | 3 | 6 |
| no_review_merges | merged PRs with zero reviews by others ÷ merged PRs | 5% | 15% |
| no_jira_link | merged PRs with no `[A-Z]+-\d+` key in title, branch or body ÷ merged PRs | 10% | 30% |
| reviewer_load | reviews by the top reviewer ÷ all reviews on merged PRs | 40% | 60% |
| lane_crossing | merged PRs touching both a frontend and a backend path ÷ merged PRs touching either, paths from GITHUB_LANES | below 25% | below 10% |
| ci_red_rate | failed CI runs ÷ (success + failure), workflows not matching the deploy name | 10% | 25% |
| deploy_frequency | successful runs of the deploy workflow ÷ weeks in window | below 1/week | below 1/month |
| lead_time | median of (first successful deploy after merge − PR created), days | 7 | 30 |
| change_failure | (hotfix or revert PRs + failed deploys) ÷ (merged PRs + failed deploys). Hotfix = title or branch contains "hotfix" or "revert" | 15% | 30% |

Time to restore (DORA 4) is not computed until incident data is connected.

## Quality (SonarQube, Testmo, Jira)

| Rule | Formula | Amber | Red |
|---|---|---|---|
| quality_gate | Sonar alert_status, 1 if OK | fail | fail |
| coverage | Sonar coverage | below 60% | below 40% |
| new_code_coverage | Sonar new_coverage (new code period as set in Sonar) | below 70% | below 50% |
| vulnerabilities | Sonar vulnerabilities count | 1 | 5 |
| sonar_bugs | Sonar bugs count | 10 | 30 |
| duplication | Sonar duplicated_lines_density | 5% | 10% |
| test_pass_rate | Testmo latest automation run passed ÷ total | below 97% | below 90% |
| test_runs | Testmo automation runs in the last 30 days | below 20 | below 8 |
| automation_share | automated tests ÷ (automated + manual cases) | below 50% | below 30% |
| escaped_bugs | Bug issues created during the latest sprint | 3 | 6 |

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
| adr_activity | pages classified ADR created in the last 90 days | below 2 | 0 |
| docs_activity | pages edited in the last 30 days | below 4 | below 1 |

Classification: a page is an ADR or runbook if its title or a label contains one of the markers in `.env`.

## Production and cost (Azure)

| Rule | Formula | Amber | Red |
|---|---|---|---|
| failed_requests | App Insights requests with success == false ÷ requests, 30 days | 1% | 3% |
| availability | App Insights availability test results passed ÷ results, 30 days | below 99.9% | below 99.5% |
| incidents | Sev0 to Sev2 alerts fired in 30 days, filtered to the team's resource group | 2 | 5 |
| time_to_restore | median (alert resolved − alert fired), hours. DORA 4 | 1h | 24h |
| cloud_cost | Cost Management actual cost for the resource group, last full calendar month, USD converted at 3.6725 | informational | |
| cost_per_feature | (cloud month + TEAM_MONTHLY_COST) × 3 ÷ epics resolved in the last 90 days, AED | 300,000 | 800,000 |

Cost per feature thresholds are placeholders. Set them with finance once the first real number is in.

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
new_code_coverage ≥ 70%, pickup_time ≤ 1 day, no_review_merges = 0%. "At start" is the last sprint before the window opened.
On track = targets met ≥ (targets × share of the window elapsed).

## Output and cost

points per engineer per sprint = done points in the last 6 closed sprints ÷ sprints ÷ people with any Jira or GitHub activity.
merged PRs per engineer per week = merged PRs in the GitHub window ÷ weeks ÷ people.
cost ratio = TEAM_MONTHLY_COST ÷ OFFSHORE_MONTHLY_COST. output vs best = this team's points per engineer ÷ the highest team's.

## Incident log

incidents = Sev0 to Sev2 alerts in 30 days (Azure). write-ups = Confluence pages created in 30 days whose title or labels
contain incident, postmortem, post-incident or RCA. missing = incidents − write-ups, floor 0.

## Active days

A weekday counts as active for a person if any of these carries their name and that date: ticket moved to In Progress,
ticket resolved, ticket added to a sprint, PR opened, PR merged, review given. Friday and Saturday excluded.
Window 42 days. This is a trace count, not attendance, not hours, and it must not be used as either.
