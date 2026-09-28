Feature: The weekly note
  Houston writes what changed, what moved with it, and what is likely next, in plain English with exact numbers.
  It names measures, never people, and never grades the team. The same text goes to Teams on Fridays.

  Scenario: What changed is the headlines that moved most, with what moved with them
    Given a team meeting 4 of 9 targets, 44% (up from 33%), missing sprint_completion and lead_time (lead_time two periods running)
    And these headline results with their previous period:
      | measure           | previous | value | unit  | target | drill                                                         |
      | lead_time         | 4        | 9     | days  | < 7    | stage_deploy 20 to 90 hours; stage_review 30 to 32 hours      |
      | sprint_completion | 70       | 60    | %     | > 80   | unplanned_work 5 to 30 %; carry_over 20 to 22 %               |
      | defect_leakage    | 30       | 15    | %     | < 20   | pr_review_rate 70 to 95 % target > 95                         |
      | bug_workload      | 21       | 22    | %     | < 20   |                                                               |
    When the note is composed with no sprint in progress
    Then the note says "**44% of targets met** (4 of 9) over the last 30 days, up from 33%. Missing: finishes less than it plans and changes take too long to reach users. Two periods running: changes take too long to reach users."
    And the note says "**What changed.** Lead time for changes got worse: 4 days to 9 days. What moved with it: waiting to deploy rose from 20 hours to 90 hours. Defect leakage improved: 30% to 15%. What moved with it: PR review rate improved from 70% to 95%. Sprint completion got worse: 70% to 60%. What moved with it: unplanned work rose from 5% to 30%."
    And the note has no "Likely next" line

  Scenario: A measure that moved the other way is never called a driver
    Given a headline that got worse from 2 to 6 hours with drill-down incidents_out_of_hours 100 to 50 %, no target
    Then it has no driver

  Scenario: A drill-down with a target explains only when its trend matches
    Given a headline that got worse from 2 to 6 hours with drill-down pr_review_rate 70 to 95 % target > 95
    Then it has no driver
    Given a headline that got worse from 2 to 6 hours with drill-down pr_review_rate 95 to 70 % target > 95
    Then the driver is "PR review rate got worse from 95% to 70%"

  Scenario: A sprint that has just started is not projected
    Given a team meeting 4 of 9 targets, 44% (up from 33%), missing nothing
    And a sprint "ABC Sprint 7" in progress: 0 of 47 points done, 1 working day elapsed, 9 left, projected 0, 2 blocked and 0 ageing
    When the note is composed
    Then the note says "**Likely next.** ABC Sprint 7 has just started: 0 of 47 points done, 9 working days left. Too early to project. 2 items are blocked or waiting."

  Scenario: A sprint under way is projected, with what it needs per day
    Given a team meeting 4 of 9 targets, 44% (up from 33%), missing nothing
    And a sprint "ABC Sprint 7" in progress: 20 of 47 points done, 5 working days elapsed, 5 left, projected 40, 0 blocked and 1 ageing
    When the note is composed
    Then the note says "**Likely next.** ABC Sprint 7 is at risk: 20 of 47 points done with 5 working days left. At the current pace it finishes about 40 of 47 points. Finishing the plan needs 5.4 points a day for the remaining 5 working days. 1 has been in progress far longer than normal."

  Scenario: Nothing moved
    Given a team meeting 4 of 9 targets, 44% (up from 33%), missing nothing
    And these headline results with their previous period:
      | measure   | previous | value | unit | target | drill |
      | lead_time | 4        | 4.2   | days | < 7    |       |
    When the note is composed with no sprint in progress
    Then the note says "**What changed.** Nothing moved by much: every headline is within 10% of the 30 days before."

  Scenario: The note is served and posted, and names nobody
    Given Houston is running with user "sam" and password "pw"
    When the user requests "/api/teams/OSSI/note"
    Then the response status is 200
    And the note has a score line, a what-changed line and a likely-next line
    And the response mentions none of the team's names

  Scenario: Compass may rephrase the note, never change a number
    Given Compass is configured and answers by rephrasing the note faithfully
    When the note for "OSSI" is polished
    Then the polished note is used, with every number of the rules note
    Given Compass is configured and answers with a note that changes a number
    When the note for "OSSI" is polished
    Then the rules note is used
    Given Compass is configured and answers with a note that adds a number
    When the note for "OSSI" is polished
    Then the rules note is used
    Given Compass is configured and is down
    When the note for "OSSI" is polished
    Then the rules note is used

  Scenario: Compass is sent the note only, with the key in the header, and is not called twice in a day
    Given Compass is configured and answers by rephrasing the note faithfully
    When the note for "OSSI" is polished twice
    Then Compass was called once, with the key as a bearer token, and the request held only the note's lines
