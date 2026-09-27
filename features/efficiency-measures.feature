Feature: Efficiency measures are exact

  Background:
    Given a reporting period from 2026-09-01 to 2026-10-01
    And the team's Jira project is "ABC" and repos merge into "main"

  Scenario: PR lead time, pickup and review time are medians over PRs merged in the period
    Given these pull requests:
      | pr | opened           | first review     | merged           | base | reviews |
      | 1  | 2026-09-02T00:00 | 2026-09-02T12:00 | 2026-09-03T00:00 | main | 1       |
      | 2  | 2026-09-04T00:00 | 2026-09-05T00:00 | 2026-09-07T00:00 | main | 1       |
      | 3  | 2026-09-10T00:00 | 2026-09-12T00:00 | 2026-09-15T00:00 | main | 1       |
    When the reports are calculated
    Then pr_lead_time is 3 days from 3 items
    And pickup_time is 1 days from 3 items
    And review_time is 2 days from 3 items
