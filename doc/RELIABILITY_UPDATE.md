# Reliability patch — 23 October 2026

Built against the exact `inventory_erp_snapshot.zip` uploaded on 23 October, Git archive comment `093f26120bdf9dd3d56b9aaa193c38fb5c0e8294`. Includes all six review fixes and the five suggested next steps: correct startup order, transaction draft preservation, applied-filter exports, durable transaction retry handling, historical product names in exports, bundled demo, regression tests, history pagination, expense reversals and npm start.

## Apply to your existing Git repository

Stop the server (Ctrl+C). Keep your current repository; do not replace or delete `.git`, `data` or `.venv`. Save the downloaded patch in Downloads. If Downloads is elsewhere, adjust the path below.

```powershell
Set-Location 'E:\New folder\inventory_erp'
git status
# Save current source changes, if any:
git add .
git commit -m "Save current state before reliability fixes"
# If Git says nothing to commit, continue.
git switch -c fix/reliability-20261023
$patch = Join-Path $env:USERPROFILE 'Downloads\inventory_reliability_20261023.patch'
git apply --check "$patch"
```

ONLY if the check succeeds:

```powershell
git apply "$patch"
.\.venv\Scripts\python.exe -m unittest discover -v
npm ci
npm run lint
.\.venv\Scripts\python.exe server.py
```

Open http://localhost:8000 and press Ctrl+F5. Keep your existing Python dependencies/venv. No new runtime Python packages are required. `npm start` also starts Python if `python` is on PATH. Node remains development/convenience tooling.

If `git apply --check` fails, it changes nothing: stop and share the exact error. Do not use `--reject` or apply only part of this patch; frontend and backend changes belong together. The patch contains a binary synthetic demo database, which Git applies directly. It is not your production database.

First startup applies schema v2 after existing schema v1. It preserves products, passwords, settings, ledger, expenses, suppliers and branding references. Before v2, a sibling `*.pre-v2-<random>.backup` is created. The two new tables store retry receipts and expense reversals. Migrations are transactional and repeated startup is safe. Back up business data and logos using the existing full-backup function before upgrading.

After checking the UI and your records:

```powershell
git add .
git commit -m "Fix ERP reliability, exports and expense corrections"
# Your existing primary branch is master:
git switch master
git merge fix/reliability-20261023
```

## Changes

- **Startup:** admin dialog elements are present before the blocking upgrade script runs. New parser-order regression test catches this failure even when a DOM test has pre-parsed the entire HTML.
- **Drafts:** supplier, note and payment method persist alongside the cart during navigation/refresh. Supplier requests are tied to their current DOM element; late requests cannot overwrite a replacement form. Drafts reset after successful submission. Drafts are in memory and do not survive closing/reloading the browser.
- **Retries:** each sale/purchase attempt gets a stable identifier. After a failed response, retrying the same unchanged cart reuses it. The database records the reference and payload fingerprint in the same stock transaction; simultaneous retries/restarts return the original reference. Reusing an ID for different data is rejected. Old scripts without a request_id remain compatible but do not receive retry protection. Reloading/closing the browser loses the pending in-memory identifier, so check Transactions before recreating an uncertain sale after reload.
- **Reports:** CSV requests use the filters of the last successfully displayed report. Editing filter fields without Apply does not change exports. Print already uses the displayed report. After Apply, both use the new period. Failed requests retain the last good report/export filters.
- **History:** `/api/state` returns only five recent movements for overview, plus database-wide totals. Transactions fetch pages from `/api/history`, with server-side search/sort and pages of 25. History CSV uses the same search/order and exports all matches; it preserves recorded product names and escapes spreadsheet formula prefixes. The complete CSV export is still assembled in memory, as are report datasets; very large exports/reports may benefit from future streaming/query aggregation.
- **Expense corrections:** Expenses → Reverse expense → date/reason → confirm. Original records remain. A separate unique negative expense entry affects the chosen correction date and category; it cannot precede the original expense date or be repeated. To fix an amount/category, reverse the mistaken record and then record its replacement. Reports and expense CSV include reversals. This is an accounting correction, not proof of cash reimbursement.
- **Demo:** tracked synthetic `demo/sample_12_months.sqlite3` covers October 2025–September 2026. No default password. Separate from `data/inventory.sqlite3`; ignored real business databases remain ignored. Start with `npm run demo` or `.\.venv\Scripts\python.exe run_demo.py`. The demo runner refuses to create an empty DB silently if the sample is missing. `npm run demo:seed` regenerates a new sample only if its target does not exist. Expected monthly totals remain in `sample_expected_totals.json`.
- **Schema:** schema.sql now recreates empty schema v2, including both migration records. Old v1 databases migrate automatically; no data reset is required.

## Verification

Executed here: 38 Python tests passed; ESLint passed for app.js/upgrade.js; Node syntax checks passed. DOM integration with an actual disposable HTTP fixture passed for startup, preserved transaction metadata, applied-filter CSV, remote pages, stable retry IDs and expense reversals. Python tests also exercise concurrent retries, stock rollback, durable receipts, v1-to-v2 preservation, expense reversal periods, search/export snapshots and existing scanner catalog mocks. Demo integrity, stock balances and monthly reconciliation verified.

`test_dom.cjs` requires optional jsdom. `test_browser.cjs` uses Playwright and a real browser page against a disposable fixture; it does not eval scripts after fully parsing the page. The native-browser test could not run in this environment because Chromium download returned an invalid/truncated archive. No native Windows or physical phone camera test is claimed.

Optional extra tests (Node 24):

```powershell
npm install --no-save jsdom
$env:PYTHON_EXECUTABLE = (Resolve-Path '.\.venv\Scripts\python.exe').Path
npm run test:dom
# To run the native browser test instead/in addition:
npm install --no-save playwright
npx playwright install chromium
npm run test:browser
```

Optional npm installs may update your working package-lock; review/revert only those optional dependency changes if they are not intended for commit. None is required for running the ERP. Both added integration tests start their own temporary database and never use business records. Existing test_frontend.cjs remains available for its manually supplied disposable fixture.

Rollback: stop server; preserve the upgraded DB/assets and any transactions recorded after upgrade. Restore the prior source plus the pre-v2 database backup into a new data folder, following UPGRADE_GUIDE.md recovery instructions. Automated schema downgrade is not implemented; do not simply switch old source against schema v2.
