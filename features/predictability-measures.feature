Feature: Predictability measures are exact
  Code traceability and ticket hygiene, counted by hand.

  Background:
    Given a reporting period from 2026-09-01 to 2026-10-01
    And the team's Jira project is "ABC" and repos merge into "main"

  Scenario: Use of branches and merged branches with PR
    Given these commits on main:
      | sha     | at         | merge | via pr |
      | a1      | 2026-09-02 | no    | yes    |
      | a2      | 2026-09-03 | no    | yes    |
      | a3      | 2026-09-04 | no    | yes    |
      | direct1 | 2026-09-05 | no    | no     |
      | plain1  | 2026-09-06 | yes   | no     |
      | old1    | 2026-08-06 | no    | no     |
      | new1    | 2026-10-06 | no    | no     |
    And these pull requests:
      | pr | opened     | merged     | base | reviews |
      | 1  | 2026-09-01 | 2026-09-02 | main | 1       |
      | 2  | 2026-09-02 | 2026-09-03 | main | 1       |
    When the reports are calculated
    Then use_of_branches is 3 of 4, 75%
    And use_of_branches lists repo@direct1
    And merged_with_pr is 2 of 3, 66.7%

  Scenario: A PR is traceable only if it names one of the team's Jira projects
    Given these pull requests:
      | pr | opened     | merged     | base | reviews | tickets |
      | 1  | 2026-09-02 | 2026-09-03 | main | 1       | ABC-12  |
      | 2  | 2026-09-04 | 2026-09-05 | main | 1       | UTF-8   |
      | 3  | 2026-09-06 | 2026-09-07 | main | 1       |         |
    When the reports are calculated
    Then prs_traceable is 1 of 3, 33.3%
    And prs_traceable lists repo#2, repo#3

  Scenario: Ticket hygiene is measured on tickets closed in the period
    Given these work items:
      | key   | type     | created    | resolved   | points | sprint | epic  |
      | ABC-1 | Story    | 2026-08-20 | 2026-09-03 | 3      | yes    | ABC-E |
      | ABC-2 | Story    | 2026-08-20 | 2026-09-04 |        | yes    | ABC-E |
      | ABC-3 | Task     | 2026-08-20 | 2026-09-05 | 1      | no     |       |
      | ABC-4 | Bug      | 2026-08-20 | 2026-09-06 | 2      | no     |       |
      | ABC-5 | Sub-task | 2026-08-20 | 2026-09-06 |        | no     |       |
      | ABC-6 | Story    | 2026-08-20 |            |        | no     |       |
      | ABC-7 | Story    | 2026-08-01 | 2026-08-20 |        | no     |       |
      | ABC-8 | Story    | 2026-09-20 | 2026-10-04 |        | no     |       |
    And these epics:
      | key   | closed     | due        |
      | ABC-E | 2026-09-10 | 2026-09-30 |
      | ABC-F | 2026-09-12 |            |
      | ABC-G |            |            |
    When the reports are calculated
    Then tickets_estimated is 3 of 4, 75%
    And tickets_estimated lists ABC-2
    And tickets_in_sprint is 2 of 4, 50%
    And tickets_in_epic is 2 of 3, 66.7%
    And epics_with_due_date is 1 of 2, 50%
