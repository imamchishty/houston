Feature: Metric audit fixes
  Each scenario fixes a way a metric could give a wrong number on real data.

  Scenario: Work stuck at the sprint's end counts, even if it has finished since
    Given a finished sprint from 2026-09-07 to 2026-09-21 where the normal for 3 points is 2 days, with:
      | key   | points | started    | status at end | finished   |
      | ABC-1 | 3      | 2026-09-08 | In Progress   | 2026-09-25 |
      | ABC-2 | 3      | 2026-09-19 | In Progress   |            |
      | ABC-3 | 3      | 2026-09-08 | Done          | 2026-09-12 |
    Then 1 item is flagged as in progress far longer than normal: ABC-1

  Scenario: No availability tests means availability is not measured
    Given production data with no availability tests
    Then there is no availability check

  Scenario: Working across frontend and backend is measured per person, across repos
    Given merged pull requests in separate repos:
      | author | repo    | area     | count |
      | aisha  | org/web | frontend | 3     |
      | aisha  | org/api | backend  | 3     |
      | rahul  | org/api | backend  | 6     |
      | priya  | org/web | frontend | 6     |
      | omar   | org/api | backend  | 2     |
    Then 1 of 3 active engineers work across frontend and backend

  Scenario: CI failure rate counts the main branch only
    Given CI runs:
      | branch    | success | failure |
      | main      | 9       | 1       |
      | feature/x | 2       | 8       |
    Then the CI failure rate is 10%

  Scenario: A PR counts as linked to a ticket only for the team's own project
    Given merged pull requests for team "ABC" mentioning:
      | tickets |
      | ABC-12  |
      | UTF-8   |
      | OTHER-4 |
      |         |
      | ABC-7   |
    Then 3 of 5 merged PRs reference no ticket of the team's project

  Scenario: Overall coverage is information only and does not move the quality score
    Then changing overall coverage from 10% to 90% leaves the quality score the same

  Scenario: The test pass rate is not measured when there were no runs
    Given a Testmo project with no runs in 30 days
    Then there is no test pass rate check

  Scenario Outline: The DORA section and the Quality report give the same change failure rate
    Given Houston is running with user "sam" and password "pw"
    And change failure rate uses "<source>"
    When the user requests "/api/dora?team=<team>&days=30"
    And the user also requests "/api/reports/quality?team=<team>&days=30"
    Then the DORA change failure rate equals the Quality report's

    Examples:
      | team | source  |
      | OSSI | hotfix  |
      | OSSI | bugs    |
      | PLAT | linked  |
      | all  | linked  |
