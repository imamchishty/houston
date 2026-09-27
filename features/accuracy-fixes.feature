Feature: Accuracy rules that real data depends on
  Each rule here fixes a way a number could be wrong on real Jira and GitHub data.

  Scenario Outline: Only another person's review counts
    Then a review by "<login>" of type "<type>" on a PR by "akhan" <counts>

    Examples:
      | login               | type | counts         |
      | lena                | User | counts         |
      | akhan               | User | does not count |
      | AKHAN               | User | does not count |
      | github-actions[bot] | Bot  | does not count |
      | copilot             | Bot  | does not count |
      | sonar-scanner[bot]  | User | does not count |
      | build-svc           | User | does not count |

  Scenario: A ticket counts as done only in the sprint it was finished in
    Given a closed sprint ending 2026-09-14 with these items:
      | key   | points | resolved   |
      | ABC-1 | 5      | 2026-09-10 |
      | ABC-2 | 3      | 2026-09-20 |
      | ABC-3 | 2      |            |
    Then 5 of 10 committed points are done in that sprint

  Scenario: Lead time uses a deploy of the PR's own repo
    Given PR 1 in "org/web" opened 2026-09-01 and merged 2026-09-02
    And a successful deploy of "org/api" on 2026-09-03
    And a successful deploy of "org/web" on 2026-09-06
    Then its lead time is 5 days

  Scenario: A repo with no deploys of its own falls back to the team's deploys
    Given PR 1 in "org/lib" opened 2026-09-01 and merged 2026-09-02
    And a successful deploy of "org/api" on 2026-09-03
    Then its lead time is 2 days

  Scenario: Work started at the first move into any in-progress status, whatever its name
    Given Jira statuses: 3 "In Development" is in progress, 4 "In Review" is in progress, 5 "Done" is done
    And a ticket history, newest first:
      | when             | to |
      | 2026-09-12T10:00 | 5  |
      | 2026-09-10T10:00 | 3  |
      | 2026-09-09T10:00 | 1  |
      | 2026-09-05T10:00 | 4  |
    Then work started at 2026-09-05T10:00
