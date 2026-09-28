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
