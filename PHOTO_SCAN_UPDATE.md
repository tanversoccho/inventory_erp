# Enhanced photo barcode scanning

Apply after inventory_phone_scanner_sync_20261026.patch. No database changes, reset or new runtime dependencies. Existing barcode lookup and phone pairing work as before.

## Use
Stop/restart the server; refresh the laptop with Ctrl+F5, then reload/reopen the paired phone page. A server restart requires pairing the phone again. Take a focused photo, select the complete barcode with a little clear border, then press Scan barcode. Enhancements are automatic. The progress text shows which attempt is running. Stop scanning stops after the current decoder attempt and keeps the original photo/crop. On success, review the decoded value and press Use decoded value; paired phones send it to the laptop as before.

## Changes
- Color image at different sizes; small images can be enlarged up to 2x, and oversized images are reduced.
- Grayscale and histogram contrast stretching.
- Estimated orientation correction using image gradients, plus retries at +/-3, +/-6, +/-12, 90 and 180 degrees.
- Light sharpening, Otsu black/white thresholding, adaptive local thresholding for uneven illumination and inverted contrast.
- White padding is added after filtering; rotations do not clip the image corners. Rotated working images are limited to about 1800 pixels per side to limit memory use. The source canvas is never changed.
- The bundled software decoder's existing TRY_HARDER hint is enabled so it samples more thoroughly.
- Maximum 20 planned variants (duplicates skipped). A 20-second budget is checked between attempts. One attempt can take longer on slower devices; Stop is also checked between attempts, and a result arriving after Stop is ignored. No live video mode is added.
- Processing stays on the scanning device. No photos are uploaded for enhancement, and the process does not guess printed digits with OCR. Only a successfully decoded value proceeds to the existing confirmation workflow.

## Limits
Filters cannot reconstruct missing/cut-off bars, severe blur, glare, strongly wrinkled packaging or extreme perspective. Flatten the packet, hold the camera straight, tap to focus and use good light. Try a tighter crop that includes the entire barcode and its clear border. Enter printed digits manually when needed. Product details still depend on online catalog coverage or your local products.

## Verification
62 Python tests passed. ESLint, vendor syntax and the independent phone/laptop DOM/HTTP regression passed. Tests with the actual bundled software decoder recovered generated vertical and inverted EAN-13 samples that raw decoding missed; clean, tilted, low-contrast, Code128 and QR samples also passed. Checks cover source preservation, cancellation, time budget, blank rejection and bounded attempt counts. The compressed barcode crop from the supplied screenshot did NOT decode; this is a documented limitation, not a successful recovery. The full original camera image was unavailable. Physical camera and phone-performance checks were not performed.

Optional image regression (development only): install jsdom, @napi-rs/canvas and jsbarcode in your test environment, then run node test_photo_decoder.cjs. Pass a local path to the supplied second screenshot as an optional diagnostic argument. These tools are not needed to run the ERP.
