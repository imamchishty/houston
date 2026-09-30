Feature: Admin section
  One admin account runs the admin section: the test report for this build, connection health, team setup and a
  change log. It always needs the admin sign-in. Tokens are never shown or accepted there: they stay in Key Vault.

  Background:
    Given Houston is running with user "sam" and password "pw"
    And the admin account is "admin" with password "Correct-Horse-Battery-9"

  Scenario: Only the admin account gets in
    When the user requests "/api/admin/status"
    Then the response status is 401
    When the admin requests "/api/admin/status"
    Then the response status is 200
    And the admin is signed in as "admin"

  Scenario: The admin can use the rest of Houston too
    When the admin requests "/api/teams"
    Then the response status is 200

  Scenario: API tokens cannot reach the admin section
    Given an API token "reporting" is set up
    When the "reporting" token requests "/api/admin/status"
    Then the response status is 401

  Scenario: No admin account, no admin section
    Given there is no admin account
    When the admin requests "/api/admin/status"
    Then the response status is 403
    And the error says "HOUSTON_ADMIN_USER and HOUSTON_ADMIN_PASSWORD are not set"

  Scenario: A weak admin password works in demo mode, with a warning
    Given the admin account is "admin" with password "admin1234"
    When the admin requests "/api/admin/status"
    Then the response status is 200
    And the admin page warns that the password is weak

  Scenario: A weak admin password turns the admin section off outside demo mode
    Given the admin account is "admin" with password "admin1234"
    And Houston runs in live mode
    When the admin requests "/api/admin/status"
    Then the response status is 403
    And the error says "too weak for live use"

  Scenario: Wrong admin passwords count towards the lockout
    When someone tries the admin password wrong 10 times
    And the admin requests "/api/admin/status"
    Then the response status is 429

  Scenario: Connection checks never show a token, and say what is wrong
    Given Jira, GitHub, SonarQube and Testmo are connected with known tokens
    And GitHub's token has the scopes "public_repo, read:org" and expires on 2026-10-01
    And Testmo rejects its token
    When the admin checks the connections
    Then the response status is 200
    And no token value appears in the response
    And "Jira" works, signed in as "Houston Bot"
    And "GitHub" is missing "repo, security_events"
    And "GitHub" expires on 2026-10-01
    And "Testmo" is failing with "Token rejected (401): expired, revoked or wrong"
    And "Azure" is not set

  Scenario: A team is checked before it is saved
    When the admin saves a team:
      | name | jiraProject | jiraBoardId | repos             |
      | NEWT | NEW         | 42          | not a repo        |
    Then the response status is 400
    And the problems include 'GitHub repo (owner/name): "not a repo" is not valid'

  Scenario: Adding, changing and removing a team is applied and logged
    When the admin saves a team:
      | name | jiraProject | jiraBoardId | repos                 | roster           |
      | NEWT | NEW         | 42          | m42/newt-api,m42/web  | Aisha,Omar       |
    Then the response status is 200
    And Houston now collects "m42/newt-api" and "m42/web" for "NEWT"
    And the team list shows "NEWT" set up in the admin page
    When the admin saves a team:
      | name | jiraProject | jiraBoardId | repos        |
      | NEWT | NEW         | 43          | m42/newt-api |
    Then Houston now collects "m42/newt-api" for "NEWT"
    When the admin removes the team "NEWT"
    Then the response status is 200
    And Houston no longer collects anything for "NEWT"
    And the change log shows "team removed", "team changed" and "team added" for "NEWT" by "admin"

  Scenario: Testing a team says what was found
    Given Jira's board 42 is "New team board" with the project "OTHER"
    When the admin tests a team:
      | name | jiraProject | jiraBoardId |
      | NEWT | NEW         | 42          |
    Then the response status is 200
    And the check "Jira board 42" failed with 'Board "New team board" found, but project NEW is not on it (it has OTHER)'

  Scenario: The test report says whether it belongs to the running build
    Given a test report from commit "abc1234" with 3 of 4 scenarios passing
    When the admin requests "/api/admin/tests"
    Then the response status is 200
    And the test report shows 3 of 4 scenarios passed
    And it is marked as a different build

  Scenario: No test report in the build
    Given there is no test report
    When the admin requests "/api/admin/tests"
    Then the response status is 200
    And it says there is no test report

  Scenario: SLAs are set per priority in the admin page, with any priority names
    When the admin saves SLAs "P0=1h/4h,P1=4h/1d,P2=1d/5d" with a working day of 08:00 to 17:00
    Then the response status is 200
    And support tickets are now judged against "p0" 1h to respond and 4h to resolve
    And the working day is 08:00 to 17:00
    And the change log shows "settings changed" by "admin"

  Scenario: A mistyped SLA is refused and nothing changes
    When the admin saves SLAs "P0=1 hour/4h" with a working day of 08:00 to 17:00
    Then the response status is 400
    And the problems include 'SLA P0: time to respond "1 hour" should look like 4h or 2d'
    And support tickets are not judged against "p0"

  Scenario: Reset goes back to the .env values
    When the admin saves SLAs "P0=1h/4h" with a working day of 08:00 to 17:00
    And the admin resets the settings
    Then support tickets are not judged against "p0"

  Scenario: Allocation is for the admin only
    When the user requests "/api/admin/allocation/OSSI"
    Then the response status is 401
    When the admin requests "/api/admin/allocation/OSSI"
    Then the response status is 200
    And the allocation has people with lanes, a last recorded date, in-progress and finished items, and no totals
    When the admin requests "/api/admin/allocation/all"
    Then the response status is 404

  Scenario: Allocation signals: stuck, hoarding, and nothing recorded; capacity from people and working days
    Given the day rate is 2000 AED
    And a sprint "ABC Sprint 7" from Monday 2026-09-07 to Monday 2026-09-21 with these items:
      | key   | points | status | resolved   | added | assignee | started    | waiting in   | since      |
      | ABC-1 | 3      | doing  |            |       | Ann      | 2026-09-08 |              |            |
      | ABC-2 | 3      | doing  |            |       | Ann      | 2026-09-08 | Ready for QA | 2026-09-08 |
      | ABC-3 | 2      | done   | 2026-09-10 |       | Ann      | 2026-09-08 |              |            |
      | ABC-4 | 2      | doing  |            |       | Bob      | 2026-09-08 |              |            |
      | ABC-5 | 2      | doing  |            |       | Bob      | 2026-09-08 |              |            |
      | ABC-6 | 2      | doing  |            |       | Bob      | 2026-09-08 |              |            |
      | ABC-7 | 2      | doing  |            |       | Bob      | 2026-09-08 |              |            |
      | ABC-8 | 5      | todo   |            |       |          |            |              |            |
    When the allocation for "ABC" is read at 2026-09-16T12:00
    # ABC-2 last moved Tuesday 8 Sept 09:00: 6.1 working days by Wednesday 16 Sept 12:00, so it is stuck; ABC-1 has
    # no history, so its last move is when it started, also stuck. Ann finished ABC-3, so she is not hoarding.
    # Bob's four have not moved either, and he has finished nothing: stuck and hoarding. Nobody is without a trace.
    # Capacity: Ann and Bob, 10 working days.
    Then Ann's signals are "2 in progress items have not moved for 5 or more working days"
    And Bob's signals are "4 in progress items have not moved for 5 or more working days; 4 items in progress and nothing finished in 14 days"
    And the capacity is 2 people, 10 working days, 20 person-days, AED 40000

  Scenario: The Definition of Ready and Definition of Done are set in the admin page
    When the admin saves the definitions: ready "estimate,acceptance", done "pr,review", largest ticket 5 points
    Then the response status is 200
    And the Definition of Ready is "estimate,acceptance" with at most 5 points, and the Definition of Done is "pr,review"
    And the change log shows "settings changed" by "admin"
    When the admin saves the definitions: ready "estimate,vibes", done "pr", largest ticket 5 points
    Then the response status is 400
    And the Definition of Ready is "estimate,acceptance" with at most 5 points, and the Definition of Done is "pr,review"

  Scenario: Saving SLAs alone leaves the definitions as they are
    When the admin saves SLAs "P0=1h/4h" with a working day of 08:00 to 17:00
    Then the Definition of Ready is "estimate,acceptance,epic,size" with at most 8 points, and the Definition of Done is "pr,review,tests,qa,stayed_done"
