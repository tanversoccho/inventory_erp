import argparse
import datetime
import hashlib
import hmac
import json
import secrets
import sqlite3
import ssl
import time
import threading
import erp_features as features
from db_connection import ManagedConnection
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from product_lookup import online_lookup

ROOT = Path(__file__).resolve().parent
DB = ROOT / "data" / "inventory.sqlite3"
SESSIONS = {}
LOGIN_ATTEMPTS = {}
AUTH_LOCK = threading.Lock()
SESSION_SECONDS = 8 * 3600


def connect():
    c = sqlite3.connect(DB, timeout=20, factory=ManagedConnection)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


def initialize():
    DB.parent.mkdir(parents=True, exist_ok=True)
    with connect() as c:
        c.executescript("""PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL DEFAULT '',stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),cost INTEGER NOT NULL DEFAULT 0,price INTEGER NOT NULL DEFAULT 0,minimum INTEGER NOT NULL DEFAULT 5);
        CREATE TABLE IF NOT EXISTS movements(id INTEGER PRIMARY KEY,created TEXT NOT NULL,kind TEXT NOT NULL,product_id INTEGER NOT NULL REFERENCES products(id),quantity INTEGER NOT NULL,unit_price INTEGER NOT NULL,unit_cost INTEGER NOT NULL,reference TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);""")


    features.migrate(__import__(__name__))


def money(v):
    try:
        d = Decimal(str(v))
        if not d.is_finite() or d < 0 or d > Decimal(1000000000):
            raise ValueError("Invalid price")
        return int((d * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    except InvalidOperation:
        raise ValueError("Invalid price")


def integer(v, minimum=1):
    d = Decimal(str(v))
    if not d.is_finite() or d != int(d) or d < minimum or d > 100000000:
        raise ValueError("Invalid quantity")
    return int(d)


def transaction(data):
    kind = data.get("kind")
    items = data.get("items", [])
    if kind not in ("purchase", "sale") or not items or len(items) > 200:
        raise ValueError("Choose items and transaction type")
    config = features.settings(__import__(__name__))
    ref = config['invoice_prefix' if kind == 'sale' else 'purchase_prefix'] + secrets.token_hex(6).upper()
    now = features.now(__import__(__name__))
    method = data.get('payment_method', config['default_payment'])
    if method not in config['payment_methods']:
        raise ValueError('Invalid payment method')
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        supplier = data.get('supplier_id') or None
        if supplier is not None and not c.execute('SELECT 1 FROM suppliers WHERE id=?', (supplier,)).fetchone():
            raise ValueError('Supplier not found')
        c.execute('INSERT INTO transactions(reference,created,kind,supplier_id,payment_method,note) VALUES(?,?,?,?,?,?)',
                  (ref, now, kind, supplier, method, str(data.get('note', config['default_note']))[:1000]))
        for item in items:
            q = integer(item["quantity"])
            price = money(item["price"])
            p = c.execute("SELECT * FROM products WHERE id=?", (item["id"],)).fetchone()
            if not p:
                raise ValueError("Product not found")
            cost = p["cost"]
            if kind == "sale":
                if q > p["stock"]:
                    raise ValueError("Insufficient stock: " + p["name"])
                c.execute("UPDATE products SET stock=stock-? WHERE id=?", (q, p["id"]))
            else:
                total = p["stock"] + q
                cost = int(
                    (Decimal(p["stock"] * cost + q * price) / total).quantize(
                        Decimal(1), rounding=ROUND_HALF_UP
                    )
                )
                c.execute(
                    "UPDATE products SET stock=?,cost=? WHERE id=?",
                    (total, cost, p["id"]),
                )
            c.execute(
                "INSERT INTO movements(created,kind,product_id,quantity,unit_price,unit_cost,reference,actual_unit_cost,name_snapshot,category_snapshot) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (now, kind, p["id"], q, price, cost, ref, price if kind == 'purchase' else None, p['name'], p['category']),
            )
    return {"reference": ref}


def create_product(data):
    config = features.settings(__import__(__name__))
    if config['code_rule'] == 'required' and not str(data.get('code', '')).strip():
        raise ValueError('A barcode/code is required by owner settings')
    code = str(data.get("code", "")).strip() or "AUTO-" + secrets.token_hex(8).upper()
    name = str(data.get("name", "")).strip()
    if not name or len(code) > 200 or len(name) > 200:
        raise ValueError("Enter product name (max 200 characters)")
    quantity = integer(data.get("quantity", 0), 0)
    cost = money(data.get("cost", 0))
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        cursor = c.execute(
            "INSERT INTO products(code,name,category,price,minimum,stock,cost) VALUES(?,?,?,?,?,?,?)",
            (
                code,
                name,
                str(data.get("category", ""))[:100],
                money(data.get("price", 0)),
                integer(data.get("minimum", config["minimum"]), 0),
                quantity,
                cost if quantity else 0,
            ),
        )
        if quantity:
            now = features.now(__import__(__name__))
            c.execute(
                "INSERT INTO movements(created,kind,product_id,quantity,unit_price,unit_cost,reference) VALUES(?,?,?,?,?,?,?)",
                (
                    now,
                    "purchase",
                    cursor.lastrowid,
                    quantity,
                    cost,
                    cost,
                    secrets.token_hex(5).upper(),
                ),
            )
        c.execute("UPDATE movements SET actual_unit_cost=unit_price,name_snapshot=?,category_snapshot=? WHERE product_id=?", (name, str(data.get('category', ''))[:100], cursor.lastrowid))
        c.execute("INSERT OR IGNORE INTO transactions(reference,created,kind) SELECT reference,created,kind FROM movements WHERE product_id=?", (cursor.lastrowid,))
        unit = data.get('unit', config['units'][0])
        if unit not in config['units']:
            raise ValueError('Invalid unit')
        custom = data.get('custom', {})
        if not isinstance(custom, dict) or set(custom) - set(config['custom_fields']) or any(not isinstance(v, str) or len(v) > 500 for v in custom.values()):
            raise ValueError('Invalid custom fields')
        c.execute('UPDATE products SET unit=?,custom_json=? WHERE id=?', (unit, json.dumps(custom), cursor.lastrowid))
    return {"code": code}


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, data, typ="application/json"):
        body = json.dumps(data).encode() if typ == "application/json" else data
        self.send_response(status)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        from http.cookies import SimpleCookie

        try:
            cookie = SimpleCookie(self.headers.get("Cookie", ""))
            token = cookie['session'].value if cookie.get('session') else ''
            with AUTH_LOCK:
                expiry = SESSIONS.get(token, 0)
                if expiry <= time.monotonic():
                    SESSIONS.pop(token, None)
                    return False
                return True
        except Exception:
            return False

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/api/public-settings':
            return self.reply(200, features.settings(__import__(__name__), public=True))
        if path.startswith('/assets/'):
            filename = path.removeprefix('/assets/')
            with connect() as c:
                asset = c.execute('SELECT * FROM assets WHERE filename=?', (filename,)).fetchone()
            if not asset:
                return self.reply(404, {'error': 'Asset not found'})
            file = Path(str(DB) + '.assets') / asset['filename']
            if not file.is_file():
                return self.reply(404, {'error': 'Asset missing; restore assets folder with database'})
            return self.reply(200, file.read_bytes(), asset['mime'])
        if path.startswith("/api/"):
            if not self.authorized():
                return self.reply(401, {"error": "Please sign in"})
            if path == '/api/backup-bundle':
                import tempfile
                from backup_database import backup
                with tempfile.TemporaryDirectory() as tmp:
                    destination = Path(tmp) / 'backup.zip'
                    backup(DB, destination)
                    return self.reply(200, destination.read_bytes(), 'application/zip')
            if path == '/api/settings':
                return self.reply(200, features.settings(__import__(__name__)))
            if path in ('/api/reports', '/api/reports.csv'):
                try:
                    query = parse_qs(urlparse(self.path).query)
                    report = features.report(__import__(__name__), query)
                    if path.endswith('.csv'):
                        return self.reply(200, features.csv_report(report, query.get('table', ['movements'])[0]), 'text/csv; charset=utf-8')
                    return self.reply(200, report)
                except (ValueError, OverflowError) as exc:
                    return self.reply(400, {'error': str(exc)})
            if path == '/api/administration':
                with connect() as c:
                    return self.reply(200, {table: [dict(r) for r in c.execute('SELECT * FROM ' + table + ' ORDER BY id DESC')] for table in ('expenses', 'suppliers')})
            if path == '/api/invoice':
                ref = parse_qs(urlparse(self.path).query).get('reference', [''])[0]
                with connect() as c:
                    header = c.execute('SELECT * FROM transactions WHERE reference=?', (ref,)).fetchone()
                    lines = [dict(r) for r in c.execute('SELECT * FROM movements WHERE reference=?', (ref,))]
                if not header:
                    return self.reply(404, {'error': 'Transaction not found'})
                return self.reply(200, {'transaction': dict(header), 'lines': lines, 'settings': features.settings(__import__(__name__))})
            if path == "/api/product-lookup":
                code = parse_qs(urlparse(self.path).query).get("code", [""])[0]
                return self.reply(200, online_lookup(code))
            with connect() as c:
                if path == "/api/state":
                    products = [dict(r) for r in c.execute("SELECT * FROM products ORDER BY name")]
                    history = [
                        dict(r)
                        for r in c.execute(
                            "SELECT m.*,p.name,p.code FROM movements m JOIN products p ON p.id=m.product_id ORDER BY m.id DESC"
                        )
                    ]
                    purchase = sum(
                        r["quantity"] * r["unit_price"] * (1 if r["kind"] == "purchase" else -1) for r in history if r["kind"] in ("purchase", "purchase_return")
                    )
                    sales = sum(
                        r["quantity"] * r["unit_price"] * (1 if r["kind"] == "sale" else -1) for r in history if r["kind"] in ("sale", "sale_return")
                    )
                    cogs = sum(
                        r["quantity"] * r["unit_cost"] * (1 if r["kind"] == "sale" else -1) for r in history if r["kind"] in ("sale", "sale_return")
                    )
                    return self.reply(
                        200,
                        dict(
                            products=products,
                            history=history,
                            totals=dict(
                                purchases=purchase,
                                sales=sales,
                                profit=sales - cogs,
                                stock=sum(p["stock"] * p["cost"] for p in products),
                            ),
                        ),
                    )
                if path == "/api/backup":
                    import tempfile

                    with tempfile.TemporaryDirectory() as t:
                        target = sqlite3.connect(Path(t) / "backup.sqlite3")
                        c.backup(target)
                        target.close()
                        body = (Path(t) / "backup.sqlite3").read_bytes()
                    return self.reply(200, body, "application/vnd.sqlite3")
            return self.reply(404, {"error": "Not found"})
        files = {
            "/": ("index.html", "text/html; charset=utf-8"),
            "/app.js": ("app.js", "text/javascript"),
            "/style.css": ("style.css", "text/css"),
            "/scanner.min.js": ("scanner.min.js", "text/javascript"),
            "/upgrade.js": ("upgrade.js", "text/javascript"),
            "/upgrade.css": ("upgrade.css", "text/css"),
        }
        if path not in files:
            return self.reply(404, {"error": "Not found"})
        name, typ = files[path]
        self.reply(200, (ROOT / "static" / name).read_bytes(), typ)

    def do_POST(self):
        try:
            # Disallow cross-origin mutation requests.
            origin = self.headers.get("Origin")
            if origin and urlparse(origin).netloc != self.headers.get("Host"):
                return self.reply(403, {"error": "Invalid origin"})
            if self.headers.get('Content-Type', '').split(';')[0].lower() != 'application/json':
                return self.reply(415, {'error': 'Use application/json'})
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > 3000000:
                return self.reply(413, {"error": "Request too large"})
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError('Expected a JSON object')
            path = urlparse(self.path).path
            if path == "/api/login":
                ip = self.client_address[0]
                with AUTH_LOCK:
                    t = time.monotonic()
                    attempts = [x for x in LOGIN_ATTEMPTS.get(ip, []) if x > t - 300]
                    if len(attempts) >= 10:
                        return self.reply(429, {'error': 'Too many attempts; wait five minutes'})
                    attempts.append(t)
                    LOGIN_ATTEMPTS[ip] = attempts
                if len(str(data.get('password', ''))) > 1024:
                    raise ValueError('Password too long')
                with connect() as c:
                    stored = c.execute(
                        "SELECT value FROM settings WHERE key='password'"
                    ).fetchone()[0]
                salt, expected = stored.split(":")
                actual = hashlib.scrypt(
                    str(data.get("password", "")).encode(),
                    salt=bytes.fromhex(salt),
                    n=16384,
                    r=8,
                    p=1,
                ).hex()
                if not hmac.compare_digest(actual, expected):
                    return self.reply(401, {"error": "Incorrect password"})
                token = secrets.token_urlsafe(32)
                with AUTH_LOCK:
                    for old_token in [k for k, v in SESSIONS.items() if v <= time.monotonic()]:
                        SESSIONS.pop(old_token, None)
                    SESSIONS[token] = time.monotonic() + SESSION_SECONDS
                    LOGIN_ATTEMPTS.pop(ip, None)
                body = b"{}"
                self.send_response(200)
                self.send_header(
                    "Set-Cookie",
                    f"session={token}; HttpOnly; SameSite=Strict; Path=/"
                    + ("; Secure" if isinstance(self.connection, ssl.SSLSocket) else ""),
                )
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(body)
                return
            if not self.authorized():
                return self.reply(401, {"error": "Please sign in"})
            if path == "/api/logout":
                from http.cookies import SimpleCookie

                cookie = SimpleCookie(self.headers.get("Cookie", ""))
                with AUTH_LOCK:
                    SESSIONS.pop(cookie['session'].value, None)
                return self.reply(200, {})
            operations = {'/api/settings': features.save_settings, '/api/asset': features.upload_asset,
                          '/api/product-edit': features.product_edit, '/api/expense': features.expense,
                          '/api/supplier': features.supplier, '/api/correction': features.correction}
            if path in operations:
                return self.reply(200, operations[path](__import__(__name__), data))
            if path == "/api/transaction":
                return self.reply(200, transaction(data))
            if path == "/api/product":
                return self.reply(201, create_product(data))
            return self.reply(404, {"error": "Not found"})
        except sqlite3.IntegrityError:
            return self.reply(400, {"error": "Product code already exists or record is invalid"})
        except (ValueError, KeyError, TypeError, InvalidOperation) as e:
            return self.reply(400, {"error": str(e)})
        except Exception:
            import traceback

            traceback.print_exc()
            return self.reply(500, {"error": "Server error; check laptop console"})


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8000)
    p.add_argument('--db', type=Path, default=DB)
    p.add_argument("--cert")
    p.add_argument("--key")
    args = p.parse_args()
    DB = args.db.resolve()
    initialize()
    with connect() as c:
        if not c.execute("SELECT 1 FROM settings WHERE key='password'").fetchone():
            import getpass

            password = getpass.getpass("Create your ERP password (at least 8 characters): ")
            if len(password) < 8:
                raise SystemExit("Password must contain at least 8 characters. Run again.")
            salt = secrets.token_hex(16)
            value = (
                salt
                + ":"
                + hashlib.scrypt(
                    password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1
                ).hex()
            )
            c.execute("INSERT INTO settings VALUES(?,?)", ("password", value))
    server = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    scheme = "http"
    if args.cert and args.key:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(args.cert, args.key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        scheme = "https"
    print(
        f"ERP running: {scheme}://localhost:{args.port} | Phone: use this laptop Wi-Fi IP and same port. Ctrl+C to stop."
    )
    server.serve_forever()
