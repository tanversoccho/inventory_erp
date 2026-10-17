import unittest
from unittest.mock import patch

import product_lookup as lookup


class LookupTests(unittest.TestCase):
    def setUp(self):
        lookup._CACHE.clear()

    def test_sample_food(self):
        with patch.object(
            lookup,
            "read_json",
            return_value={
                "status": 1,
                "product": {
                    "product_name": "Mr noodles ramen hot chicken 85g",
                    "categories": "Instant noodles",
                },
            },
        ) as request:
            r = lookup.online_lookup("840205744336")
            self.assertTrue(r["found"])
            self.assertEqual(r["name"], "Mr noodles ramen hot chicken 85g")
            self.assertEqual(r["code"], "840205744336")
            self.assertNotIn("price", r)
            self.assertEqual(lookup.online_lookup("840205744336"), r)
            self.assertEqual(request.call_count, 1)

    def test_fallback(self):
        with patch.object(
            lookup,
            "read_json",
            side_effect=[
                {"status": 0},
                {"items": [{"title": "Sample mug", "category": "Home > Mugs"}]},
            ],
        ):
            r = lookup.online_lookup("123456789012")
            self.assertEqual(r["source"], "UPCitemdb")
            self.assertEqual(r["category"], "Mugs")

    def test_unknown(self):
        with patch.object(lookup, "read_json", side_effect=[{"status": 0}, {"items": []}]):
            self.assertFalse(lookup.online_lookup("123456789012")["found"])

    def test_timeout(self):
        with patch.object(lookup, "read_json", side_effect=TimeoutError):
            self.assertIn("unavailable", lookup.online_lookup("123456789012")["message"])

    def test_qr_url_not_fetched(self):
        with patch.object(lookup, "read_json") as request:
            self.assertFalse(lookup.online_lookup("https://example.com/")["found"])
            request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
