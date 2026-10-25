const $ = (s) => document.querySelector(s),
  esc = (v) =>
  String(v).replace(
    /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
let scanBusy = false;
let transactionBusy = false;
let productBusy = false;
const pendingRequests = { purchase: null, sale: null };
let state,
  page = 'dashboard',
  carts = { purchase: [], sale: [] },
  scanner,
  scanTarget;
const cash = (n) => window.erp ? window.erp.money(n) : (n / 100).toFixed(2);
async function api(path, data) {
  const r = await fetch(
    '/api/' + path,
    data
    ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }
    : {},
  );
  const v = await r.json();
  if (!r.ok) throw Error(v.error || 'Request failed');
  return v;
}
function notice(msg, error = false) {
  $('#notice').hidden = false;
  $('#notice').textContent = msg;
  $('#notice').className = error ? 'error' : '';
}
async function refresh() {
  if (window.erp) window.erp.captureDrafts();
  state = await api('state');
  if (window.erp) await window.erp.load();
  $('#login').hidden = true;
  $('#workspace').hidden = false;
  render();
  if (window.erp) window.erp.afterRender(state, page);
}
function go(p) {
  if (window.erp) window.erp.captureDrafts();
  page = p;
  document.querySelectorAll('.page').forEach((e) => (e.hidden = e.id !== p));
  document
    .querySelectorAll('nav button')
    .forEach((e) => e.classList.toggle('active', e.dataset.page === p));
  $('#pageTitle').textContent = {
    dashboard: 'Overview',
    inventory: 'Inventory',
    purchase: 'Purchase stock',
    sale: 'New sale',
    history: 'Transactions',
    payments: 'Payments & dues', reports: 'Reports & analytics', expenses: 'Expenses', suppliers: 'Suppliers', settings: 'Settings',
  }[p];
  render();
  if (window.erp) window.erp.afterRender(state, page);
}
function activity(rows) {
  return rows.length
    ? rows
    .map(
      (r) =>
      `<div class="activity"><div><b>${esc(r.name)}</b><small>${esc(r.kind)} · ${r.quantity} units · ${esc(r.created.slice(0, 10))}</small></div><b>${cash(r.quantity * r.unit_price)}</b></div>`,
    )
    .join('')
    : '<div class="empty">No transactions yet. Add a product and record your first purchase.</div>';
}
function render() {
  const t = state.totals;
  $('#metrics').innerHTML = [
    ['Net purchase spending', t.purchases, 'Purchases less supplier returns'],
    ['Sales revenue', t.sales, 'Sales less recorded customer returns'],
    ['Gross profit', t.profit, 'Revenue minus cost of goods sold'],
    ['Stock value', t.stock, 'At weighted-average cost'],
  ]
    .map(
      (a) =>
      `<article class="metric"><small>${a[0]}</small><strong>${cash(a[1])}</strong><p>${a[2]}</p></article>`,
    )
    .join('');
  $('#recent').innerHTML = activity(state.history.slice(0, 5));
  const low = state.products.filter((p) => p.stock <= p.minimum);
  $('#alerts').innerHTML = low.length
    ? low
    .map(
      (p) =>
      `<div class="activity"><div><b>${esc(p.name)}</b><small>${esc(p.code)}</small></div><span class="badge low">${p.stock} left</span></div>`,
    )
    .join('')
    : '<div class="empty">All products are above their stock alerts.</div>';
  renderProducts();
  $('#ledger').innerHTML =
    state.history
    .map(
      (r) =>
      `<tr><td>${esc(r.created.replace('T', ' ').slice(0, 19))}<small>${esc(r.reference)}</small></td><td><span class="badge ${r.kind === 'purchase' ? 'low' : ''}">${r.kind}</span></td><td>${esc(r.name)}<small>${esc(r.code)}</small></td><td>${r.quantity}</td><td>${cash(r.unit_price)}</td><td>${cash(r.quantity * r.unit_price)}</td></tr>`,
    )
    .join('') || '<tr><td colspan="6">No transactions recorded.</td></tr>';
  for (const kind of ['purchase', 'sale']) renderTransaction(kind);
}
function renderProducts() {
  let q = $('#search').value.toLowerCase();
  $('#products').innerHTML =
    state.products
    .filter((p) => (p.name + ' ' + p.code + ' ' + p.category).toLowerCase().includes(q))
    .map(
      (p) =>
      `<tr><td><b>${esc(p.name)}</b><small>${esc(p.code)}</small></td><td>${esc(p.category) || '—'}</td><td>${p.stock}</td><td>${cash(p.cost)}</td><td>${cash(p.price)}</td><td><span class="badge ${p.stock <= p.minimum ? 'low' : ''}">${p.stock <= p.minimum ? 'Low stock' : 'In stock'}</span></td></tr>`,
    )
    .join('') ||
    '<tr><td colspan="6">No products found. Add your first product to begin.</td></tr>';
}
function renderTransaction(kind) {
  const sale = kind === 'sale';
  $('#' + kind).innerHTML =
    `<div class="transaction-grid"><article class="panel"><h2>${sale ? 'Build a sale' : 'Receive stock'}</h2><p class="muted">Scan a code, type it, or select an existing product.</p><label>Barcode / QR code<div class="inline"><input id="${kind}Code" placeholder="Scan or enter code"><button type="button" data-scan="${kind}">Photo scan</button></div></label><button class="text" data-find="${kind}">Find product →</button><label>Product name<input id="${kind}Name" list="${kind}Names" placeholder="Type a saved product name"><datalist id="${kind}Names">${state.products.map((p) => `<option value="${esc(p.name)}"></option>`).join('')}</datalist></label><label>Choose product<select id="${kind}Select"><option value="">Choose product</option>${state.products.map((p) => `<option value="${p.id}">${esc(p.name)} · ${esc(p.code)} (${p.stock} available)</option>`).join('')}</select></label><button data-add="${kind}">+ Add to ${sale ? 'sale' : 'purchase'}</button></article><article class="panel"><h2>${sale ? 'Sale summary' : 'Purchase summary'}</h2><div id="${kind}Cart"></div><div class="total" id="${kind}Total"></div><button data-save="${kind}">${sale ? 'Complete sale' : 'Save purchase'}</button><p class="muted">${sale ? 'Stock reduces only when the sale is completed.' : 'Enter the actual unit purchase cost for each item.'}</p></article></div>`;
  renderCart(kind);
}
function renderCart(kind) {
  $('#' + kind + 'Cart').innerHTML =
    carts[kind]
    .map(
      (item, i) =>
      `<div class="cart-row"><div class="section-head"><b>${esc(state.products.find((p) => p.id === item.id).name)}</b><button class="text" data-remove="${kind}:${i}">Remove</button></div><div class="two"><label>Quantity<input type="number" min="1" step="1" value="${item.quantity}" data-edit="${kind}:${i}:quantity"></label><label>Unit ${kind === 'sale' ? 'selling price' : 'purchase cost'} (BDT)<input type="number" min="0" step="0.01" value="${item.price}" data-edit="${kind}:${i}:price"></label></div></div>`,
    )
    .join('') || '<p class="empty">Your list is empty.</p>';
  updateTotal(kind);
}
function updateTotal(kind) {
  const total = carts[kind].reduce((sum, item) => sum + Math.round(Number(item.price) * 100) * Number(item.quantity), 0);
  $('#' + kind + 'Total').textContent = cash(total);
  window.paymentUI?.update(kind, total);
}
function barcodeKey(code) {
  const s = String(code).trim();
  return /^\d{12,14}$/.test(s) ? s.replace(/^0+/, '') : s;
}
function localProduct(code) {
  return state.products.find((p) => barcodeKey(p.code) === barcodeKey(code));
}
async function findProduct(kind) {
  const code = $('#' + kind + 'Code').value.trim(),
    p = localProduct(code);
  if (!code) {
    notice('Enter or scan a barcode first.', true);
    return;
  }
  if (p) {
    $('#' + kind + 'Select').value = p.id;
    $('#' + kind + 'Name').value = p.name;
    notice('Found: ' + p.name);
    return;
  }
  $('#' + kind + 'Select').value = '';
  $('#' + kind + 'Name').value = '';
  openNewProduct(code);
  await fetchProductOnline(code);
}
function openScan(target) {
  scanTarget = target;
  scanBusy = false;
  $('#scanDialog').showModal();
  setCropBusy(false);
  cropMessage(
    cropPhoto
    ? 'Photo retained. Adjust the selection or take another photo.'
    : 'Take a photo, select the code, then preview and scan.',
  );
}
async function scanDone(code) {
  if (scanTarget === 'product') {
    $('#productCode').value = code;
    lookupProduct();
    if (!localProduct(code)) await fetchProductOnline(code);
  } else {
    $('#' + scanTarget + 'Code').value = code;
    await findProduct(scanTarget);
  }
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.save && transactionBusy) return;
  try {
    if (b.dataset.page) go(b.dataset.page);
    if (b.dataset.go) go(b.dataset.go);
    if (b.dataset.scan) await openScan(b.dataset.scan);
    if (b.dataset.find) await findProduct(b.dataset.find);
    if (b.dataset.add) {
      const k = b.dataset.add,
        id = Number($('#' + k + 'Select').value);
      const p = state.products.find((p) => p.id === id);
      if (!p) throw Error('Choose a product first');
      const existing = carts[k].find((i) => i.id === id);
      if (existing) existing.quantity++;
      else carts[k].push({ id, quantity: 1, price: (k === 'sale' ? p.price : p.cost) / 100 });
      renderCart(k);
    }
    if (b.dataset.remove) {
      const [k, i] = b.dataset.remove.split(':');
      carts[k].splice(Number(i), 1);
      renderCart(k);
    }
    if (b.dataset.save) {
      transactionBusy = true;
      const k = b.dataset.save;
      if (!carts[k].length) throw Error('Add at least one product');
      b.disabled = true;
      const payload = { kind: k, items: carts[k], ...(window.erp ? window.erp.transactionData(k) : {}) };
      const body = JSON.stringify(payload);
      if (!pendingRequests[k] || pendingRequests[k].body !== body) {
        const bytes = new Uint8Array(24);
        crypto.getRandomValues(bytes);
        pendingRequests[k] = { body, key: Array.from(bytes, (v) => v.toString(16).padStart(2, '0')).join('') };
      }
      const result = await api('transaction', { ...payload, request_id: pendingRequests[k].key });
      pendingRequests[k] = null;
      if (window.erp) window.erp.resetDraft(k);
      carts[k] = [];
      await refresh();
      notice('Saved successfully. Reference: ' + result.reference);
    }
  } catch (e) {
    notice(e.message, true);
  } finally {
    if (b.dataset.save) transactionBusy = false;
    b.disabled = false;
  }
});
document.addEventListener('input', (e) => {
  if (e.target.dataset.edit) {
    const [k, i, field] = e.target.dataset.edit.split(':');
    carts[k][i][field] = e.target.value;
    updateTotal(k);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && ['purchaseCode', 'saleCode'].includes(e.target.id)) {
    e.preventDefault();
    findProduct(e.target.id.replace('Code', '')).catch((error) => notice(error.message, true));
  }
});
$('#search').oninput = renderProducts;
$('#addProduct').onclick = () => $('#productDialog').showModal();
$('#closeProduct').onclick = () => $('#productDialog').close();
$('#scanProduct').onclick = () => openScan('product');
$('#productForm').onsubmit = async (e) => {
  e.preventDefault();
  if (productBusy) return;
  productBusy = true;
  const b = $('#saveProduct');
  b.disabled = true;
  try {
    await api('product', Object.fromEntries(new FormData(e.target)));
    e.target.reset();
    $('#productDialog').close();
    await refresh();
    notice('Product and starting stock saved.');
  } catch (e) {
    alert(e.message);
  } finally {
    productBusy = false;
    b.disabled = false;
  }
};
$('#loginForm').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('login', { password: $('#password').value });
    $('#password').value = '';
    await refresh();
  } catch (e) {
    $('#loginError').textContent = e.message;
  }
};
$('#logout').onclick = async () => {
  await api('logout', {});
  location.reload();
};
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('#backup').onclick = async () => {
  try {
    const r = await fetch('/api/backup');
    if (!r.ok) throw Error('Backup failed; sign in again');
    download(await r.blob(), 'inventory-backup-' + new Date().toISOString().slice(0, 10) + '.sqlite3');
  } catch (e) {
    notice(e.message, true);
  }
};
$('#export').onclick = () => window.erp.exportHistory().catch((error) => notice(error.message, true));
$('#today').textContent = new Date().toLocaleDateString('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
refresh().catch((e) => { if (!e.message.includes('sign in')) $('#loginError').textContent = e.message; });

function lookupProduct() {
  const p = localProduct($('#productCode').value.trim());
  const form = $('#productForm');
  if (p) {
    $('#productName').value = p.name;
    form.elements.category.value = p.category;
    form.elements.price.value = p.price / 100;
    form.elements.minimum.value = p.minimum;
    form.elements.cost.value = p.cost / 100;
    $('#productLookup').textContent =
      'Found: ' +
      p.name +
      '. Already registered. Use Purchase stock to receive more of this product.';
    $('#saveProduct').disabled = true;
  } else {
    $('#productLookup').textContent = 'New product: enter the product name manually.';
    $('#saveProduct').disabled = false;
  }
}
$('#productCode').addEventListener('input', () => {
  onlineRequestId++;
  lookupProduct();
});
$('#productDialog').addEventListener('close', () => {
  $('#productForm').reset();
  $('#productLookup').textContent = '';
  $('#saveProduct').disabled = false;
});
document.addEventListener('change', (e) => {
  for (const k of ['purchase', 'sale']) {
    if (e.target.id === k + 'Select') {
      const p = state.products.find((p) => p.id === Number(e.target.value));
      $('#' + k + 'Name').value = p ? p.name : '';
    }
    if (e.target.id === k + 'Name') {
      const matches = state.products.filter(
        (p) => p.name.toLowerCase() === e.target.value.trim().toLowerCase(),
      );
      $('#' + k + 'Select').value = matches.length === 1 ? matches[0].id : '';
      if (matches.length > 1)
        notice('Multiple products share that name. Choose the exact product below.', true);
    }
  }
});

// Photo cropping is entirely local. Only the explicit Scan button runs decoding.
let cropPhoto = null,
  cropBox = { left: 0, right: 1, top: 0, bottom: 1 },
  cropDrag = null,
  decodedCrop = null;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function cropPixels(box, width, height) {
  const x = Math.max(0, Math.min(width - 1, Math.floor(box.left * width)));
  const y = Math.max(0, Math.min(height - 1, Math.floor(box.top * height)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.ceil(box.right * width) - x)),
    height: Math.max(1, Math.min(height - y, Math.ceil(box.bottom * height) - y)),
  };
}
function cropMessage(text, status = 'info') {
  const el = $('#scanMessage');
  el.textContent = text;
  el.dataset.state = status;
}
function setCropBusy(busy) {
  scanBusy = busy;
  $('#scanDialog').setAttribute('aria-busy', String(busy));
  for (const id of [
    'takePhoto',
    'closeScan',
    'resetCrop',
    'previewCrop',
    'decodeCrop',
    'cropLeft',
    'cropRight',
    'cropTop',
    'cropBottom',
    'useScanResult',
  ])
    $('#' + id).disabled = busy;
  $('#decodeCrop').textContent = busy ? 'Scanning…' : 'Scan barcode';
}
function invalidateCrop() {
  decodedCrop = null;
  $('#scanResult').hidden = true;
  $('#useScanResult').hidden = true;
  $('#cropPreviewArea').hidden = true;
}
function drawCrop() {
  if (!cropPhoto) return;
  const canvas = $('#cropCanvas'),
    ctx = canvas.getContext('2d'),
    w = canvas.width,
    h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(cropPhoto, 0, 0, w, h);
  const { x, y, width, height } = cropPixels(cropBox, w, h),
    theme = getComputedStyle($('#scanDialog'));
  ctx.fillStyle = theme.getPropertyValue('--crop-shade').trim();
  ctx.fillRect(0, 0, w, y);
  ctx.fillRect(0, y + height, w, h - y - height);
  ctx.fillRect(0, y, x, height);
  ctx.fillRect(x + width, y, w - x - width, height);
  ctx.strokeStyle = theme.getPropertyValue('--crop-accent').trim();
  ctx.lineWidth = Math.max(2, w / 450);
  ctx.strokeRect(x + 1, y + 1, Math.max(0, width - 2), Math.max(0, height - 2));
  for (const edge of ['left', 'right', 'top', 'bottom']) {
    $('#crop' + edge[0].toUpperCase() + edge.slice(1)).value = Math.round(cropBox[edge] * 1000);
    $('#' + edge + 'Value').textContent = Math.round(cropBox[edge] * 100) + '%';
  }
}
function cropChanged() {
  invalidateCrop();
  drawCrop();
  cropMessage('Selection updated. Preview or scan when ready.');
}
function selectedCanvas() {
  if (!cropPhoto) throw Error('Take a photo first.');
  const p = cropPixels(cropBox, cropPhoto.naturalWidth, cropPhoto.naturalHeight);
  if (p.width < 20 || p.height < 20)
    throw Error('The crop is too small. Include the entire code and a clear border.');
  const out = document.createElement('canvas');
  out.width = p.width;
  out.height = p.height;
  out.getContext('2d').drawImage(cropPhoto, p.x, p.y, p.width, p.height, 0, 0, p.width, p.height);
  return out;
}
function previewSelection() {
  const out = selectedCanvas(),
    preview = $('#cropPreview');
  preview.width = out.width;
  preview.height = out.height;
  preview.getContext('2d').drawImage(out, 0, 0);
  $('#cropPreviewArea').hidden = false;
  $('#cropResolution').textContent =
    `${out.width} × ${out.height} pixels · original photo resolution`;
  return out;
}
$('#takePhoto').onclick = () => {
  if (!scanBusy) $('#scanFile').click();
};
$('#scanFile').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || scanBusy) return;
  if (!file.type.startsWith('image/')) {
    cropMessage('Choose a supported image file.', 'error');
    return;
  }
  setCropBusy(true);
  cropMessage('Loading photo locally…');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw Error('Empty image');
    cropPhoto = image;
    cropBox = { left: 0, right: 1, top: 0, bottom: 1 };
    invalidateCrop();
    $('#cropEditor').hidden = false;
    // Scale only the editor display; keep the original Image for full-resolution export.
    const scale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
    $('#cropCanvas').width = Math.round(image.naturalWidth * scale);
    $('#cropCanvas').height = Math.round(image.naturalHeight * scale);
    drawCrop();
    cropMessage('Photo ready. Drag around one code or adjust the four sliders.');
  } catch {
    cropMessage(
      'Could not open this photo. Try JPEG or PNG; your previous photo is retained.',
      'error',
    );
  } finally {
    URL.revokeObjectURL(url);
    setCropBusy(false);
  }
};
function cropPoint(e) {
  const r = $('#cropCanvas').getBoundingClientRect();
  return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
}
$('#cropCanvas').onpointerdown = (e) => {
  if (scanBusy || !cropPhoto || !e.isPrimary || e.button !== 0) return;
  e.preventDefault();
  cropDrag = { ...cropPoint(e), id: e.pointerId };
  $('#cropCanvas').setPointerCapture(e.pointerId);
};
$('#cropCanvas').onpointermove = (e) => {
  if (!cropDrag || scanBusy || e.pointerId !== cropDrag.id) return;
  const p = cropPoint(e);
  if (Math.abs(p.x - cropDrag.x) < 0.002 || Math.abs(p.y - cropDrag.y) < 0.002) return;
  cropBox = {
    left: Math.min(p.x, cropDrag.x),
    right: Math.max(p.x, cropDrag.x),
    top: Math.min(p.y, cropDrag.y),
    bottom: Math.max(p.y, cropDrag.y),
  };
  cropChanged();
};
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
  $('#cropCanvas').addEventListener(event, (e) => {
    if (cropDrag?.id === e.pointerId) cropDrag = null;
  });
for (const edge of ['left', 'right', 'top', 'bottom'])
  $('#crop' + edge[0].toUpperCase() + edge.slice(1)).oninput = (e) => {
    if (scanBusy) return;
    const value = Number(e.target.value) / 1000,
      gap = 0.002;
    cropBox[edge] =
      edge === 'left'
      ? Math.min(value, cropBox.right - gap)
      : edge === 'right'
      ? Math.max(value, cropBox.left + gap)
      : edge === 'top'
      ? Math.min(value, cropBox.bottom - gap)
      : Math.max(value, cropBox.top + gap);
    cropChanged();
  };
$('#resetCrop').onclick = () => {
  cropBox = { left: 0, right: 1, top: 0, bottom: 1 };
  cropChanged();
};
$('#previewCrop').onclick = () => {
  try {
    previewSelection();
    cropMessage('Preview ready. Click Scan barcode to decode.');
  } catch (e) {
    cropMessage(e.message, 'error');
  }
};
$('#decodeCrop').onclick = async () => {
  if (scanBusy) return;
  setCropBusy(true);
  decodedCrop = null;
  $('#scanResult').hidden = true;
  $('#useScanResult').hidden = true;
  try {
    const out = previewSelection();
    cropMessage('Scanning selected crop locally…');
    scanner = scanner || new Html5Qrcode('reader');
    const code = await decodePhotoCrop(out);
    if (!code) throw Error('Empty result');
    decodedCrop = code;
    $('#scanResult').textContent = 'Decoded: ' + code;
    $('#scanResult').hidden = false;
    $('#useScanResult').hidden = false;
    cropMessage('Code detected. Click Use decoded value to fill the product form.', 'success');
  } catch {
    cropMessage(
      'No readable code detected, or the crop could not be decoded. Keep the complete code and a clear border, adjust the crop, and retry.',
      'error',
    );
  } finally {
    try {
      scanner?.clear();
    } catch { /* Keep crop for retry. */ }
    setCropBusy(false);
  }
};
$('#useScanResult').onclick = async () => {
  if (scanBusy || decodedCrop === null) return;
  const code = decodedCrop;
  $('#scanDialog').close();
  await scanDone(code);
};
$('#closeScan').onclick = () => {
  if (!scanBusy) $('#scanDialog').close();
};
$('#scanDialog').addEventListener('cancel', (e) => {
  if (scanBusy) e.preventDefault();
});

let onlineRequestId = 0,
  onlineBusy = false;
function openNewProduct(code) {
  if (!$('#productDialog').open) {
    $('#productForm').reset();
    $('#productDialog').showModal();
  }
  $('#productCode').value = code;
  lookupProduct();
}
async function fetchProductOnline(code) {
  if (onlineBusy) {
    $('#productLookup').textContent = 'A lookup is already running. Please wait, then retry.';
    return;
  }
  if (!code) {
    $('#productLookup').textContent = 'Enter a barcode number first.';
    return;
  }
  const local = localProduct(code);
  if (local) {
    lookupProduct();
    return;
  }
  const requestId = ++onlineRequestId;
  onlineBusy = true;
  const button = $('#onlineLookup');
  button.disabled = true;
  button.textContent = 'Searching online…';
  const save = $('#saveProduct');
  save.disabled = true;
  const previousName = $('#productName').value,
    previousCategory = $('#productForm').elements.category.value;
  $('#productLookup').textContent = 'Looking up this barcode online…';
  try {
    const result = await api('product-lookup?code=' + encodeURIComponent(code));
    if (
      requestId !== onlineRequestId ||
      !$('#productDialog').open ||
      $('#productCode').value.trim() !== code
    )
      return;
    if (result.found) {
      // Do not overwrite typing performed while the request was pending.
      if ($('#productName').value === previousName) $('#productName').value = result.name;
      if ($('#productForm').elements.category.value === previousCategory)
        $('#productForm').elements.category.value = result.category || '';
      const info = $('#productLookup');
      info.textContent =
        'Found online: ' + result.name + '. Source: ' + result.source + '. ' + result.license + ' ';
      const link = document.createElement('a');
      link.href = result.source_url;
      link.textContent = 'View source';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      info.appendChild(link);
    } else $('#productLookup').textContent = result.message;
  } catch {
    if (requestId === onlineRequestId)
      $('#productLookup').textContent =
        'Online lookup failed. Check laptop internet, retry, or enter the name manually.';
  } finally {
    onlineBusy = false;
    button.disabled = false;
    button.textContent = 'Look up product online';
    save.disabled = !!localProduct($('#productCode').value.trim());
  }
}
$('#onlineLookup').onclick = () => fetchProductOnline($('#productCode').value.trim());
$('#productDialog').addEventListener('close', () => {
  onlineRequestId++;
});
// Retry a failed crop with bounded resize/rotation variants, keeping the original unchanged.
async function decodePhotoCrop(out) {
  const variants = [
    { angle: 0, scale: 1 },
    { angle: 0, scale: Math.min(1, 1600 / Math.max(out.width, out.height)) },
    { angle: 90, scale: Math.min(1, 2200 / Math.max(out.width, out.height)) },
    { angle: 270, scale: Math.min(1, 2200 / Math.max(out.width, out.height)) },
  ];
  for (let i = 0; i < variants.length; i++) {
    const { angle, scale } = variants[i];
    if (i === 1 && scale === 1) continue;
    cropMessage(`Reading crop locally… attempt ${i + 1}/${variants.length}`);
    const c = document.createElement('canvas'),
      w = Math.max(1, Math.round(out.width * scale)),
      h = Math.max(1, Math.round(out.height * scale));
    c.width = angle ? h : w;
    c.height = angle ? w : h;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.drawImage(out, -w / 2, -h / 2, w, h);
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
    if (!blob) continue;
    try {
      const value = await scanner.scanFile(
        new File([blob], 'product-crop.png', { type: 'image/png' }),
        false,
      );
      if (value) return value;
    } catch { /* Keep crop for retry. */ }
    scanner.clear();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw Error('No readable code');
}

if (window.erp) window.erp.refresh = refresh;
