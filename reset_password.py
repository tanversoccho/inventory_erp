import argparse
import getpass
import hashlib
import secrets
from pathlib import Path

import server
from server import connect, initialize

parser = argparse.ArgumentParser()
parser.add_argument("--db", type=Path, default=server.DB)
args = parser.parse_args()
server.DB = args.db.resolve()

initialize()
p = getpass.getpass("New password (at least 8 characters): ")
if len(p) < 8:
  raise SystemExit("Password too short")
salt = secrets.token_hex(16)
value = salt + ":" + hashlib.scrypt(p.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
with connect() as c:
  c.execute("INSERT OR REPLACE INTO settings VALUES('password',?)", (value,))
print("Password reset. Restart the server.")
