Feature: Weekly post in Teams
  Every Friday each team's performance goes to Teams: its score and trend, the plain summary, what missed its
  target two periods running, and a link to the team page. It goes to everyone, so it names nobody.

  Scenario: The headline is posted for every board, without names
    Given a Teams webhook is listening
    And Houston's public address is "https://houston.example.internal"
    When the Friday digest is sent
    Then Teams receives 2 cards
    And no card mentions any of the team's names
    And every card links to "https://houston.example.internal/#"
    And every card gives the share of targets met

  Scenario: Without a webhook nothing is posted and the reason is given
    Given no Teams webhook is configured
    When the Friday digest is sent
    Then every board reports "TEAMS_WEBHOOK not set"
