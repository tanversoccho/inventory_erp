# Barcode lookup and customer list

Apply this patch AFTER inventory_partial_payments_20261025.patch. Stop the server first. No database reset or new migration is needed.

## Product lookup
- Photo scan still looks up a code automatically when you choose Use code.
- Add product now also looks up typed/pasted/keyboard-scanner codes automatically after a short pause. Enter starts lookup immediately instead of submitting the form.
- Matching online catalog entries fill product name and category. Confirm suggestions before saving. Selling price, cost, quantity and vendor/customer data remain your responsibility.
- EAN/UPC numeric codes (8, 12, 13 or 14 digits) use existing Open Food Facts and UPCitemdb catalog integrations. The laptop running Python needs internet. Coverage, uptime and trial limits depend on the providers.
- GS1 Digital Link paths containing /01/ followed by a 14-digit GTIN are supported without visiting the scanned URL.
- A generic QR website link, such as https://qrco.de/bcgT17, is not a retail barcode. Scan the striped barcode or type the digits below it. Alternatively register that QR value manually; future scans find the locally saved product. Arbitrary QR websites are not scraped.
- Newer scans supersede pending lookups. Text edited while a request is pending is preserved.

## Customers
Open Customers in the navigation. View saved name, phone, address, invoice count, confirmed outstanding amount, refund due and unconfirmed invoice count. Search by name, phone or address. Add customers here or from a sale. View statement opens the existing printable invoice/payment statement. Contacts without invoices are included. Historical balances remain excluded until verified.

## Verification
55 Python tests; ESLint; DOM/HTTP integration for automatic name/category fill, customer list/search/statement, and existing payment workflows. Online catalogs are mocked in automated tests; live availability and coverage for your specific barcode are not guaranteed. No physical scanner or phone-camera test was performed.
