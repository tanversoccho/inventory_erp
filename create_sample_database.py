"""Reproducible synthetic trading records. Creates a NEW file, refuses overwrite."""

import argparse
import json
import random
from pathlib import Path
from unittest.mock import patch

import erp_features as features
import server


def validate(path):
  old = server.DB
  server.DB = Path(path).resolve()
  try:
    with server.connect() as c:
      assert c.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
      assert not c.execute("PRAGMA foreign_key_check").fetchall()
      for p in c.execute("SELECT * FROM products"):
        q = c.execute(
          "SELECT coalesce(sum(CASE WHEN kind IN ('purchase','sale_return','adjust_in') THEN quantity ELSE -quantity END),0) FROM movements WHERE product_id=?",
          (p["id"],),
        ).fetchone()[0]
        assert q == p["stock"], (p["name"], q, p["stock"])
      for original in c.execute("SELECT * FROM movements WHERE kind IN ('sale','purchase')"):
        returned = c.execute(
          "SELECT coalesce(sum(quantity),0) FROM movements WHERE original_id=?", (original["id"],)
        ).fetchone()[0]
        assert returned <= original["quantity"]
    return {"integrity": "ok", "foreign_keys": "ok", "stock_reconciliation": "ok", "returns": "ok"}
  finally:
    server.DB = old


def create_sample(output):
  path = Path(output).resolve()
  path.parent.mkdir(parents=True, exist_ok=True)
  with path.open("xb"):
    pass
  old = server.DB
  server.DB = path
  rng = random.Random(20261021)
  clock = ["2025-10-01T08:00:00+06:00"]
  try:
    server.initialize()
    features.save_settings(
      server,
      {
        "company": "SYNTHETIC DEMO SHOP",
        "app_name": "Soccho Demo",
        "categories": ["Food", "Household", "Stationery", "Homeware"],
        "minimum": 12,
      },
    )
    specs = [
      ("Rice 1 kg", "Food", 62, 78),
      ("Noodles 85g", "Food", 38, 52),
      ("Tea 200g", "Food", 95, 130),
      ("Milk 1L", "Food", 72, 95),
      ("Biscuits", "Food", 24, 35),
      ("Soap", "Household", 30, 45),
      ("Detergent", "Household", 82, 112),
      ("Cleaner", "Household", 60, 85),
      ("Notebook", "Stationery", 32, 50),
      ("Pen", "Stationery", 6, 12),
      ("Pencil", "Stationery", 4, 8),
      ("Folder", "Stationery", 15, 25),
      ("Mug", "Homeware", 95, 150),
      ("Tote bag", "Homeware", 110, 180),
      ("Slow-moving vase", "Homeware", 160, 220),
      ("Low stock bowl", "Homeware", 60, 95),
    ]

    def at(y, m, d, h=12):
      clock[0] = f"{y:04d}-{m:02d}-{d:02d}T{h:02d}:00:00+06:00"

    with (
      patch.object(features, "now", lambda s: clock[0]),
      patch.object(server.secrets, "token_hex", lambda n: rng.randbytes(n).hex()),
    ):
      for i, (name, cat, cost, price) in enumerate(specs):
        server.create_product(
          {
            "name": "Demo " + name,
            "code": f"DEMO-{i + 1:03d}",
            "category": cat,
            "price": price,
            "quantity": 5 if i == 15 else 0,
            "cost": cost,
            "minimum": 12,
          }
        )
      features.supplier(server, {"name": "Demo wholesale supplier", "phone": "Demo only"})
      for index in range(12):
        m = (9 + index) % 12 + 1
        y = 2025 + (9 + index) // 12
        at(y, m, 1, 8)
        server.transaction(
          {
            "kind": "purchase",
            "supplier_id": 1,
            "items": [
              {
                "id": i + 1,
                "quantity": 75 if i != 14 else 2,
                "price": cost + rng.choice([-1, 0, 1, 2]),
              }
              for i, (_, _, cost, _) in enumerate(specs)
              if i != 15
            ],
          }
        )
        for day in (3, 6, 9, 12, 15, 18, 21, 24, 27):
          at(y, m, day)
          for _ in range(3 + index % 3):
            ids = rng.sample(range(1, 15), rng.randrange(1, 5))
            server.transaction(
              {
                "kind": "sale",
                "items": [
                  {
                    "id": i,
                    "quantity": rng.randrange(1, 4),
                    "price": specs[i - 1][3] - rng.choice([0, 0, 1]),
                  }
                  for i in ids
                ],
              }
            )
        features.expense(
          server,
          {
            "date": f"{y}-{m:02d}-05",
            "category": "Rent",
            "amount": 2000,
            "payment_method": "Cash",
            "description": "Synthetic monthly rent",
          },
        )
        features.expense(
          server,
          {
            "date": f"{y}-{m:02d}-20",
            "category": "Utilities",
            "amount": 300 + index * 15,
            "payment_method": "Bank",
          },
        )
        at(y, m, 28)
        with server.connect() as c:
          line = c.execute(
            "SELECT * FROM movements WHERE kind='sale' AND created LIKE ? ORDER BY id LIMIT 1",
            (f"{y}-{m:02d}%",),
          ).fetchone()
        features.correction(
          server,
          {
            "kind": "sale_return",
            "product_id": line["product_id"],
            "original_id": line["id"],
            "quantity": 1,
            "reason": "Synthetic customer return",
          },
        )
        features.correction(
          server,
          {
            "kind": "adjust_out",
            "product_id": 6,
            "quantity": 1,
            "reason": "Synthetic damaged stock",
          },
        )
      with server.connect() as c:
        c.execute("INSERT INTO settings VALUES('dataset_label','SYNTHETIC 12-MONTH DEMO ONLY')")
    expected = {}
    for month in ("2026-08", "2026-09"):
      r = features.report(server, {"month": [month]})
      # Independent raw ledger arithmetic for expected figures.
      with server.connect() as c:
        rows = [
          dict(x) for x in c.execute("SELECT * FROM movements WHERE created LIKE ?", (month + "%",))
        ]
        expenses = (
          c.execute(
            "SELECT sum(amount) FROM expenses WHERE created LIKE ?", (month + "%",)
          ).fetchone()[0]
          or 0
        )
      revenue = sum(
        x["quantity"] * x["unit_price"] * (1 if x["kind"] == "sale" else -1)
        for x in rows
        if x["kind"] in ("sale", "sale_return")
      )
      cogs = sum(
        x["quantity"] * x["unit_cost"] * (1 if x["kind"] == "sale" else -1)
        for x in rows
        if x["kind"] in ("sale", "sale_return")
      )
      assert (
        revenue == r["summary"]["sales"]
        and revenue - cogs == r["summary"]["profit"]
        and expenses == r["summary"]["expenses"]
      )
      expected[month] = r["summary"]
    validate(path)
    with server.connect() as c:
      c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    return expected
  finally:
    server.DB = old


if __name__ == "__main__":
  parser = argparse.ArgumentParser()
  parser.add_argument("output", nargs="?", default="demo/sample_12_months.sqlite3")
  parser.add_argument("--validate", action="store_true")
  args = parser.parse_args()
  print(
    json.dumps(validate(args.output) if args.validate else create_sample(args.output), indent=2)
  )
