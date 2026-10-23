# Inventory ERP upgrade — 21 October 2026

This upgrade extends the uploaded inventory_erp.zip baseline. It preserves the Python HTTP server, SQLite, browser JavaScript, photo crop scanner, online barcode lookup and existing password. No real business data was used or bundled.

## Install the upgrade on Windows

Stop the running server with Ctrl+C. Make a copy of your existing project folder before applying source changes. The release contains no production `data` folder. Keep your existing data and certificates.

Choose ONE installation route:

**Full source:** copy the contents of the release's `inventory_erp` directory into `E:\New folder\inventory_erp`, replacing source files and keeping your existing data folder. Do not copy a demo database over your real database.

**Patch:** put `inventory_upgrade.patch` in the existing project directory. This patch matches the uploaded 21 October baseline; if you have reformatted it again, use the full source route or provide your latest files. First check, then apply:

```powershell
Set-Location 'E:\New folder\inventory_erp'
git apply --check .\inventory_upgrade.patch
git apply .\inventory_upgrade.patch
```

Install and start (Python 3.11+):

```powershell
Set-Location 'E:\New folder\inventory_erp'
# Only if the project has no working virtual environment:
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r .\requirements.txt
.\.venv\Scripts\python.exe .\server.py
```

Open http://localhost:8000 and press Ctrl+F5. The Windows launcher creates the venv, installs the two dependencies and starts the server. Direct Python startup avoids checking packages again on each launch. Pillow validates/re-encodes uploaded logos; tzdata supplies Windows timezone rules. npm is optional development tooling, not required to run the ERP.

First startup automatically applies additive schema v1. Existing products, stock, ledger and password remain. A populated legacy database gets a sibling `inventory.sqlite3.pre-v1-<random>.backup` before migration. A failure rolls back the migration and prevents startup. Do not delete tables or reset the database to fix migration errors.

## Test the demo safely

The bundled demo/sample_12_months.sqlite3 sample covers October 2025–September 2026 with 16 products, multiple-line sales/purchases, returns, damaged stock, expenses, one low-stock item and a slow-moving item. It has no password; create your own demo password at first launch. It never loads into your real DB automatically.

```powershell
.\.venv\Scripts\python.exe .\server.py --db .\demo\sample_12_months.sqlite3 --port 8001
```

Open http://localhost:8001. Choose Reports, then August or September 2026. Figures in BDT:

| Month | Gross sales | Sales returns | Net sales | COGS | Gross profit | Expenses | Operating result |
|---|---:|---:|---:|---:|---:|---:|---:|
| August 2026 | 16,733.00 | 52.00 | 16,681.00 | 11,634.23 | 5,046.77 | 2,450.00 | 2,566.39 |
| September 2026 | 18,416.00 | 45.00 | 18,371.00 | 12,738.84 | 5,632.16 | 2,465.00 | 3,136.82 |

Operating result also includes recorded inventory correction costs. This is not audited net profit. Raw expected totals in `sample_expected_totals.json` use integer minor units: divide monetary fields by 100, but not transaction counts, units or margin percentages.

Generate another reproducible demo, or verify one:

```powershell
.\.venv\Scripts\python.exe .\create_sample_database.py .\another_demo.sqlite3
.\.venv\Scripts\python.exe .\create_sample_database.py .\demo\sample_12_months.sqlite3 --validate
```

The generator refuses to overwrite any existing file. `schema.sql` recreates the empty current schema without passwords or products. For an empty application database, simply start with a new `--db` path; the application creates and migrates it automatically.

## Runtime branding and settings

Settings → Branding & appearance controls application/short name, login welcome, company/contact details, tax ID text, invoice/report header/footer, appearance, regional display and workflow preferences. Save explicitly; successful saves show a status. No rebuild/restart is required. Existing open tabs on another device load updated settings when refreshed or signed in again.

Upload primary/dark/login/business logos and a favicon separately. Preview updates only after successful validation. PNG/JPEG/WebP: at most 2 MiB, 8–4096 pixels per side, no more than 10 megapixels. SVG is rejected. Images are decoded and rewritten as PNG, stripping original metadata. Failed uploads preserve the active image. Remove returns that role to its fallback. Previously uploaded files are retained on disk for backup/recovery but unreferenced files cannot be fetched through the server.

All settings are owner-only. The public endpoint exposes only login identity/theme and public image paths, never password or database paths. The existing one-owner password model remains; anyone with this password has owner access.

Theme: light/dark/system; colors are centralized CSS tokens. Density, contrast, reduced motion and navigation collapse apply at runtime. The Menu toggle changes the current view; use Settings → collapsed to persist it. Widget lists specify visibility/order. Module visibility only changes navigation and does not grant or revoke permissions.

Regional settings: currency code/symbol, locale number formatting, grouping, display precision, timezone and date/time format. Currency code is locked after the first ledger or expense record; this application does not perform currency conversion. Money always uses two minor-unit digits in storage. Locale is a formatting preference; the interface is English only. No claim of a full Bangla translation is made.

Inventory settings: category suggestions, whole-quantity unit labels, default reorder level, optional/required code, list sorting/columns and text custom-field names. Edit an existing product to enter its custom fields and packaging unit. Creation also accepts a unit. Product categories remain free text with suggestions. Custom values are text, not executable formulas. Historical names/categories are snapshotted for new movements; old history can only inherit the name/category available during migration.

Payment-method settings record a method label. They do NOT record or prove settlement. Default notes and supplier selection are available on purchase/sale forms. Invoice/purchase prefixes affect future random unique references. Restore appearance changes nonfinancial appearance preferences only.

## Reports and daily workflows

- Reports: month/year picker, previous/next month, optional inclusive From/Through, product/category/type filters. Internally the end boundary is the next midnight, exclusive, in the business timezone. Offsets on old timestamps are honored. Comparison cards use full months only; arbitrary ranges do not show misleading month comparisons. Same-month-last-year comparison appears only if matching records exist.
- KPIs: gross sales, customer returns, net sales, purchases/supplier returns, COGS, gross profit/margin, distinct sales transactions, net units, average gross sale, recorded expenses, correction cost, operating result, current stock value and low-stock count.
- Charts: daily sales, 12-month sales/profit/purchase trends, product revenue/quantity, categories and margin. The 12-month context ends in the selected month and is labeled separately from the custom range. Numeric source tables are available.
- Detail selector: daily/monthly summaries, product/category performance, current valuation, low stock, movements/returns/adjustments, expenses, expense categories and products with no net sales in the selected period. These are period-specific observations, not predictions of slow demand.
- Tables support search, sorting and pages of 25. CSV exports use the report filters and full selected dataset, not only the displayed page or table-search subset. CSV money is explicitly integer minor units. Potential spreadsheet formulas in text are escaped. Print exports the entire selected detail dataset plus KPIs/charts; browser Save as PDF may be available. There is no dedicated PDF renderer.
- Historical reports use recorded unit prices and costs, never today's selling price. Purchases use actual unit_price/actual_unit_cost, not recalculated average inventory cost. Sales use the cost basis recorded when sold. Gross sales already reflect any manually lowered sale price; separate discounts are not tracked.
- Current valuation is explicitly current. Historical month-end valuation and inventory trend charts are not fabricated. General business expenses are excluded from product/category/type slices because overhead is not allocated.
- Inventory → Edit changes name, unique code, category, selling price, reorder level, unit and custom fields. It cannot rewrite stock/history. Use Purchase stock for receipts.
- Suppliers: add and view supplier contacts; select a supplier on a purchase.
- Transactions → Returns / stock adjustment: choose kind and product, whole quantity and required reason. Returns also require the original ledger line ID, shown in Transactions/Reports. Partial returns cannot exceed the original quantity less earlier returns. Supplier returns require sufficient stock. Adjust out records damage/expiry/loss in the reason; Adjust in requires a unit cost.
- Stock changes are atomic and serialized with SQLite BEGIN IMMEDIATE. Failed multiline transactions roll back. Corrections create new ledger entries; old movements are not deleted.
- Click a transaction reference for its printable invoice/receipt. Runtime company/logo/header/footer apply. Metadata captures method label, note and supplier ID, without inferring money collected.
- Expenses: record date/category/positive amount/payment label/description/payee. Expense records are immutable in this release. Correct an entry only after a database backup and deliberate administrative repair; there is no expense-delete shortcut.
- Photo scanner remains local photo → crop → preview → decode → use value. No continuous video/upload was added. Catalog lookup still needs internet and only sends the barcode. No live catalog or physical camera verification was performed for this upgrade.

## Backup and recovery

Use **Download full backup** to get a consistent database plus uploaded branding images. **Download backup** retains the old database-only SQLite export. Protect these files: they include the password hash, business records and settings.

Equivalent PowerShell backup command (works while the server runs):

```powershell
.\.venv\Scripts\python.exe .\backup_database.py --db .\data\inventory.sqlite3 --output .\backup_2026-10-21.zip
```

The output must not already exist. Copy backups to another drive. To restore a full backup, stop the server first. Preserve the complete old data folder, including WAL sidecars, then extract the backup into a NEW empty folder and copy the consistent database and assets:

```powershell
# Stop server first with Ctrl+C.
Rename-Item .\data .\data_before_restore_2026-10-21
Expand-Archive .\backup_2026-10-21.zip .\restore_2026-10-21
New-Item -ItemType Directory .\data
Copy-Item .\restore_2026-10-21\inventory.sqlite3 .\data\inventory.sqlite3
# If the backup includes logos:
if (Test-Path .\restore_2026-10-21\inventory.sqlite3.assets) {
  Copy-Item .\restore_2026-10-21\inventory.sqlite3.assets .\data\inventory.sqlite3.assets -Recurse
}
.\.venv\Scripts\python.exe .\server.py
```

Use fresh names if any of these destination folders already exist. This procedure keeps old WAL/SHM files out of the restored database. For custom `--db`, the assets directory must be named `<full database filename>.assets` alongside it.

Schema rollback: automatic downgrade is unsupported. Stop the server, preserve the migrated DB and assets, restore the original source version and its pre-v1 database backup into a new data folder. Changes recorded AFTER that backup will not appear in the restored DB; export/reconcile them before rollback. Never run old software against the upgraded database and assume corrections are understood.

Password reset, after stopping server:

```powershell
.\.venv\Scripts\python.exe .\reset_password.py --db .\data\inventory.sqlite3
```

Sessions expire after eight hours, logout invalidates the session and server restart clears sessions. Login is throttled after ten failed attempts per client IP in five minutes. JSON writes check Origin and require application/json. Use the server on a trusted private network, not a public internet port. HTTPS remains available with `--cert` and `--key`; phone file-capture behavior depends on browser/device.

## Development verification

```powershell
.\.venv\Scripts\python.exe -m unittest discover -v
npm ci
npm run lint
```

Python tests use temporary databases. Optional DOM integration test: install jsdom in a separate test environment or with `npm install --no-save jsdom`, point `TEST_URL` and `TEST_PASSWORD` at a disposable test database/server, then run `node test_frontend.cjs`. It records expenses/suppliers/purchases/sales and changes branding; never use it against real records. DOM tests do not replace visual browser/camera/printing checks.

See IMPLEMENTATION_PLAN.md for architecture and CHANGELOG.md for completed/partial/deferred items and executed test results.
