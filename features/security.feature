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

  Scenario: Oversized request bodies are refused
    When the user posts a 20000 character body to "/api/refresh"
    Then the response status is 413

  Scenario: Refresh runs at most once every five minutes
    When the user posts to "/api/refresh"
    Then the response status is 200
    When the user posts to "/api/refresh"
    Then the response status is 429

  Scenario: Server errors do not leak detail
    When the user requests "/api/teams/OSSI/evidence/no_such_rule"
    Then the response status is 404
    And the response does not contain "Error:"
