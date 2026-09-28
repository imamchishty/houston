Feature: Every metric is explained
  Nobody should have to guess what a number means. Every metric says why it matters
  and exactly how it is calculated, and the DORA ones show their DORA tier.

  Scenario: Every headline and drill-down measure has an explanation
    When the demo teams' performance is read
    Then every measure shown has a reason it matters and how it is calculated

  Scenario: The explanations are available to the page
    Given Houston is running with user "sam" and password "pw"
    When the user requests "/api/metrics"
    Then the response status is 200
    And the response contains "\"why\""
    And the response contains "\"how\""
    And the response contains "sprint_completion"

  Scenario Outline: DORA metrics are placed in their DORA tier
    Then a <metric> of <value> is DORA "<tier>"

    Examples:
      | metric           | value | tier   |
      | deploy_frequency | 9.4   | Elite  |
      | deploy_frequency | 1     | High   |
      | deploy_frequency | 0.6   | Medium |
      | deploy_frequency | 0.1   | Low    |
      | lead_time        | 0.5   | Elite  |
      | lead_time        | 8.8   | Medium |
      | change_failure_rate | 10 | High   |
      | change_failure_rate | 20 | Low    |
      | time_to_restore  | 30    | Medium |

  Scenario: Every measure shown is defined in METRICS.md
    Then METRICS.md defines every headline and drill-down measure
