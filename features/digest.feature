Feature: Friday digest in Teams
  Every Friday each team's headline goes to Teams: scores, the top red findings,
  and a link to the full digest. It goes to everyone, so it names nobody.

  Scenario: The headline is posted for every board, without names
    Given a Teams webhook is listening
    And Houston's public address is "https://houston.example.internal"
    When the Friday digest is sent
    Then Teams receives 2 cards
    And no card mentions any of the team's names
    And every card links to "https://houston.example.internal/api/teams/"

  Scenario: Without a webhook nothing is posted and the reason is given
    Given no Teams webhook is configured
    When the Friday digest is sent
    Then every board reports "TEAMS_WEBHOOK not set"
