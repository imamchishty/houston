Feature: Scores in plain language
  A score is a number and a band. Bands say where to look, not who is bad,
  and each team sees which checks would move its score the most.

  Scenario Outline: Scores fall into bands
    Then a score of <score> is "<band>"

    Examples:
      | score | band            |
      | 100   | Healthy         |
      | 75    | Healthy         |
      | 74    | Watch           |
      | 50    | Watch           |
      | 49    | Needs attention |
      | 0     | Needs attention |

  Scenario: The digest describes the score in words, not colours
    Given Houston is running with user "sam" and password "pw"
    When the user requests "/api/teams/OSSI/digest.md"
    Then the response contains "Sprint health: "
    And the response does not contain "(red)"

  Scenario: The biggest gains are listed first, and add up to no more than the points lost
    Given Houston is running with user "sam" and password "pw"
    When the user requests "/api/teams/OSSI/summary"
    Then the gains are in descending order
    And the sprint gains add up to no more than 100 minus the sprint score
