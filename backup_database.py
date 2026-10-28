"""Consistent SQLite + branding assets backup. Refuses to overwrite output."""

import argparse
import sqlite3
import tempfile
import zipfile
from contextlib import closing
from pathlib import Path


def backup(db, output):
  db = Path(db).resolve()
  if not db.is_file():
    raise ValueError("Source database does not exist")
  with tempfile.TemporaryDirectory() as tmp:
    copy = Path(tmp) / "inventory.sqlite3"
    with (
      closing(sqlite3.connect(db.as_uri() + "?mode=ro", uri=True)) as source,
      closing(sqlite3.connect(copy)) as target,
    ):
      source.backup(target)
    with zipfile.ZipFile(output, "x", zipfile.ZIP_DEFLATED) as archive:
      archive.write(copy, "inventory.sqlite3")
      folder = Path(str(db) + ".assets")
      if folder.exists():
        for asset in folder.glob("*.png"):
          archive.write(asset, "inventory.sqlite3.assets/" + asset.name)
  return str(output)


if __name__ == "__main__":
  parser = argparse.ArgumentParser()
  parser.add_argument("--db", default="data/inventory.sqlite3")
  parser.add_argument("--output", required=True)
  a = parser.parse_args()
  print(backup(a.db, a.output))
