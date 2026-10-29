# Database module reference (non-breaking organization)

This folder groups **unchanged reference copies** of the project's existing database code by responsibility. No existing project code, imports, command paths or runtime behavior was modified.

- `schema/schema.sql`: SQL table definitions reference
- `connections/db_connection.py`: managed SQLite connection
- `migrations/erp_features.py`: feature tables and migration routines
- `migrations/reliability.py`: reliability, audit and related database operations
- `payments/payments.py`: payment tables, balances and settlement logic
- `maintenance/backup_database.py`: database backup utility
- `fixtures/create_sample_database.py`: demo database generator

**IMPORTANT:** The application continues to execute the original Python files in the project root. These are read-only reference copies, not an independently runnable package. The project also creates its initial tables inline in `server.py` (`initialize()`); that code is deliberately left untouched to avoid breaking imports and startup. The application database is still at `data/inventory.sqlite3` by default; the bundled demo remains at `demo/sample_12_months.sqlite3`.

To actually move execution into this folder, code import/path changes and full regression testing would be required. This was intentionally not done because the request was to make no code modifications.
