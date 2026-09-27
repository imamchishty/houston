Feature: DORA metrics on the dashboard
  Each DORA metric shows what it is, the headline for the period, the change on the previous period,
  its DORA tier and a daily chart. The numbers must match the findings on the team pages.

  Background:
    Given Houston is running with user "sam" and password "pw"

  Scenario Outline: The dashboard agrees with the team's findings
    When the user requests "/api/dora?team=<team>&days=90"
    Then the response status is 200
    And the dashboard's <metric> matches the team's finding within <tolerance>

    Examples:
      | team | metric         | tolerance |
      | OSSI | lead_time      | 0.2       |
      | PLAT | lead_time      | 0.2       |
      | OSSI | change_failure | 1         |
      | PLAT | change_failure | 1         |

  Scenario: Every metric has a daily series for the whole period, an explanation and a tier
    When the user requests "/api/dora?team=all&days=30"
    Then each of the 4 metrics has 30 days of data, an explanation and a DORA tier

  Scenario: The previous period is compared only when there is data for it
    When the user requests "/api/dora?team=OSSI&days=30"
    Then each metric has a previous value
    When the user requests "/api/dora?team=OSSI&days=90"
    Then no metric has a previous value

  Scenario: The tier matches the DORA bands
    When the user requests "/api/dora?team=PLAT&days=30"
    Then each metric's tier is the DORA band for its value

  Scenario Outline: Bad filters are refused
    When the user requests "<path>"
    Then the response status is <status>

    Examples:
      | path                          | status |
      | /api/dora?days=14             | 400    |
      | /api/dora?team=NOPE&days=30   | 404    |
      | /api/dora?team=constructor    | 404    |
