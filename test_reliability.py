"""Reliability regression coverage. All tests use temporary databases."""

import csv
import io
import tempfile
import threading
import unittest
from html.parser import HTMLParser
from pathlib import Path

import erp_features as features
import reliability
import server


class ReliabilityTests(unittest.TestCase):
  def setUp(self):
    self.temp = tempfile.TemporaryDirectory()
    self.old = server.DB
    server.DB = Path(self.temp.name) / "db.sqlite3"
    server.initialize()
    server.create_product(
      {"name": "Recorded name", "code": "TEST", "quantity": 100, "cost": 10, "price": 20}
    )

  def tearDown(self):
    server.DB = self.old
    self.temp.cleanup()

  def sale(self, key="retry-key-123456789", price=20):
    return server.transaction(
      {"kind": "sale", "request_id": key, "items": [{"id": 1, "quantity": 2, "price": price}]}
    )

  def test_retry_is_durable_and_does_not_deduct_again(self):
    first = self.sale()
    server.initialize()
    second = self.sale()
    self.assertEqual(first["reference"], second["reference"])
    self.assertTrue(second["replayed"])
    with server.connect() as c:
      self.assertEqual(c.execute("SELECT stock FROM products").fetchone()[0], 98)
      self.assertEqual(
        c.execute("SELECT count(*) FROM movements WHERE kind='sale'").fetchone()[0], 1
      )

  def test_reused_key_different_payload_is_rejected(self):
    self.sale()
    with self.assertRaises(ValueError):
      self.sale(price=21)

  def test_failed_request_can_be_corrected_and_retried(self):
    body = {
      "kind": "sale",
      "request_id": "atomic-1234567890",
      "items": [{"id": 1, "quantity": 101, "price": 20}],
    }
    with self.assertRaises(ValueError):
      server.transaction(body)
    body["items"][0]["quantity"] = 2
    server.transaction(body)
    with server.connect() as c:
      self.assertEqual(c.execute("SELECT count(*) FROM request_receipts").fetchone()[0], 1)

  def test_simultaneous_retries_commit_once(self):
    results = []

    def sell():
      results.append(self.sale())

    threads = [threading.Thread(target=sell) for _ in range(4)]
    for thread in threads:
      thread.start()
    for thread in threads:
      thread.join()
    self.assertEqual(len(results), 4)
    self.assertEqual(len({r["reference"] for r in results}), 1)
    with server.connect() as c:
      self.assertEqual(c.execute("SELECT stock FROM products").fetchone()[0], 98)

  def test_purchase_retry_once(self):
    body = {
      "kind": "purchase",
      "request_id": "purchase-1234567890",
      "items": [{"id": 1, "quantity": 3, "price": 15}],
    }
    a = server.transaction(body)
    b = server.transaction(body)
    self.assertEqual(a["reference"], b["reference"])
    with server.connect() as c:
      self.assertEqual(c.execute("SELECT stock FROM products").fetchone()[0], 103)

  def test_v1_migration_preserves_existing_data_and_backs_up_once(self):
    with server.connect() as c:
      c.execute("DROP INDEX movements_reference")
      c.execute("DROP TABLE payment_events")
      c.execute("DROP TABLE invoice_accounts")
      c.execute("DROP TABLE customers")
      c.execute("DELETE FROM migrations WHERE version=3")
      c.execute("DROP TABLE request_receipts")
      c.execute("DROP TABLE expense_reversals")
      c.execute("DELETE FROM migrations WHERE version=2")
      c.execute("PRAGMA user_version=1")
    before = set(Path(self.temp.name).glob("*.pre-v2-*.backup"))
    server.initialize()
    server.initialize()
    after = set(Path(self.temp.name).glob("*.pre-v2-*.backup"))
    self.assertEqual(len(after - before), 1)
    with server.connect() as c:
      self.assertEqual(c.execute("PRAGMA user_version").fetchone()[0], 3)
      self.assertEqual(c.execute("SELECT stock FROM products").fetchone()[0], 100)

  def test_history_pagination_search_sort_and_snapshot_csv(self):
    for i in range(31):
      self.sale("sale-request-" + str(i).zfill(16))
    features.product_edit(
      server, {"id": 1, "name": "New name", "code": "TEST", "price": 20, "unit": "piece"}
    )
    first = reliability.history(server, {"size": ["10"], "page": ["1"]})
    second = reliability.history(server, {"size": ["10"], "page": ["2"]})
    self.assertEqual(first["total"], 32)
    self.assertEqual(len(first["rows"]), 10)
    self.assertTrue({r["id"] for r in first["rows"]}.isdisjoint({r["id"] for r in second["rows"]}))
    searched = reliability.history(
      server, {"q": ["Recorded name"], "sort": ["id"], "direction": ["asc"]}
    )
    self.assertEqual(searched["rows"][0]["id"], 1)
    output = reliability.history(server, {"q": ["Recorded name"]}, True).decode()
    self.assertIn("Recorded name", output)
    self.assertNotIn("New name", output)
    self.assertEqual(len(list(csv.reader(io.StringIO(output)))), 33)
    self.assertEqual(reliability.history(server, {"q": ["%"]})["total"], 0)
    with self.assertRaises(ValueError):
      reliability.history(server, {"sort": ["DROP TABLE products"]})

  def test_reversal_preserves_original_and_respects_correction_date(self):
    features.expense(
      server,
      {"date": "2026-08-10", "amount": 50, "category": "Rent", "payment_method": "Cash"},
    )
    ref = reliability.reverse_expense(
      server, {"expense_id": 1, "date": "2026-09-10", "reason": "Entered twice"}
    )
    self.assertTrue(ref["reference"].startswith("EXR-"))
    august = features.report(server, {"month": ["2026-08"]})
    september = features.report(server, {"month": ["2026-09"]})
    self.assertEqual(august["summary"]["expenses"], 5000)
    self.assertEqual(september["summary"]["expenses"], -5000)
    self.assertEqual(september["expenses"][0]["description"], "Reversal: Entered twice")
    self.assertIn("-5000", features.csv_report(september, "expenses").decode())
    with server.connect() as c:
      self.assertEqual(c.execute("SELECT amount FROM expenses").fetchone()[0], 5000)
    with self.assertRaises(ValueError):
      reliability.reverse_expense(
        server, {"expense_id": 1, "date": "2026-09-10", "reason": "Again"}
      )

  def test_invalid_expense_reversal_has_no_effect(self):
    features.expense(
      server,
      {"date": "2026-08-10", "amount": 50, "category": "Rent", "payment_method": "Cash"},
    )
    for body in (
      {"expense_id": 1, "date": "2026-08-01", "reason": "Earlier"},
      {"expense_id": 1, "date": "2026-08-11", "reason": ""},
      {"expense_id": 999, "date": "2026-08-11", "reason": "Unknown"},
    ):
      with self.assertRaises(ValueError):
        reliability.reverse_expense(server, body)
    with server.connect() as c:
      self.assertEqual(c.execute("SELECT count(*) FROM expense_reversals").fetchone()[0], 0)


class PageOrderTests(unittest.TestCase):
  def test_handlers_have_targets_before_blocking_scripts(self):
    class Parser(HTMLParser):
      def __init__(self):
        super().__init__()
        self.ids = set()
        self.at_upgrade = set()

      def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
          self.ids.add(attrs["id"])
        if tag == "script" and attrs.get("src") == "/upgrade.js":
          self.at_upgrade = set(self.ids)

    parser = Parser()
    parser.feed((Path(__file__).parent / "static/index.html").read_text(encoding="utf-8"))
    self.assertTrue(
      {"closeAdmin", "adminDialog", "toggleNav", "addProduct"}.issubset(parser.at_upgrade)
    )


if __name__ == "__main__":
  unittest.main()
