# Photo crop scanner update (Soccho ERP v2)

This patch targets the exact Soccho_ERP_v2.zip source provided earlier. It changes only static/app.js, static/index.html and static/style.css, and adds this guide. Database files, Python server, venv, transactions and manual entry are unchanged.

## Apply on Windows with Git installed
1. Download photo_crop_scanner.patch into E:\New folder\inventory_erp.
2. Stop server with Ctrl+C. Keep a backup of the static folder before applying.
3. Open PowerShell and run:
```powershell
Set-Location 'E:\New folder\inventory_erp'
git apply --check .\photo_crop_scanner.patch
```
If this reports an error, stop: your files differ from the v2 baseline. Do not force the patch.
If the check passes:
```powershell
git apply .\photo_crop_scanner.patch
.\.venv\Scripts\python.exe .\server.py
```
Git does not require a Git repository to apply this patch. Install Git for Windows if the git command is not available.
4. Hard refresh the laptop browser with Ctrl+F5. On phone reload; clear the site's cached files if the old Live camera label persists.

## Use
- In Add product, Purchase stock or New sale choose Photo scan.
- Take photo / Retake opens an image file input requesting the rear camera on mobile. The browser/OS decides whether to offer camera, gallery, or both. Desktop can choose an existing photo.
- Drag to select a rectangle using a finger or mouse, or use Left/Right/Top/Bottom sliders. Include the entire code plus a clear margin. The dimmed region is excluded.
- Reset crop restores the full image. Preview crop shows only the selected pixels, at the original image resolution.
- Scan barcode decodes that crop locally with the existing bundled html5-qrcode library. No image or video is uploaded, and there is no live-video scan. A failed scan retains your photo and crop for adjustment and retry.
- On success, choose Use decoded value. It fills the existing code field and runs the existing product lookup/autofill. It does not save a transaction automatically.
- Unknown codes still follow the original manual product-registration behavior. A barcode alone cannot invent a product name. For a product created on another device, refresh the page first.

## Themes
The scanner's colors are CSS custom properties: --crop-bg, --crop-surface, --crop-fg, --crop-muted, --crop-accent, --crop-border, --crop-shade, --crop-error and --crop-success. Override these in a later stylesheet or :root declaration. The canvas reads shade/accent variables when redrawn. Existing ERP styling is preserved outside the scanner dialog.

This workflow uses phone photo capture instead of getUserMedia/live video; it does not require the previous live-video HTTPS setup for that API. File capture availability depends on the mobile browser/OS. Use HTTPS if transmitting passwords/business records across an untrusted network.

## Validation and limits
JavaScript syntax, simulated crop coordinate mapping, full-resolution export, failure retention, explicit-only decode, duplicate scan guard and decoded-value handoff were checked. Seven existing backend tests passed. Actual camera/gallery behavior and decoding your printed labels still need testing on your phone. Blurred, cropped-off, low-contrast or unsupported codes may not decode. Photos remain in browser memory while the page is open; reload clears them.

## Undo
Stop server, run `git apply -R --check .\photo_crop_scanner.patch`, then `git apply -R .\photo_crop_scanner.patch`, restart and hard-refresh. Avoid reversing after further edits without checking first.
