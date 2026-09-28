Feature: The sprint board
  The sprint in progress for a team. Who is working on what is shown only to the named people viewers.

  Background:
    Given Houston is running with user "sam" and password "pw"

  Scenario: The sprint board refuses an unknown team
    When the user requests "/api/sprints/current?team=NOPE"
    Then the response status is 404

  Scenario: The sprint board hides who is working on what from non viewers
    Given the people viewers are "imam"
    When the user requests "/api/sprints/current?team=OSSI"
    Then the response status is 200
    And no work in progress item has an assignee

  Scenario: A people viewer sees assignees on the sprint board
    Given Houston is running with user "imam" and password "pw"
    And the people viewers are "imam"
    When the user requests "/api/sprints/current?team=OSSI"
    Then every work in progress item has an assignee field
