"""Disposable local server for browser regression tests. Never opens business data."""

import hashlib
import json
import os
import secrets
import tempfile
from pathlib import Path
import server
import erp_features as features

if __name__ == "__main__":
  with tempfile.TemporaryDirectory() as temporary:
    server.DB = Path(temporary) / "fixture.sqlite3"
    server.initialize()
    password = os.environ["ERP_TEST_PASSWORD"]
    salt = secrets.token_hex(16)
    value = (
      salt
      + ":"
      + hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    )
    with server.connect() as c:
      c.execute("INSERT INTO settings VALUES('password',?)", (value,))
    features.now = lambda s: "2026-09-15T12:00:00+06:00"
    server.create_product(
      {"name": "Fixture product", "code": "FIX", "quantity": 500, "cost": 10, "price": 20}
    )
    for i in range(30):
      server.transaction({"kind": "sale", "items": [{"id": 1, "quantity": 1, "price": 20}]})
    features.supplier(server, {"name": "Fixture supplier"})
    features.expense(
      server,
      {"date": "2026-08-10", "amount": 50, "category": "Fixture rent", "payment_method": "Cash"},
    )
    http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    print(json.dumps({"port": http.server_port}), flush=True)
    try:
      http.serve_forever()
    except KeyboardInterrupt:
      pass
    finally:
      http.server_close()
