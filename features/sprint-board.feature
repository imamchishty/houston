Feature: Current sprint numbers are exact
  Days left count working days only. Committed is what was in the sprint at the start; scope includes what was
  added. The outlook carries the points done per working day so far to the end of the sprint.

  Scenario: Days, points and outlook for a sprint two thirds of the way through
    Given a sprint "ABC Sprint 7" from Monday 2026-09-07 to Monday 2026-09-21 with these items:
      | key   | points | status | resolved   | added      |
      | ABC-1 | 5      | done   | 2026-09-10 |            |
      | ABC-2 | 3      | done   | 2026-09-15 |            |
      | ABC-3 | 8      | doing  |            |            |
      | ABC-4 | 2      | todo   |            | 2026-09-12 |
      | ABC-5 |        | todo   |            |            |
    When the sprint board is read at 2026-09-16T12:00
    Then the sprint has 10 working days, 8 elapsed and 2 left
    And committed is 16 points, scope 18, done 8 and remaining 10
    And the projection is 10 points and the outlook is "Off track"
    And 1 item is unestimated
    And the ideal line runs from 16 to 0
    And scope on 2026-09-11 is 16 and on 2026-09-14 is 18

  Scenario: Blocked or waiting now: blocked first, then the longest waiting, in working days
    Given a sprint "ABC Sprint 7" from Monday 2026-09-07 to Monday 2026-09-21 with these items:
      | key   | points | status | resolved | added | waiting in   | since      |
      | ABC-1 | 3      | doing  |          |       |              |            |
      | ABC-6 | 3      | doing  |          |       | Blocked      | 2026-09-14 |
      | ABC-7 | 2      | doing  |          |       | Ready for QA | 2026-09-11 |
    When the sprint board is read at 2026-09-16T12:00
    # ABC-6: Monday 09:00 to Wednesday 12:00 = 51 hours = 2.1 days. ABC-7: Friday 09:00 to Wednesday 12:00, the
    # weekend left out = 15 + 24 + 24 + 12 = 75 hours = 3.1 days. Blocked comes before waiting.
    Then blocked or waiting now lists, in order:
      | ABC-6 | Blocked      | Blocked | 2.1 |
      | ABC-7 | Ready for QA | Waiting | 3.1 |

  Scenario: An item flagged in Jira is blocked, whatever its status
    Given a sprint "ABC Sprint 7" from Monday 2026-09-07 to Monday 2026-09-21 with these items:
      | key   | points | status | resolved | added | flagged    |
      | ABC-1 | 3      | doing  |          |       |            |
      | ABC-8 | 3      | doing  |          |       | 2026-09-15 |
    When the sprint board is read at 2026-09-16T12:00
    # Flagged Tuesday 09:00, read Wednesday 12:00: 27 hours = 1.1 days. ABC-1 is not flagged or waiting.
    Then blocked or waiting now lists, in order:
      | ABC-8 | In Progress | Blocked | 1.1 |

  Scenario: Every ticket in the sprint is listed with its type, state and person, for filtering
    Given a sprint "ABC Sprint 7" from Monday 2026-09-07 to Monday 2026-09-21 with these items:
      | key   | points | status | resolved   | added      | assignee | type  |
      | ABC-1 | 5      | done   | 2026-09-10 |            | Ann      | Story |
      | ABC-2 | 3      | doing  |            |            | Bob      | Bug   |
      | ABC-3 | 2      | todo   |            | 2026-09-12 |          | Task  |
    When the sprint board is read with names at 2026-09-16T12:00
    Then the sprint's tickets are, in order:
      | ABC-1 | Story | done       | Ann |
      | ABC-2 | Bug   | inprogress | Bob |
      | ABC-3 | Task  | todo       |     |
    And ABC-3 was added after the sprint started
