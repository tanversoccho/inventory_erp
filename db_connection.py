"""SQLite context manager that settles the transaction and always closes its handle."""

import sqlite3


class ManagedConnection(sqlite3.Connection):
  def __exit__(self, exc_type, exc_value, traceback):
    try:
      return super().__exit__(exc_type, exc_value, traceback)
    finally:
      self.close()
