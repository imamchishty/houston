Feature: How a team is performing
  Ten headline measures in five areas: planning, execution, quality, stability and support, security. The score is the share of headline targets
  met; drill-down measures explain a headline and never count in the score. Small samples are shown but not judged.

  Background:
    Given Houston is running with user "sam" and password "pw"

  Scenario: The score counts judged headline targets only
    Given these headline results:
      | measure            | value | target   | small sample |
      | deploy_frequency   | 2     | > 1      |              |
      | lead_time          | 9     | < 7      |              |
      | sprint_completion  | 85    | > 80     |              |
      | defect_leakage     | 50    | < 20     | yes          |
      | bug_workload       |       | < 20     |              |
      | flow_efficiency    | 45    | > 40     |              |
    And a drill-down measure pickup_time of 5 against a target of under 1
    When the score is worked out
    Then 3 of 4 targets are met, 75%

  Scenario: Missed targets are listed worst first
    When the user requests "/api/teams/OSSI?days=30"
    Then the missed targets come before nothing else, two periods running first, then in area order

  Scenario: Every rate shows the counts that give its value, and every headline has a target and a definition
    When the user requests "/api/teams/all?days=90"
    Then every measured rate has a count over a count that gives its value
    And every headline has a target and a definition

  Scenario: All teams together agree with each team's counts
    When the user requests "/api/teams/all?days=30"
    Then each headline count for all teams is the sum of the teams' counts

  Scenario Outline: Bad filters are refused
    When the user requests "<path>"
    Then the response status is <status>

    Examples:
      | path                        | status |
      | /api/teams/OSSI?days=14     | 400    |
      | /api/teams/NOPE             | 404    |
      | /api/teams/NOPE/history     | 404    |
      | /api/monthly?team=NOPE      | 404    |
