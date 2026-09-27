Feature: Build version
  The footer and /api/version say which build is running, so anyone can tell
  whether a fix has been deployed.

  Scenario: The running build identifies itself
    Given Houston is running with user "sam" and password "pw"
    When the user requests "/api/version"
    Then the response status is 200
    And the version matches package.json
    And the version has a commit and a build time

  Scenario: The page has a footer for the version
    Given Houston is running with user "sam" and password "pw"
    When the user requests "/"
    Then the response contains "<footer id=\"version\">"
