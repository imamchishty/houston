Feature: Claude usage and cost
  On a Team plan Claude is billed per seat. The seat is part of what a feature costs,
  and adoption shows whether the seats are used. Usage comes from Claude Code's own telemetry.

  Scenario: A Claude seat is added to the holder's day rate and flows into feature cost
    Given day rates of AED 2000 for FTEs and AED 1000 for contractors
    And a Claude seat costing AED 100 a working day for everyone
    And a sprint from Monday 1 June 2026 to Monday 15 June 2026
    And these tickets in the sprint:
      | ticket | assignee | points | status | feature |
      | A-1    | Aisha    | 3      | done   | A-E1    |
    When the feature costs are calculated
    Then feature "A-E1" cost AED 21000, of which AED 21000 FTE and AED 0 contractor
    And Claude seats cost AED 1000 of the team cost

  Scenario: Only seat holders carry the seat cost
    Given day rates of AED 2000 for FTEs and AED 1000 for contractors
    And a Claude seat costing AED 100 a working day for "Priya"
    And "Priya" is a contractor
    And a sprint from Monday 1 June 2026 to Monday 15 June 2026
    And these tickets in the sprint:
      | ticket | assignee | points | status | feature |
      | A-1    | Aisha    | 3      | done   | A-E1    |
      | A-2    | Priya    | 3      | done   | A-E1    |
    When the feature costs are calculated
    Then feature "A-E1" cost AED 31000, of which AED 20000 FTE and AED 11000 contractor
    And Claude seats cost AED 1000 of the team cost

  Scenario: A monthly seat price becomes a daily cost over the working year
    Then a seat of AED 520 a month costs AED 24 a working day

  Scenario: Adoption is the share of the team using Claude Code
    Given Houston is running with user "sam" and password "pw"
    When the user requests "/api/teams/OSSI/claude"
    Then the response status is 200
    And 5 of 8 people use Claude Code, 63%

  Scenario: Only people viewers see who is and is not using it
    Given Houston is running with user "sam" and password "pw"
    And the people viewers are "imam"
    When the user requests "/api/teams/OSSI/claude"
    Then the Claude report has no per person data
    And the response mentions none of the team's names

  Scenario: A people viewer sees the per person view
    Given Houston is running with user "imam" and password "pw"
    And the people viewers are "imam"
    When the user requests "/api/teams/OSSI/claude"
    Then the Claude report lists 5 people and 3 not using it
    And no Claude person record has an email address

  Scenario: Every Claude figure is explained
    Then the metrics "claude_seat_cost, claude_adoption, claude_acceptance, claude_output, claude_api_equivalent" are explained
