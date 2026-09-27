Feature: Cost to build a feature
  Product and finance need to know what a feature cost so far and what the rest will cost.
  FTEs and contractors cost different amounts per day, and some people have their own rate.
  Each person's sprint cost is split across the tickets they worked that sprint, by story points.

  Background:
    Given day rates of AED 2000 for FTEs and AED 1000 for contractors
    And "Priya" is a contractor
    And a sprint from Monday 1 June 2026 to Monday 15 June 2026

  Scenario: A sprint's cost is split across features by story points
    Given these tickets in the sprint:
      | ticket | assignee | points | status | feature |
      | A-1    | Aisha    | 3      | done   | A-E1    |
      | A-2    | Aisha    | 1      | done   |         |
      | A-3    | Priya    | 5      | done   | A-E1    |
    When the feature costs are calculated
    Then the sprint has 10 working days
    And feature "A-E1" cost AED 25000, of which AED 15000 FTE and AED 10000 contractor
    And work with no feature cost AED 5000
    And the team cost AED 30000

  Scenario: An individual rate replaces the FTE or contractor rate
    Given "Aisha" has her own day rate of AED 3000
    And these tickets in the sprint:
      | ticket | assignee | points | status | feature |
      | A-1    | Aisha    | 3      | done   | A-E1    |
      | A-2    | Aisha    | 1      | done   |         |
    When the feature costs are calculated
    Then feature "A-E1" cost AED 22500, of which AED 22500 FTE and AED 0 contractor

  Scenario: Someone on the team with no tickets still costs money, but not against a feature
    Given "Dinesh" is on the team roster
    And these tickets in the sprint:
      | ticket | assignee | points | status | feature |
      | A-1    | Aisha    | 3      | done   | A-E1    |
    When the feature costs are calculated
    Then feature "A-E1" cost AED 20000, of which AED 20000 FTE and AED 0 contractor
    And people not on tickets cost AED 20000
    And the team cost AED 40000

  Scenario: Tickets not started yet cost nothing this sprint
    Given these tickets in the sprint:
      | ticket | assignee | points | status | feature |
      | A-1    | Aisha    | 3      | done   | A-E1    |
      | A-2    | Aisha    | 5      | todo   | A-E2    |
    When the feature costs are calculated
    Then feature "A-E1" cost AED 20000, of which AED 20000 FTE and AED 0 contractor
    And feature "A-E2" cost AED 0, of which AED 0 FTE and AED 0 contractor

  Scenario: Remaining work is priced at the team's cost per point
    Given these tickets in the sprint:
      | ticket | assignee | points | status     | feature |
      | A-1    | Aisha    | 4      | done       | A-E1    |
      | A-2    | Aisha    | 4      | inprogress | A-E1    |
    And feature "A-E1" is in progress with 2 tickets, 1 done
    When the feature costs are calculated
    Then the cost per point is AED 5000
    And feature "A-E1" has 4 points left costing AED 20000 to complete
    And feature "A-E1" is estimated at AED 40000 in total

  Scenario: A finished feature has nothing left to pay for
    Given these tickets in the sprint:
      | ticket | assignee | points | status     | feature |
      | A-1    | Aisha    | 4      | done       | A-E1    |
      | A-2    | Aisha    | 4      | inprogress | A-E1    |
    And feature "A-E1" is done with 2 tickets, 2 done
    When the feature costs are calculated
    Then feature "A-E1" has 0 points left costing AED 0 to complete

  Scenario: Feature costs are visible to the team, the rates only to people viewers
    Given Houston is running with user "sam" and password "pw"
    And the people viewers are "imam"
    When the user requests "/api/teams/OSSI/costs"
    Then the response status is 200
    And the response contains "\"features\""
    And the response does not show the day rates

  Scenario: A people viewer sees the rates behind the numbers
    Given Houston is running with user "imam" and password "pw"
    And the people viewers are "imam"
    When the user requests "/api/teams/OSSI/costs"
    Then the response shows the day rates
