Feature: Support load from plain Jira
  Support tickets are counted, and their SLAs measured by Houston in working time: WORKING_HOURS on working days, in
  the team's time zone. Each ticket's SLA is judged once, when it is met or when its goal passes unmet.
  Test setup: UTC, 08:00 to 18:00, Saturday and Sunday off. 2026-06-01 is a Monday.

  Background:
    Given a reporting period from 2026-06-01 to 2026-07-01
    And the working day is 08:00 to 18:00 UTC with Saturday and Sunday off
    And support SLAs are "High=4h/2d,Medium=1d/5d"

  Scenario: First response is judged in working time, once
    Given these support tickets:
      | key  | priority | created          | first response   | resolved         |
      | S-1  | High     | 2026-06-01 09:00 | 2026-06-01 12:00 | 2026-06-02 10:00 |
      | S-2  | High     | 2026-06-05 16:00 | 2026-06-08 09:30 | 2026-06-09 10:00 |
      | S-3  | High     | 2026-06-05 16:00 | 2026-06-08 11:00 |                  |
      | S-4  | Medium   | 2026-06-10 17:00 |                  |                  |
      | S-5  | Low      | 2026-06-10 09:00 | 2026-06-20 09:00 | 2026-06-25 09:00 |
    When the reports are calculated
    # S-1 3h: met. S-2 Fri 16:00 + 4 working hours = Mon 10:00; answered 09:30: met (a weekend is not waiting).
    # S-3 answered Mon 11:00, after Mon 10:00: missed. S-4 Medium 1 day = 10 working hours, due Thu 11 17:00, never answered: missed.
    # S-5 Low has no SLA: not judged.
    Then sla_response is 2 of 4, 50.0%
    And sla_response lists S-3, S-4

  Scenario: Resolution in working days
    Given these support tickets:
      | key  | priority | created          | first response   | resolved         |
      | S-1  | High     | 2026-06-01 09:00 | 2026-06-01 10:00 | 2026-06-03 08:30 |
      | S-2  | High     | 2026-06-01 09:00 | 2026-06-01 10:00 | 2026-06-03 10:00 |
    When the reports are calculated
    # High: 2 working days = 20 working hours from Mon 09:00 = Wed 09:00.
    Then sla_resolution is 1 of 2, 50.0%
    # Working hours: S-1 9 + 10 + 0.5 = 19.5, S-2 9 + 10 + 2 = 21, median 20.25.
    And support_resolution_time is 20.3 hours from 2 items

  Scenario: Support share of work, and work outside working hours
    Given these support tickets:
      | key  | priority | created          | first response   | resolved         | status changes                     |
      | S-1  | High     | 2026-06-01 09:00 | 2026-06-01 10:00 | 2026-06-01 11:00 | 2026-06-01 10:00, 2026-06-01 21:00 |
      | S-2  | High     | 2026-06-06 09:00 | 2026-06-06 10:00 | 2026-06-06 11:00 | 2026-06-06 10:00                   |
    And these work items:
      | key   | type  | created    | resolved   |
      | ABC-1 | Story | 2026-06-01 | 2026-06-02 |
      | ABC-2 | Story | 2026-06-01 | 2026-06-03 |
    When the reports are calculated
    Then support_share is 2 of 4, 50.0%
    # 21:00 is after hours; Saturday 06-06 10:00 is the weekend.
    And support_out_of_hours is 2 of 3, 66.7%

  Scenario: Reopened and duplicate tickets
    Given these support tickets:
      | key | priority | created          | resolved         | reopened | duplicate |
      | S-1 | High     | 2026-06-01 09:00 | 2026-06-02 11:00 | yes      |           |
      | S-2 | High     | 2026-06-10 09:00 | 2026-06-10 11:00 |          | yes       |
      | S-3 | High     | 2026-06-12 09:00 | 2026-06-12 11:00 |          |           |
      | S-4 | High     | 2026-06-12 09:00 | 2026-06-12 11:00 |          |           |
    When the reports are calculated
    Then support_repeat is 2 of 4, 50.0%
    And support_repeat shows these, one per line:
      | S-1 (reopened)  |
      | S-2 (duplicate) |

  Scenario: Only people's comments and status changes are kept, as times
    Given a Jira support ticket raised by "cust-1" with a comment by "cust-1" at 09:30, an automation status change at 09:40, a comment by "agent-7" at 10:15 and a status change by "agent-7" at 11:00
    When it is read from Jira
    Then its first response is 10:15
    And it keeps 1 status change time and no names or comment text

  Scenario: Reopened and duplicate come from Jira's own records
    Given a Jira support ticket whose resolution was cleared after being set, linked as duplicating "SUP-9"
    When it is read from Jira
    Then it is marked reopened and duplicate

  Scenario: Which tickets are support
    Then a team with its own support project "OSSSUP" searches 'project = "OSSSUP" AND (created >= -90d OR resolved >= -90d OR statusCategory != Done) ORDER BY created DESC'
    And a team without one searches its own project "OSS" for support issue types or labels

  Scenario: The dashboard works before any support data is collected
    Given Houston is running with user "sam" and password "pw"
    And no support data has been collected yet
    When the user requests "/api/dashboard"
    Then the response status is 200
    And support SLAs are left out of the score until support data is collected
