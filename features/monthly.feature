Feature: Monthly report
  One calendar month in the team's time zone, against the month before, with six months of trend.
  A month the collected data does not fully cover is never shown as if it were complete.

  Scenario Outline: A month runs from the 1st to the next 1st in the team's time zone
    Then with time zone offset <tz> hours, <month> runs from <from> to <to>

    Examples:
      | tz | month   | from                     | to                       |
      | 0  | 2026-09 | 2026-09-01T00:00:00.000Z | 2026-10-01T00:00:00.000Z |
      | 4  | 2026-09 | 2026-08-31T20:00:00.000Z | 2026-09-30T20:00:00.000Z |
      | 4  | 2026-12 | 2026-11-30T20:00:00.000Z | 2026-12-31T20:00:00.000Z |

  Scenario: The current month is in progress, a month the data starts in is partial, and before that there is no data
    Given Houston is running with user "sam" and password "pw"
    Then the monthly status for the current month is "in progress"
    And the monthly status for the month the collected data starts in is "partial"
    And the monthly status for the month before that is "no data"

  Scenario: A saved month is used once its raw data is gone
    Given the month before the collected data starts was saved with 7.5 deploys per week
    Then that month shows as "saved" with 7.5 deploys per week

  Scenario: The report and its Markdown agree
    Given Houston is running with user "sam" and password "pw"
    When the user requests the monthly report for last month
    Then the response status is 200
    And it has 11 key numbers and 6 months of trend for each
    And the Markdown for the same month shows the same deploys per week

  Scenario Outline: Bad months are refused
    Given Houston is running with user "sam" and password "pw"
    When the user requests "<path>"
    Then the response status is <status>

    Examples:
      | path                           | status |
      | /api/monthly?month=2026-13     | 400    |
      | /api/monthly?month=26-09       | 400    |
      | /api/monthly?team=NOPE         | 404    |
