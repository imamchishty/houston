Feature: New versions keep the data
  Deploying a new version must never lose history. Schema changes are numbered steps that keep
  existing rows, a copy is saved before any step runs, and an older version will not write to a newer database.

  Scenario: A new version with a schema change keeps existing history
    Given a history database with 1 day of scores for "OSSI"
    When a new version adds a schema step
    Then the history still has 1 day of scores for "OSSI"
    And the database is at the new schema version
    And a copy was saved before the schema step ran

  Scenario: Opening the same version again changes nothing
    Given a history database with 1 day of scores for "OSSI"
    When the same version opens it again
    Then the history still has 1 day of scores for "OSSI"
    And no pre-upgrade copy was made

  Scenario: An older version refuses a newer database
    Given a history database written by a newer version
    When this version opens it
    Then it refuses with a message to deploy the newer version or restore a backup
