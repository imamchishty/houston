Feature: History that survives the nightly collect
  Jira only gives back the last few sprints and the other tools only give "now".
  Houston keeps every day's scores, every sprint it has scored, and cost over time.

  Scenario: Each run records the day, and a second run the same day replaces it
    When the nightly job runs twice on "2026-09-27"
    Then the history has 1 day of area scores for "OSSI"
    And the history keeps 6 sprints for "OSSI"
    And a backup of the history exists for "2026-09-27"

  Scenario: Sprints Jira no longer returns are kept
    Given the history already holds a sprint "OSSI Sprint 3" for "OSSI"
    When the nightly job runs on "2026-09-28"
    Then the history keeps 7 sprints for "OSSI"

  Scenario: Old backups are pruned
    When the nightly job has run on 32 different days
    Then there are 30 backups

  Scenario: History is available over the API
    Given Houston is running with user "sam" and password "pw"
    When the user requests "/api/teams/OSSI/history"
    Then the response status is 200
    And the response contains "\"areas\""
    And the response contains "\"sprints\""
