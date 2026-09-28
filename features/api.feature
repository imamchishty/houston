Feature: API for the IDP
  Backstage, the IDP, or any other system reads Houston with a read-only API token.
  Everything the page shows is available as JSON, and the contract is published.

  Background:
    Given Houston is running with user "sam" and password "pw"
    And the people viewers are "imam"
    And an API token "backstage" of "0123456789abcdef0123456789abcdef"

  Scenario: A system reads how a team is performing with its token
    When "backstage" requests "/api/teams/OSSI" with its token
    Then the response status is 200
    And it has a score, a summary and the 10 headline measures in five areas, speed and quality first
    And the response mentions none of the team's names

  Scenario: A wrong token is refused
    When a caller presents the token "not-a-real-token-not-a-real-token" for "/api/teams"
    Then the response status is 401

  Scenario: API tokens are read-only
    When "backstage" posts to "/api/refresh" with its token
    Then the response status is 403

  Scenario: Every endpoint is described in the OpenAPI document, and nothing else
    When the user requests "/api/openapi.json"
    Then the response status is 200
    And the OpenAPI document lists exactly the routes Houston serves

  Scenario Outline: Everything on the page is available as JSON
    When "backstage" requests "<path>" with its token
    Then the response status is 200

    Examples:
      | path                          |
      | /api/teams                    |
      | /api/teams/OSSI               |
      | /api/teams/all?days=90        |
      | /api/teams/OSSI/history       |
      | /api/dashboard                |
      | /api/monthly?team=OSSI        |
      | /api/sprints/current?team=OSSI |
      | /api/data-quality             |
      | /api/metrics                  |
      | /api/version                  |
