"""Invoice-linked settlements. Money uses integer minor units; stock/profit are separate."""

import csv
import datetime as dt
import hashlib
import io
import json
import re
import secrets
import sqlite3
from contextlib import closing
from pathlib import Path

import erp_features as features


def migrate(s):
  with s.connect() as c:
    version = c.execute("PRAGMA user_version").fetchone()[0]
    if version == 3:
      return
    if version != 2:
      raise RuntimeError("Payment migration requires schema v2")
    destination = Path(str(s.DB) + ".pre-v3-" + secrets.token_hex(4) + ".backup")
    with closing(sqlite3.connect(destination)) as target:
      c.backup(target)
    c.execute("BEGIN IMMEDIATE")
    c.execute(
      "CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '')"
    )
    c.execute("""CREATE TABLE invoice_accounts(reference TEXT PRIMARY KEY REFERENCES transactions(reference),
            confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN (0,1)),
            customer_id INTEGER REFERENCES customers(id),supplier_id INTEGER REFERENCES suppliers(id),due_date TEXT NOT NULL DEFAULT '',
            opening_paid INTEGER NOT NULL DEFAULT 0 CHECK(opening_paid>=0),verified_created TEXT NOT NULL DEFAULT '',verification_note TEXT NOT NULL DEFAULT '')""")
    c.execute("""CREATE TABLE payment_events(id INTEGER PRIMARY KEY,reference TEXT NOT NULL REFERENCES invoice_accounts(reference),
            created TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),kind TEXT NOT NULL CHECK(kind IN ('payment','refund')),
            method TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',receipt TEXT NOT NULL UNIQUE,request_id TEXT NOT NULL UNIQUE,payload_hash TEXT NOT NULL)""")
    c.execute("CREATE INDEX movements_reference ON movements(reference,kind)")
    c.execute("CREATE INDEX invoice_accounts_customer ON invoice_accounts(customer_id)")
    c.execute("CREATE INDEX invoice_accounts_supplier ON invoice_accounts(supplier_id)")
    c.execute("CREATE INDEX payment_events_reference ON payment_events(reference,id)")
    c.execute("CREATE INDEX payment_events_created ON payment_events(created)")
    c.execute(
      "INSERT INTO invoice_accounts(reference,supplier_id) SELECT reference,supplier_id FROM transactions WHERE kind IN ('sale','purchase')"
    )
    c.execute("INSERT INTO migrations VALUES(3,?)", (dt.datetime.now(dt.UTC).isoformat(),))
    c.execute("PRAGMA user_version=3")


def customer(s, data):
  name = str(data.get("name", "")).strip()
  if not name or len(name) > 200:
    raise ValueError("Customer name required (max 200 characters)")
  with s.connect() as c:
    cur = c.execute(
      "INSERT INTO customers(name,phone,address) VALUES(?,?,?)",
      (name, str(data.get("phone", ""))[:100], str(data.get("address", ""))[:1000]),
    )
    return {"id": cur.lastrowid, "name": name}


def _date(value):
  if not isinstance(value, str):
    raise ValueError("Choose an ISO calendar date")
  return dt.date.fromisoformat(value).isoformat()


def _party(s, c, data, kind, required):
  field, table = ("customer_id", "customers") if kind == "sale" else ("supplier_id", "suppliers")
  selected = data.get(field) or None
  if selected is not None:
    selected = s.integer(selected)
    if not c.execute("SELECT 1 FROM " + table + " WHERE id=?", (selected,)).fetchone():
      raise ValueError("Customer/vendor not found")
  if required and selected is None:
    raise ValueError(
      "Choose a saved "
      + ("customer" if kind == "sale" else "vendor")
      + " for an outstanding balance"
    )
  return selected


def _insert_event(c, reference, created, amount, kind, method, note, key, digest):
  receipt = "PAY-" + secrets.token_hex(8).upper()
  c.execute(
    "INSERT INTO payment_events(reference,created,amount,kind,method,note,receipt,request_id,payload_hash) VALUES(?,?,?,?,?,?,?,?,?)",
    (reference, created, amount, kind, method, note, receipt, key, digest),
  )
  return {"receipt": receipt, "reference": reference}


def open_account(s, c, reference, data, total, kind, created):
  """Called inside the same transaction as stock and sale/purchase records."""
  mode = data.get("payment_mode")
  if mode is None:  # Old callers and opening-stock entries never imply cash/payment history.
    c.execute(
      "INSERT INTO invoice_accounts(reference,supplier_id) VALUES(?,?)",
      (reference, data.get("supplier_id") or None),
    )
    return
  if mode not in ("full", "partial", "unpaid"):
    raise ValueError("Choose full, partial or unpaid")
  paid = (
    total if mode == "full" else 0 if mode == "unpaid" else s.money(data.get("amount_paid", ""))
  )
  if mode == "partial" and not 0 < paid < total:
    raise ValueError("Partial amount must be greater than zero and less than invoice total")
  party = _party(s, c, data, kind, paid < total)
  due = _date(data["due_date"]) if data.get("due_date") else ""
  invoice_day = features.instant(created, features.settings(s)).date().isoformat()
  if due and due < invoice_day:
    raise ValueError("Due date cannot precede invoice date")
  c.execute(
    "INSERT INTO invoice_accounts(reference,confirmed,customer_id,supplier_id,due_date,verified_created) VALUES(?,1,?,?,?,?)",
    (
      reference,
      party if kind == "sale" else None,
      party if kind == "purchase" else None,
      due,
      created,
    ),
  )
  if paid:
    method = data.get("payment_method", features.settings(s)["default_payment"])
    _insert_event(
      c,
      reference,
      created,
      paid,
      "payment",
      method,
      "Payment at invoice creation",
      "initial-" + secrets.token_hex(20),
      "initial",
    )


def ensure_unconfirmed(c, reference, supplier_id=None):
  c.execute(
    "INSERT OR IGNORE INTO invoice_accounts(reference,supplier_id) VALUES(?,?)",
    (reference, supplier_id),
  )


ACCOUNT_SQL = """SELECT a.*,t.created,t.kind,
    CASE WHEN t.kind='sale' THEN coalesce(cu.name,'Walk-in customer') ELSE coalesce(su.name,'Unassigned vendor') END party_name,
    coalesce((SELECT sum(m.quantity*m.unit_price) FROM movements m WHERE m.reference=t.reference AND m.kind=t.kind),0) original_total,
    coalesce((SELECT sum(r.quantity*r.unit_price) FROM movements r JOIN movements o ON o.id=r.original_id WHERE o.reference=t.reference AND r.kind IN ('sale_return','purchase_return')),0) returns_total,
    coalesce((SELECT sum(CASE WHEN e.kind='payment' THEN e.amount ELSE -e.amount END) FROM payment_events e WHERE e.reference=t.reference),0) event_paid
    FROM invoice_accounts a JOIN transactions t ON t.reference=a.reference
    LEFT JOIN customers cu ON cu.id=a.customer_id LEFT JOIN suppliers su ON su.id=a.supplier_id"""


def _decorate(row, today):
  r = dict(row)
  r["net_total"] = r["original_total"] - r["returns_total"]
  r["net_paid"] = r["opening_paid"] + r["event_paid"]
  balance = r["net_total"] - r["net_paid"]
  r["balance"] = balance if r["confirmed"] else None
  r["due"] = max(0, balance) if r["confirmed"] else 0
  r["refund_due"] = max(0, -balance) if r["confirmed"] else 0
  r["status"] = (
    "Unconfirmed"
    if not r["confirmed"]
    else "Refund due"
    if balance < 0
    else "Paid"
    if balance == 0
    else "Unpaid"
    if r["net_paid"] == 0
    else "Partially paid"
  )
  r["overdue"] = bool(r["confirmed"] and balance > 0 and r["due_date"] and r["due_date"] < today)
  return r


def account(s, c, reference):
  row = c.execute(ACCOUNT_SQL + " WHERE a.reference=?", (reference,)).fetchone()
  if not row:
    raise ValueError("Payment account not found for this transaction")
  today = dt.datetime.now(features.zone(features.settings(s))).date().isoformat()
  r = _decorate(row, today)
  r["payments"] = [
    dict(e)
    for e in c.execute(
      "SELECT * FROM payment_events WHERE reference=? ORDER BY created,id", (reference,)
    )
  ]
  # Request fingerprints are private implementation details; not needed in invoice/statement UI.
  for entry in r["payments"]:
    entry.pop("payload_hash", None)
    entry.pop("request_id", None)
  return r


def confirm_legacy(s, data):
  reference = str(data.get("reference", ""))
  note = str(data.get("note", "")).strip()
  if not note or len(note) > 1000:
    raise ValueError("Explain how this opening balance was checked")
  config = features.settings(s)
  with s.connect() as c:
    c.execute("BEGIN IMMEDIATE")
    r = account(s, c, reference)
    if r["confirmed"]:
      raise ValueError("This opening balance has already been confirmed")
    paid = s.money(data.get("opening_paid", 0))
    # Historical net paid may exceed the net total after returns, leaving an explicit refund due.
    if paid > r["original_total"]:
      raise ValueError("Opening paid cannot exceed the original invoice total")
    party = _party(s, c, data, r["kind"], paid != r["net_total"])
    due = _date(data["due_date"]) if data.get("due_date") else ""
    c.execute(
      "UPDATE invoice_accounts SET confirmed=1,customer_id=?,supplier_id=?,due_date=?,opening_paid=?,verified_created=?,verification_note=? WHERE reference=?",
      (
        party if r["kind"] == "sale" else None,
        party if r["kind"] == "purchase" else None,
        due,
        paid,
        features.now(s),
        note,
        reference,
      ),
    )
    return account(s, c, reference)


def record(s, data):
  reference = str(data.get("reference", ""))
  kind = data.get("kind", "payment")
  if kind not in ("payment", "refund"):
    raise ValueError("Invalid payment type")
  key = data.get("request_id", "")
  if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", key):
    raise ValueError("A unique payment request identifier is required")
  digest = hashlib.sha256(
    json.dumps(
      {k: v for k, v in data.items() if k != "request_id"}, sort_keys=True, separators=(",", ":")
    ).encode()
  ).hexdigest()
  config = features.settings(s)
  with s.connect() as c:
    c.execute("BEGIN IMMEDIATE")
    previous = c.execute(
      "SELECT receipt,reference,payload_hash FROM payment_events WHERE request_id=?", (key,)
    ).fetchone()
    if previous:
      if previous["payload_hash"] != digest:
        raise ValueError("Payment identifier already used with different data")
      return {"receipt": previous["receipt"], "reference": previous["reference"], "replayed": True}
    r = account(s, c, reference)
    if not r["confirmed"]:
      raise ValueError("Confirm the historical opening balance before recording a payment")
    amount = s.money(data.get("amount", 0))
    maximum = r["due"] if kind == "payment" else r["refund_due"]
    if amount <= 0 or amount > maximum:
      raise ValueError(
        "Amount must be positive and cannot exceed "
        + ("outstanding balance" if kind == "payment" else "refund due")
      )
    method = data.get("method", config["default_payment"])
    if method not in config["payment_methods"]:
      raise ValueError("Invalid payment method")
    day = _date(data.get("date", dt.datetime.now(features.zone(config)).date().isoformat()))
    invoice_day = (
      features.instant(r["created"], config).astimezone(features.zone(config)).date().isoformat()
    )
    if day < invoice_day:
      raise ValueError("Payment date cannot precede invoice date")
    if day > dt.datetime.now(features.zone(config)).date().isoformat():
      raise ValueError("Record payments only when made; use due date for future payments")
    created = dt.datetime.combine(
      dt.date.fromisoformat(day), dt.time(12), features.zone(config)
    ).isoformat()
    return _insert_event(
      c, reference, created, amount, kind, method, str(data.get("note", ""))[:1000], key, digest
    )


def list_accounts(s, query=None):
  query = query or {}
  get = lambda key, default="": query.get(key, [default])[0]
  config = features.settings(s)
  today = dt.datetime.now(features.zone(config)).date().isoformat()
  with s.connect() as c:
    rows = [
      _decorate(row, today)
      for row in c.execute(ACCOUNT_SQL + " ORDER BY t.created DESC,t.reference")
    ]
    customers = [dict(r) for r in c.execute("SELECT * FROM customers ORDER BY name,id")]
    suppliers = [dict(r) for r in c.execute("SELECT * FROM suppliers ORDER BY name,id")]
  summary = dict(
    receivables=0,
    payables=0,
    overdue_receivables=0,
    overdue_payables=0,
    customer_refunds_due=0,
    vendor_refunds_due=0,
    unconfirmed=0,
  )
  for r in rows:
    if not r["confirmed"]:
      summary["unconfirmed"] += 1
      continue
    summary["receivables" if r["kind"] == "sale" else "payables"] += r["due"]
    if r["overdue"]:
      summary["overdue_receivables" if r["kind"] == "sale" else "overdue_payables"] += r["due"]
    summary["customer_refunds_due" if r["kind"] == "sale" else "vendor_refunds_due"] += r[
      "refund_due"
    ]
  q = get("q").casefold()
  kind = get("kind")
  status = get("status")
  customer_id = get("customer_id")
  supplier_id = get("supplier_id")
  if kind not in ("", "sale", "purchase"):
    raise ValueError("Invalid invoice type")
  rows = [
    r
    for r in rows
    if (not q or q in (r["reference"] + " " + r["party_name"]).casefold())
    and (not kind or r["kind"] == kind)
    and (not status or r["status"] == status)
    and (not customer_id or str(r["customer_id"]) == customer_id)
    and (not supplier_id or str(r["supplier_id"]) == supplier_id)
  ]
  return {
    "accounts": rows,
    "summary": summary,
    "customers": customers,
    "suppliers": suppliers,
    "currency": config["currency"],
  }


def statement(s, query):
  party_type = query.get("type", ["customer"])[0]
  if party_type not in ("customer", "vendor"):
    raise ValueError("Choose customer or vendor")
  party_id = s.integer(query.get("id", [""])[0])
  field = "customer_id" if party_type == "customer" else "supplier_id"
  rows = list_accounts(
    s, {field: [str(party_id)], "kind": ["sale" if party_type == "customer" else "purchase"]}
  )["accounts"]
  with s.connect() as c:
    party = c.execute(
      "SELECT * FROM " + ("customers" if party_type == "customer" else "suppliers") + " WHERE id=?",
      (party_id,),
    ).fetchone()
    if not party:
      raise ValueError("Customer/vendor not found")
    invoices = [account(s, c, r["reference"]) for r in rows]
  return {
    "party": dict(party),
    "type": party_type,
    "invoices": invoices,
    "due": sum(r["due"] for r in invoices),
    "refund_due": sum(r["refund_due"] for r in invoices),
    "unconfirmed": sum(not r["confirmed"] for r in invoices),
  }


def cash_summary(s, start, end):
  """Actual payment events only; opening confirmations are excluded from cash received/paid."""
  config = features.settings(s)
  zone = features.zone(config)
  result = {
    "customer_receipts": 0,
    "vendor_payments": 0,
    "customer_refunds": 0,
    "vendor_refunds": 0,
  }
  with s.connect() as c:
    rows = c.execute(
      "SELECT e.*,t.kind invoice_kind FROM payment_events e JOIN transactions t ON t.reference=e.reference"
    ).fetchall()
  for row in rows:
    day = features.instant(row["created"], config).astimezone(zone).date().isoformat()
    if not start <= day <= end:
      continue
    key = (
      ("customer_receipts" if row["kind"] == "payment" else "customer_refunds")
      if row["invoice_kind"] == "sale"
      else ("vendor_payments" if row["kind"] == "payment" else "vendor_refunds")
    )
    result[key] += row["amount"]
  result["net_settlement_cash"] = (
    result["customer_receipts"]
    + result["vendor_refunds"]
    - result["vendor_payments"]
    - result["customer_refunds"]
  )
  return result


def csv_accounts(s, query):
  result = list_accounts(s, query)
  output = io.StringIO(newline="")
  writer = csv.writer(output)
  writer.writerow(
    ["Currency", result["currency"], "Amounts in minor units (100 = 1 currency unit)"]
  )
  keys = [
    "reference",
    "created",
    "kind",
    "party_name",
    "status",
    "due_date",
    "original_total",
    "returns_total",
    "net_total",
    "net_paid",
    "balance",
    "due",
    "refund_due",
    "overdue",
  ]
  writer.writerow(keys)
  for row in result["accounts"]:
    values = []
    for key in keys:
      value = row[key]
      if not row["confirmed"] and key in ("net_paid", "balance", "due", "refund_due"):
        value = "Unconfirmed"
      if isinstance(value, str) and value.lstrip().startswith(
        ("=", "+", "-", "@", "\t", "\r", "\n")
      ):
        value = "'" + value
      values.append(value)
    writer.writerow(values)
  return ("\ufeff" + output.getvalue()).encode()
