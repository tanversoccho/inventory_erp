/* Runtime customization and reporting; existing scanner and transaction UI remain in app.js. */
(() => {
  const el = (s) => document.querySelector(s);
  const escape = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  let config = { currency_symbol: '৳', precision: 2, locale: 'en-BD', grouping: true, timezone: 'Asia/Dhaka' };
  let currentState, currentPage, admin, reportData, reportSequence = 0;
  const paging = {};
  let appliedReportQuery = '', historySequence = 0;
  const historyState = {page:1,size:25,q:'',sort:'id',direction:'desc'};
  const drafts = { purchase: null, sale: null };
  let supplierCache = null;
  function captureDrafts() {
    window.paymentUI?.capture();
    for (const kind of ['purchase','sale']) {
      const payment=el('#'+kind+'Payment'), note=el('#'+kind+'Note');
      if (payment && note) drafts[kind]={payment_method:payment.value,note:note.value,supplier_id:kind==='purchase'?(el('#purchaseSupplier')?.dataset.ready==='true'?el('#purchaseSupplier').value:(drafts.purchase?.supplier_id||'')):''};
    }
  }
  function resetDraft(kind) {
    window.paymentUI?.reset(kind);
    drafts[kind]=null;
    const payment=el('#'+kind+'Payment'), note=el('#'+kind+'Note');
    if(payment)payment.value=config.default_payment;
    if(note)note.value=config.default_note;
    if(kind==='purchase' && el('#purchaseSupplier'))el('#purchaseSupplier').value='';
  }
  function historyQuery() { return new URLSearchParams(Object.entries(historyState).map(([k,v])=>[k,String(v)])); }
  async function exportHistory() {
    const response=await fetch('/api/history.csv?'+historyQuery());
    if(!response.ok)throw Error('Export failed; sign in again');
    const link=document.createElement('a');link.href=URL.createObjectURL(await response.blob());link.download='transactions.csv';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  }
  async function fetchHistory() {
    const seq=++historySequence, target=el('#historyEnhanced');
    if(!target)return;
    const focused=target.querySelector('input')===document.activeElement;
    const position=focused?document.activeElement.selectionStart:0;
    try {
      const data=await request('history?'+historyQuery());
      if(seq!==historySequence)return;
      historyState.page=data.page;
      const cols=columns.movements;
      const keys=['id','created','reference','kind','name','quantity','unit_price','unit_cost','note'];
      target.innerHTML=`<div class="table-tools"><input id="historySearch" placeholder="Search all transactions" aria-label="Search all transactions" value="${escape(historyState.q)}"><span>${data.total} records</span></div><div class="table-wrap"><table><thead><tr>${cols.map((c,i)=>`<th><button class="text" data-history-sort="${keys[i]}">${escape(c[1])}</button></th>`).join('')}</tr></thead><tbody>${data.rows.map((row)=>{const r={...row,local_date:date(row.created)+' '+time(row.created)};return '<tr>'+cols.map((c)=>'<td>'+(c[2]?c[2](r[c[0]],r):escape(r[c[0]]))+'</td>').join('')+'</tr>';}).join('')||'<tr><td colspan="9">No matching transactions.</td></tr>'}</tbody></table></div><div class="table-tools"><button id="historyPrev" ${data.page<=1?'disabled':''}>Previous</button><span>Page ${data.page} / ${Math.max(1,Math.ceil(data.total/data.size))}</span><button id="historyNext" ${data.page*data.size>=data.total?'disabled':''}>Next</button></div>`;
      el('#historySearch').oninput=(e)=>{historyState.q=e.target.value;historyState.page=1;fetchHistory();};
      el('#historyPrev').onclick=()=>{historyState.page--;fetchHistory();};
      el('#historyNext').onclick=()=>{historyState.page++;fetchHistory();};
      target.querySelectorAll('[data-history-sort]').forEach((button)=>button.onclick=()=>{const key=button.dataset.historySort;historyState.direction=historyState.sort===key&&historyState.direction==='asc'?'desc':'asc';historyState.sort=key;historyState.page=1;fetchHistory();});
      if(focused){el('#historySearch').focus();el('#historySearch').setSelectionRange(position,position);}
    } catch(error){if(seq===historySequence)message(error.message,true);}
  }
  const request = async (path, data) => {
    const response = await fetch('/api/' + path, data === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Request failed');
    return result;
  };
  const money = (n) => {
    try { return config.currency_symbol + ' ' + (n / 100).toLocaleString(config.locale, {minimumFractionDigits:config.precision,maximumFractionDigits:config.precision,useGrouping:config.grouping}); }
    catch { return config.currency_symbol + ' ' + (n / 100).toFixed(2); }
  };
  function date(value) {
    const instant = new Date(value);
    const style = config.date_format === 'mdy' ? 'en-US' : config.date_format === 'dmy' ? 'en-GB' : 'en-CA';
    return new Intl.DateTimeFormat(style, {year:'numeric',month:'2-digit',day:'2-digit',timeZone:config.timezone}).format(instant);
  }
  function time(value) {
    return new Intl.DateTimeFormat(config.locale, {hour:'2-digit',minute:'2-digit',hour12:config.time_format === '12',timeZone:config.timezone}).format(new Date(value));
  }
  function message(text, bad=false) {
    el('#notice').hidden = false;
    el('#notice').textContent = text;
    el('#notice').className = bad ? 'error' : '';
  }
  function options(values, selected) { return values.map((v) => `<option ${v === selected ? 'selected' : ''} value="${escape(v)}">${escape(v)}</option>`).join(''); }
  function brandBox(target, role) {
    const box = el(target);
    const dark = document.documentElement.dataset.theme === 'dark';
    const src = (role === 'login_logo' && config.assets?.login_logo) || (dark && config.assets?.dark_logo) || config.assets?.logo;
    box.innerHTML = `${src ? `<img src="${escape(src)}" alt="">` : `<b class="brand-mark">${escape(config.short_name?.slice(0,1) || 'S')}</b>`}<span>${escape(role === 'login_logo' ? config.app_name : config.short_name)}</span>`;
  }
  const media = matchMedia('(prefers-color-scheme: dark)');
  function apply() {
    document.documentElement.dataset.theme = config.theme === 'system' ? (media.matches ? 'dark' : 'light') : config.theme;
    document.documentElement.style.setProperty('--green', config.primary || '#255c4b');
    document.documentElement.style.setProperty('--accent', config.accent || '#dce6a5');
    document.documentElement.dataset.density = config.density;
    document.documentElement.classList.toggle('nav-collapsed', !!config.collapsed);
    document.documentElement.classList.toggle('reduced-motion', !!config.reduced_motion);
    document.documentElement.classList.toggle('high-contrast', !!config.high_contrast);
    document.title = config.app_name + ' · ' + config.subtitle;
    document.documentElement.lang = 'en';
    el('meta[name="description"]').content = config.description || '';
    el('#brandFavicon').href = config.assets?.favicon || config.assets?.logo || 'data:,';
    el('#brandWelcome').textContent = config.welcome;
    el('#brandFooter').textContent = config.app_name;
    el('#brandSubtitle').textContent = config.subtitle;
    brandBox('[data-brand="login"]', 'login_logo');
    brandBox('[data-brand="navigation"]', 'logo');
    if (config.modules) document.querySelectorAll('nav [data-page]').forEach((b) => {
      if (['reports','expenses','suppliers'].includes(b.dataset.page)) b.hidden = !config.modules.includes(b.dataset.page);
    });
    try { el('#today').textContent = new Intl.DateTimeFormat(config.locale, {dateStyle:'medium',timeZone:config.timezone}).format(new Date()); } catch { /* Server validates timezone. */ }
  }
  media.addEventListener('change', apply);
  async function load() { config = await request('settings'); apply(); window.paymentUI?.configure(config); }
  function table(id, rows, columns, target) {
    const state = paging[id] ||= {page:0, q:'',sort:0,desc:false};
    const keys = columns.map((c) => c[0]);
    const filtered = rows.filter((r) => keys.some((key) => String(r[key] ?? '').toLowerCase().includes(state.q.toLowerCase())));
    filtered.sort((a,b) => { const x=a[keys[state.sort]], y=b[keys[state.sort]]; return (typeof x === 'number' && typeof y === 'number' ? x-y : String(x ?? '').localeCompare(String(y ?? ''))) * (state.desc ? -1 : 1); });
    state.page = Math.max(0, Math.min(state.page, Math.ceil(filtered.length/25)-1));
    const show = () => table(id, rows, columns, target);
    target.innerHTML = `<div class="table-tools"><input data-table-search="${id}" aria-label="Search ${escape(id)}" placeholder="Search this table" value="${escape(state.q)}"><span>${filtered.length} records</span></div><div class="table-wrap"><table><thead><tr>${columns.map((c,i)=>`<th><button type="button" class="text" data-sort="${i}">${escape(c[1])}${state.sort===i ? (state.desc?' ↓':' ↑'):''}</button></th>`).join('')}</tr></thead><tbody>${filtered.slice(state.page*25,state.page*25+25).map((r)=>`<tr>${columns.map((c)=>`<td>${c[2] ? c[2](r[c[0]],r) : escape(r[c[0]])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${columns.length}">No matching records.</td></tr>`}</tbody></table></div><div class="table-tools"><button type="button" data-prev ${state.page===0?'disabled':''}>Previous</button><span>Page ${state.page+1} / ${Math.max(1,Math.ceil(filtered.length/25))}</span><button type="button" data-next ${((state.page+1)*25>=filtered.length)?'disabled':''}>Next</button></div>`;
    target.querySelector('[data-table-search]').oninput = (event) => { const pos=event.target.selectionStart;state.q=event.target.value;state.page=0;show();const input=target.querySelector('input');input.focus();input.setSelectionRange(pos,pos); };
    target.querySelectorAll('[data-sort]').forEach((b)=>b.onclick=()=>{const next=Number(b.dataset.sort);state.desc=state.sort===next?!state.desc:false;state.sort=next;show();});
    target.querySelector('[data-prev]').onclick=()=>{state.page--;show();};
    target.querySelector('[data-next]').onclick=()=>{state.page++;show();};
  }
  function card(title, value, note='') { return `<article class="metric"><small>${escape(title)}</small><strong>${escape(value)}</strong><p>${escape(note)}</p></article>`; }
  function chart(rows, key, label, title, format=money) {
    const max = Math.max(1,...rows.map((r)=>Math.abs(r[key] || 0)));
    return `<article class="panel"><h2>${title}</h2><div class="bar-chart" aria-label="${escape(title)}">${rows.some((r)=>r[key]) ? rows.map((r)=>`<div class="bar-row"><span>${escape(r[label])}</span><div><i style="width:${Math.max(0.5,Math.abs(r[key]||0)/max*100)}%;${r[key]<0?'background:#bb4949':''}"></i></div><b>${escape(format(r[key]||0))}</b></div>`).join('') : '<p class="empty">No activity in this period.</p>'}</div></article>`;
  }
  const columns = {
    daily:[['date','Date'],['sales','Net sales',money],['purchases','Purchases',money],['profit','Gross profit',money],['units','Units'],['transactions','Sales transactions']],
    monthly:[['month','Month'],['sales','Net sales',money],['profit','Gross profit',money],['margin','Margin %'],['purchases','Purchases',money]],
    products:[['name','Product'],['category','Category'],['units','Net units'],['sales','Net sales',money],['cogs','COGS',money],['profit','Gross profit',money],['stock','Current stock']],
    categories:[['category','Category'],['sales','Net sales',money],['cogs','COGS',money],['profit','Gross profit',money],['units','Units']],
    valuation:[['name','Product'],['code','Code'],['stock','Current stock'],['cost','Average unit cost',money],['value','Current value',money]],
    low_stock:[['name','Product'],['code','Code'],['stock','Stock'],['minimum','Reorder level']],
    movements:[['id','Line ID'],['local_date','Business date'],['reference','Reference',(v)=>`<button class="text" data-invoice="${escape(v)}">${escape(v)}</button>`],['kind','Type'],['name','Product'],['quantity','Quantity'],['unit_price','Unit price',money],['unit_cost','Cost basis',money],['note','Reason / note']],
    expenses:[['local_date','Date'],['category','Category'],['amount','Expense',money],['payment_method','Payment'],['description','Description'],['reference','Reference'],['payee','Payee']],
  };
  function defaultMonth() { return new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',timeZone:config.timezone}).format(new Date()).replace(/(\d{2})\/(\d{4})/,'$2-$1'); }
  function reportsShell() {
    if (el('#reportForm')) return;
    el('#reports').innerHTML = `<article class="panel"><form id="reportForm" class="report-filters"><label>Month<input name="month" type="month" value="${defaultMonth()}" required></label><button type="button" id="prevMonth">← Month</button><button type="button" id="nextMonth">Month →</button><label>From (optional)<input name="start" type="date"></label><label>Through (inclusive)<input name="end" type="date"></label><label>Product<select name="product"><option value="">All products</option>${currentState.products.map((p)=>`<option value="${p.id}">${escape(p.name)}</option>`).join('')}</select></label><label>Category<select name="category"><option value="">All categories</option>${options([...new Set(currentState.products.map((p)=>p.category).filter(Boolean))])}</select></label><label>Type<select name="kind">${options(['','sale','purchase','sale_return','purchase_return','adjust_in','adjust_out'])}</select></label><button>Apply filters</button></form><p id="reportStatus" role="status"></p></article><div id="reportOutput"></div>`;
    const form=el('#reportForm');
    if (config.report_period==='year') { const y=Number(form.elements.namedItem('month').value.slice(0,4)); form.elements.namedItem('start').value=`${y}-01-01`;form.elements.namedItem('end').value=`${y}-12-31`; }
    form.onsubmit=(e)=>{e.preventDefault();fetchReport();};
    form.elements.namedItem('month').onchange=()=>{form.elements.namedItem('start').value='';form.elements.namedItem('end').value='';};
    for(const [id,delta] of [['prevMonth',-1],['nextMonth',1]]) el('#'+id).onclick=()=>{const [y,m]=form.elements.namedItem('month').value.split('-').map(Number);const d=new Date(Date.UTC(y,m-1+delta,1));form.elements.namedItem('month').value=d.toISOString().slice(0,7);form.elements.namedItem('start').value='';form.elements.namedItem('end').value='';fetchReport();};
  }
  function query() { const q=new URLSearchParams(); for(const [key,value] of new FormData(el('#reportForm'))) if(value)q.set(key,value);return q; }
  async function fetchReport() {
    const seq=++reportSequence;
    const selectedQuery=query().toString();
    el('#reportStatus').textContent='Loading reports…';
    try {
      const data=await request('reports?'+selectedQuery);
      if(seq!==reportSequence)return;
      reportData=data;
      appliedReportQuery=selectedQuery;
      renderReport();
      el('#reportStatus').textContent=`${data.start} through ${data.end} · ${data.timezone} · ${data.currency}`;
    } catch(e){if(seq===reportSequence)el('#reportStatus').textContent=e.message;}
  }
  function renderReport() {
    const d=reportData,t=d.summary;
    const comps=(prior)=>prior ? `${money(prior.sales)} prior period · change ${prior.sales ? ((t.sales-prior.sales)/Math.abs(prior.sales)*100).toFixed(1)+'%' : 'not comparable'}`:'No comparison available';
    el('#reportOutput').innerHTML=`<div id="reportPrintHeader"><h2>${escape(config.company||config.app_name)}</h2><p>${escape(config.report_header)}</p><p>${escape(d.start)} — ${escape(d.end)} · ${escape(d.timezone)}</p></div><div class="metrics">${[
      ['Gross sales',money(t.gross_sales)],['Sales returns',money(t.sales_returns)],['Net sales',money(t.sales)],['Purchase spending',money(t.purchases)],['Supplier returns',money(t.purchase_returns)],['Cost of goods sold',money(t.cogs)],['Gross profit',money(t.profit)],['Gross margin',t.margin===null?'—':t.margin+'%'],['Sales transactions',t.transactions,'Distinct sale references'],['Net units sold',t.units],['Average sale',money(t.average_sale),'Gross sales / sale transactions'],['Recorded expenses',money(t.expenses),d.overhead_allocated?'Whole business':'Not allocated to this filter'],['Stock correction cost',money(t.adjustment_cost)],['Operating result',money(t.operating_result),'Gross profit − recorded expenses − correction cost; excludes tax'],['Current stock value',money(t.current_stock_value),'Today, not historical month-end'],['Low stock products',t.low_stock_count]].map((r)=>card(...r)).join('')}</div><article class="panel"><p>Previous month: ${escape(comps(d.previous))}</p><p>Same month last year: ${escape(comps(d.year_ago))}</p><p class="muted">${escape(d.note)} Unallocated expense totals are excluded from product, category and type slices.</p></article><div class="grid">${chart(d.daily,'sales','date','Daily net sales')}${chart(d.monthly,'sales','month','12-month sales trend')}${chart(d.monthly,'profit','month','12-month gross profit')}${chart(d.monthly,'purchases','month','12-month purchase spending')}${chart(d.products.slice(0,10),'sales','name','Top products by net sales')}${chart(d.categories,'sales','category','Sales by category')}${chart(d.products.slice().sort((a,b)=>b.units-a.units).slice(0,10),'units','name','Top products by net quantity',(v)=>String(v))}${chart(d.monthly,'margin','month','Gross margin trend',(v)=>v+'%')}</div><article class="panel"><div class="toolbar"><select id="reportTable" aria-label="Report table">${Object.keys(columns).map((key)=>`<option value="${key}">${({daily:'Sales / purchase daily summary',monthly:'Monthly gross-profit analysis',products:'Product performance',categories:'Category performance',valuation:'Current inventory valuation',low_stock:'Low stock',movements:'Stock movements / returns / adjustments',expenses:'Expenses'})[key]}</option>`).join('')}<option value="slow_moving">No net sales in selected period</option><option value="expense_categories">Expense categories</option></select><button id="reportCsv">Export selected CSV</button><button id="summaryCsv">Export KPI CSV</button><button id="printReport">Print report</button></div><div id="reportTableOutput"></div></article><p>${escape(config.report_footer)}</p>`;
    el('#reportTable').onchange=showReportTable;
    el('#reportCsv').onclick=()=>downloadReport(el('#reportTable').value);
    el('#summaryCsv').onclick=()=>downloadReport('summary');
    el('#printReport').onclick=()=>{renderPrintTable();document.body.classList.add('print-report');window.print();document.body.classList.remove('print-report');};
    showReportTable();
    window.paymentUI?.reportCash(d.payment_cash);
  }
  function renderPrintTable() {
    let target=el('#reportPrintTable');if(!target){target=document.createElement('div');target.id='reportPrintTable';el('#reportOutput').append(target);}
    const key=el('#reportTable').value;
    const cols=key==='slow_moving'?columns.products:key==='expense_categories'?[['category','Category'],['amount','Amount',money]]:columns[key];
    target.innerHTML='<h2>'+escape(key.replaceAll('_',' '))+'</h2><table><thead><tr>'+cols.map((c)=>'<th>'+escape(c[1])+'</th>').join('')+'</tr></thead><tbody>'+reportData[key].map((r)=>'<tr>'+cols.map((c)=>'<td>'+(c[2]?c[2](r[c[0]],r):escape(r[c[0]]))+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
  }
  async function downloadReport(key) {
    try {
      const q=new URLSearchParams(appliedReportQuery);q.set('table',key);
      const response=await fetch('/api/reports.csv?'+q);
      if(!response.ok)throw Error('Export failed; sign in again');
      const link=document.createElement('a');link.href=URL.createObjectURL(await response.blob());link.download=`${key}-${reportData.start}-${reportData.end}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
    }catch(e){message(e.message,true);}
  }
  function showReportTable() {
    const key=el('#reportTable').value;
    const cols=key==='slow_moving'?columns.products:key==='expense_categories'?[['category','Category'],['amount','Amount',money]]:columns[key];
    table('report-'+key,reportData[key],cols,el('#reportTableOutput'));
  }
  const groups = {
    'Branding & business': ['app_name','short_name','subtitle','description','welcome','company','address','phone','email','website','tax_id','invoice_header','invoice_footer','report_header','report_footer'],
    'Appearance & navigation': ['theme','primary','accent','density','collapsed','reduced_motion','high_contrast','widgets','modules'],
    'Region & display': ['currency','currency_symbol','locale','language','timezone','date_format','time_format','precision','grouping'],
    'Inventory & workflows': ['categories','units','custom_fields','minimum','code_rule','product_sort','product_columns','invoice_prefix','purchase_prefix','payment_methods','default_payment','default_note','report_period'],
  };
  const choices={theme:['system','light','dark'],density:['comfortable','compact'],language:['en'],date_format:['iso','dmy','mdy'],time_format:['24','12'],code_rule:['optional','required'],product_sort:['name','stock','category'],report_period:['month','year']};
  function settingsPage() {
    el('#settings').innerHTML=`<article class="panel"><h2>Branding & appearance</h2><p>Changes apply immediately and persist after restart. Currency is locked once transactions exist. English is the available interface language. Amounts remain stored with two minor-unit digits; precision changes display only.</p><form id="settingsForm">${Object.entries(groups).map(([group,keys])=>`<fieldset><legend>${group}</legend><div class="settings-grid">${keys.map((key)=>{let input;const val=config[key];if(choices[key])input=`<select name="${key}">${options(choices[key],val)}</select>`;else if(typeof val==='boolean')input=`<input type="checkbox" name="${key}" ${val?'checked':''}>`;else input=`<input name="${key}" ${typeof val==='number'?'type="number" min="0"':key==='primary'||key==='accent'?'type="color"':''} value="${escape(Array.isArray(val)?val.join(', '):val)}">`;return `<label>${escape(key.replaceAll('_',' '))}${input}</label>`;}).join('')}</div></fieldset>`).join('')}<p class="muted">Lists use commas. Widget order: sales, profit, purchases, stock. Modules: reports, expenses, suppliers. Optional product columns: category, cost, price. Units label whole-unit quantities; decimal quantities and automatic tax calculation are not supported.</p><button>Save settings</button><button type="button" id="resetAppearance">Restore default appearance</button><p id="settingsStatus" role="status"></p></form></article><article class="panel"><h2>Logos & browser icon</h2><p>PNG, JPEG, WebP only; max 2 MiB, 8–4096 pixels per side, max 10 megapixels. SVG is not accepted. Uploads are checked and re-encoded before replacing the active logo.</p><div class="settings-grid">${['logo','dark_logo','favicon','login_logo','business_logo'].map((role)=>`<div><h3>${role.replaceAll('_',' ')}</h3><img class="asset-preview" id="preview-${role}" ${config.assets[role]?`src="${escape(config.assets[role])}"`:'hidden'} alt="${role} preview"><input type="file" accept="image/png,image/jpeg,image/webp" data-asset="${role}" aria-label="Upload ${role}"><button type="button" data-remove-asset="${role}">Remove</button><p id="asset-status-${role}" role="status"></p></div>`).join('')}</div></article>`;
    el('#settingsForm').onsubmit=async(e)=>{e.preventDefault();const status=el('#settingsStatus');const button=e.submitter;if(!confirm('Save these business and appearance settings?'))return;button.disabled=true;try{const data={};for(const keys of Object.values(groups))for(const key of keys){const input=e.target.elements.namedItem(key);data[key]=typeof config[key]==='boolean'?input.checked:typeof config[key]==='number'?Number(input.value):Array.isArray(config[key])?input.value.split(',').map((v)=>v.trim()).filter(Boolean):input.value;}status.textContent='Saving…';config=await request('settings',data);apply();status.textContent='Saved successfully.';}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
    el('#resetAppearance').onclick=async()=>{if(!confirm('Restore default colors, theme, density and navigation?'))return;try{config=await request('settings',{theme:'system',primary:'#255c4b',accent:'#dce6a5',density:'comfortable',collapsed:false,reduced_motion:false,high_contrast:false,widgets:['sales','profit','purchases','stock']});apply();settingsPage();}catch(e){message(e.message,true);}};
    document.querySelectorAll('[data-asset]').forEach((input)=>input.onchange=async()=>{const file=input.files[0];if(!file)return;const role=input.dataset.asset;const status=el('#asset-status-'+role);input.disabled=true;try{if(file.size>2*1024*1024)throw Error('File exceeds 2 MiB');status.textContent='Validating and saving…';const content=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('Cannot read file'));reader.readAsDataURL(file);});config=await request('asset',{role,content});apply();el('#preview-'+role).src=config.assets[role];el('#preview-'+role).hidden=false;status.textContent='Saved.';}catch(e){status.textContent=e.message;}finally{input.disabled=false;input.value='';}});
    document.querySelectorAll('[data-remove-asset]').forEach((b)=>b.onclick=async()=>{if(!confirm('Remove this active image?'))return;try{config=await request('asset',{role:b.dataset.removeAsset,remove:true});apply();settingsPage();}catch(e){message(e.message,true);}});
  }
  async function administration() {
    admin=await request('administration');
    if(currentPage==='expenses') {
      el('#expenses').innerHTML=`<article class="panel"><h2>Record an expense</h2><form id="expenseForm" class="settings-grid"><label>Date<input name="date" type="date" value="${new Intl.DateTimeFormat('en-CA',{timeZone:config.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}" required></label><label>Category<input name="category" required maxlength="100"></label><label>Amount (${escape(config.currency)})<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Payment method<select name="payment_method">${options(config.payment_methods,config.default_payment)}</select></label><label>Description<input name="description" maxlength="1000"></label><label>Payee<input name="payee" maxlength="200"></label><button>Save expense</button></form><p>Expenses are immutable records. Use Reports to filter, summarize and export them.</p></article><article class="panel" id="expensesTable"></article>`;
      table('expenses',admin.expenses.map((r)=>({...r,local_date:date(r.created)})),[...columns.expenses,['reversal_reference','Correction',(v,r)=>v?'Reversed: '+escape(v):`<button class="text" data-reverse-expense="${r.id}">Reverse expense</button>`]],el('#expensesTable'));
      formSubmit('#expenseForm','expense');
    } else if(currentPage==='suppliers') {
      el('#suppliers').innerHTML='<article class="panel"><h2>Add supplier</h2><form id="supplierForm" class="settings-grid"><label>Name<input name="name" maxlength="200" required></label><label>Phone<input name="phone" maxlength="100"></label><label>Address<input name="address" maxlength="1000"></label><button>Save supplier</button></form></article><article class="panel" id="suppliersTable"></article>';
      table('suppliers',admin.suppliers,[['name','Name'],['phone','Phone'],['address','Address']],el('#suppliersTable'));
      formSubmit('#supplierForm','supplier');
    }
  }
  function formSubmit(selector,path,after=administration) {el(selector).onsubmit=async(e)=>{e.preventDefault();e.submitter.disabled=true;try{await request(path,Object.fromEntries(new FormData(e.target)));message('Saved successfully.');await after();}catch(error){message(error.message,true);}finally{e.submitter.disabled=false;}};}
  function transactionExtras(kind) {
    const panel=el('#'+kind+' .panel:last-child');
    const draft=drafts[kind]||{payment_method:config.default_payment,note:config.default_note,supplier_id:''};
    const box=document.createElement('div');box.className='transaction-options';box.innerHTML=`<label>Payment method (label only; no payment collection)<select id="${kind}Payment">${options(config.payment_methods,draft.payment_method)}</select></label><label>Note<input id="${kind}Note" maxlength="1000" value="${escape(draft.note)}"></label>${kind==='purchase'?`<label>Supplier<select id="purchaseSupplier" data-ready="${supplierCache===null?'false':'true'}"><option value="">No supplier</option>${(supplierCache||[]).map((p)=>`<option value="${p.id}" ${String(p.id)===String(draft.supplier_id)?'selected':''}>${escape(p.name)}</option>`).join('')}</select></label>`:''}`;panel.prepend(box);
    window.paymentUI?.attach(kind,box);
    box.addEventListener('input',captureDrafts);
    box.addEventListener('change',captureDrafts);
    const supplierSelect=kind==='purchase'?el('#purchaseSupplier'):null;
    if(kind==='purchase')request('administration').then((data)=>{supplierCache=data.suppliers;const select=el('#purchaseSupplier');if(select!==supplierSelect)return;const wanted=select?.dataset.ready==='true'?select.value:(drafts.purchase?.supplier_id||draft.supplier_id||'');if(select)select.innerHTML='<option value="">No supplier</option>'+data.suppliers.map((p)=>`<option value="${p.id}">${escape(p.name)}</option>`).join('');if(select){select.value=wanted;select.dataset.ready='true';}}).catch((e)=>message(e.message,true));
  }
  function openDialog(content) {el('#adminDialogContent').innerHTML=content;el('#adminDialog').showModal();}
  function editProduct(id) {
    const p=currentState.products.find((p)=>p.id===Number(id));
    openDialog(`<h2>Edit product</h2><form id="editProductForm"><input name="id" value="${p.id}" type="hidden">${['name','code','category'].map((key)=>`<label>${key}<input name="${key}" value="${escape(p[key])}" ${key==='category'?'':'required'} maxlength="200"></label>`).join('')}<label>Selling price<input name="price" type="number" min="0" step="0.01" value="${p.price/100}" required></label><label>Low-stock level<input name="minimum" type="number" min="0" step="1" value="${p.minimum}" required></label><label>Unit<select name="unit">${options(config.units,p.unit)}</select></label>${config.custom_fields.map((key)=>`<label>${escape(key)}<input data-custom="${escape(key)}" value="${escape(JSON.parse(p.custom_json||'{}')[key]||'')}" maxlength="500"></label>`).join('')}<p>Existing movement names and categories remain unchanged. Correct quantities through stock adjustments.</p><button>Save changes</button><p id="editStatus" role="status"></p></form>`);
    el('#editProductForm').onsubmit=async(e)=>{e.preventDefault();e.submitter.disabled=true;try{const data=Object.fromEntries(new FormData(e.target));data.custom={};e.target.querySelectorAll('[data-custom]').forEach((input)=>data.custom[input.dataset.custom]=input.value);await request('product-edit',data);el('#adminDialog').close();location.reload();}catch(error){el('#editStatus').textContent=error.message;}finally{e.submitter.disabled=false;}};
  }
  function correctionDialog() {
    openDialog(`<h2>Return / stock correction</h2><p>Returns must reference an original ledger line ID. Adjustment costs enter the operating result. Enter “damaged” or “expired” in the reason for write-offs.</p><form id="correctionForm"><label>Type<select name="kind">${options(['sale_return','purchase_return','adjust_in','adjust_out'])}</select></label><label>Product<select name="product_id">${currentState.products.map((p)=>`<option value="${p.id}">${escape(p.name)}</option>`).join('')}</select></label><label>Original line ID (returns only)<input name="original_id" type="number" min="1"></label><label>Quantity<input name="quantity" type="number" min="1" step="1" required></label><label>Unit cost (stock added only)<input name="cost" type="number" min="0" step="0.01" value="0"></label><label>Reason<input name="reason" required maxlength="1000"></label><button>Save correction</button><p id="correctionStatus" role="status"></p></form>`);
    el('#correctionForm').onsubmit=async(e)=>{e.preventDefault();if(!confirm('Record this permanent ledger correction?'))return;e.submitter.disabled=true;try{await request('correction',Object.fromEntries(new FormData(e.target)));el('#adminDialog').close();location.reload();}catch(error){el('#correctionStatus').textContent=error.message;}finally{e.submitter.disabled=false;}};
  }
  function reverseExpense(id) {
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:config.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    openDialog(`<h2>Reverse expense</h2><p>The original record stays in the ledger. An equal negative expense is recorded on the date below. Record a new expense separately if you need a replacement.</p><form id="expenseReverseForm"><input name="expense_id" type="hidden" value="${Number(id)}"><label>Correction date<input name="date" type="date" value="${day}" required></label><label>Reason<input name="reason" required maxlength="1000"></label><button>Confirm reversal</button><p id="expenseReverseStatus" role="status"></p></form>`);
    el('#expenseReverseForm').onsubmit=async(e)=>{e.preventDefault();if(!confirm('Record this permanent expense reversal?'))return;e.submitter.disabled=true;try{await request('expense-reverse',Object.fromEntries(new FormData(e.target)));el('#adminDialog').close();await administration();message('Expense reversed. Original record preserved.');}catch(error){el('#expenseReverseStatus').textContent=error.message;}finally{e.submitter.disabled=false;}};
  }
  async function invoice(reference) {
    const data=await request('invoice?reference='+encodeURIComponent(reference));
    const t=data.transaction;let total=0;
    openDialog(`<div class="invoice"><img class="asset-preview" ${config.assets.business_logo||config.assets.logo?`src="${escape(config.assets.business_logo||config.assets.logo)}"`:'hidden'} alt="Business logo"><h2>${escape(config.company||config.app_name)}</h2><p>${escape(config.address)}<br>${escape(config.phone)} ${escape(config.email)}</p><p>${escape(config.tax_id)}</p><p>${escape(config.invoice_header)}</p><h3>${escape(t.kind)} · ${escape(reference)}</h3><p>${escape(date(t.created))} ${escape(time(t.created))} · ${escape(config.currency)}</p><div class="table-wrap"><table><thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${data.lines.map((r)=>{const value=r.quantity*r.unit_price;total+=value;return `<tr><td>${escape(r.name_snapshot)}</td><td>${r.quantity}</td><td>${escape(money(r.unit_price))}</td><td>${escape(money(value))}</td></tr>`;}).join('')}</tbody></table></div><h3>Total: ${escape(money(total))}</h3><p>${escape(t.note)}</p><p>Preferred / initial payment method: ${escape(t.payment_method)}</p>${window.paymentUI?window.paymentUI.invoiceHTML(data.settlement):''}<p>${escape(config.invoice_footer)}</p></div><button id="printInvoice">Print invoice / receipt</button>`);
    el('#printInvoice').onclick=()=>{document.body.classList.add('print-invoice');window.print();document.body.classList.remove('print-invoice');};
  }
  document.addEventListener('click',async(e)=>{const button=e.target.closest('button');if(!button)return;try{if(button.dataset.editProduct)editProduct(button.dataset.editProduct);if(button.dataset.invoice)await invoice(button.dataset.invoice);if(button.dataset.reverseExpense)reverseExpense(button.dataset.reverseExpense);}catch(error){message(error.message,true);}});
  function afterRender(state,page) {
    window.paymentUI?.dashboard(state.totals.settlements);
    if(page==='payments')window.paymentUI?.renderPage();
    if(page==='customers')window.paymentUI?.renderCustomers();
    currentState=state;currentPage=page;
    if(!el('#fullBackup')){const b=document.createElement('button');b.id='fullBackup';b.textContent='Download full backup';el('.aside-bottom').prepend(b);b.onclick=async()=>{b.disabled=true;try{const response=await fetch('/api/backup-bundle');if(!response.ok)throw Error('Backup failed; sign in again');const link=document.createElement('a');link.href=URL.createObjectURL(await response.blob());link.download='inventory-full-backup.zip';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}catch(error){message(error.message,true);}finally{b.disabled=false;}};}
    const metrics=Array.from(el('#metrics').children), map={purchases:metrics[0],sales:metrics[1],profit:metrics[2],stock:metrics[3]};
    el('#metrics').replaceChildren(...config.widgets.map((key)=>map[key]).filter(Boolean));
    for(const kind of ['purchase','sale'])transactionExtras(kind);
    el('#products').querySelectorAll('tr').forEach((row)=>{const code=row.querySelector('small')?.textContent;const p=state.products.find((p)=>p.code===code);if(p){const action=document.createElement('button');action.className='text';action.dataset.editProduct=p.id;action.textContent='Edit';row.lastElementChild.append(action);}});
    let correction=el('#openCorrection');if(!correction){correction=document.createElement('button');correction.id='openCorrection';correction.type='button';correction.textContent='Returns / stock adjustment';el('#history .toolbar').append(correction);}correction.onclick=correctionDialog;
    if(!el('#historyEnhanced')){el('#history .panel .table-wrap').hidden=true;el('#history .panel').insertAdjacentHTML('beforeend','<div id="historyEnhanced"></div>');}
    if(!el('#inventoryEnhanced')){el('#inventory .panel .table-wrap').hidden=true;el('#inventory .panel').insertAdjacentHTML('beforeend','<div id="inventoryEnhanced"></div>');}
    if(page==='history')fetchHistory();
    const productCols=[['name','Product',(v,p)=>`<b>${escape(v)}</b><small>${escape(p.code)}</small><button class="text" data-edit-product="${p.id}">Edit</button>`],...config.product_columns.map((key)=>[key,key,key==='category'?undefined:money]),['stock','Stock'],['unit','Unit'],['minimum','Reorder level']];
    const products=[...state.products].sort((a,b)=>config.product_sort==='stock'?a.stock-b.stock:String(a[config.product_sort]).localeCompare(String(b[config.product_sort])));
    const draw=()=>table('inventory',products.filter((p)=>(p.name+' '+p.code+' '+p.category).toLowerCase().includes(el('#search').value.toLowerCase())),productCols,el('#inventoryEnhanced'));
    el('#search').oninput=draw;draw();
    if(page==='reports'){reportsShell();fetchReport();}
    if(page==='settings')settingsPage();
    if(page==='expenses'||page==='suppliers')administration().catch((e)=>message(e.message,true));
    // Region-aware labels in existing product and cart forms.
    document.querySelectorAll('#productForm label,.cart-row label').forEach((label)=>{const node=label.firstChild;if(node?.nodeType===Node.TEXT_NODE)node.textContent=node.textContent.replace('(BDT)','('+config.currency+')');});
  }
  el('#closeAdmin').onclick=()=>el('#adminDialog').close();
  el('#toggleNav').onclick=()=>{config.collapsed=!config.collapsed;apply();};
  el('#addProduct').addEventListener('click',()=>{const form=el('#productForm');form.elements.minimum.value=config.minimum;let units=el('#newProductUnit');if(!units){const label=document.createElement('label');label.textContent='Measurement unit (whole quantities)';units=document.createElement('select');units.id='newProductUnit';units.name='unit';label.append(units);form.insertBefore(label,el('#saveProduct'));}units.innerHTML=options(config.units,config.units[0]);form.elements.category.setAttribute('list','categoryChoices');let list=el('#categoryChoices');if(!list){list=document.createElement('datalist');list.id='categoryChoices';form.append(list);}list.innerHTML=options(config.categories);});
  window.erp={load,money,afterRender,table,exportReport:downloadReport,captureDrafts,resetDraft,exportHistory,transactionData:(kind)=>({payment_method:el('#'+kind+'Payment')?.value||config.default_payment,note:el('#'+kind+'Note')?.value||'',supplier_id:kind==='purchase'?el('#purchaseSupplier')?.value||null:null,...(window.paymentUI?window.paymentUI.data(kind):{})})};
  request('public-settings').then((data)=>{if(!config.app_name){config={...config,...data};apply();}}).catch((e)=>{el('#loginError').textContent=e.message;});
})();
