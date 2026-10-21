# Implementation plan and baseline review

Baseline: uploaded inventory_erp.zip, 21 October 2026. Python standard-library HTTP server; plain browser JavaScript/CSS; SQLite products, movements and settings. Bundled html5-qrcode; online lookup uses fixed catalog URLs. No real database was supplied or used.

1. Preserve existing scanner, product creation, transaction and login workflows. Extend server through erp_features.py; no framework replacement.
2. Add versioned, transactional, additive migration with SQLite backup and user_version. Retain password, stock, codes and historical movement values. Add line snapshots and actual purchase-cost field; legacy purchase cost comes from unit_price, never from historical average cost.
3. Add typed centralized settings, safe public subset, owner-only mutations, persisted assets validated/re-encoded with Pillow. Reject SVG. Introduce bounded sessions and login throttling.
4. Add timezone-aware half-open reports using movement-time prices/costs and distinct references; reusable report data feeds tables, charts, print and CSV. Keep current valuation explicitly current. Add expenses separately from purchases, never infer payment collection.
5. Add product editing, suppliers, transaction notes/payment metadata, original-line-linked partial returns and reasoned stock adjustments. Preserve ledger and use BEGIN IMMEDIATE. Whole-unit quantities remain an explicit constraint.
6. Extend existing navigation with Reports, Expenses, Suppliers and Settings; apply tokens at runtime; searchable paginated detail tables and printable invoices. Preserve the crop scanner intact.
7. Seed a separate reproducible 12-month demo, validate stock/foreign keys and two independent expected monthly totals. Export empty schema. Test migration, HTTP endpoints, settings, uploads, report boundaries, financial and correction behavior.
8. Deliver full source and baseline-relative patch, demo and operating/recovery instructions. No production data, caches, venv or node_modules in deliverables.

## Findings and decisions
- Existing purchase unit_cost is average after receiving. Keep legacy values unchanged; add actual_unit_cost on purchase lines using unit_price.
- Monetary storage remains integer minor units with two digits. Locale precision is display-only. Currency changes after ledger/expenses exist are rejected: this is a single-currency ledger, no conversion.
- Existing single owner password is the authorization model. No role UI or invented multi-user permissions.
- Existing history names/categories reflect current products. New lines record snapshots; migration can only snapshot the current legacy name/category, not recover unknown historical names.
- Existing date strings carry offsets; parse timestamps before comparisons instead of lexical SQL date comparisons. Naive legacy timestamps use configured business zone.
- No stock history snapshots exist. Do not claim historical valuation or cash collected. Report operating result is gross profit less recorded expenses/stock write-offs; it is not audited net profit.
- All mutation JSON routes require application/json and same-origin requests; no CORS. Assets and public settings expose no credentials. Uploaded SVG is deliberately unsupported.
