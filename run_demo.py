"""Start the demo only if the expected sample already exists."""

import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
sample = root / "demo" / "sample_12_months.sqlite3"
if not sample.is_file():
  raise SystemExit(
    "Demo database missing. Run: python create_sample_database.py demo/sample_12_months.sqlite3"
  )
raise SystemExit(
  subprocess.call(
    [sys.executable, str(root / "server.py"), "--db", str(sample), "--port", "8001", *sys.argv[1:]]
  )
)
