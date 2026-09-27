Feature: Web security
  Houston must pass the go-live security scan: strict headers, no cross-site posts,
  validated input and limits on the expensive endpoints.

  Background:
    Given Houston is running with user "sam" and password "pw"

  Scenario: Every response carries security headers
    When the user requests "/"
    Then the response status is 200
    And the "content-security-policy" header contains "script-src 'self'"
    And the "content-security-policy" header contains "frame-ancestors 'none'"
    And the "x-frame-options" header is "DENY"
    And the "x-content-type-options" header is "nosniff"

  Scenario: The page has no inline script or event handlers
    When the user requests "/"
    Then the response does not contain "onclick="
    And the response does not contain "<script>"

  Scenario: Cross-site form posts are refused
    When the user posts to "/api/refresh" without the Houston header
    Then the response status is 403

  Scenario: Files outside the UI cannot be read
    When the user requests "/../package.json"
    Then the response status is not 200

  Scenario Outline: The action log rejects bad entries
    When the user records an action <entry> for "<board>"
    Then the response status is <status>

    Examples:
      | entry                                                   | board | status |
      | {"recId":"flow","status":"hacked","owner":"sam"}        | OSSI  | 400    |
      | {"recId":"flow","status":"done"}                        | OSSI  | 400    |
      | {"recId":"flow","status":"done","owner":"sam","x":1}    | OSSI  | 400    |
      | {"recId":"flow","status":"done","owner":"sam"}          | NOPE  | 404    |

  Scenario: Oversized action log entries are refused
    When the user records an action with a 20000 character note for "OSSI"
    Then the response status is 413

  Scenario: A valid action is recorded and listed
    When the user records an action {"recId":"flow","status":"accepted","owner":"sam","note":"WIP limit agreed"} for "OSSI"
    Then the response status is 200
    When the user requests "/api/teams/OSSI/actions"
    Then the response contains "WIP limit agreed"

  Scenario: Refresh runs at most once every five minutes
    When the user posts to "/api/refresh"
    Then the response status is 200
    When the user posts to "/api/refresh"
    Then the response status is 429

  Scenario: Server errors do not leak detail
    When the user requests "/api/teams/OSSI/evidence/no_such_rule"
    Then the response status is 404
    And the response does not contain "Error:"
