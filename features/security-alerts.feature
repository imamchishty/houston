Feature: Security alerts are fixed on time
  Critical and high alerts from GitHub (vulnerable dependencies, leaked secrets, code scanning) are judged against a
  deadline by severity: critical 7 days, high 30, medium 90. Each alert is judged once, when it is fixed or when its
  deadline passes, whichever is first. Dismissing an overdue alert cannot improve the rate.

  Background:
    Given a reporting period from 2026-06-01 to 2026-07-01

  Scenario: On time, late, still open past the deadline, and dismissed
    Given these security alerts:
      | title | severity | state     | opened     | closed     |
      | A     | critical | fixed     | 2026-06-02 | 2026-06-05 |
      | B     | critical | fixed     | 2026-06-02 | 2026-06-20 |
      | C     | high     | open      | 2026-05-10 |            |
      | D     | high     | dismissed | 2026-05-01 | 2026-06-25 |
      | E     | high     | dismissed | 2026-06-10 | 2026-06-12 |
      | F     | high     | fixed     | 2026-06-20 | 2026-06-22 |
      | G     | medium   | fixed     | 2026-06-01 | 2026-06-03 |
      | H     | critical | fixed     | 2026-06-28 | 2026-07-03 |
    When the reports are calculated
    # A on time. B late (due 06-09, judged then). C due 06-09, still open: late. D due 05-31, before the period: not judged.
    # E dismissed before its deadline: left out. F on time. G medium: not in the rate. H judged when fixed, after the period.
    Then security_on_time is 2 of 4, 50.0%
    And security_on_time lists repo: B (critical dependency), repo: C (high dependency)
    And security_on_time misses its target of over 95

  Scenario: Dismissing an alert after its deadline still counts as late
    Given these security alerts:
      | title | severity | state     | opened     | closed     |
      | X     | critical | dismissed | 2026-06-01 | 2026-06-20 |
    When the reports are calculated
    Then security_on_time is 0 of 1, 0.0%

  Scenario: Overdue, open and leaked secrets at the end of the period
    Given these security alerts:
      | title          | kind       | severity | state | opened     | closed     |
      | old lib        | dependency | high     | open  | 2026-05-01 |            |
      | new lib        | dependency | critical | open  | 2026-06-28 |            |
      | Azure key      | secret     | critical | open  | 2026-06-15 |            |
      | fixed later    | dependency | medium   | fixed | 2026-02-01 | 2026-07-05 |
      | low no dead    | dependency | low      | open  | 2026-01-01 |            |
    When the reports are calculated
    Then security_overdue counts 3
    And security_overdue shows these, one per line:
      | repo: old lib (high dependency, 60 days old)            |
      | repo: Azure key (critical leaked secret, 15 days old)   |
      | repo: fixed later (medium dependency, 149 days old)     |
    And security_open_critical_high counts 3
    And secrets_open counts 1

  Scenario: Time to fix is the median for alerts fixed in the period
    Given these security alerts:
      | title | severity | state | opened     | closed     |
      | A     | critical | fixed | 2026-06-01 | 2026-06-03 |
      | B     | critical | fixed | 2026-06-01 | 2026-06-05 |
      | C     | critical | fixed | 2026-06-01 | 2026-06-13 |
      | D     | critical | fixed | 2026-05-01 | 2026-05-03 |
    When the reports are calculated
    Then security_fix_critical is 4 days from 3 items
    And security_fix_critical meets its target of under 7

  Scenario: A repo with scanning off is counted, and an unreadable one is left out and explained
    Given scanning is turned on like this:
      | repo | dependency | secret | code    |
      | api  | on         | on     | on      |
      | web  | on         | on     | off     |
      | ops  | on         | on     | unknown |
    When the reports are calculated
    Then scan_code is 1 of 2, 50.0%
    And scan_code lists org/web
    And scan_code notes "1 repos could not be checked: the GitHub token needs read access to code scanning."
    And scan_dependency is 3 of 3, 100.0%

  Scenario: The collector never keeps a secret, and reads disabled scanners as off
    Given GitHub returns a leaked secret, no Dependabot alerts (disabled) and code scanning without permission
    When the security alerts are collected for "org/api"
    Then no stored alert contains the secret value
    And the leaked secret is stored as "Azure Storage Account Access Key", critical and open
    And dependency scanning is off, secret scanning is on and code scanning is unknown
    And only links on the GitHub API host are followed
