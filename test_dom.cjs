/* Optional jsdom integration; owns a disposable HTTP fixture. npm install --no-save jsdom */
const { JSDOM, VirtualConsole } = require('jsdom');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const path = require('node:path');
const password = randomBytes(24).toString('hex');
const child = spawn(
  process.env.PYTHON_EXECUTABLE || 'python',
  [path.join(__dirname, 'browser_fixture.py')],
  {
    cwd: __dirname,
    env: { ...process.env, ERP_TEST_PASSWORD: password },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let dom;
const lines = createInterface({ input: child.stdout });
const port = new Promise((resolve, reject) => {
  lines.once('line', (s) => resolve(JSON.parse(s).port));
  child.once('error', reject);
  child.once('exit', (code) => reject(Error('Fixture exited ' + code)));
});
(async () => {
  const base = 'http://127.0.0.1:' + (await port),
    errors = [],
    vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    if (!e.message.includes('navigation')) errors.push(e.message);
  });
  let cookie = '',
    lastExport = '',
    loseResponse = false;
  const saved = [];
  dom = await JSDOM.fromURL(base, {
    resources: 'usable',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {} });
      w.confirm = () => true;
      w.print = () => {};
      w.HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
      };
      w.HTMLDialogElement.prototype.close = function () {
        this.open = false;
      };
      w.URL.createObjectURL = () => 'blob:test';
      w.URL.revokeObjectURL = () => {};
      w.HTMLAnchorElement.prototype.click = function () {};
      w.fetch = async (url, options = {}) => {
        const response = await fetch(new URL(url, base), {
          ...options,
          headers: { ...(options.headers || {}), Cookie: cookie },
        });
        if (response.headers.get('set-cookie'))
          cookie = response.headers.get('set-cookie').split(';')[0];
        if (url.includes('.csv')) lastExport = String(url);
        if (url === '/api/transaction') {
          saved.push(JSON.parse(options.body));
          if (loseResponse) {
            loseResponse = false;
            throw Error('Simulated lost response after commit');
          }
        }
        return response;
      };
    },
  });
  const w = dom.window,
    d = w.document;
  async function until(fn, label) {
    for (let i = 0; i < 200; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw Error(
      'Timeout ' + label + ' ' + d.querySelector('#notice')?.textContent + ' ' + errors.join('\n'),
    );
  }
  const click = (s) => {
    assert(d.querySelector(s), s);
    d.querySelector(s).click();
  };
  const submit = (s) => {
    const f = d.querySelector(s);
    f.dispatchEvent(
      new w.SubmitEvent('submit', {
        cancelable: true,
        submitter: f.querySelector('button:not([type="button"])'),
      }),
    );
  };
  await until(() => w.erp && d.title.includes('Soccho'), 'parser startup');
  d.querySelector('#password').value = password;
  submit('#loginForm');
  await until(() => !d.querySelector('#workspace').hidden, 'login');
  click('[data-page="purchase"]');
  await until(() => d.querySelector('#purchaseSupplier option[value="1"]'), 'suppliers');
  d.querySelector('#purchaseSupplier').value = '1';
  d.querySelector('#purchasePayment').value = 'Bank';
  d.querySelector('#purchaseNote').value = 'Keep draft';
  d.querySelector('#purchaseSelect').value = '1';
  click('[data-add="purchase"]');
  click('[data-page="inventory"]');
  click('[data-page="purchase"]');
  await until(() => d.querySelector('#purchaseSupplier').value === '1', 'draft supplier');
  assert.equal(d.querySelector('#purchasePayment').value, 'Bank');
  assert.equal(d.querySelector('#purchaseNote').value, 'Keep draft');
  click('[data-save="purchase"]');
  await until(() => d.querySelector('#notice').textContent.includes('PUR-'), 'saved purchase');
  assert.equal(saved[0].supplier_id, '1');
  assert.equal(saved[0].note, 'Keep draft');
  click('[data-page="reports"]');
  await until(() => d.querySelector('#reportForm'), 'report form');
  d.querySelector('#reportForm').elements.month.value = '2026-09';
  submit('#reportForm');
  await until(
    () => d.querySelector('#reportStatus').textContent.includes('2026-09-01'),
    'September',
  );
  d.querySelector('#reportForm').elements.month.value = '2026-08';
  click('#reportCsv');
  await until(() => lastExport, 'CSV');
  assert.equal(new URL(lastExport, base).searchParams.get('month'), '2026-09');
  click('[data-page="history"]');
  await until(() => d.querySelector('#historyNext:not([disabled])'), 'paged history');
  const first = d.querySelector('#historyEnhanced tbody tr').textContent;
  click('#historyNext');
  await until(
    () => d.querySelector('#historyEnhanced').textContent.includes('Page 2 /'),
    'history next',
  );
  assert.notEqual(d.querySelector('#historyEnhanced tbody tr').textContent, first);
  click('[data-page="sale"]');
  d.querySelector('#saleSelect').value = '1';
  click('[data-add="sale"]');
  loseResponse = true;
  click('[data-save="sale"]');
  await until(() => d.querySelector('#notice').className === 'error', 'lost response');
  click('[data-save="sale"]');
  await until(() => d.querySelector('#notice').textContent.includes('INV-'), 'retry sale');
  assert.equal(saved[1].request_id, saved[2].request_id);
  click('[data-page="expenses"]');
  await until(() => d.querySelector('[data-reverse-expense="1"]'), 'expense action');
  click('[data-reverse-expense="1"]');
  d.querySelector('#expenseReverseForm').elements.date.value = '2026-09-10';
  d.querySelector('#expenseReverseForm').elements.reason.value = 'Duplicate';
  submit('#expenseReverseForm');
  await until(
    () => d.querySelector('#expensesTable').textContent.includes('Reversed: EXR-'),
    'reversal',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: DOM/HTTP startup, transaction metadata after navigation, applied-filter CSV, remote history pagination, stable retry identifier and expense reversal.',
  );
  await new Promise((r) => setTimeout(r, 100));
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    if (dom) dom.window.close();
    lines.close();
    child.kill();
  });
