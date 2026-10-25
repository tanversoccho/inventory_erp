# Partial payments, credit sales and vendor dues — 25 October 2026

This patch matches the uploaded inventory_erp_current.zip. It adds customer/vendor settlement records to the existing Python/SQLite ERP. A payment does not create another sale/purchase, change quantities or recalculate gross profit.

## Apply the patch

Stop the running server with Ctrl+C. Download a full database/logo backup using the existing backup button, or run your backup_database.py utility before stopping. Keep your existing data folder and Git repository. Do not reset your database.

From PowerShell:

```powershell
Set-Location 'E:\New folder\inventory_erp'
git status
# Save any current source edits if needed:
git add .
git commit -m "Save current source before partial payments"
# If nothing needs committing, continue.
git switch -c feature/partial-payments
$patch = Join-Path $env:USERPROFILE 'Downloads\inventory_partial_payments_20261025.patch'
git apply --check "$patch"
```

Only after the check succeeds:

```powershell
git apply "$patch"
.\.venv\Scripts\python.exe -m unittest discover -v
npm run lint
.\.venv\Scripts\python.exe server.py
```

Open http://localhost:8000 and press Ctrl+F5. No additional runtime Python or npm packages are needed. If development dependencies are missing, run `npm ci` before linting. If the patch check fails, it has not changed your files: stop and share the exact error. Do not apply only selected portions of this patch.

First startup migrates schema v2 to v3. It creates a consistent sibling `inventory.sqlite3.pre-v3-<random>.backup` before the additive migration. Passwords, products, stock, purchases, sales, expenses, suppliers, settings and logos remain intact. Repeat startup does not repeat the migration. New schema.sql recreates an empty v3 database without real records.

## Buy from a vendor

Save the vendor in Suppliers first if the purchase will have a balance. Purchase stock → select products and quantities/costs → choose the vendor → choose one of:

- **Pay full amount now:** records the full purchase amount as paid.
- **Pay partial amount now:** enter the amount actually paid; the rest is payable.
- **No payment now / pay later:** records zero payment and the full amount payable.

Choose the payment method and optional due date. An outstanding balance requires a saved vendor. The purchase and its initial payment are saved atomically. Starting quantity entered directly while creating a product is opening inventory: its automatically generated purchase has an unconfirmed payment balance, since the application cannot assume how that opening stock was paid for. Use Purchase stock for normal new vendor purchases.

## Sell to a customer

New sale → select products → choose a saved customer or use **+ Add customer**. Choose full, partial or no payment, then optionally enter a due date. Customer name, phone and address can be saved. Fully paid walk-in sales may omit a customer; sales with a balance require one.

Example: invoice BDT 1,000, received BDT 300 → Partially paid, receivable BDT 700. Receiving another BDT 200 later leaves BDT 500. Receiving the final BDT 500 changes it to Paid. Those installments do not increase sales revenue or reduce stock again.

Payment controls, party selection, amount and due date survive navigating between pages while preparing the transaction. Like the existing cart, drafts are held in browser memory; reloading/closing the page clears them.

## Record a later installment

Open **Payments & dues**. Search/filter the invoice table and click its reference. The detail dialog shows original invoice, returns, net amount, net paid, balance, due date and payment history. Enter a positive installment, actual payment date, method and optional note, then confirm.

Each installment is tied to one invoice. Multiple installments are supported. Payments cannot exceed the remaining balance. Future-dated payments are rejected: use a due date for a promise to pay, and record payment only when it happens. Payment dates cannot precede the invoice date.

The server uses database transactions and durable request identifiers. Repeated or simultaneous retries of the same unchanged request return its original receipt without recording another payment. The UI preserves the identifier while retrying an unchanged form. After a browser reload or reopening a form following an uncertain response, check payment history before making another entry, because a newly created form has a new identifier.

Payment entries are permanent records in this release. Review the confirmation carefully; an arbitrary payment-entry reversal/edit feature is not included. The refund function below records legitimate refunds resulting from returns, not a way to silently rewrite a mistaken entry.

## Existing records and opening balances

The old application stored payment-method labels but did not reliably record money received/paid. Migration therefore marks existing purchase/sale invoices **Unconfirmed**. They are excluded from receivable/payable/refund totals, with a visible count on the dashboard and Payments page. Nothing is assumed paid or unpaid automatically.

Filter status → Unconfirmed → open an invoice → select the correct customer/vendor, enter the verified historical cumulative NET amount paid (after historical refunds), optional due date and a verification note. Confirm once. A fully settled historical invoice may have no party; an outstanding or refund balance requires one.

Confirmation establishes an opening balance, not a new cash transaction. Its amount is shown separately in the invoice/statement and excluded from dated cash-receipt/payment reports. New installments recorded after confirmation count as actual payment events on their recorded dates. Historical net paid cannot exceed the original invoice total; old overpayments/unapplied credit require separate reconciliation outside this limited invoice-payment model.

## Returns and refunds

Existing sale/purchase returns remain linked to original ledger lines. Their values automatically reduce the net invoice balance:

- An unpaid return first reduces the amount owed.
- A return after full/partial payment may leave **Refund due**.
- Open the original invoice in Payments & dues and record a customer refund or a vendor refund received, up to that credit balance.

Refund history is explicit; recording a return never fabricates a cash refund. Outstanding balances and refund balances are shown separately rather than netted across unrelated invoices.

## Statements, dashboard and reports

- Dashboard shows current receivables, payables, overdue balances, customer refunds owed, vendor refunds due and the count of unconfirmed invoices.
- Payments & dues supports invoice type/status/name/reference filters, searchable/sortable tables and CSV export. CSV exports the top-level invoice filters, not just the visible page or the table's secondary search box. Money in CSV is labeled as integer minor units (100 = 1 currency unit).
- Customer/vendor statements list assigned invoices, status, opening confirmations, payment receipts and current balances; they are printable with current business branding.
- Printed purchase/sale invoices show party, status, returns, net amount, net paid, outstanding balance and due date. The preferred/initial payment-method label alone is not proof of settlement.
- Whole-business Reports show customer receipts, vendor payments, customer refunds, vendor refunds received and net settlement cash for the selected dates, plus a settlement cash CSV button. These follow payment dates, not invoice dates. Opening confirmations are excluded. Product/category/type slices do not allocate invoice-level cash to individual products.
- Existing revenue/COGS/gross profit remain based on the transaction ledger. Credit sales still count as sales; their collection later is a payment only. Purchase spending remains different from cash paid. Expense entries remain in their separate module. The settlement-cash total is not complete cash flow or net profit.

One payment is allocated to one invoice. Customer/vendor deposits, cross-invoice allocations, interest, multi-currency settlement, external payment processing, user roles and a full general ledger are not implemented. All entry is by the existing authenticated owner. Multiple browser devices can record transactions; SQLite serializes payment/stock writes and validates the remaining balance inside the same transaction.

## Backup, recovery and verification

The existing full backup includes all payment/customer/account tables automatically. Protect backups as business data. To roll back, stop the server and preserve the upgraded database/assets, restore the matching pre-v3 database backup and previous source into a separate recovery folder, then reconcile transactions recorded after that backup. Simply switching source branches against schema v3 is not a schema downgrade.

Executed verification: 53 Python tests passed (38 prior regressions plus 15 settlement/HTTP cases), ESLint passed for all three frontend files, and Node syntax checks passed. Optional DOM/HTTP integration passed through customer creation, partial customer sale, unpaid vendor purchase, navigation/draft preservation, later installments, simulated lost-response retry, historical confirmation, statements, printable invoice balances and unchanged stock after payments. Unit tests cover full/partial/unpaid purchases and sales, invalid parties/amounts/dates, overpayment rollback, concurrent payments, retry durability, sale/vendor returns and refunds, migration preservation, cash periods, CSV and authentication.

To rerun optional DOM integration on your machine (requires Node and jsdom):

```powershell
npm install --no-save --package-lock=false jsdom
$env:PYTHON_EXECUTABLE = (Resolve-Path '.\.venv\Scripts\python.exe').Path
npm run test:payments-ui
```

This starts its own temporary fixture database and does not access business data. No graphical browser, physical printer, Windows-native runtime or phone camera verification is claimed for this patch.

## Source changes

Added payments.py, static/payments-ui.js, test_payments.py, test_payments_ui.cjs and this guide. Extended server.py, erp_features.py, reliability.py, static/app.js, static/upgrade.js, static/index.html, static/upgrade.css, schema.sql and package.json. Existing migration regression fixtures were advanced to v3. LAN startup URLs, scanner, lookup, manual inventory and unrelated workflows are preserved.
