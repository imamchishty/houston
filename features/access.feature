Feature: Access control
  Houston holds per person data and API tokens. Only signed in people see anything,
  and only the named people viewers see individuals.

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

  Scenario Outline: Non viewers cannot reach the people view, however the URL is written
    Given Houston is running with user "sam" and password "pw"
    And the people viewers are "imam"
    When the user requests "<path>"
    Then the response status is 403

    Examples:
      | path                               |
      | /api/teams/OSSI/people             |
      | /api/teams/OSSI/%70eople           |
      | /api/teams/OSSI/%70%65%6f%70%6c%65 |
      | /api/teams/OSSI/people?x=1         |

  Scenario: A people viewer sees the people view
    Given Houston is running with user "imam" and password "pw"
    And the people viewers are "imam"
    When the user requests "/api/teams/OSSI/people"
    Then the response status is 200

  Scenario: Repeated wrong passwords lock the address out
    Given Houston is running with user "sam" and password "pw"
    When someone tries 10 wrong passwords
    And the user requests "/api/teams"
    Then the response status is 429
