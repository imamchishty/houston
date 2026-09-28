Feature: Metric audit fixes
  Each scenario fixes a way a metric could give a wrong number on real data.

  Scenario: No availability tests means availability is not measured
    Given production data with no availability tests
    Then availability is not measured, and server errors are

  Scenario: CI failure rate counts the main branch only
    Given CI runs:
      | branch    | success | failure |
      | main      | 9       | 1       |
      | feature/x | 2       | 8       |
    Then the CI failure rate is 10%

  Scenario: The test pass rate is not measured when there were no runs
    Given a Testmo project with no runs in 30 days
    Then the test pass rate is not measured
