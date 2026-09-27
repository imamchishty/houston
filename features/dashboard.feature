Feature: Dashboard
  The home page answers "how are we doing" in one look: how many teams are in each band,
  whether the data is fresh, every team's status, and where effort moves scores most.

  Background:
    Given Houston is running with user "sam" and password "pw"

  Scenario: Every team is counted in exactly one band
    When the user requests "/api/dashboard"
    Then the response status is 200
    And the band counts add up to the number of teams

  Scenario: Teams are listed alphabetically, not ranked
    When the user requests "/api/dashboard"
    Then the teams are in alphabetical order

  Scenario: The dashboard names nobody
    When the user requests "/api/dashboard"
    Then the response mentions none of the team's names

  Scenario: Fresh data is marked fresh
    When the user requests "/api/dashboard"
    Then the data is marked fresh

  Scenario: A missed nightly run shows as stale
    When the dashboard is read 2 days after the last collect
    Then the data is marked stale

  Scenario: The biggest gains across teams come first, each naming its team
    When the user requests "/api/dashboard"
    Then every attention item names a team
    And the attention items are in descending order of gain

  Scenario: The home page is the dashboard
    When the user requests "/app.js"
    Then the response contains "Teams at a glance"
    And the response contains "/dashboard"
