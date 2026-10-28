"""Regression checks independent of Windows file-deletion semantics."""

import sqlite3
import tempfile
import unittest
from pathlib import Path

from db_connection import ManagedConnection


class ConnectionCleanupTests(unittest.TestCase):
  def assert_closed(self, connection):
    with self.assertRaises(sqlite3.ProgrammingError):
      connection.execute("SELECT 1")

  def test_success_commits_and_closes(self):
    with tempfile.TemporaryDirectory() as tmp:
      path = Path(tmp) / "db.sqlite3"
      with sqlite3.connect(path, factory=ManagedConnection) as connection:
        connection.execute("CREATE TABLE records(value INTEGER)")
        connection.execute("INSERT INTO records VALUES(1)")
      self.assert_closed(connection)
      with sqlite3.connect(path, factory=ManagedConnection) as reader:
        self.assertEqual(reader.execute("SELECT value FROM records").fetchone()[0], 1)
      self.assert_closed(reader)

  def test_exception_rolls_back_and_closes(self):
    with sqlite3.connect(":memory:", factory=ManagedConnection) as connection:
      connection.execute("CREATE TABLE records(value INTEGER)")
    self.assert_closed(connection)
    connection = sqlite3.connect(":memory:", factory=ManagedConnection)
    with self.assertRaises(ValueError), connection:
      connection.execute("CREATE TABLE records(value INTEGER)")
      raise ValueError("Abort")
    self.assert_closed(connection)

  def test_commit_failure_also_closes(self):
    connection = sqlite3.connect(":memory:", factory=ManagedConnection)
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("CREATE TABLE parent(id INTEGER PRIMARY KEY)")
    connection.execute(
      "CREATE TABLE child(parent_id REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)"
    )
    with self.assertRaises(sqlite3.IntegrityError), connection:
      connection.execute("INSERT INTO child VALUES(999)")
    self.assert_closed(connection)


if __name__ == "__main__":
  unittest.main()
