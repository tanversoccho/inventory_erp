"""Additive ERP services. Currency amounts are integer minor units, never floats."""

import base64
import csv
import datetime as dt
import io
import json
import re
import secrets
import sqlite3
from contextlib import closing
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULTS = {
  "app_name": "Soccho",
  "short_name": "Soccho",
  "subtitle": "Inventory & sales",
  "description": "Your inventory workspace",
  "welcome": "Your stock. Your business, clearer.",
  "company": "",
  "address": "",
  "phone": "",
  "email": "",
  "website": "",
  "tax_id": "",
  "invoice_header": "",
  "invoice_footer": "Thank you for your business.",
  "report_header": "",
  "report_footer": "",
  "theme": "system",
  "primary": "#255c4b",
  "accent": "#dce6a5",
  "density": "comfortable",
  "collapsed": False,
  "reduced_motion": False,
  "high_contrast": False,
  "currency": "BDT",
  "currency_symbol": "৳",
  "locale": "en-BD",
  "language": "en",
  "timezone": "Asia/Dhaka",
  "date_format": "iso",
  "time_format": "24",
  "precision": 2,
  "grouping": True,
  "units": ["piece", "pack", "box", "kg", "litre"],
  "categories": [],
  "minimum": 5,
  "code_rule": "optional",
  "invoice_prefix": "INV-",
  "purchase_prefix": "PUR-",
  "payment_methods": ["Cash", "Bank", "bKash", "Nagad"],
  "default_payment": "Cash",
  "default_note": "",
  "report_period": "month",
  "widgets": ["sales", "profit", "purchases", "stock"],
  "modules": ["reports", "expenses", "suppliers"],
  "product_sort": "name",
  "custom_fields": [],
  "product_columns": ["category", "cost", "price"],
}
ASSET_ROLES = ("logo", "dark_logo", "favicon", "login_logo", "business_logo")
PUBLIC_KEYS = {
  "app_name",
  "short_name",
  "subtitle",
  "description",
  "welcome",
  "theme",
  "primary",
  "accent",
  "density",
  "collapsed",
  "reduced_motion",
  "high_contrast",
  "locale",
  "language",
}


def migrate(s):
  """Backup existing DB before additive v1 migration; SQLite rolls DDL back on failure."""
  with s.connect() as c:
    version = c.execute("PRAGMA user_version").fetchone()[0]
    if version > 3:
      raise RuntimeError(
        "Database is newer than this application; use matching application version"
      )
    if version >= 1:
      return
    has_data = (
      c.execute("SELECT count(*) FROM products").fetchone()[0]
      or c.execute("SELECT count(*) FROM settings").fetchone()[0]
    )
    if has_data:
      backup = Path(str(s.DB) + ".pre-v1-" + secrets.token_hex(4) + ".backup")
      with closing(sqlite3.connect(backup)) as target:
        c.backup(target)
    c.execute("BEGIN IMMEDIATE")
    try:
      c.execute("CREATE TABLE migrations(version INTEGER PRIMARY KEY, applied TEXT NOT NULL)")
      c.execute("ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'piece'")
      c.execute("ALTER TABLE products ADD COLUMN custom_json TEXT NOT NULL DEFAULT '{}'")
      c.execute("ALTER TABLE movements ADD COLUMN original_id INTEGER REFERENCES movements(id)")
      c.execute("ALTER TABLE movements ADD COLUMN actual_unit_cost INTEGER")
      c.execute("ALTER TABLE movements ADD COLUMN name_snapshot TEXT NOT NULL DEFAULT ''")
      c.execute("ALTER TABLE movements ADD COLUMN category_snapshot TEXT NOT NULL DEFAULT ''")
      c.execute("ALTER TABLE movements ADD COLUMN note TEXT NOT NULL DEFAULT ''")
      c.execute("UPDATE movements SET actual_unit_cost=unit_price WHERE kind='purchase'")
      c.execute(
        "UPDATE movements SET name_snapshot=(SELECT name FROM products WHERE id=product_id), category_snapshot=(SELECT category FROM products WHERE id=product_id)"
      )
      c.execute(
        "CREATE TABLE suppliers(id INTEGER PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '')"
      )
      c.execute(
        "CREATE TABLE transactions(reference TEXT PRIMARY KEY,created TEXT NOT NULL,kind TEXT NOT NULL,supplier_id INTEGER REFERENCES suppliers(id),payment_method TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '')"
      )
      c.execute(
        "INSERT INTO transactions(reference,created,kind) SELECT reference,min(created),kind FROM movements GROUP BY reference,kind"
      )
      c.execute(
        "CREATE TABLE expenses(id INTEGER PRIMARY KEY,created TEXT NOT NULL,category TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),payment_method TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',reference TEXT NOT NULL,payee TEXT NOT NULL DEFAULT '')"
      )
      c.execute(
        "CREATE TABLE assets(role TEXT PRIMARY KEY,filename TEXT NOT NULL,mime TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL)"
      )
      c.execute("CREATE INDEX movements_created ON movements(created)")
      c.execute("CREATE INDEX movements_product ON movements(product_id,created)")
      c.execute("CREATE INDEX movements_original ON movements(original_id)")
      c.execute("CREATE INDEX expenses_created ON expenses(created)")
      c.execute(
        "INSERT INTO migrations VALUES(1,?)", (dt.datetime.now(dt.UTC).isoformat(),)
      )
      c.execute("PRAGMA user_version=1")
      c.commit()
    except Exception:
      c.rollback()
      raise


def settings(s, public=False):
  with s.connect() as c:
    row = c.execute("SELECT value FROM settings WHERE key='configuration'").fetchone()
    config = {**DEFAULTS, **(json.loads(row[0]) if row else {})}
    assets = {r["role"]: "/assets/" + r["filename"] for r in c.execute("SELECT * FROM assets")}
  if public:
    config = {k: v for k, v in config.items() if k in PUBLIC_KEYS}
    assets = {
      k: v for k, v in assets.items() if k in ("logo", "dark_logo", "favicon", "login_logo")
    }
  return {**config, "assets": assets}


def zone(config):
  try:
    return ZoneInfo(config["timezone"])
  except ZoneInfoNotFoundError:
    if config["timezone"] == "Asia/Dhaka":
      return dt.timezone(dt.timedelta(hours=6), "Asia/Dhaka")
    raise ValueError("Time zone not installed. Install tzdata or use Asia/Dhaka")


def instant(value, config):
  result = dt.datetime.fromisoformat(value)
  return result.replace(tzinfo=zone(config)) if result.tzinfo is None else result


def now(s):
  return dt.datetime.now(zone(settings(s))).isoformat(timespec="seconds")


def save_settings(s, data):
  old = settings(s)
  data = dict(data)
  data.pop("assets", None)
  if set(data) - set(DEFAULTS):
    raise ValueError("Unknown setting")
  config = {**{k: old[k] for k in DEFAULTS}, **data}
  choices = {
    "theme": ["light", "dark", "system"],
    "density": ["compact", "comfortable"],
    "language": ["en"],
    "date_format": ["iso", "dmy", "mdy"],
    "time_format": ["12", "24"],
    "code_rule": ["optional", "required"],
    "product_sort": ["name", "stock", "category"],
    "report_period": ["month", "year"],
  }
  for k, default in DEFAULTS.items():
    v = config[k]
    if isinstance(default, bool):
      if not isinstance(v, bool):
        raise ValueError("Invalid " + k)
    elif isinstance(default, int):
      if (
        isinstance(v, bool)
        or not isinstance(v, int)
        or not 0 <= v <= (4 if k == "precision" else 1000000)
      ):
        raise ValueError("Invalid " + k)
    elif isinstance(default, list):
      if (
        not isinstance(v, list)
        or len(v) > 50
        or any(not isinstance(x, str) or len(x) > 100 or not x.strip() for x in v)
        or len(set(v)) != len(v)
      ):
        raise ValueError("Invalid " + k)
    elif not isinstance(v, str) or len(v) > 2000:
      raise ValueError("Invalid " + k)
  for k, values in choices.items():
    if config[k] not in values:
      raise ValueError("Unsupported " + k)
  for key, allowed in [
    ("widgets", ["sales", "profit", "purchases", "stock"]),
    ("modules", ["reports", "expenses", "suppliers"]),
    ("product_columns", ["category", "cost", "price"]),
  ]:
    if set(config[key]) - set(allowed):
      raise ValueError("Invalid " + key)
  for key in ("primary", "accent"):
    if not re.fullmatch("#[0-9a-fA-F]{6}", config[key]):
      raise ValueError("Use a six-digit hex color")
  if not re.fullmatch("[A-Z]{3}", config["currency"]) or not re.fullmatch(
    r"[a-z]{2,3}(-[A-Za-z0-9]{2,8})*", config["locale"]
  ):
    raise ValueError("Invalid currency or locale")
  if (
    not config["app_name"].strip()
    or not config["short_name"].strip()
    or len(config["app_name"]) > 80
    or len(config["short_name"]) > 30
  ):
    raise ValueError("Enter a name (80 characters) and short name (30 characters)")
  if config["default_payment"] not in config["payment_methods"] or not config["units"]:
    raise ValueError("Choose a default payment method and at least one unit")
  for key in ("invoice_prefix", "purchase_prefix"):
    if not re.fullmatch(r"[A-Za-z0-9_-]{0,20}", config[key]):
      raise ValueError("Reference prefixes: letters, numbers, dash and underscore only")
  zone(config)
  with s.connect() as c:
    c.execute("BEGIN IMMEDIATE")
    if config["currency"] != old["currency"] and (
      c.execute("SELECT 1 FROM movements LIMIT 1").fetchone()
      or c.execute("SELECT 1 FROM expenses LIMIT 1").fetchone()
    ):
      raise ValueError(
        "Currency is locked after transactions; start a separate database for another currency"
      )
    c.execute("INSERT OR REPLACE INTO settings VALUES('configuration',?)", (json.dumps(config),))
  return settings(s)


def upload_asset(s, data):
  role = data.get("role")
  if role not in ASSET_ROLES:
    raise ValueError("Invalid logo role")
  if data.get("remove") is True:
    with s.connect() as c:
      c.execute("DELETE FROM assets WHERE role=?", (role,))
    return settings(s)
  from PIL import Image, UnidentifiedImageError

  try:
    raw = base64.b64decode(data.get("content", ""), validate=True)
    if not 0 < len(raw) <= 2 * 1024 * 1024:
      raise ValueError("Logo must be at most 2 MiB")
    with Image.open(io.BytesIO(raw)) as im:
      if (
        im.format not in ("PNG", "JPEG", "WEBP")
        or min(im.size) < 8
        or max(im.size) > 4096
        or im.width * im.height > 10000000
      ):
        raise ValueError("Use PNG, JPEG or WebP, 8–4096 pixels per side, at most 10 megapixels")
      im.load()
      clean = im.convert("RGBA")
      width, height = clean.size
    output = io.BytesIO()
    clean.save(output, format="PNG")
  except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
    raise ValueError("Invalid or unsafe image") from exc
  folder = Path(str(s.DB) + ".assets")
  folder.mkdir(parents=True, exist_ok=True)
  filename = secrets.token_hex(20) + ".png"
  path = folder / filename
  try:
    path.write_bytes(output.getvalue())
    with s.connect() as c:
      c.execute(
        "INSERT OR REPLACE INTO assets VALUES(?,?,?,?,?)",
        (role, filename, "image/png", width, height),
      )
  except Exception:
    path.unlink(missing_ok=True)
    raise
  # Old assets retained for recovery; only database-referenced assets are served.
  return settings(s)


def product_edit(s, data):
  name = str(data.get("name", "")).strip()
  code = str(data.get("code", "")).strip()
  if not name or not code or len(name) > 200 or len(code) > 200:
    raise ValueError("Enter product name and unique code (max 200 characters)")
  config = settings(s)
  unit = data.get("unit", "piece")
  custom = data.get("custom", {})
  if (
    unit not in config["units"]
    or not isinstance(custom, dict)
    or set(custom) - set(config["custom_fields"])
    or any(not isinstance(v, str) or len(v) > 500 for v in custom.values())
  ):
    raise ValueError("Invalid unit or custom fields")
  with s.connect() as c:
    cursor = c.execute(
      "UPDATE products SET name=?,code=?,category=?,price=?,minimum=?,unit=?,custom_json=? WHERE id=?",
      (
        name,
        code,
        str(data.get("category", ""))[:100],
        s.money(data.get("price", 0)),
        s.integer(data.get("minimum", 5), 0),
        unit,
        json.dumps(custom),
        data["id"],
      ),
    )
    if not cursor.rowcount:
      raise ValueError("Product not found")
  return {"ok": True}


def expense(s, data):
  config = settings(s)
  day = dt.date.fromisoformat(data["date"])
  amount = s.money(data["amount"])
  category = str(data.get("category", "")).strip()[:100]
  method = data.get("payment_method", config["default_payment"])
  if not amount or not category or method not in config["payment_methods"]:
    raise ValueError("Enter positive amount, expense category and valid payment method")
  created = dt.datetime.combine(day, dt.time(12), zone(config)).isoformat()
  with s.connect() as c:
    ref = "EXP-" + secrets.token_hex(6).upper()
    c.execute(
      "INSERT INTO expenses(created,category,amount,payment_method,description,reference,payee) VALUES(?,?,?,?,?,?,?)",
      (
        created,
        category,
        amount,
        method,
        str(data.get("description", ""))[:1000],
        ref,
        str(data.get("payee", ""))[:200],
      ),
    )
  return {"reference": ref}


def supplier(s, data):
  name = str(data.get("name", "")).strip()[:200]
  if not name:
    raise ValueError("Supplier name required")
  with s.connect() as c:
    c.execute(
      "INSERT INTO suppliers(name,phone,address) VALUES(?,?,?)",
      (name, str(data.get("phone", ""))[:100], str(data.get("address", ""))[:1000]),
    )
  return {"ok": True}


def correction(s, data):
  kind = data.get("kind")
  reason = str(data.get("reason", "")).strip()
  q = s.integer(data["quantity"])
  if (
    kind not in ("sale_return", "purchase_return", "adjust_in", "adjust_out")
    or not reason
    or len(reason) > 1000
  ):
    raise ValueError("Choose correction type and provide a reason (max 1000 characters)")
  with s.connect() as c:
    c.execute("BEGIN IMMEDIATE")
    p = c.execute("SELECT * FROM products WHERE id=?", (data["product_id"],)).fetchone()
    if not p:
      raise ValueError("Product not found")
    original_id = None
    cost, price = p["cost"], 0
    if kind.endswith("return"):
      original_id = s.integer(data["original_id"])
      original = c.execute(
        "SELECT * FROM movements WHERE id=? AND product_id=? AND kind=?",
        (original_id, p["id"], "sale" if kind == "sale_return" else "purchase"),
      ).fetchone()
      if not original:
        raise ValueError("Select a matching original sale/purchase line")
      returned = c.execute(
        "SELECT coalesce(sum(quantity),0) FROM movements WHERE original_id=?", (original_id,)
      ).fetchone()[0]
      if q > original["quantity"] - returned:
        raise ValueError("Return exceeds remaining original quantity")
      price = original["unit_price"]
      cost = original["unit_cost"] if kind == "sale_return" else p["cost"]
    elif kind == "adjust_in":
      cost = s.money(data.get("cost", 0))
    inbound = kind in ("sale_return", "adjust_in")
    if not inbound and q > p["stock"]:
      raise ValueError("Insufficient stock")
    stock = p["stock"] + (q if inbound else -q)
    avg = (
      int(
        (s.Decimal(p["stock"] * p["cost"] + q * cost) / stock).quantize(
          s.Decimal(1), rounding=s.ROUND_HALF_UP
        )
      )
      if inbound
      else p["cost"]
    )
    ref = "COR-" + secrets.token_hex(6).upper()
    created = now(s)
    c.execute("UPDATE products SET stock=?,cost=? WHERE id=?", (stock, avg, p["id"]))
    c.execute(
      "INSERT INTO movements(created,kind,product_id,quantity,unit_price,unit_cost,reference,original_id,name_snapshot,category_snapshot,note) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      (created, kind, p["id"], q, price, cost, ref, original_id, p["name"], p["category"], reason),
    )
    c.execute(
      "INSERT INTO transactions(reference,created,kind,note) VALUES(?,?,?,?)",
      (ref, created, kind, reason),
    )
  return {"reference": ref}


def report(s, query):
  import payments

  config = settings(s)
  tz = zone(config)
  get = lambda key, default="": query.get(key, [default])[0]
  today = dt.datetime.now(tz).date()
  month = get("month", today.strftime("%Y-%m"))
  if not re.fullmatch(r"\d{4}-\d{2}", month):
    raise ValueError("Invalid month")
  year, mon = map(int, month.split("-"))
  first = dt.date(year, mon, 1)
  start = dt.date.fromisoformat(get("start", first.isoformat()))
  next_month = dt.date(year + (mon == 12), 1 if mon == 12 else mon + 1, 1)
  end = dt.date.fromisoformat(
    get("end", (next_month - dt.timedelta(days=1)).isoformat())
  ) + dt.timedelta(days=1)
  if end <= start or (end - start).days > 1100:
    raise ValueError("Choose a date range of at most 1100 days")
  product = int(get("product", "0") or 0)
  category, kind = get("category"), get("kind")
  allowed = ("", "purchase", "sale", "sale_return", "purchase_return", "adjust_in", "adjust_out")
  if kind not in allowed:
    raise ValueError("Invalid transaction type")
  with s.connect() as c:
    products = [dict(r) for r in c.execute("SELECT * FROM products ORDER BY name")]
    # Parameterized predicates; timestamps are normalized in Python for mixed legacy offsets.
    sql = "SELECT m.*,p.code FROM movements m JOIN products p ON p.id=m.product_id WHERE 1=1"
    params = []
    for clause, value in [
      (" AND product_id=?", product),
      (" AND category_snapshot=?", category),
      (" AND kind=?", kind),
    ]:
      if value:
        sql += clause
        params.append(value)
    all_rows = [dict(r) for r in c.execute(sql + " ORDER BY m.created,m.id", params)]
    from reliability import expense_rows

    expenses = expense_rows(c)
  for r in all_rows:
    r["name"] = r["name_snapshot"]
    r["category"] = r["category_snapshot"]
    r["local_date"] = instant(r["created"], config).astimezone(tz).date().isoformat()

  def between(rows, a, b):
    return [r for r in rows if a.isoformat() <= r["local_date"] < b.isoformat()]

  rows = between(all_rows, start, end)
  for e in expenses:
    e["local_date"] = instant(e["created"], config).astimezone(tz).date().isoformat()
  # Expenses are unallocated: do not subtract company-wide overhead from a product/type slice.
  filtered = bool(product or category or kind)
  selected_expenses = between(expenses, start, end) if not filtered else []

  def totals(rs, es=()):
    out = dict(
      gross_sales=0,
      sales_returns=0,
      purchases=0,
      purchase_returns=0,
      cogs=0,
      units=0,
      adjustment_cost=0,
    )
    refs = set()
    for r in rs:
      k, q, price, cost = r["kind"], r["quantity"], r["unit_price"], r["unit_cost"]
      if k == "sale":
        out["gross_sales"] += q * price
        out["cogs"] += q * cost
        out["units"] += q
        refs.add(r["reference"])
      elif k == "sale_return":
        out["sales_returns"] += q * price
        out["cogs"] -= q * cost
        out["units"] -= q
      elif k == "purchase":
        out["purchases"] += q * price
      elif k == "purchase_return":
        out["purchase_returns"] += q * price
        # Inventory leaves at current average; difference from supplier refund affects result.
        out["adjustment_cost"] += q * (cost - price)
      elif k in ("adjust_in", "adjust_out"):
        out["adjustment_cost"] += q * cost * (1 if k == "adjust_out" else -1)
    out["sales"] = out["gross_sales"] - out["sales_returns"]
    out["profit"] = out["sales"] - out["cogs"]
    out["expenses"] = sum(e["amount"] for e in es)
    out["operating_result"] = out["profit"] - out["expenses"] - out["adjustment_cost"]
    out["transactions"] = len(refs)
    out["average_sale"] = round(out["gross_sales"] / len(refs)) if refs else 0
    out["margin"] = round(out["profit"] * 100 / out["sales"], 2) if out["sales"] else None
    return out

  summary = totals(rows, selected_expenses)
  current_products = [
    p
    for p in products
    if (not product or p["id"] == product) and (not category or p["category"] == category)
  ]
  summary["current_stock_value"] = sum(p["stock"] * p["cost"] for p in current_products)
  summary["low_stock_count"] = sum(p["stock"] <= p["minimum"] for p in current_products)
  prev_first = (first - dt.timedelta(days=1)).replace(day=1)
  prev_end = first
  yoy_first = first.replace(year=year - 1)
  yoy_end = (yoy_first + dt.timedelta(days=32)).replace(day=1)
  full_month = start == first and end == next_month
  previous = (
    totals(
      between(all_rows, prev_first, prev_end),
      between(expenses, prev_first, prev_end) if not filtered else [],
    )
    if full_month
    else None
  )
  yoy_rows = between(all_rows, yoy_first, yoy_end)
  yoy = totals(yoy_rows) if full_month and yoy_rows else None
  daily = []
  day = start
  while day < end:
    daily.append(
      {"date": day.isoformat(), **totals(between(rows, day, day + dt.timedelta(days=1)))}
    )
    day += dt.timedelta(days=1)
  months = []
  cursor = first
  for _ in range(12):
    months.insert(0, cursor)
    cursor = (cursor - dt.timedelta(days=1)).replace(day=1)
  monthly = [
    {
      "month": a.strftime("%Y-%m"),
      **totals(between(all_rows, a, (a + dt.timedelta(days=32)).replace(day=1))),
    }
    for a in months
  ]
  performance = []
  performance_products = [
    p for p in products if p in current_products or any(r["product_id"] == p["id"] for r in rows)
  ]
  for p in performance_products:
    prs = [r for r in rows if r["product_id"] == p["id"]]
    t = totals(prs)
    performance.append(
      {"id": p["id"], "name": p["name"], "category": p["category"], "stock": p["stock"], **t}
    )
  performance.sort(key=lambda p: p["sales"], reverse=True)
  categories = [
    {"category": cat or "(Uncategorized)", **totals([r for r in rows if r["category"] == cat])}
    for cat in sorted({r["category"] for r in rows})
  ]
  expense_categories = [
    {"category": cat, "amount": sum(e["amount"] for e in selected_expenses if e["category"] == cat)}
    for cat in sorted({e["category"] for e in selected_expenses})
  ]
  return dict(
    start=start.isoformat(),
    end=(end - dt.timedelta(days=1)).isoformat(),
    timezone=config["timezone"],
    currency=config["currency"],
    payment_cash=None
    if filtered
    else payments.cash_summary(s, start.isoformat(), (end - dt.timedelta(days=1)).isoformat()),
    branding={k: config[k] for k in ("app_name", "company", "report_header", "report_footer")},
    summary=summary,
    previous=previous,
    year_ago=yoy,
    daily=daily,
    monthly=monthly,
    products=performance,
    categories=categories,
    movements=rows,
    expenses=selected_expenses,
    expense_categories=expense_categories,
    valuation=[{**p, "value": p["stock"] * p["cost"]} for p in current_products],
    low_stock=[p for p in current_products if p["stock"] <= p["minimum"]],
    slow_moving=[p for p in performance if p["units"] <= 0 and p["stock"] > 0],
    overhead_allocated=not filtered,
    note="Current valuation is today’s stock, not historical month end. Cash collected is not tracked. Prices include any discount entered at sale. Taxes are not calculated. Monthly trend covers 12 months ending in selected month; other tables follow the date range.",
  )


def csv_report(data, table="movements"):
  keys = {
    "movements": [
      "local_date",
      "reference",
      "kind",
      "name",
      "code",
      "quantity",
      "unit_price",
      "unit_cost",
      "note",
    ],
    "products": ["name", "category", "stock", "units", "sales", "cogs", "profit", "margin"],
    "categories": ["category", "sales", "cogs", "profit", "units"],
    "daily": ["date", "sales", "purchases", "profit", "units", "transactions"],
    "monthly": ["month", "sales", "purchases", "profit", "margin", "units", "transactions"],
    "valuation": ["name", "code", "stock", "cost", "value"],
    "low_stock": ["name", "code", "stock", "minimum"],
    "expenses": [
      "local_date",
      "category",
      "amount",
      "payment_method",
      "description",
      "reference",
      "payee",
    ],
    "slow_moving": ["name", "category", "stock", "units", "sales"],
    "expense_categories": ["category", "amount"],
    "cash": list((data.get("payment_cash") or {}).keys()),
    "summary": list(data["summary"]),
  }
  if table not in keys:
    raise ValueError("Invalid export table")
  output = io.StringIO(newline="")
  writer = csv.writer(output)
  brand = data.get("branding", {})

  def safe(v):
    return (
      "'" + v
      if isinstance(v, str) and v.lstrip().startswith(("=", "+", "-", "@", "\t", "\r", "\n"))
      else v
    )

  writer.writerow(
    [safe(brand.get("company") or brand.get("app_name", "")), safe(brand.get("report_header", ""))]
  )
  writer.writerow(
    [
      "Period",
      data["start"],
      data["end"],
      "Currency",
      data["currency"],
      "Money values in minor units (100 = 1 currency unit)",
    ]
  )
  writer.writerow(keys[table])
  if table == "cash" and data.get("payment_cash") is None:
    raise ValueError("Settlement cash export requires a whole-business report")
  rows = (
    [data["payment_cash"]]
    if table == "cash"
    else [data["summary"]]
    if table == "summary"
    else data[table]
  )
  for row in rows:
    values = []
    for k in keys[table]:
      value = row.get(k, "")
      if isinstance(value, str) and value.lstrip().startswith(
        ("=", "+", "-", "@", "\t", "\r", "\n")
      ):
        value = "'" + value
      values.append(value)
    writer.writerow(values)
  if brand.get("report_footer"):
    writer.writerow([safe(brand["report_footer"])])
  return ("\ufeff" + output.getvalue()).encode("utf-8")
