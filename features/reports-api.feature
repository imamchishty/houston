Feature: Reports agree with each other
  The dashboard headline, the summary page and the per-team table are the same numbers from the same
  functions. If they ever disagree, people stop trusting all of them.

  Background:
    Given Houston is running with user "sam" and password "pw"

  Scenario Outline: The dashboard headline equals the report
    When the user requests "/api/dashboard"
    And the user also requests "/api/reports/<report>?team=all&days=30"
    Then the dashboard's <measure> equals the report's

    Examples:
      | report         | measure             |
      | quality        | change_failure_rate |
      | quality        | bugs_per_change         |
      | predictability | sprint_completion   |
      | predictability | prs_traceable       |
      | efficiency     | pr_cycle_hours      |
      | efficiency     | pickup_time         |

  Scenario Outline: Each team's row equals that team's own report
    When the user requests "/api/reports/<report>?team=all&days=30"
    Then every team's row equals the report filtered to that team

    Examples:
      | report         |
      | quality        |
      | predictability |
      | efficiency     |

  Scenario: Every measure shows its counts, target and definition
    When the user requests "/api/reports/quality?team=all&days=90"
    Then every measured rate has a count over a count that gives its value
    And every measure has a target and a definition

  Scenario Outline: Bad filters are refused
    When the user requests "<path>"
    Then the response status is <status>

    Examples:
      | path                                      | status |
      | /api/reports/quality?days=14              | 400    |
      | /api/reports/quality?team=NOPE            | 404    |
      | /api/sprints/current?team=NOPE            | 404    |

  Scenario: The sprint board hides who is working on what from non viewers
    Given the people viewers are "imam"
    When the user requests "/api/sprints/current?team=OSSI"
    Then the response status is 200
    And no work in progress item has an assignee

  Scenario: A people viewer sees assignees on the sprint board
    Given Houston is running with user "imam" and password "pw"
    And the people viewers are "imam"
    When the user requests "/api/sprints/current?team=OSSI"
    Then every work in progress item has an assignee field
