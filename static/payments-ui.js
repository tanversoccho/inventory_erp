/* Invoice settlements: payments never create extra sales, purchases or stock movements. */
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (v) =>
    String(v ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  let config = {},
    customers = null,
    loadingCustomers = null,
    sequence = 0;
  const drafts = { purchase: {}, sale: {} },
    totals = { purchase: 0, sale: 0 };
  const cash = (v) => window.erp.money(v);
  const options = (rows, id) =>
    rows
      .map(
        (r) =>
          `<option value="${r.id}" ${String(id) === String(r.id) ? 'selected' : ''}>${esc(r.name)}${r.phone ? ' · ' + esc(r.phone) : ''}</option>`,
      )
      .join('');
  const methods = () =>
    config.payment_methods
      .map((m) => `<option ${m === config.default_payment ? 'selected' : ''}>${esc(m)}</option>`)
      .join('');
  const today = () =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: config.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  async function api(path, data) {
    const r = await fetch(
      '/api/' + path,
      data === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          },
    );
    const result = await r.json();
    if (!r.ok) throw Error(result.error || 'Request failed');
    return result;
  }
  function notice(text, bad = false) {
    $('#notice').hidden = false;
    $('#notice').textContent = text;
    $('#notice').className = bad ? 'error' : '';
  }
  function key() {
    return Array.from(crypto.getRandomValues(new Uint8Array(24)), (v) =>
      v.toString(16).padStart(2, '0'),
    ).join('');
  }
  async function loadCustomers(force = false) {
    if (force && loadingCustomers) await loadingCustomers;
    if (loadingCustomers) return loadingCustomers;
    loadingCustomers = api('customers')
      .then((rows) => {
        customers = rows;
        return rows;
      })
      .finally(() => {
        loadingCustomers = null;
      });
    return loadingCustomers;
  }
  function capture() {
    for (const kind of ['sale', 'purchase']) {
      if (!$('#' + kind + 'PayMode')) continue;
      const select = $('#saleCustomer');
      drafts[kind] = {
        payment_mode: $('#' + kind + 'PayMode').value,
        amount_paid: $('#' + kind + 'Paid').value,
        due_date: $('#' + kind + 'DueDate').value,
        customer_id:
          kind === 'sale'
            ? select?.dataset.ready === 'true'
              ? select.value
              : drafts.sale.customer_id || ''
            : '',
      };
    }
  }
  function reset(kind) {
    drafts[kind] = {};
    if ($('#' + kind + 'PayMode')) {
      $('#' + kind + 'PayMode').value = 'full';
      $('#' + kind + 'DueDate').value = '';
      if (kind === 'sale' && $('#saleCustomer')) $('#saleCustomer').value = '';
      update(kind, totals[kind]);
    }
  }
  function attach(kind, parent) {
    const d = drafts[kind],
      mode = d.payment_mode || 'full';
    const box = document.createElement('fieldset');
    box.className = 'settlement-entry';
    box.innerHTML = `<legend>${kind === 'sale' ? 'Customer payment' : 'Vendor payment'}</legend>${kind === 'sale' ? `<label>Customer (required for credit)<select id="saleCustomer" data-ready="${customers === null ? 'false' : 'true'}"><option value="">Walk-in / no customer</option>${options(customers || [], d.customer_id)}</select></label><button type="button" id="quickCustomer">+ Add customer</button>` : ''}<label>Payment status<select id="${kind}PayMode"><option value="full" ${mode === 'full' ? 'selected' : ''}>Pay full amount now</option><option value="partial" ${mode === 'partial' ? 'selected' : ''}>Pay partial amount now</option><option value="unpaid" ${mode === 'unpaid' ? 'selected' : ''}>No payment now / pay later</option></select></label><div class="two"><label>Amount ${kind === 'sale' ? 'received' : 'paid'} now<input id="${kind}Paid" type="number" min="0" step="0.01" value="${esc(d.amount_paid || '0')}"></label><label>Due date (optional)<input id="${kind}DueDate" type="date" value="${esc(d.due_date || '')}"></label></div><p id="${kind}BalancePreview" role="status"></p><p class="muted">${kind === 'sale' ? 'Save a customer' : 'Choose a vendor above'} when any amount remains due. Later installments are recorded in Payments & dues.</p>`;
    parent.append(box);
    box.addEventListener('input', () => {
      capture();
      update(kind, totals[kind]);
    });
    box.addEventListener('change', () => {
      capture();
      update(kind, totals[kind]);
    });
    update(kind, totals[kind]);
    if (kind === 'sale') {
      const select = $('#saleCustomer');
      $('#quickCustomer').onclick = () => addCustomer(true);
      loadCustomers()
        .then((rows) => {
          if ($('#saleCustomer') !== select) return;
          const value =
            select.dataset.ready === 'true' ? select.value : drafts.sale.customer_id || '';
          select.innerHTML =
            '<option value="">Walk-in / no customer</option>' + options(rows, value);
          select.value = value;
          select.dataset.ready = 'true';
        })
        .catch((e) => notice(e.message, true));
    }
  }
  function update(kind, total) {
    totals[kind] = total;
    const mode = $('#' + kind + 'PayMode'),
      paid = $('#' + kind + 'Paid');
    if (!mode || !paid) return;
    paid.disabled = mode.value !== 'partial';
    if (mode.value === 'full') paid.value = (total / 100).toFixed(2);
    if (mode.value === 'unpaid') paid.value = '0';
    const entered = Math.round(Number(paid.value) * 100);
    $('#' + kind + 'BalancePreview').textContent =
      `Invoice: ${cash(total)} · ${kind === 'sale' ? 'Receivable' : 'Payable'} after saving: ${cash(total - entered)}`;
  }
  function data(kind) {
    capture();
    const d = drafts[kind];
    return {
      payment_mode: d.payment_mode || 'full',
      amount_paid: d.amount_paid || '0',
      due_date: d.due_date || '',
      customer_id: kind === 'sale' ? d.customer_id || null : null,
    };
  }
  function cards(summary) {
    return [
      ['Customers owe you', summary.receivables],
      ['You owe vendors', summary.payables],
      ['Overdue receivables', summary.overdue_receivables],
      ['Overdue payables', summary.overdue_payables],
      ['Refunds owed to customers', summary.customer_refunds_due],
      ['Refunds due from vendors', summary.vendor_refunds_due],
    ]
      .map(
        ([label, value]) =>
          `<article class="metric"><small>${label}</small><strong>${esc(cash(value))}</strong></article>`,
      )
      .join('');
  }
  function dashboard(summary) {
    if (!summary) return;
    let target = $('#settlementMetrics');
    if (!target) {
      target = document.createElement('div');
      target.id = 'settlementMetrics';
      $('#metrics').after(target);
    }
    target.innerHTML = `<h2>Current payments & dues</h2><div class="metrics">${cards(summary)}</div><p class="muted">${summary.unconfirmed} invoice(s) have unconfirmed historical payment balances and are excluded from dues. Confirm them in Payments & dues.</p>`;
  }
  function reportCash(summary) {
    if (!summary) return;
    const panel = document.createElement('article');
    panel.className = 'panel';
    panel.innerHTML = `<h2>Payments recorded in selected period</h2><p>Customer receipts: ${esc(cash(summary.customer_receipts))} · Vendor payments: ${esc(cash(summary.vendor_payments))}</p><p>Customer refunds: ${esc(cash(summary.customer_refunds))} · Vendor refunds received: ${esc(cash(summary.vendor_refunds))}</p><p>Net settlement cash: ${esc(cash(summary.net_settlement_cash))}. Expenses are reported separately. Verified opening balances are excluded; this is settlement activity, not net profit or a complete cash-flow statement.</p><button id="settlementCashCsv">Export settlement cash CSV</button>`;
    $('#reportOutput').append(panel);
    $('#settlementCashCsv').onclick = () => window.erp.exportReport('cash');
  }
  function invoiceHTML(r) {
    if (!r) return '';
    if (!r.confirmed)
      return '<p><b>Payment status: Unconfirmed</b>. Historical payment information has not been verified.</p>';
    return `<section class="settlement-print"><h3>${esc(r.party_name)} · ${esc(r.status)}</h3><p>Original total: ${esc(cash(r.original_total))} · Returns: ${esc(cash(r.returns_total))} · Net invoice: ${esc(cash(r.net_total))}</p><p>Net paid: ${esc(cash(r.net_paid))} · Balance due: <b>${esc(cash(r.due))}</b> · Refund due: ${esc(cash(r.refund_due))}</p><p>Due date: ${esc(r.due_date || 'Not specified')}${r.overdue ? ' · Overdue' : ''}</p></section>`;
  }
  function dialog(html) {
    $('#adminDialogContent').innerHTML = html;
    if (!$('#adminDialog').open) $('#adminDialog').showModal();
  }
  async function addCustomer(fromSale = false) {
    dialog(
      '<h2>Add customer</h2><form id="customerForm"><label>Name<input name="name" maxlength="200" required></label><label>Phone<input name="phone" maxlength="100"></label><label>Address<input name="address" maxlength="1000"></label><button>Save customer</button><p id="customerStatus" role="status"></p></form>',
    );
    $('#customerForm').onsubmit = async (e) => {
      e.preventDefault();
      e.submitter.disabled = true;
      try {
        const result = await api('customer', Object.fromEntries(new FormData(e.target)));
        await loadCustomers(true);
        if (fromSale) {
          const select = $('#saleCustomer');
          if (select) {
            select.innerHTML =
              '<option value="">Walk-in / no customer</option>' + options(customers, result.id);
            select.value = String(result.id);
            select.dataset.ready = 'true';
            capture();
          }
        }
        $('#adminDialog').close();
        if (!fromSale) {
          if (!$('#customers').hidden) await renderCustomers();
          else await renderPage();
        }
        notice('Customer saved.');
      } catch (error) {
        $('#customerStatus').textContent = error.message;
      } finally {
        e.submitter.disabled = false;
      }
    };
  }
  let customerSequence = 0,
    customerQuery = '';
  async function renderCustomers() {
    const seq = ++customerSequence;
    try {
      const result = await api('payments?kind=sale');
      if (seq !== customerSequence || $('#customers').hidden) return;
      customers = result.customers;
      const rows = customers
        .map((p) => {
          const invoices = result.accounts.filter((a) => a.customer_id === p.id);
          return {
            ...p,
            invoices: invoices.length,
            due: invoices.reduce((n, a) => n + (a.confirmed ? a.due : 0), 0),
            refund: invoices.reduce((n, a) => n + (a.confirmed ? a.refund_due : 0), 0),
            unconfirmed: invoices.filter((a) => !a.confirmed).length,
          };
        })
        .filter((p) =>
          [p.name, p.phone, p.address].some((v) =>
            String(v || '')
              .toLowerCase()
              .includes(customerQuery.toLowerCase()),
          ),
        );
      $('#customers').innerHTML =
        `<article class="panel"><div class="toolbar"><button id="newCustomer">+ Add customer</button></div><label>Search name, phone or address<input id="customerSearch" maxlength="200" value="${esc(customerQuery)}"></label><button id="findCustomers">Search</button><p>${rows.length} customer(s). Balances include confirmed invoices only. Unconfirmed invoices require verification.</p><div id="customerList"></div></article>`;
      window.erp.table(
        'customers',
        rows,
        [
          ['name', 'Name'],
          ['phone', 'Phone'],
          ['address', 'Address'],
          ['invoices', 'Invoices'],
          ['due', 'Outstanding', cash],
          ['refund', 'Refund due', cash],
          ['unconfirmed', 'Unconfirmed invoices'],
          [
            'id',
            'Statement',
            (v) => `<button type="button" data-customer-statement="${v}">View statement</button>`,
          ],
        ],
        $('#customerList'),
      );
      $('#newCustomer').onclick = () => addCustomer();
      $('#findCustomers').onclick = () => {
        customerQuery = $('#customerSearch').value;
        renderCustomers();
      };
      $('#customerSearch').onkeydown = (e) => {
        if (e.key === 'Enter') $('#findCustomers').click();
      };
    } catch (e) {
      notice(e.message, true);
    }
  }
  let filters = { kind: '', status: '', q: '' };
  async function renderPage() {
    const seq = ++sequence;
    const page = $('#payments');
    if (!page) return;
    try {
      const query = new URLSearchParams(filters);
      const result = await api('payments?' + query);
      if (seq !== sequence) return;
      customers = result.customers;
      page.innerHTML = `<div class="metrics">${cards(result.summary)}</div><p>${result.summary.unconfirmed} historical invoices are unconfirmed. No payment or debt was assumed for them.</p><article class="panel"><div class="toolbar"><button id="addCustomer">+ Add customer</button><button id="duesCsv">Export dues CSV</button></div><div class="settings-grid"><label>Type<select id="duesKind"><option value="">All</option><option value="sale" ${filters.kind === 'sale' ? 'selected' : ''}>Customer sales</option><option value="purchase" ${filters.kind === 'purchase' ? 'selected' : ''}>Vendor purchases</option></select></label><label>Status<select id="duesStatus">${['', 'Paid', 'Partially paid', 'Unpaid', 'Refund due', 'Unconfirmed'].map((v) => `<option value="${v}" ${filters.status === v ? 'selected' : ''}>${v || 'All'}</option>`).join('')}</select></label><label>Name / reference<input id="duesQuery" maxlength="200" value="${esc(filters.q)}"></label><button id="duesFilter">Apply filters</button></div><div id="duesTable"></div></article><article class="panel"><h2>Customer / vendor statement</h2><div class="two"><label>Customer<select id="statementCustomer"><option value="">Select customer</option>${options(result.customers)}</select></label><label>Vendor<select id="statementVendor"><option value="">Select vendor</option>${options(result.suppliers)}</select></label><button id="customerStatement">View customer statement</button><button id="vendorStatement">View vendor statement</button></div><p class="muted">Manage vendor contacts from Suppliers. Customer/vendor balances are sums of confirmed invoice balances; refunds are shown separately.</p></article>`;
      window.erp.table(
        'dues',
        result.accounts,
        [
          [
            'reference',
            'Invoice',
            (v) => `<button class="text" data-account="${esc(v)}">${esc(v)}</button>`,
          ],
          ['kind', 'Type'],
          ['party_name', 'Customer / vendor'],
          ['status', 'Status'],
          ['net_total', 'Net invoice', cash],
          ['net_paid', 'Net paid', (v, r) => (r.confirmed ? cash(v) : 'Unconfirmed')],
          ['due', 'Due', (v, r) => (r.confirmed ? cash(v) : 'Unconfirmed')],
          ['refund_due', 'Refund due', cash],
          ['due_date', 'Due date'],
          ['overdue', 'Overdue', (v) => (v ? 'Yes' : '')],
        ],
        $('#duesTable'),
      );
      $('#addCustomer').onclick = () => addCustomer();
      $('#duesFilter').onclick = () => {
        filters = {
          kind: $('#duesKind').value,
          status: $('#duesStatus').value,
          q: $('#duesQuery').value,
        };
        renderPage();
      };
      $('#duesCsv').onclick = async () => {
        try {
          const r = await fetch('/api/payments.csv?' + new URLSearchParams(filters));
          if (!r.ok) throw Error('Export failed');
          const a = document.createElement('a');
          a.href = URL.createObjectURL(await r.blob());
          a.download = 'payments-and-dues.csv';
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        } catch (e) {
          notice(e.message, true);
        }
      };
      $('#customerStatement').onclick = () =>
        showStatement('customer', $('#statementCustomer').value);
      $('#vendorStatement').onclick = () => showStatement('vendor', $('#statementVendor').value);
    } catch (e) {
      notice(e.message, true);
    }
  }
  async function accountDialog(reference) {
    try {
      const r = await api('payment-account?reference=' + encodeURIComponent(reference));
      const parties = r.kind === 'sale' ? await loadCustomers() : (await api('payments')).suppliers;
      dialog(`<h2>${esc(reference)}</h2><p>${esc(r.kind)} · ${esc(r.party_name)} · ${esc(r.status)}</p>${invoiceHTML(r)}${r.confirmed ? '' : `<p>Original invoice: ${esc(cash(r.original_total))}. Returns: ${esc(cash(r.returns_total))}. Enter verified cumulative NET paid before this feature, after any historical refunds. This confirms an opening balance and does not record a new cash payment.</p><form id="confirmOpening"><input name="reference" type="hidden" value="${esc(reference)}"><label>${r.kind === 'sale' ? 'Customer' : 'Vendor'}<select name="${r.kind === 'sale' ? 'customer_id' : 'supplier_id'}"><option value="">No party (only fully settled invoices)</option>${options(parties, r.customer_id || r.supplier_id)}</select></label><label>Historical net paid<input name="opening_paid" type="number" min="0" max="${r.original_total / 100}" step="0.01" required></label><label>Due date<input name="due_date" type="date"></label><label>Verification note<input name="note" maxlength="1000" required></label><button>Confirm opening balance</button></form>`}
    ${r.confirmed && (r.due > 0 || r.refund_due > 0) ? `<form id="installmentForm"><h3>${r.refund_due ? 'Record ' + (r.kind === 'sale' ? 'refund to customer' : 'refund from vendor') : 'Record ' + (r.kind === 'sale' ? 'customer receipt' : 'vendor payment')}</h3><input name="reference" type="hidden" value="${esc(reference)}"><input name="kind" type="hidden" value="${r.refund_due ? 'refund' : 'payment'}"><label>Amount<input name="amount" type="number" min="0.01" max="${(r.refund_due || r.due) / 100}" step="0.01" required></label><label>Date paid<input name="date" type="date" value="${today()}" max="${today()}" required></label><label>Payment method<select name="method">${methods()}</select></label><label>Note<input name="note" maxlength="1000"></label><button>Save payment</button></form>` : ''}
    <p id="settlementStatus" role="status"></p><h3>Payment history</h3>${r.opening_paid ? `<p>Verified historical net paid: ${esc(cash(r.opening_paid))}. ${esc(r.verification_note)}</p>` : ''}<div id="paymentLedger"></div>`);
      window.erp.table(
        'ledger-' + reference,
        r.payments,
        [
          ['created', 'Date'],
          ['receipt', 'Receipt'],
          ['kind', 'Type'],
          ['amount', 'Amount', cash],
          ['method', 'Method'],
          ['note', 'Note'],
        ],
        $('#paymentLedger'),
      );
      if ($('#confirmOpening')) {
        let busy = false;
        $('#confirmOpening').onsubmit = async (e) => {
          e.preventDefault();
          if (
            busy ||
            !confirm(
              'Confirm this verified historical balance? It will not count as a new cash payment.',
            )
          )
            return;
          busy = true;
          e.submitter.disabled = true;
          try {
            await api('payment-confirm', Object.fromEntries(new FormData(e.target)));
            await window.erp.refresh();
            await accountDialog(reference);
          } catch (error) {
            $('#settlementStatus').textContent = error.message;
          } finally {
            busy = false;
            e.submitter.disabled = false;
          }
        };
      }
      if ($('#installmentForm')) {
        let attempt = null,
          busy = false;
        $('#installmentForm').onsubmit = async (e) => {
          e.preventDefault();
          if (busy || !confirm('Record this payment? Check the amount, date and method.')) return;
          busy = true;
          e.submitter.disabled = true;
          try {
            const payload = Object.fromEntries(new FormData(e.target)),
              body = JSON.stringify(payload);
            if (!attempt || attempt.body !== body) attempt = { body, id: key() };
            await api('payment', { ...payload, request_id: attempt.id });
            await window.erp.refresh();
            await accountDialog(reference);
            notice('Payment saved. Stock and sales totals are unchanged.');
          } catch (error) {
            $('#settlementStatus').textContent = error.message;
          } finally {
            busy = false;
            e.submitter.disabled = false;
          }
        };
      }
    } catch (e) {
      notice(e.message, true);
    }
  }
  async function showStatement(type, id) {
    if (!id) {
      notice('Choose a saved customer/vendor.', true);
      return;
    }
    try {
      const s = await api('party-statement?type=' + type + '&id=' + id);
      dialog(
        `<div class="invoice"><h2>${esc(config.company || config.app_name)}</h2><h3>${esc(s.party.name)} · ${esc(type)} statement</h3><p>${esc(s.party.phone)} ${esc(s.party.address)}</p><p>Outstanding: ${esc(cash(s.due))} · Refund balance: ${esc(cash(s.refund_due))} · Unconfirmed invoices: ${s.unconfirmed}</p>${s.invoices.map((r) => `<section><h3>${esc(r.reference)} · ${esc(r.created.slice(0, 10))}</h3>${invoiceHTML(r)}${r.opening_paid ? `<p>Historical verified net paid: ${esc(cash(r.opening_paid))}</p>` : ''}${r.payments.map((e) => `<p>${esc(e.created.slice(0, 10))} · ${esc(e.receipt)} · ${esc(e.kind)} · ${esc(cash(e.amount))} · ${esc(e.method)}</p>`).join('')}</section>`).join('') || '<p>No invoices assigned.</p>'}</div><button id="printStatement">Print statement</button>`,
      );
      $('#printStatement').onclick = () => {
        document.body.classList.add('print-invoice');
        window.print();
        document.body.classList.remove('print-invoice');
      };
    } catch (e) {
      notice(e.message, true);
    }
  }
  document.addEventListener('click', (e) => {
    const statementButton = e.target.closest('[data-customer-statement]');
    if (statementButton) showStatement('customer', statementButton.dataset.customerStatement);
    const b = e.target.closest('[data-account]');
    if (b) accountDialog(b.dataset.account);
  });
  window.paymentUI = {
    configure: (c) => {
      config = c;
    },
    capture,
    reset,
    attach,
    update,
    data,
    dashboard,
    renderPage,
    reportCash,
    invoiceHTML,
    renderCustomers,
  };
})();
