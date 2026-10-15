# Online product autofill and photo decoding retries

Apply this patch AFTER photo_crop_scanner.patch. It targets the exact photo-crop version supplied earlier, not bare ERP v2. Back up your application files and stop the server first. No database/schema/venv changes are made; no new pip packages are required.

Save online_product_lookup.patch inside E:\New folder\inventory_erp, then run PowerShell:
```powershell
Set-Location 'E:\New folder\inventory_erp'
git apply --check .\online_product_lookup.patch
```
If the check passes:
```powershell
git apply .\online_product_lookup.patch
.\.venv\Scripts\python.exe .\server.py
```
If check fails, stop and check which earlier patch/version is installed. Do not force application. Hard-refresh browser with Ctrl+F5 after restarting; reload phone too.

## Try your sample without a photo
1. Inventory → Add product.
2. Type 840205744336 into the optional barcode field.
3. Click Look up product online.
4. The name/category should populate if the online catalog remains reachable and contains the record. At development time, the live Open Food Facts response returned “Mr noodles ramen hot chicken 85g” and category “Instant noodles”.
5. Review the source/details, enter your selling price, purchase cost and quantity, then Save product.

After it is saved, scanning or typing this barcode in Purchase stock/New sale finds your own database record and fills the product name. Equivalent leading-zero UPC/EAN representations are matched for numeric codes of 12–14 digits.

## Scan workflow
Take photo → crop → preview → Scan barcode → Use decoded value.
The decoder tries the original full-resolution crop, a bounded smaller version where useful, and 90°/270° rotations. It cannot recover details lost to blur/glare. Leave a clear white margin around the entire code. Retake the label straight-on with focus locked and good light when needed.

Use decoded value first checks your saved products. An unknown code in purchase/sale opens Add product and tries online lookup. In Add product an unknown decoded code triggers online lookup in the existing form. All returned fields are editable. A barcode lookup does not save a product or transaction by itself. Starting stock entered in Add product is still recorded as a purchase under the original workflow; add it to your pending sale after registration.

## Data and limits
Photo cropping/decoding remains local in the browser. Only the barcode number is sent by the laptop server to Open Food Facts, then UPCitemdb's trial endpoint if necessary. The laptop needs internet; photos and business quantities/prices are not sent to these catalogs. No AI guesses or unrestricted web searches are used. Community catalog coverage varies; especially local products may be absent. Availability/rate limits depend on the providers. Service timeouts and no-match results are shown as distinct messages; manual entry remains available. A short in-memory cache reduces repeat requests and clears when the server restarts.

Online lookup supports numeric retail codes of 8, 12, 13 or 14 digits. Arbitrary QR text/URLs still match exact local records but are not followed as websites or used for online retail catalog lookup. Returned names/categories may need correction. Prices, purchase costs and quantities are never inferred from online catalogs.

Attribution is displayed with returned results: Open Food Facts (https://world.openfoodfacts.org, Open Database License/ODbL); UPCitemdb (https://www.upcitemdb.com, trial service terms/limits apply). Preserve source attribution when reusing/exporting catalog-derived content. This update does not turn public catalog records into verified manufacturer data.

## Checks
12 Python tests passed, including food lookup, general-catalog fallback, no match, timeouts, cache reuse, rejection of URL fetching, and existing stock/cost tests. JavaScript syntax checks passed. The sample code was queried against the live Open Food Facts API successfully during development. Physical mobile/photo-decoder performance is unverified; failed photos may still need retaking or typed numbers.

Undo with `git apply -R --check .\online_product_lookup.patch` followed by `git apply -R .\online_product_lookup.patch`, then restart and refresh. Reverse only after checking for later modifications.
