Feature: Access control
  Only signed in people see anything. Who is working on what (sprint board assignees) is shown only to the named
  people viewers.

  Scenario: Anonymous visitors are asked to sign in
    Given Houston is running with user "sam" and password "s3cret:pw"
    When an anonymous visitor requests "/api/teams"
    Then the response status is 401

  Scenario: A password containing a colon works
    Given Houston is running with user "sam" and password "s3cret:pw"
    When the user requests "/api/teams"
    Then the response status is 200

  Scenario: The health check answers without credentials and reveals nothing
    Given Houston is running with user "sam" and password "s3cret:pw"
    When an anonymous visitor requests "/api/health"
    Then the response status is 200
    And the response body is exactly '{"ok":true}'

  Scenario: Repeated wrong passwords lock the address out
    Given Houston is running with user "sam" and password "pw"
    When someone tries 10 wrong passwords
    And the user requests "/api/teams"
    Then the response status is 429
