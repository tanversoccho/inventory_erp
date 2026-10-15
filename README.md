# Soccho Inventory & Sales ERP

A working local web application. One laptop runs a Python server and keeps a real SQLite database. Laptop and phone browsers share the same records. No cloud account or paid database required. This is an inventory and sales MVP, not a full accounting/payroll ERP.

## Start on Windows
1. Install Python 3.11 or newer from https://www.python.org/downloads/ if needed.
2. Extract the ZIP into a writable folder. Double-click START_WINDOWS.bat (or run `py -3 server.py`).
3. Create a password of at least 8 characters when prompted. The input is hidden as you type.
4. Open http://localhost:8000 on your laptop and sign in.

macOS/Linux: run `python3 server.py` in this folder.
No pip packages or internet connection are required after download. Keep the terminal running while using the app.

## Connect a phone
Connect the phone and laptop to the same private Wi-Fi. Find the laptop's IPv4 address with Windows `ipconfig` (for example 192.168.1.20). Open http://192.168.1.20:8000 on the phone. Allow Python through the firewall for private networks only if prompted. Guest Wi-Fi may block connections between devices.

Typing codes, choosing products and USB/Bluetooth keyboard scanners work over this connection. Scan a barcode into the code field and press Enter, then add the matched product to the transaction.

### Phone camera scanning: HTTPS setup
Modern mobile browsers require a secure context for live camera access. Ordinary HTTP on a laptop Wi-Fi address does not qualify. For reliable live scanning, use a locally trusted HTTPS certificate:
1. Install mkcert from its official project: https://github.com/FiloSottile/mkcert . Run `mkcert -install` on the laptop.
2. Generate a certificate covering your actual laptop IPv4 address and localhost: `mkcert -cert-file cert.pem -key-file key.pem localhost 127.0.0.1 192.168.1.20` (replace the example IP).
3. Find the certificate authority directory using `mkcert -CAROOT`. Transfer ONLY rootCA.pem to your phone and install/trust it as a certificate authority. On iOS, enable full trust under Certificate Trust Settings after installing the profile. On Android, install it as a CA certificate in device security settings. Never share rootCA-key.pem or key.pem.
4. Restart with `py -3 server.py --cert cert.pem --key key.pem` (macOS/Linux use python3). Open https://YOUR-LAPTOP-IP:8000 and allow camera permission.
5. Choose Scan. Barcode and QR decoding is bundled locally using html5-qrcode. A code photo upload is also available; browser/device photo capture behavior varies. Test your actual product label sizes and lighting.
If the laptop IP changes, regenerate its certificate. Reserve an IP in your router for convenience. Laptop must remain on; phone has no independent offline database.

## Use the app
1. Inventory → Add product. Scan or type a unique barcode/QR value; enter name, category, default selling price and low-stock threshold. Any QR payload is treated as the exact product code, not automatically parsed into fields.
2. Purchase stock → scan/select product → Add. Set quantity and actual unit purchase cost. Add multiple products; Save purchase. Repeat purchases recalculate weighted-average cost.
3. New sale → scan/select products → Add. Enter quantities and selling prices; Complete sale. Transactions are atomic and insufficient stock is rejected.
4. Overview shows all-time purchase spend, revenue, gross profit and current inventory value in BDT. Gross profit is sales less the weighted-average cost recorded when sold. It excludes operating expenses, tax and discounts not already reflected in the entered unit price.
5. Transactions shows every line and its transaction reference. Export CSV for reporting.

Quantities are whole units. Money is stored as integer paisa. No sample records are inserted. Records cannot be edited/deleted in this first version; returns, refunds, customer credit, VAT, invoices and multi-user roles are not implemented. Refresh a second device to see changes made elsewhere.

## Backup and restore
Use Download backup to obtain a consistent SQLite backup while the app runs. Keep copies on another drive. To restore, stop the server, preserve your existing data folder, then replace data/inventory.sqlite3 with the downloaded file. If any inventory.sqlite3-wal or inventory.sqlite3-shm files remain after shutdown, remove those old sidecars before starting the restored database. Password settings are included in backups. Do not overwrite an active database.

## Access and limits
All devices use one owner password. Restarting the server clears sessions. Use only on a trusted private network; do not forward this port to the internet. There is no brute-force rate limiter or user administration in this MVP. The password is hashed with scrypt and a random salt. To reset it, stop the server and run `python reset_password.py`, then restart. This preserves inventory and transactions.

## Verification
Run `python -m unittest -v test_server.py`. Automated tests cover weighted-average purchase costing, sales profit, overselling protection, transaction rollback and validation. Browser/camera tests on your physical laptop and phone are still required.

## Third-party software
static/scanner.min.js: html5-qrcode 2.3.8, Apache-2.0, copyright Minhaz A.V. and contributors. Project: https://github.com/mebjas/html5-qrcode . License and notices included in THIRD_PARTY.txt. The application uses Python's standard library.

## Version 2: manual inventory, name lookup and project venv

Stop the old server with Ctrl+C. Copy the updated application files into your existing inventory_erp folder. Keep your existing data folder: the update ZIP contains no database and no replacement data folder. Existing records/password remain compatible. Restart with START_WINDOWS.bat and hard-refresh the browser (Ctrl+F5).

START_WINDOWS.bat now creates .venv using your working `python` command and runs the app with .venv\Scripts\python.exe. The virtual environment is generated on your laptop, not shipped from another operating system. No pip dependencies are needed. If an existing .venv is broken, remove only .venv and run the launcher again. On macOS/Linux use `sh START_MAC_LINUX.sh`.

Manual PowerShell setup in your existing folder:
```powershell
Set-Location 'E:\New folder\inventory_erp'
python -m venv .venv
.\.venv\Scripts\python.exe .\server.py
```
No Activate.ps1 or PowerShell execution policy change is required.

Barcode/QR is now OPTIONAL. Add product accepts typed name, category, price, starting quantity and purchase cost. Leaving the code empty creates an internal AUTO- identifier; you do not have to print or scan it. Starting quantity is included in purchase spending and stock value.

Live camera buttons are available in Add product, Purchase stock and New sale. Scanning an existing code looks up the product in the database snapshot and fills its product-name field. Purchase/sale also selects that product for adding to the cart. If another device just added the product, refresh first. Unknown codes require you to type the name when creating the product; a barcode alone does not contain your product name. Scanning an already registered code in Add product shows its name and prevents duplicate creation; use Purchase stock to add its quantity. You can also type/select a saved name in purchase/sale without scanning.

Laptop live scanning: open http://localhost:8000 and allow camera permission. Phone live scanning: follow the trusted HTTPS instructions above. After certificate setup you may run `START_WINDOWS.bat --cert cert.pem --key key.pem`.
