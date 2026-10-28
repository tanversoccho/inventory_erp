import json
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
from types import SimpleNamespace

import scanner_sync
import server


class ScannerTests(unittest.TestCase):
  def setUp(self):
    self.broker = scanner_sync.Broker()
    self.s = SimpleNamespace(
      AUTH_LOCK=threading.Lock(),
      SESSIONS={"owner": time.monotonic() + 1000, "other": time.monotonic() + 1000},
    )
    self.owner = SimpleNamespace(headers={"Cookie": "session=owner"})
    self.other = SimpleNamespace(headers={"Cookie": "session=other"})
    self.pair = self.call("create", {"target": "sale"})
    self.phone = SimpleNamespace(headers={"X-Scanner-Token": self.pair["token"]})
    self.call("connect", self.phone_data(), self.phone)

  def call(self, action, data, handler=None):
    return self.broker.handle(self.s, handler or self.owner, action, data)

  def phone_data(self, **kw):
    return dict(channel=self.pair["channel"], device="phone-identifier-123456", **kw)

  def send(self, scan_id="scan-identifier-123456", code="9415007013402"):
    return self.call("send", self.phone_data(scan_id=scan_id, code=code), self.phone)

  def test_roundtrip_and_pause(self):
    self.send()
    event = self.call("poll", self.pair)["pending"]
    self.assertEqual(event["code"], "9415007013402")
    self.assertIsNone(self.call("status", self.phone_data(), self.phone)["pending"])
    self.call("ack", dict(self.pair, scan_id=event["scan_id"]))
    self.assertEqual(
      self.call("status", self.phone_data(scan_id=event["scan_id"]), self.phone)["status"],
      "applied",
    )
    with self.assertRaises(scanner_sync.ScanError):
      self.send("another-scan-identifier")
    self.call("ready", self.pair)
    self.send("another-scan-identifier")

  def test_retry_and_concurrent_send(self):
    with ThreadPoolExecutor(max_workers=5) as pool:
      replies = list(pool.map(lambda _: self.send(), range(5)))
    self.assertEqual(len(self.broker.channels[self.pair["channel"]]["receipts"]), 1)
    self.assertTrue(all(r["status"] == "pending" for r in replies))
    with self.assertRaises(scanner_sync.ScanError):
      self.send(code="different")

  def test_wrong_owner_and_wrong_phone(self):
    with self.assertRaises(scanner_sync.ScanError):
      self.call("poll", self.pair, self.other)
    with self.assertRaises(scanner_sync.ScanError):
      self.call("connect", dict(self.phone_data(), device="different-phone-123456"), self.phone)
    with self.assertRaises(scanner_sync.ScanError):
      self.call(
        "send",
        self.phone_data(code="X", scan_id="scan-identifier-123456"),
        SimpleNamespace(headers={}),
      )

  def test_revoked_and_expired(self):
    del self.s.SESSIONS["owner"]
    with self.assertRaises(scanner_sync.ScanError):
      self.send()
    self.assertFalse(self.broker.channels)

  def test_disconnect(self):
    self.call("disconnect", self.pair)
    with self.assertRaises(scanner_sync.ScanError):
      self.send()

  def test_queue_does_not_overwrite_and_validation(self):
    self.send()
    with self.assertRaises(scanner_sync.ScanError):
      self.send("different-scan-123456")
    self.assertEqual(self.call("poll", self.pair)["pending"]["scan_id"], "scan-identifier-123456")
    with self.assertRaises(scanner_sync.ScanError):
      self.send(code="x" * 513)


class ScannerHTTPTests(unittest.TestCase):
  def test_capability_routes_and_origin(self):
    http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    worker = threading.Thread(target=http.serve_forever, daemon=True)
    worker.start()
    token = "test-scanner-owner-" + str(http.server_port)
    server.SESSIONS[token] = time.monotonic() + 1000

    def post(action, data, headers=None):
      c = HTTPConnection("127.0.0.1", http.server_port)
      try:
        c.request(
          "POST",
          "/api/scanner/" + action,
          json.dumps(data),
          {"Content-Type": "application/json", **(headers or {})},
        )
        r = c.getresponse()
        return r.status, json.loads(r.read())
      finally:
        c.close()

    try:
      self.assertEqual(post("create", {"target": "sale"})[0], 401)
      owner = {"Cookie": "session=" + token}
      status, pair = post("create", {"target": "product"}, owner)
      self.assertEqual(status, 200)
      phone = {"X-Scanner-Token": pair["token"]}
      body = {"channel": pair["channel"], "device": "http-test-phone-123456"}
      self.assertEqual(post("connect", body, phone)[0], 200)
      self.assertEqual(
        post("send", dict(body, scan_id="http-test-scan-123456", code="9415007013402"), phone)[0],
        200,
      )
      self.assertEqual(post("poll", pair, phone)[0], 401)
      self.assertEqual(post("status", body, dict(phone, Origin="http://attacker.invalid"))[0], 403)
      self.assertEqual(post("poll", pair, owner)[1]["pending"]["code"], "9415007013402")
      post("disconnect", pair, owner)
      self.assertEqual(post("status", body, phone)[0], 410)
    finally:
      server.SESSIONS.pop(token, None)
      http.shutdown()
      http.server_close()
      worker.join()
