Feature: Flow measures are exact
  Flow efficiency, the bottleneck heatmap, QA rejection, lead time stages and deployment-linked change failure,
  from hand-made histories. Weekends (Saturday, Sunday) are left out of working hours.

  Background:
    Given a reporting period from 2026-09-01 to 2026-10-01
    And the team's Jira project is "ABC" and repos merge into "main"

  Scenario: Flow efficiency and where the time went
    Given these ticket histories:
      | key   | status           | at               |
      | ABC-1 | To Do            | 2026-09-07T09:00 |
      | ABC-1 | In Progress      | 2026-09-07T10:00 |
      | ABC-1 | Ready for Review | 2026-09-08T10:00 |
      | ABC-1 | In Review        | 2026-09-09T10:00 |
      | ABC-1 | Done             | 2026-09-10T10:00 |
      | ABC-2 | To Do            | 2026-09-10T09:00 |
      | ABC-2 | In Progress      | 2026-09-11T10:00 |
      | ABC-2 | Blocked          | 2026-09-11T16:00 |
      | ABC-2 | In Progress      | 2026-09-14T10:00 |
      | ABC-2 | Done             | 2026-09-14T12:00 |
    When the reports are calculated
    Then flow_efficiency is 56 of 98, 57.1%
    And the time in "In Progress" is 32 hours, "Ready for Review" 24, "In Review" 24 and "Blocked" 18

  Scenario: QA rejection counts tickets sent back, not tickets moving on
    Given these ticket histories:
      | key   | status          | at               |
      | ABC-1 | In Progress     | 2026-09-07T10:00 |
      | ABC-1 | QA              | 2026-09-08T10:00 |
      | ABC-1 | In Progress     | 2026-09-08T15:00 |
      | ABC-1 | QA              | 2026-09-09T10:00 |
      | ABC-1 | Done            | 2026-09-09T15:00 |
      | ABC-2 | In Progress     | 2026-09-07T10:00 |
      | ABC-2 | QA              | 2026-09-08T10:00 |
      | ABC-2 | Done            | 2026-09-08T15:00 |
      | ABC-3 | In Progress     | 2026-09-07T10:00 |
      | ABC-3 | QA              | 2026-09-08T10:00 |
      | ABC-3 | Awaiting Deploy | 2026-09-08T12:00 |
      | ABC-3 | Done            | 2026-09-09T12:00 |
    When the reports are calculated
    Then qa_rejection is 1 of 3, 33.3%
    And qa_rejection lists ABC-1

  Scenario: Lead time in stages
    Given these pull requests:
      | pr | first commit     | opened           | merged           | base | reviews |
      | 1  | 2026-09-01T00:00 | 2026-09-02T00:00 | 2026-09-03T00:00 | main | 1       |
    And these deploys:
      | at               | success |
      | 2026-09-04T12:00 | yes     |
    When the reports are calculated
    Then stage_coding is 24 hours from 1 items
    And stage_review is 24 hours from 1 items
    And stage_deploy is 36 hours from 1 items

  Scenario: Change failure rate linked to deployments counts each deploy once
    Given change failure rate is linked to deployments
    And these deploys:
      | at               | success |
      | 2026-09-02T10:00 | yes     |
      | 2026-09-05T10:00 | yes     |
      | 2026-09-08T10:00 | yes     |
    And these work items:
      | key   | type | priority | created          | resolved |
      | ABC-1 | Bug  | Highest  | 2026-09-02T20:00 |          |
      | ABC-2 | Bug  | Highest  | 2026-09-10T12:00 |          |
    And these incidents:
      | fired            | resolved         |
      | 2026-09-05T11:00 | 2026-09-05T12:00 |
      | 2026-09-05T12:00 | 2026-09-05T13:00 |
    When the reports are calculated
    Then change_failure_rate is 2 of 3, 66.7%

  Scenario: Flow distribution, velocity and flow time
    Given these work items:
      | key   | type  | created    | resolved   | labels    |
      | ABC-1 | Bug   | 2026-09-01 | 2026-09-03 |           |
      | ABC-2 | Bug   | 2026-09-02 | 2026-09-06 |           |
      | ABC-3 | Story | 2026-08-30 | 2026-09-09 | tech-debt |
      | ABC-4 | Story | 2026-09-05 | 2026-09-15 | security  |
      | ABC-5 | Story | 2026-09-10 | 2026-09-12 |           |
      | ABC-6 | Task  | 2026-09-10 | 2026-09-30 |           |
      | ABC-7 | Story | 2026-09-10 |            |           |
    When the reports are calculated
    Then the flow distribution is 2 features, 2 defects, 1 risks and 1 debt
    And flow_velocity is 1.4 items a week from 6 done
    And flow_time is 7 days from 6 items
