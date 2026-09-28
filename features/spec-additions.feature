Feature: Weekend-aware cycle time, unplanned work, defect leakage, WIP per person and the simple view

  Scenario Outline: Hours between two times leave out weekend days, in the team's time zone
    Then from <from> to <to> with offset <tz> hours is <hours> hours excluding weekends

    Examples:
      | from             | to               | tz | hours |
      | 2026-09-25T16:00 | 2026-09-28T10:00 | 0  | 18    |
      | 2026-09-22T09:00 | 2026-09-22T17:00 | 0  | 8     |
      | 2026-09-26T09:00 | 2026-09-27T17:00 | 0  | 0     |
      | 2026-09-25T18:00 | 2026-09-28T02:00 | 4  | 8     |
      | 2026-09-18T12:00 | 2026-09-25T12:00 | 0  | 120   |

  Scenario: Unplanned work counts points on tickets created after the sprint started
    Given a reporting period from 2026-09-01 to 2026-10-01
    And a closed sprint from 2026-09-07 to 2026-09-21 with these finished tickets:
      | key   | points | created    | resolved   |
      | ABC-1 | 5      | 2026-08-30 | 2026-09-10 |
      | ABC-2 | 3      | 2026-09-09 | 2026-09-12 |
      | ABC-3 | 2      | 2026-09-02 | 2026-09-15 |
      | ABC-4 |        | 2026-09-10 | 2026-09-16 |
      | ABC-5 | 8      | 2026-09-11 | 2026-09-25 |
    When the reports are calculated
    Then unplanned_work is 3 of 10, 30%
    And unplanned_work notes "1 finished tickets had no estimate and are not counted."

  Scenario: Defect leakage uses labels and never guesses
    Given a reporting period from 2026-09-01 to 2026-10-01
    And these labelled bugs:
      | key   | created    | labels     |
      | ABC-1 | 2026-09-02 | production |
      | ABC-2 | 2026-09-03 | qa         |
      | ABC-3 | 2026-09-04 | staging    |
      | ABC-4 | 2026-09-05 | customer   |
      | ABC-5 | 2026-09-06 |            |
      | ABC-6 | 2026-08-06 | production |
    When the reports are calculated
    Then defect_leakage is 2 of 4, 50%
    And defect_leakage notes "1 of 5 bugs had no environment label and are not counted."

  Scenario: WIP per person counts people with more than two tickets in progress at once
    Given a sprint "ABC Sprint 7" from Monday 2026-09-07 to Monday 2026-09-21 with these items:
      | key   | points | status | resolved | added |
      | ABC-1 | 1      | doing  |          |       |
      | ABC-2 | 1      | doing  |          |       |
      | ABC-3 | 1      | doing  |          |       |
      | ABC-4 | 1      | todo   |          |       |
    When the sprint board is read at 2026-09-16T12:00
    Then 1 of 1 people has more than 2 tickets in progress, at most 3

  Scenario: Every headline measure has a plain English name for the summary line
    Then every headline measure has a plain name

  Scenario: Each team's summary line is plain words and names nobody
    Given Houston is running with user "sam" and password "pw"
    When the user requests "/api/dashboard"
    Then the response status is 200
    And every team's summary line uses no jargon
    And the response mentions none of the team's names

  Scenario: A past sprint's board does not count work finished after it ended
    Given a closed sprint "ABC Sprint 6" from Monday 2026-08-24 to Monday 2026-09-07 with these items:
      | key   | points | status | resolved   | added |
      | ABC-1 | 5      | done   | 2026-09-01 |       |
      | ABC-2 | 3      | done   | 2026-09-10 |       |
    When the board for sprint 1 is read at 2026-09-27T12:00
    Then committed is 8 points, scope 8, done 5 and remaining 3
    And the sprint has 10 working days, 10 elapsed and 0 left

  Scenario: Any past sprint can be opened from the API
    Given Houston is running with user "sam" and password "pw"
    When the user requests the board for OSSI's first sprint
    Then the response status is 200
    And no item on it was finished after the sprint ended
