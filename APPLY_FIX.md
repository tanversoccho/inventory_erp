# Windows SQLite cleanup fix

Stop the ERP server. Copy the SIX .py files from this folder into your existing inventory_erp directory, replacing the four matching source/test files and adding db_connection.py and test_connection_cleanup.py. Keep your .git, data, .venv and other files. No database migration or deletion is required.

Alternatively apply windows_db_cleanup.patch against the delivered upgrade, using git apply --check first. Use only ONE method.

Then run:

```powershell
Set-Location 'E:\New folder\inventory_erp'
.\.venv\Scripts\python.exe -m unittest discover -v
```

If successful, start server.py normally.

Cause: sqlite3.Connection context management settles transactions but leaves the connection open. Windows retains file locks and newer Python reports ResourceWarning. ManagedConnection now commits/rolls back and closes in finally. Backup and raw-test connections also close deterministically. Readonly backup paths use Path.as_uri for safe Windows/path escaping.

Executed verification: 28 tests passed on Linux. All 2,296 connections opened during the test run were retained and checked: zero remained open. Three regression cases cover success, exceptions and commit failure. Patch application verified. Native Windows/Python 3.14 execution remains for your device; the fix does not hide warnings or suppress cleanup errors. No real business database was accessed.
