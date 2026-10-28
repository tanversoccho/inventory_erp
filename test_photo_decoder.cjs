/* Optional real software-decoder regression. Dev-only: jsdom, @napi-rs/canvas, jsbarcode. */
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { JSDOM } = require('jsdom'),
  { createCanvas, loadImage } = require('@napi-rs/canvas'),
  barcode = require('jsbarcode');
const dom = new JSDOM('<div id="reader"></div>', { runScripts: 'outside-only' }),
  w = dom.window;
w.eval(fs.readFileSync(path.join(__dirname, 'static/scanner.min.js'), 'utf8'));
const reader = new w.Html5Qrcode('reader', { useBarCodeDetectorIfSupported: false });
const originalCreate = w.document.createElement.bind(w.document);
w.document.createElement = (tag, ...args) =>
  tag === 'canvas' ? createCanvas(1, 1) : originalCreate(tag, ...args);
w.eval(fs.readFileSync(path.join(__dirname, 'static/photo-decoder.js'), 'utf8'));
const read = async (c) => (await reader.qrcode.decodeRobustlyAsync(c)).text;
const make = (angle = 0, contrast = 1, invert = false) => {
  const clean = createCanvas(1, 1);
  barcode(clean, '9415007013402', {
    format: 'EAN13',
    width: 3,
    height: 130,
    margin: 30,
    displayValue: true,
  });
  const rad = (angle * Math.PI) / 180,
    c = createCanvas(
      Math.ceil(
        Math.abs(clean.width * Math.cos(rad)) + Math.abs(clean.height * Math.sin(rad)) + 60,
      ),
      Math.ceil(
        Math.abs(clean.height * Math.cos(rad)) + Math.abs(clean.width * Math.sin(rad)) + 60,
      ),
    );
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(clean, -clean.width / 2, -clean.height / 2);
  ctx.resetTransform();
  const im = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < im.data.length; i += 4) {
    let v = Math.round(110 + im.data[i] * contrast);
    v = Math.min(255, v);
    if (invert) v = 255 - v;
    im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
  }
  ctx.putImageData(im, 0, 0);
  return c;
};
(async () => {
  const cases = [
    ['clean', make()],
    ['tilted', make(12)],
    ['vertical', make(90)],
    ['dim contrast', make(-7, 0.12)],
    ['inverted', make(0, 0.5, true)],
  ];
  if (process.argv[2]) {
    const image = await loadImage(process.argv[2]),
      c = createCanvas(382, 216);
    c.getContext('2d').drawImage(image, 79, 845, 382, 216, 0, 0, 382, 216);
    cases.push(['uploaded screenshot crop', c]);
  }
  let improved = 0;
  for (const [label, c] of cases) {
    const before = Buffer.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
    let raw = '';
    try {
      raw = await read(c);
    } catch {}
    let last = '';
    let value;
    try {
      value = await w.photoDecoder.decode(c, read, {
        progress: (name) => {
          last = name;
        },
        budgetMs: 30000,
      });
    } catch (e) {
      if (label === 'uploaded screenshot crop') {
        console.log(
          'LIMIT: compressed uploaded screenshot was not decoded; no incorrect result returned.',
        );
        continue;
      }
      throw e;
    }
    assert.equal(value, '9415007013402', label);
    assert.deepEqual(
      Buffer.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data),
      before,
      label + ' source unchanged',
    );
    if (raw !== value) improved++;
    console.log('PASS', label, 'raw=', raw || 'not decoded', 'enhanced=', value, 'via', last);
  }
  assert(improved > 0, 'At least one hard image must improve over raw decoding');
  let attempts = 0;
  await assert.rejects(
    w.photoDecoder.decode(
      make(),
      async () => {
        attempts++;
        throw Error('no code');
      },
      { cancelled: () => attempts >= 2 },
    ),
    /stopped/,
  );
  assert.equal(attempts, 2);
  const blank = createCanvas(300, 120);
  blank.getContext('2d').fillStyle = 'white';
  blank.getContext('2d').fillRect(0, 0, 300, 120);
  let count = 0;
  await assert.rejects(
    w.photoDecoder.decode(blank, async (c) => {
      count++;
      return read(c);
    }),
    /No readable/,
  );
  assert(count <= 20);

  let budgetCalls = 0;
  await assert.rejects(
    w.photoDecoder.decode(
      make(),
      async () => {
        budgetCalls++;
        await new Promise((r) => setTimeout(r, 10));
        throw Error('no match');
      },
      { budgetMs: 1 },
    ),
    /No readable/,
  );
  assert.equal(budgetCalls, 1);
  const code128 = createCanvas(1, 1);
  barcode(code128, 'ERP-TEST-123', { format: 'CODE128', height: 100, width: 3, margin: 30 });
  assert.equal(await w.photoDecoder.decode(code128, read), 'ERP-TEST-123');
  w.eval(fs.readFileSync(path.join(__dirname, 'static/pair-qr.js'), 'utf8'));
  const qr = w.qrcode(0, 'M');
  qr.addData('https://example.com/item');
  qr.make();
  const image = await loadImage(Buffer.from(qr.createSvgTag({ cellSize: 6, margin: 24 }))),
    qc = createCanvas(image.width, image.height);
  qc.getContext('2d').drawImage(image, 0, 0);
  assert.equal(await w.photoDecoder.decode(qc, read), 'https://example.com/item');
  console.log('PASS cancellation, time budget, bounded attempts, blank rejection, Code128 and QR');
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => dom.window.close());
