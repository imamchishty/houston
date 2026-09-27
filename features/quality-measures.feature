Feature: Quality measures are exact
  Every quality rate is a count over a count, over one period. These examples are small enough to check by hand.

  Background:
    Given a reporting period from 2026-09-01 to 2026-10-01
    And the team's Jira project is "ABC" and repos merge into "main"

  Scenario: Change failure rate from hotfixes and failed deploys, and rework rate
    Given these pull requests:
      | pr | opened     | merged     | base    | reviews | comments | hotfix | revert | draft |
      | 1  | 2026-09-02 | 2026-09-03 | main    | 1       | 0        | no     | no     | no    |
      | 2  | 2026-09-04 | 2026-09-05 | main    | 1       | 0        | yes    | no     | no    |
      | 3  | 2026-09-10 | 2026-09-11 | main    | 1       | 0        | no     | no     | no    |
      | 4  | 2026-09-20 | 2026-09-21 | main    | 1       | 0        | no     | no     | no    |
      | 5  | 2026-08-20 | 2026-08-21 | main    | 1       | 0        | yes    | no     | no    |
      | 6  | 2026-09-20 | 2026-09-21 | release | 1       | 0        | yes    | no     | no    |
      | 7  | 2026-09-20 | 2026-09-21 | main    | 1       | 0        | yes    | no     | yes   |
      | 8  | 2026-09-30 | 2026-10-02 | main    | 1       | 0        | yes    | no     | no    |
    And these deploys:
      | at         | success |
      | 2026-09-06 | yes     |
      | 2026-09-12 | no      |
      | 2026-08-12 | no      |
      | 2026-10-02 | no      |
    And these work items:
      | key   | type  | priority | created    | resolved   |
      | ABC-1 | Bug   | Highest  | 2026-09-05 |            |
      | ABC-9 | Bug   | Highest  | 2026-10-03 |            |
      | ABC-2 | Bug   | Medium   | 2026-09-15 | 2026-09-18 |
      | ABC-3 | Bug   | Medium   | 2026-08-15 | 2026-09-02 |
      | ABC-4 | Story | Medium   | 2026-09-01 | 2026-09-09 |
    When the reports are calculated
    Then change_failure_rate is 2 of 5, 40%
    And change_failure_rate misses its target of under 10
    And rework_rate is 2 of 4, 50%

  Scenario: Change failure rate can count significant bugs per deploy instead
    Given change failure rate counts significant bugs
    And these deploys:
      | at         | success |
      | 2026-09-02 | yes     |
      | 2026-09-09 | yes     |
      | 2026-09-16 | yes     |
      | 2026-09-23 | yes     |
      | 2026-09-24 | no      |
    And these work items:
      | key   | type | priority | created    | resolved |
      | ABC-1 | Bug  | Highest  | 2026-09-05 |          |
      | ABC-2 | Bug  | Medium   | 2026-09-15 |          |
    When the reports are calculated
    Then change_failure_rate is 1 of 4, 25%
    And change_failure_rate lists ABC-1

  Scenario: Review rate and review comment rate
    Given these pull requests:
      | pr | opened     | merged     | base | reviews | comments |
      | 1  | 2026-09-02 | 2026-09-03 | main | 1       | 0        |
      | 2  | 2026-09-04 | 2026-09-05 | main | 0       | 0        |
      | 3  | 2026-09-10 | 2026-09-11 | main | 2       | 3        |
      | 4  | 2026-09-20 | 2026-09-21 | main | 1       | 1        |
    When the reports are calculated
    Then pr_review_rate is 3 of 4, 75%
    And pr_review_rate lists repo#2
    And pr_review_comment_rate is 2 of 4, 50%
    And pr_review_comment_rate misses its target of over 50

  Scenario: Bug lead time, fix vs find, and bug workload
    Given these work items:
      | key   | type  | created    | resolved   |
      | ABC-1 | Bug   | 2026-09-01 | 2026-09-03 |
      | ABC-2 | Bug   | 2026-08-28 | 2026-09-01 |
      | ABC-3 | Bug   | 2026-09-10 | 2026-09-20 |
      | ABC-4 | Bug   | 2026-09-25 |            |
      | ABC-5 | Story | 2026-09-01 | 2026-09-05 |
      | ABC-6 | Story | 2026-09-01 | 2026-09-06 |
      | ABC-7 | Task  | 2026-09-01 | 2026-09-07 |
      | ABC-8 | Sub-task | 2026-09-01 | 2026-09-07 |
    When the reports are calculated
    Then bug_lead_time is 4 days from 3 items
    And bug_fix_find is 3 of 3, 100%
    And bug_workload is 3 of 6, 50%

  Scenario: Revert ratio counts GitHub revert PRs only
    Given these pull requests:
      | pr | opened     | merged     | base | reviews | revert | hotfix |
      | 1  | 2026-09-02 | 2026-09-03 | main | 1       | yes    | yes    |
      | 2  | 2026-09-04 | 2026-09-05 | main | 1       | no     | yes    |
      | 3  | 2026-09-10 | 2026-09-11 | main | 1       | no     | no     |
      | 4  | 2026-09-12 | 2026-09-13 | main | 1       | no     | no     |
      | 5  | 2026-09-14 | 2026-09-15 | main | 1       | no     | no     |
    When the reports are calculated
    Then revert_ratio is 1 of 5, 20%

  Scenario: Time to restore is the median of resolved incidents in the period
    Given these incidents:
      | fired            | resolved         |
      | 2026-09-02T10:00 | 2026-09-02T11:00 |
      | 2026-09-05T10:00 | 2026-09-05T13:00 |
      | 2026-09-09T00:00 | 2026-09-10T06:00 |
      | 2026-09-20T00:00 |                  |
      | 2026-10-02T00:00 | 2026-10-02T01:00 |
      | 2026-08-20T00:00 | 2026-08-25T00:00 |
    When the reports are calculated
    Then time_to_restore is 3 hours from 3 items

  Scenario: Nothing to count is not zero
    When the reports are calculated
    Then rework_rate is not measured
    And pr_review_rate is not measured
    And bug_lead_time is not measured
