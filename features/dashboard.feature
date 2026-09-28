Feature: Dashboard
  The home page answers "how are teams performing" in one look: every team on the 10 headline measures with its
  score (share of targets met) and trend, what has missed its target two periods running, and whether the data is fresh.

  Background:
    Given Houston is running with user "sam" and password "pw"

  Scenario: Every team is shown on the same 10 headline measures, in area order
    When the user requests "/api/dashboard"
    Then the response status is 200
    And every team shows the headline measures in order, and nothing else

  Scenario: Teams are listed alphabetically, not ranked
    When the user requests "/api/dashboard"
    Then the teams are in alphabetical order

  Scenario: The dashboard score is the team page score
    When the user requests "/api/dashboard"
    Then each team's score and summary equal its own team page

  Scenario: The dashboard names nobody
    When the user requests "/api/dashboard"
    Then the response mentions none of the team's names

  Scenario: Fresh data is marked fresh
    When the user requests "/api/dashboard"
    Then the data is marked fresh

  Scenario: A missed nightly run shows as stale
    When the dashboard is read 2 days after the last collect
    Then the data is marked stale

  Scenario: Needs attention lists only headline targets missed two periods running
    When the user requests "/api/dashboard"
    Then every attention item names a team and a headline measure missed two periods running

  Scenario: The home page is the dashboard
    When the user requests "/app.js"
    Then the response contains "How teams are performing"
    And the response contains "/dashboard"
