Feature: Requirement churn
  Jira keeps every edit to a ticket. Houston counts edits to the description, title or acceptance criteria made after
  work started, with who made them, and tickets sent back from in progress to to do. It cannot tell a clarification
  from a change of mind: every row is a ticket to read.

  Background:
    Given a reporting period from 2026-09-01 to 2026-10-01
    And the team's Jira project is "ABC" and repos merge into "main"

  Scenario: Edits before work started do not count; edits after do, with who made them
    Given these sprint tickets:
      | key   | type  | points | started    | resolved   | ac  | epic  | edits                                                       |
      | ABC-1 | Story | 3      | 2026-09-08 | 2026-09-12 | yes | ABC-E | 2026-09-05 description by Nadia                             |
      | ABC-2 | Story | 3      | 2026-09-08 | 2026-09-16 | yes | ABC-E | 2026-09-09 description by Nadia; 2026-09-10 acceptance by Nadia; 2026-09-11 summary by Omar |
      | ABC-3 | Story | 3      | 2026-09-08 | 2026-09-13 | yes | ABC-E |                                                             |
      | ABC-4 | Story | 3      | 2026-09-08 | 2026-09-18 | yes | ABC-E | 2026-09-12 description by Nadia                             |
      | ABC-5 | Story | 3      |            |            | yes | ABC-E | 2026-09-12 description by Nadia                             |
    Then the tickets' requirement churn is:
      | ABC-1 | 0 |                        |
      | ABC-2 | 3 | Nadia, Omar            |
      | ABC-3 | 0 |                        |
      | ABC-4 | 1 | Nadia                  |
      | ABC-5 | 0 |                        |
    When the reports are calculated
    Then requirements_changed is 2 of 4, 50.0%
    And requirements_changed shows these, one per line:
      | ABC-2 (3 edits by Nadia, Omar) |
      | ABC-4 (1 edit by Nadia)        |

  Scenario: What the changes cost
    Given these sprint tickets:
      | key   | type  | points | started    | resolved   | ac  | epic  | edits                           |
      | ABC-1 | Story | 3      | 2026-09-08 | 2026-09-18 | yes | ABC-E | 2026-09-09 description by Nadia |
      | ABC-2 | Story | 3      | 2026-09-08 | 2026-09-17 | yes | ABC-E | 2026-09-09 description by Nadia |
      | ABC-3 | Story | 3      | 2026-09-08 | 2026-09-20 | yes | ABC-E | 2026-09-09 description by Nadia |
      | ABC-4 | Story | 3      | 2026-09-08 | 2026-09-11 | yes | ABC-E |                                 |
      | ABC-5 | Story | 3      | 2026-09-08 | 2026-09-12 | yes | ABC-E |                                 |
      | ABC-6 | Story | 3      | 2026-09-08 | 2026-09-13 | yes | ABC-E |                                 |
    When the reports are calculated
    # Changed: 10, 9, 12 days from start to done, median 10. Unchanged: 3, 4, 5, median 4. (Started 09:00, done 12:00.)
    Then requirements_changed notes "Start to done: changed tickets took a median 10.1 days, unchanged 4.1."

  Scenario: Sent back to refinement
    Given these sprint tickets:
      | key   | type  | points | started    | resolved   | ac  | epic  | path                                   |
      | ABC-1 | Story | 3      | 2026-09-08 | 2026-09-12 | yes | ABC-E | In Progress > To Do > In Progress > Done |
      | ABC-2 | Story | 3      | 2026-09-08 | 2026-09-12 | yes | ABC-E | In Progress > Done                       |
    When the reports are calculated
    Then sent_back is 1 of 2, 50.0%
    And sent_back lists ABC-1

  Scenario: The collector reads requirement edits from the ticket's history, and only those fields
    Given a ticket's edit history:
      | when             | field               | by    |
      | 2026-09-09T10:00 | description         | Nadia |
      | 2026-09-09T11:00 | Acceptance Criteria | Nadia |
      | 2026-09-09T12:00 | summary             | Omar  |
      | 2026-09-09T13:00 | Story Points        | Omar  |
      | 2026-09-09T14:00 | status              | Omar  |
    Then the requirement edits read are "description by Nadia, acceptance by Nadia, summary by Omar"
