Feature: Definition of Ready and Definition of Done
  Every ticket is checked against the team's two definitions, from what Jira and GitHub record. Ready is a miss once
  work has started. Done is judged only on done tickets. A check that cannot be judged for a ticket is left out.

  Background:
    Given a reporting period from 2026-09-01 to 2026-10-01
    And the team's Jira project is "ABC" and repos merge into "main"

  Scenario: Ready, check by check
    Given these sprint tickets:
      | key    | type  | points | estimated  | started    | ac  | epic  |
      | ABC-1  | Story | 3      |            | 2026-09-08 | yes | ABC-E |
      | ABC-2  | Story |        |            | 2026-09-08 | yes | ABC-E |
      | ABC-3  | Story | 3      | 2026-09-10 | 2026-09-08 | yes | ABC-E |
      | ABC-4  | Story | 3      | 2026-09-05 | 2026-09-08 | yes | ABC-E |
      | ABC-5  | Story | 3      |            | 2026-09-08 | no  | ABC-E |
      | ABC-6  | Story | 3      |            | 2026-09-08 | yes |       |
      | ABC-7  | Bug   | 3      |            | 2026-09-08 | yes |       |
      | ABC-8  | Story | 13     |            | 2026-09-08 | yes | ABC-E |
      | ABC-9  | Story |        |            | 2026-09-08 | no  |       |
      | ABC-10 | Story |        |            |            | no  |       |
    Then the tickets are ready or not:
      | ABC-1  | ready                                                   |
      | ABC-2  | no estimate                                             |
      | ABC-3  | estimated after work started                            |
      | ABC-4  | ready                                                   |
      | ABC-5  | no acceptance criteria                                  |
      | ABC-6  | not in an epic                                          |
      | ABC-7  | ready                                                   |
      | ABC-8  | bigger than 8 points                                    |
      | ABC-9  | no estimate, no acceptance criteria, not in an epic     |
      | ABC-10 | no estimate, no acceptance criteria, not in an epic     |
    When the reports are calculated
    # Only the nine tickets whose work started count: ABC-10 is still to do, so it is not a miss yet.
    Then ready_rate is 3 of 9, 33.3%
    And ready_rate notes "Most often missing: no estimate (2), no acceptance criteria (2), not in an epic (2)."

  Scenario: Done, check by check
    Given the team's repos have a tests lane
    And these sprint tickets:
      | key   | type  | points | started    | resolved   | ac  | epic  | path                                           |
      | ABC-1 | Story | 3      | 2026-09-08 | 2026-09-12 | yes | ABC-E | In Progress > QA > Done                        |
      | ABC-2 | Story | 3      | 2026-09-08 | 2026-09-12 | yes | ABC-E | In Progress > QA > Done                        |
      | ABC-3 | Story | 3      | 2026-09-08 | 2026-09-12 | yes | ABC-E | In Progress > QA > Done                        |
      | ABC-4 | Story | 3      | 2026-09-08 | 2026-09-12 | yes | ABC-E | In Progress > QA > Done                        |
      | ABC-5 | Story | 3      | 2026-09-08 | 2026-09-12 | yes | ABC-E | In Progress > Done                             |
      | ABC-6 | Story | 3      | 2026-09-08 | 2026-09-12 | yes | ABC-E | In Progress > QA > Done > In Progress > QA > Done |
      | ABC-7 | Spike | 3      | 2026-09-08 | 2026-09-12 | yes | ABC-E | In Progress > QA > Done                        |
      | ABC-8 | Story | 3      | 2026-09-08 | 2026-09-12 | yes | ABC-E | In Progress > QA > Done                        |
      | ABC-9 | Story | 3      | 2026-09-08 |            | yes | ABC-E | In Progress                                    |
    And these pull requests:
      | pr | opened     | merged     | base | reviews | areas         | tickets |
      | 1  | 2026-09-09 | 2026-09-10 | main | 1       | backend+tests | ABC-1   |
      | 3  | 2026-09-09 | 2026-09-10 | main | 0       | backend+tests | ABC-3   |
      | 4  | 2026-09-09 | 2026-09-10 | main | 1       | backend       | ABC-4   |
      | 5  | 2026-09-09 | 2026-09-10 | main | 1       | backend+tests | ABC-5   |
      | 6  | 2026-09-09 | 2026-09-10 | main | 1       | backend+tests | ABC-6   |
      | 8  | 2026-09-09 |            | main | 1       | backend+tests | ABC-8   |
    Then the done tickets are done properly or not:
      | ABC-1 | done                             |
      | ABC-2 | no merged pull request           |
      | ABC-3 | not reviewed by someone else     |
      | ABC-4 | no tests in the change           |
      | ABC-5 | did not go through QA            |
      | ABC-6 | reopened after being marked done |
      | ABC-7 | done                             |
      | ABC-8 | no merged pull request           |
      | ABC-9 | not judged                       |
    When the reports are calculated
    # ABC-7 is a Spike: no code needed. ABC-9 is not done, so it is not judged.
    Then done_rate is 2 of 8, 25.0%
    And done_rate shows these, one per line:
      | ABC-2 (no merged pull request)           |
      | ABC-3 (not reviewed by someone else)     |
      | ABC-4 (no tests in the change)           |
      | ABC-5 (did not go through QA)            |
      | ABC-6 (reopened after being marked done) |
      | ABC-8 (no merged pull request)           |

  Scenario: A check Houston cannot judge is left out, not failed
    # No GitHub data for the team, no status history, no tests lane: nothing can be held against the ticket.
    Given these sprint tickets:
      | key   | type  | points | started    | resolved   | ac  | epic  |
      | ABC-1 | Story | 3      | 2026-09-08 | 2026-09-12 | yes | ABC-E |
    Then the done tickets are done properly or not:
      | ABC-1 | done |

  Scenario: Released to production, when the team's definition includes it
    Given the Definition of Done also needs a release
    And these sprint tickets:
      | key   | type  | points | started    | resolved   | ac  | epic  |
      | ABC-1 | Story | 3      | 2026-09-08 | 2026-09-12 | yes | ABC-E |
      | ABC-2 | Story | 3      | 2026-09-18 | 2026-09-21 | yes | ABC-E |
    And these pull requests:
      | pr | opened     | merged     | base | reviews | tickets |
      | 1  | 2026-09-09 | 2026-09-10 | main | 1       | ABC-1   |
      | 2  | 2026-09-19 | 2026-09-20 | main | 1       | ABC-2   |
    And these deploys:
      | at         | success |
      | 2026-09-12 | yes     |
    Then the done tickets are done properly or not:
      | ABC-1 | done             |
      | ABC-2 | not released yet |

  Scenario: When the estimate was first set comes from the ticket's history
    Given a ticket's estimate history, oldest first:
      | when             | from | to |
      | 2026-09-05T10:00 |      | 3  |
      | 2026-09-09T10:00 | 3    | 5  |
    Then it was first estimated at 2026-09-05T10:00
    Given a ticket's estimate history, oldest first:
      | when             | from | to |
      | 2026-09-09T10:00 | 3    | 5  |
    Then it was estimated when it was created
