Feature: History that survives the nightly collect
  Jira and the other tools only give back recent data. Houston keeps every day's score and measures, so trends
  keep growing beyond what the tools still hold.

  Scenario: Each run records the day, and a second run the same day replaces it
    When the nightly job runs twice on "2026-09-27"
    Then the history has 1 score for "OSSI" on "2026-09-27", equal to the team's score now
    And the history has the headline measures for "OSSI" on "2026-09-27"
    And a backup of the history exists for "2026-09-27"

  Scenario: Old backups are pruned
    When the nightly job has run on 32 different days
    Then there are 30 backups

  Scenario: History is available over the API
    Given Houston is running with user "sam" and password "pw"
    When the user requests "/api/teams/OSSI/history"
    Then the response status is 200
    And the history response has a score series and one series per headline measure
