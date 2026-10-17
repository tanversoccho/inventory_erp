import tempfile
import unittest
from pathlib import Path

import server


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old = server.DB
        server.DB = Path(self.temp.name) / "data" / "inventory.sqlite3"
        server.initialize()
        with server.connect() as c:
            c.execute("INSERT INTO products(code,name) VALUES('001','Test')")

    def tearDown(self):
        server.DB = self.old
        self.temp.cleanup()

    def tx(self, kind, q, price):
        return server.transaction(
            {"kind": kind, "items": [{"id": 1, "quantity": q, "price": price}]}
        )

    def product(self):
        with server.connect() as c:
            return dict(c.execute("SELECT * FROM products").fetchone())

    def test_weighted_cost_and_profit(self):
        self.tx("purchase", 10, 100)
        self.tx("purchase", 10, 200)
        self.assertEqual(self.product()["cost"], 15000)
        self.tx("sale", 3, 250)
        self.assertEqual(self.product()["stock"], 17)
        with server.connect() as c:
            r = c.execute("SELECT * FROM movements WHERE kind='sale'").fetchone()
            self.assertEqual(r["quantity"] * (r["unit_price"] - r["unit_cost"]), 30000)

    def test_oversell(self):
        self.tx("purchase", 2, 10)
        with self.assertRaises(ValueError):
            self.tx("sale", 3, 20)
        self.assertEqual(self.product()["stock"], 2)

    def test_atomic_rollback(self):
        self.tx("purchase", 5, 10)
        with self.assertRaises(ValueError):
            server.transaction(
                {
                    "kind": "sale",
                    "items": [
                        {"id": 1, "quantity": 2, "price": 20},
                        {"id": 1, "quantity": 5, "price": 20},
                    ],
                }
            )
        self.assertEqual(self.product()["stock"], 5)
        with server.connect() as c:
            self.assertEqual(c.execute("SELECT count(*) FROM movements").fetchone()[0], 1)

    def test_invalid_inputs(self):
        for q in [0, -1, 1.5, "NaN"]:
            with self.assertRaises((ValueError, ArithmeticError)):
                self.tx("purchase", q, 10)
        for p in [-1, "NaN", "Infinity"]:
            with self.assertRaises(ValueError):
                self.tx("purchase", 1, p)

    def test_manual_inventory_without_barcode(self):
        result = server.create_product(
            {"name": "Manual mug", "quantity": 5, "cost": "80", "price": "120"}
        )
        self.assertTrue(result["code"].startswith("AUTO-"))
        with server.connect() as c:
            p = c.execute("SELECT * FROM products WHERE name='Manual mug'").fetchone()
            self.assertEqual(p["stock"], 5)
            self.assertEqual(p["cost"], 8000)
            m = c.execute("SELECT * FROM movements WHERE product_id=?", (p["id"],)).fetchone()
            self.assertEqual(m["quantity"] * m["unit_price"], 40000)

    def test_duplicate_code_keeps_stock(self):
        import sqlite3

        with self.assertRaises(sqlite3.IntegrityError):
            server.create_product({"name": "Duplicate", "code": "001", "quantity": 9, "cost": 10})
        self.assertEqual(self.product()["stock"], 0)

    def test_rounding(self):
        self.assertEqual(server.money("1.005"), 101)


if __name__ == "__main__":
    unittest.main()
