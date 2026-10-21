# Inventory ERP — configurable local inventory and sales

One laptop runs Python and SQLite. Laptop and phone browsers share products, purchases, sales and reports. Barcode/QR codes are optional; photo crop scanning and online product lookup remain available.

**Start here: [UPGRADE_GUIDE.md](UPGRADE_GUIDE.md)** — exact Windows commands, safe upgrades, demo loading, runtime branding/settings, reports, backup, recovery and testing.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe server.py
```

Open http://localhost:8000. New databases prompt for your own password. Existing passwords/data persist. START_WINDOWS.bat creates the venv and installs required packages. No npm tooling is needed to run the application.

Demo only: `server.py --db sample_12_months.sqlite3 --port 8001`. Never replace the real database with a demo. The bundled sample has no default password.

This is a single-owner, single-currency inventory application with management reports, not full accounting/payroll software. Money uses integer minor units; quantities remain whole units. Cash settlement, tax calculations, receivables/payables, complete language translation and historical month-end valuation are not implemented.

`PHOTO_SCAN.md` and `ONLINE_LOOKUP.md` document the preserved scanner/catalog features. The upgrade guide supersedes earlier installation, reporting and security statements in older documentation.
