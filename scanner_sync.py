"""Ephemeral, session-bound phone scanner channels. Never writes inventory."""

import secrets
import threading
import time
from http.cookies import SimpleCookie


class ScanError(ValueError):
  def __init__(self, status, message):
    super().__init__(message)
    self.status = status


def session_token(handler):
  try:
    return SimpleCookie(handler.headers.get("Cookie", ""))["session"].value
  except (KeyError, ValueError):
    return ""


class Broker:
  def __init__(self):
    self.lock = threading.Lock()
    self.channels = {}

  def handle(self, server, handler, action, data):
    with self.lock:
      now = time.monotonic()
      with server.AUTH_LOCK:
        alive = {k for k, v in server.SESSIONS.items() if v > now}
      for key, value in list(self.channels.items()):
        if value["owner"] not in alive or value["expires"] <= now:
          del self.channels[key]
      owner = session_token(handler)
      if action == "create":
        if owner not in alive:
          raise ScanError(401, "Please sign in on the laptop")
        target = data.get("target")
        if target not in ("product", "sale", "purchase"):
          raise ScanError(400, "Choose a scanner destination")
        # Each owner may have several laptop tabs, each with its own channel.
        if len(self.channels) >= 64:
          raise ScanError(429, "Disconnect unused scanner sessions first")
        channel = secrets.token_urlsafe(24)
        token = secrets.token_urlsafe(32)
        self.channels[channel] = dict(
          owner=owner,
          token=token,
          target=target,
          expires=now + 600,
          phone="",
          seen=0,
          pending=None,
          receipts={},
          ready=True,
        )
        return dict(channel=channel, token=token, target=target, expires_in=600)
      channel = str(data.get("channel", ""))
      row = self.channels.get(channel)
      if not row:
        raise ScanError(410, "Scanner session ended. Pair again from the laptop.")
      phone_action = action in ("connect", "send", "status")
      if phone_action:
        token = handler.headers.get("X-Scanner-Token", "")
        if not token or not secrets.compare_digest(token, row["token"]):
          raise ScanError(403, "Invalid scanner pairing")
        device = str(data.get("device", ""))
        if not 16 <= len(device) <= 100:
          raise ScanError(400, "Invalid phone identifier")
        if action == "connect" and not row["phone"]:
          row["phone"] = device
          row["expires"] = now + 8 * 3600
        if row["phone"] != device:
          raise ScanError(409, "This scanner is paired to another phone")
        row["seen"] = now
      elif owner != row["owner"] or owner not in alive:
        raise ScanError(403, "This scanner belongs to a different laptop session")
      if action == "disconnect":
        del self.channels[channel]
        return {}
      if action == "ready":
        row["ready"] = True
      if action == "send":
        scan_id = str(data.get("scan_id", ""))
        code = str(data.get("code", "")).strip()
        if (
          not 16 <= len(scan_id) <= 100
          or not code
          or len(code) > 512
          or any(ord(c) < 32 for c in code)
        ):
          raise ScanError(400, "Invalid barcode or scan identifier")
        previous = row["receipts"].get(scan_id)
        if previous:
          if previous["code"] != code:
            raise ScanError(409, "Scan identifier was reused with another barcode")
          return dict(scan_id=scan_id, status=previous["status"])
        if row["pending"] or not row["ready"]:
          raise ScanError(
            409, "Laptop is reviewing a scan. Finish the item and click Ready for next scan."
          )
        event = dict(scan_id=scan_id, code=code, status="pending")
        row["pending"] = event
        row["receipts"][scan_id] = event
        while len(row["receipts"]) > 128:
          del row["receipts"][next(iter(row["receipts"]))]
        return dict(scan_id=scan_id, status="pending")
      if action == "ack":
        event = row["pending"]
        if event and event["scan_id"] == data.get("scan_id"):
          event["status"] = "applied"
          row["pending"] = None
          row["ready"] = False
      if action not in ("connect", "status", "poll", "ack", "ready"):
        raise ScanError(404, "Unknown scanner operation")
      # A scanner capability never exposes product, customer or invoice data.
      return dict(
        target=row["target"],
        connected=bool(row["phone"]) and now - row["seen"] < 15,
        ready=row["ready"],
        pending=dict(row["pending"]) if row["pending"] and not phone_action else None,
        status=(row["receipts"].get(str(data.get("scan_id", ""))) or {}).get("status", ""),
        expires_in=max(0, int(row["expires"] - now)),
      )


BROKER = Broker()
