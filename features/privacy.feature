Feature: Names stay out of shared outputs
  The digest goes to the whole team and Teams. Recommendations and raw evidence can
  judge individuals. Only people viewers see names; everyone else sees a count.

  Background:
    Given Houston is running with user "sam" and password "pw"
    And the people viewers are "imam"

  Scenario: The team digest names nobody
    When the user requests "/api/teams/OSSI/digest.md"
    Then the response status is 200
    And the response mentions none of the team's names
    And the response contains "names in the people view"

  Scenario: A non viewer asking for a named digest still gets no names
    When the user requests "/api/teams/OSSI/digest.md?named=1"
    Then the response mentions none of the team's names

  Scenario: Recommendations for a non viewer name nobody
    When the user requests "/api/teams/OSSI/recommendations"
    Then the response status is 200
    And the response mentions none of the team's names

  Scenario: Raw evidence hides who did the work from non viewers
    When the user requests "/api/teams/OSSI/evidence/pr_size"
    Then the response status is 200
    And no evidence record has the fields "author, reviewers, assignee, createdBy, updatedBy"

  Scenario: A people viewer can ask for names
    Given Houston is running with user "imam" and password "pw"
    And the people viewers are "imam"
    When the user requests "/api/teams/OSSI/digest.md?named=1"
    Then the response mentions some of the team's names
