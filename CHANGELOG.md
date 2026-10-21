# Upgrade delivery status

## Completed

- Existing application extended; baseline-relative patch and full source delivered. Existing scanner, lookup, manual entry, carts, SQLite backup and password retained.
- Additive versioned migration (user_version=1 and migrations record), automatic legacy backup, transactional schema update, repeated-start safety and recovery instructions. No real database touched.
- Central settings, public login configuration subset and owner-only settings/assets/admin/report routes.
- Runtime app/short name, logos (primary/dark/login/business/favicon), welcome, metadata, company/contact/tax-ID text, invoice/report headers/footers. Logos are validated/re-encoded; failed uploads leave previous image intact.
- Light/dark/system appearance, primary/accent tokens, density, collapsed nav, contrast/reduced motion, dashboard widget order/visibility, optional module visibility, number/currency/date/time display, configured timezone, category/unit/custom-field preferences, table columns/sort, method/note/reference-prefix preferences.
- Monthly/custom range reporting, whole-month comparisons, conditional year-over-year, distinct transaction counts, historical cost basis, filtered exports, charts/detail tables, full selected-table print output, explicit current valuation and unallocated expense handling.
- Product edits; supplier registration/purchase links; expense recording/category breakdown; printable invoices; partial sale/purchase returns; reasoned stock corrections; new movement snapshots and actual purchase-cost field.
- Expiring sessions, failed-login throttling, JSON content-type/origin checks, protected private settings, generated image filenames, authenticated backups.
- Separate reproducible twelve-month demo, integrity/stock/return reconciliation, two independently verified monthly totals, empty SQL schema and full DB+asset backup utility.

## Partially supported / explicit boundaries

- Inventory fields: text custom fields through product editing; categories are suggestions; unit names/packaging labels use existing whole-unit quantities. New products accept unit labels; advanced custom-field value entry is through Edit.
- Profitability: gross profit less recorded expenses and inventory correction costs is a management operating result. It excludes tax and unmodeled expenses; not audited net profit.
- Payment labels are metadata only. Cash collected, receivables/payables and settlement balances are not inferred.
- Print-friendly HTML and browser printing supported; dedicated PDF generation not added. Actual print rendering requires a device check.
- Report CSV includes business/report text branding and filter/currency metadata. Raster logos do not embed into CSV.
- English interface only; locale changes number/date formatting, not translated interface text.
- Legacy movement names/categories are snapshotted from the available product record during migration; unknown past edits cannot be recovered.
- All data accessible to the one authenticated owner; no per-user roles. Hidden modules remain authorized owner endpoints.
- Current inventory valuation only. Month-end history/snapshots are not available. Trend context is a labeled 12 months ending in selected month.
- Table search/page state is a browsing aid; CSV/print use all records matching report filters, not just visible/search-matched rows.
- Other open devices see new configuration after refresh, not via realtime push.

## Deferred

Automatic tax rules and inclusive/exclusive tax accounting; separate discount/refund-payment/cancellation models; expense reversal workflow and attachments; supplier edit/delete; customer/supplier credit and cash-flow accounting; decimal quantities; expiry/batch entities; multi-owner roles; full translations; historical valuation snapshots; automated downgrade; invoice layout designer; native PDF export. No placeholders or fake results stand in for these features.

## Verification actually executed

- 25 Python unittest cases passed: original 12 regression cases plus 13 upgrade/HTTP cases. Coverage includes fresh schema, legacy data/password preservation, backup/repeat migration, settings restart/public isolation, invalid settings, image content/dimensions/failure/removal, timezone month boundaries, empty periods/year boundary, distinct multiline counts, partial returns/over-return rejection, supplier returns, adjustments, expenses, product snapshots/custom fields, filtered CSV/formula escaping, simultaneous overselling, schema recreation, backup overwrite protection, reproducible demo reconciliation, HTTP authentication/logout/expiry/origin/content type and failed-login throttling.
- ESLint passed using the supplied configuration with both app.js and upgrade.js. Existing `find` function renamed to avoid a browser-global collision.
- Node syntax checks passed. jsdom integration against an actual temporary HTTP server passed: public/login branding, sign-in, report filters, runtime name/theme saves, expense/supplier saves, product/correction dialogs, real purchase and sale submissions, invoice dialog and retained photo scanner controls.
- Baseline-relative patch checked and applied in a fresh copy; resulting source bytes matched delivery source.
- Demo integrity/foreign keys/stock balances verified; August and September expected totals independently reconciled.
- Not run: graphical browser layout/real printer, mobile camera and actual printed barcode decoding; Chromium executable unavailable. No live external product-catalog requests were required by this upgrade. Existing catalog tests use mocks.

## Changed files and decisions

Modified: server.py, static/index.html, static/app.js, START_WINDOWS.bat, START_MAC_LINUX.sh, README.md, product_lookup.py (generic catalog user-agent), package.json, reset_password.py. Supplied eslint.config.mjs and package-lock.json preserved.

Added: erp_features.py, static/upgrade.js, static/upgrade.css, requirements.txt, create_sample_database.py, backup_database.py, schema.sql, test_upgrade.py, test_frontend.cjs, sample_12_months.sqlite3, sample_expected_totals.json, IMPLEMENTATION_PLAN.md, UPGRADE_GUIDE.md and CHANGELOG.md.

The main architecture is intentionally unchanged. Extension services keep migrations/settings/reports/corrections separate from existing request/transaction code. Pillow is the sole image-processing dependency; tzdata supplies portable timezone data. Financial storage stays two-digit integer minor units. Returns preserve original cost/price and reference an original line; outbound supplier stock uses current weighted-average cost with the refund difference recognized as correction cost. Logo storage is per database to isolate demo and business branding. Full backups include these assets.
