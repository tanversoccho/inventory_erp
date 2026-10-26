# Phone scanner paired with laptop

Apply after inventory_barcode_customers_20261026.patch (and its prerequisite partial-payment patch). Stop/restart the Python server and refresh the laptop page with Ctrl+F5. No database migration, reset or npm install is needed for runtime. The online catalog timeout can remain at your working 20 seconds.

## Use
1. Keep the server running on the laptop. Sign in there. Connect the phone and laptop to the same Wi-Fi.
2. Click Pair phone scanner in the laptop header. Choose Add product, Sale or Purchase; click Create pairing QR.
3. Scan the displayed QR using the phone's normal camera app. Open the link. This opens a dedicated scanner page, with no ERP password required. Alternatively copy the displayed link to your phone. Pairing QR generation is local and makes no external request.
4. On the phone click Scan a barcode. Take/select a photo, crop, Scan barcode, then Use decoded value. The code is sent to the laptop automatically. You can also enter barcode digits on the phone and click Send to laptop.
5. The laptop selects the saved product or opens the new-product form and fetches matching online name/category suggestions. Keep the selected laptop form open. A scan waits if the laptop is hidden, busy or showing another dialog. Return to that form to receive it.
6. Review the fields on the laptop. For sales/purchases, add the item to the cart as usual. Enter any required quantity, price, cost and payment details there. Complete/save transactions on the laptop.
7. Click Ready for next scan on the laptop after finishing each item. This deliberate pause prevents the next phone scan from overwriting your current item. Ready reopens the selected form.
8. To change destination, use Pair phone scanner and create a new QR for the desired destination. To finish, use Disconnect scanner in that dialog.

## Behavior and limits
- This pairs barcode input to one particular laptop tab and target; it is not synchronization of unsaved forms between every browser.
- The phone uses the existing photo/crop decoder. This update does not add continuous live camera scanning or fix every blurry/tilted photograph. Photo capture works on the existing LAN HTTP setup without introducing a live-camera HTTPS requirement.
- Photo images remain on the phone. Only the decoded value is sent to the laptop server. Generic website QR values do not guarantee catalog details. Internet is required on the server laptop for online product lookup; saved products work locally.
- Name/category are filled if found. Your business prices, quantities, cost and payment data are not inferred or saved automatically.
- Keep the pairing link private. Its random token only permits barcode submission/status on that channel, not reading records or making transactions. One phone can claim a channel. The claim link expires after 10 minutes if unused; a claimed channel expires after 8 hours or when the laptop login expires/is signed out.
- Pairing is temporary memory. Restarting the server or refreshing the laptop requires pairing again. Refreshing the same phone tab retains its pairing for the life of that tab; a new phone tab may require a new QR.
- Unacknowledged scans stay pending while the server and login remain active. Resending the same attempt after a network error does not queue it twice. The server remembers the most recent 128 attempts per channel. Acknowledgment means the barcode reached the form, not that a product or transaction was saved.
- An inactive phone shows as disconnected after 15 seconds without a heartbeat. Reopening it on the same connection resumes the channel until expiry. The phone may need to remain in the foreground.
- If the phone cannot open the QR URL, use the LAN address printed by server.py and check your normal Windows private-network firewall access. A guest Wi-Fi network may prevent devices from communicating. Change Wi-Fi/IP: restart server and pair again.
- qrcode-generator 2.0.4 is bundled locally in static/pair-qr.js, under its MIT license in static/pair-qr.LICENSE. No CDN is used.

## Validation
62 Python tests passed, including scanner authentication, capability scope, phone binding, pending/ack flow, duplicate/concurrent retries, queue limits, disconnect and expired owner session. ESLint passed. A DOM/HTTP test with independent phone and laptop browser contexts checks pairing, QR creation, automatic catalog filling, receipt confirmation, pause/resume, revocation, sale selection and unchanged stock, plus existing payment/customer regression workflows. Automated catalog responses are mocked. Physical phone cameras, native Windows and actual Wi-Fi routing were not tested.

Run Python checks: .\.venv\Scripts\python.exe -m unittest discover -v
Run lint after installing existing development tools: npm run lint
Optional DOM test (requires jsdom in the development environment): node test_scanner_ui.cjs
