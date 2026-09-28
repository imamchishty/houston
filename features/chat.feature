Feature: Ask Houston
  A question about a team or all teams, answered from Houston's own numbers. Compass only chooses which of Houston's
  lookups to run and words the answer; every number in the answer must be in the facts Houston fetched, or the facts
  are shown instead. Questions about people are refused before anything is sent.

  Background:
    Given Houston is running with user "sam" and password "pw"

  Scenario: Off without Compass
    When the user asks "Why did lead time go up?" about "OSSI"
    Then the response status is 503

  Scenario Outline: Questions about people are refused, and Compass is never called
    Given Compass is configured for chat
    When the user asks "<question>" about "OSSI"
    Then the response status is 200
    And the answer is a refusal and Compass was not called

    Examples:
      | question                                   |
      | who is on the project?                     |
      | which engineer is slowest?                 |
      | how many developers does OSSI have?        |
      | whose tickets are blocked?                 |

  Scenario: Compass picks lookups, Houston runs them, and a faithful answer is used
    Given Compass is configured for chat, choosing the "sprint" lookup and answering from the facts
    When the user asks "How is the sprint going?" about "OSSI"
    Then the response status is 200
    And the answer came from Compass and every number in it is in the facts
    And the answer is based on "OSSI: current sprint"

  Scenario: An answer with a number that is not in the facts is replaced by the facts
    Given Compass is configured for chat, choosing the "sprint" lookup and answering with an invented number
    When the user asks "How is the sprint going?" about "OSSI"
    Then the response status is 200
    And the answer is Houston's own words from the facts

  Scenario: The page's team scopes the question, whatever Compass chose
    Given Compass is configured for chat, choosing the "performance" lookup for team "PLAT" and answering from the facts
    When the user asks "How are we doing?" about "OSSI"
    Then the response status is 200
    And the lookup ran for "OSSI"

  Scenario: An unknown lookup is ignored and a bad plan falls back to the team's performance
    Given Compass is configured for chat, choosing a lookup that does not exist
    When the user asks "How are we doing?" about "OSSI"
    Then the response status is 200
    And the lookup ran for "OSSI"

  Scenario: API tokens cannot ask
    Given Compass is configured for chat
    And an API token "reporting" is set up
    When the "reporting" token asks "How are we doing?"
    Then the response status is 403
