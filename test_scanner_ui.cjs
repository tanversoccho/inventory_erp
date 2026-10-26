/* Optional DOM/HTTP integration. Uses its own temporary database; requires jsdom. */
const {JSDOM,VirtualConsole}=require('jsdom');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {randomBytes}=require('node:crypto');
const assert=require('node:assert/strict');
const path=require('node:path');
const password=randomBytes(24).toString('hex');
const fixture=spawn(process.env.PYTHON_EXECUTABLE||'python',[path.join(__dirname,'browser_fixture.py')],{cwd:__dirname,env:{...process.env,ERP_TEST_PASSWORD:password},stdio:['ignore','pipe','pipe']});
let dom,phoneDom;const lines=createInterface({input:fixture.stdout});
const port=new Promise((resolve,reject)=>{lines.once('line',(line)=>resolve(JSON.parse(line).port));fixture.once('error',reject);fixture.once('exit',(code)=>reject(Error('Fixture exited '+code)));});
(async()=>{
 const base='http://127.0.0.1:'+await port,errors=[],vc=new VirtualConsole();let cookie='',losePaymentResponse=false;const paymentBodies=[];
 vc.on('jsdomError',(e)=>{if(!e.message.includes('navigation'))errors.push(e.message);});
 dom=await JSDOM.fromURL(base,{resources:'usable',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
  w.matchMedia=()=>({matches:false,addEventListener(){}});w.confirm=()=>true;w.print=()=>{};w.alert=(m)=>errors.push(m);
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};
  w.fetch=async(url,options={})=>{if(String(url).startsWith('/api/product-lookup?code=840205744336'))return {ok:true,json:async()=>({found:true,name:'Catalog test noodles',category:'Noodles',source:'Test catalog',license:'Fixture only',source_url:'https://example.com/product'})};const response=await fetch(new URL(url,base),{...options,headers:{...(options.headers||{}),Cookie:cookie}});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(url==='/api/payment'){paymentBodies.push(JSON.parse(options.body));if(losePaymentResponse){losePaymentResponse=false;throw Error('Simulated response lost after payment committed');}}return response;};
 }});
 const w=dom.window,d=w.document;
 async function until(fn,label){for(let i=0;i<300;i++){if(fn())return;await new Promise((r)=>setTimeout(r,20));}throw Error('Timeout '+label+' notice='+d.querySelector('#notice')?.textContent+' modal='+d.querySelector('#settlementStatus')?.textContent+' errors='+errors.join('\n'));}
 const click=(s)=>{assert(d.querySelector(s),s);d.querySelector(s).click();};
 const submit=(s)=>{const form=d.querySelector(s);assert(form,s);form.dispatchEvent(new w.SubmitEvent('submit',{cancelable:true,submitter:form.querySelector('button:not([type="button"])')}));};
 async function openAccount(ref){await until(()=>d.querySelector('[data-table-search="dues"]'),'dues search');const input=d.querySelector('[data-table-search="dues"]');input.value=ref;input.dispatchEvent(new w.Event('input',{bubbles:true}));await until(()=>d.querySelector('[data-account="'+ref+'"]'),'searched invoice');click('[data-account="'+ref+'"]');}
 const query=async(s)=>{const response=await w.fetch('/api/'+s);assert(response.ok,s);return response.json();};
 await until(()=>w.erp&&w.paymentUI&&w.erpScan,'startup');d.querySelector('#password').value=password;submit('#loginForm');await until(()=>!d.querySelector('#workspace').hidden,'login');
 assert(d.querySelector('#settlementMetrics').textContent.includes('Customers owe you'));
 click('[data-page="sale"]');click('#quickCustomer');d.querySelector('#customerForm').elements.name.value='Customer Credit';d.querySelector('#customerForm').elements.phone.value='01001';submit('#customerForm');await until(()=>!d.querySelector('#adminDialog').open,'new customer');assert.equal(d.querySelector('#saleCustomer').value,'1');
 d.querySelector('#saleSelect').value='1';click('[data-add="sale"]');const quantity=d.querySelector('[data-edit="sale:0:quantity"]');quantity.value='5';quantity.dispatchEvent(new w.Event('input',{bubbles:true}));
 d.querySelector('#salePayMode').value='partial';d.querySelector('#salePayMode').dispatchEvent(new w.Event('change',{bubbles:true}));d.querySelector('#salePaid').value='40';d.querySelector('#saleDueDate').value='2026-09-30';
 click('[data-page="inventory"]');click('[data-page="sale"]');await until(()=>d.querySelector('#saleCustomer').value==='1','customer draft');assert.equal(d.querySelector('#salePayMode').value,'partial');assert.equal(d.querySelector('#salePaid').value,'40');
 click('[data-save="sale"]');await until(()=>d.querySelector('#notice').textContent.includes('INV-'),'partial sale');const saleRef=d.querySelector('#notice').textContent.split('Reference: ')[1];let a=await query('payment-account?reference='+saleRef);assert.equal(a.due,6000);assert.equal(a.net_paid,4000);
 click('[data-page="purchase"]');await until(()=>d.querySelector('#purchaseSupplier option[value="1"]'),'vendor');d.querySelector('#purchaseSupplier').value='1';d.querySelector('#purchaseSelect').value='1';click('[data-add="purchase"]');const pq=d.querySelector('[data-edit="purchase:0:quantity"]');pq.value='5';pq.dispatchEvent(new w.Event('input',{bubbles:true}));d.querySelector('#purchasePayMode').value='unpaid';d.querySelector('#purchasePayMode').dispatchEvent(new w.Event('change',{bubbles:true}));
 click('[data-save="purchase"]');await until(()=>d.querySelector('#notice').textContent.includes('PUR-'),'unpaid purchase');const purchaseRef=d.querySelector('#notice').textContent.split('Reference: ')[1];assert.equal((await query('payment-account?reference='+purchaseRef)).due,5000);
 const stock=(await query('state')).products[0].stock;
 click('[data-page="payments"]');await openAccount(saleRef);await until(()=>d.querySelector('#installmentForm'),'installment form');d.querySelector('#installmentForm').elements.amount.value='20';losePaymentResponse=true;submit('#installmentForm');await until(()=>d.querySelector('#settlementStatus').textContent.includes('Simulated response lost'),'lost response');submit('#installmentForm');await until(()=>d.querySelector('#installmentForm')?.elements.amount.max==='40','replayed installment');assert.equal(paymentBodies[0].request_id,paymentBodies[1].request_id);a=await query('payment-account?reference='+saleRef);assert.equal(a.payments.length,2);assert.equal(a.due,4000);
 d.querySelector('#installmentForm').elements.amount.value='40';submit('#installmentForm');await until(()=>d.querySelector('.settlement-print')?.textContent.includes('Paid')&&!d.querySelector('#installmentForm'),'settled sale');assert.equal((await query('state')).products[0].stock,stock);
 click('#closeAdmin');await openAccount(purchaseRef);await until(()=>d.querySelector('#installmentForm'),'vendor installment');d.querySelector('#installmentForm').elements.amount.value='50';submit('#installmentForm');await until(()=>!d.querySelector('#installmentForm')&&d.querySelector('.settlement-print')?.textContent.includes('Paid'),'vendor settled');click('#closeAdmin');
 const data=await query('payments');const legacy=data.accounts.find((r)=>r.kind==='sale'&&!r.confirmed);await openAccount(legacy.reference);await until(()=>d.querySelector('#confirmOpening'),'legacy confirmation');d.querySelector('#confirmOpening').elements.opening_paid.value=String(legacy.original_total/100);d.querySelector('#confirmOpening').elements.customer_id.value='1';d.querySelector('#confirmOpening').elements.note.value='Checked old records';submit('#confirmOpening');await until(()=>!d.querySelector('#confirmOpening'),'confirmed opening');click('#closeAdmin');
 d.querySelector('#statementCustomer').value='1';click('#customerStatement');await until(()=>d.querySelector('#printStatement'),'statement');assert(d.querySelector('.invoice').textContent.includes('Customer Credit'));assert(d.querySelector('.invoice').textContent.includes(saleRef));click('#closeAdmin');
 // Exercise printable invoice integration through existing transaction history.
 click('[data-page="history"]');await until(()=>d.querySelector(`#historyEnhanced [data-invoice="${saleRef}"]`),'invoice reference');click(`#historyEnhanced [data-invoice="${saleRef}"]`);await until(()=>d.querySelector('#printInvoice'),'invoice');assert(d.querySelector('.invoice').textContent.includes('Balance due:'));assert(d.querySelector('.invoice').textContent.includes('Customer Credit'));

 click('#closeAdmin');click('[data-page="customers"]');await until(()=>d.querySelector('#customerList'),'customer list');assert(d.querySelector('#customerList').textContent.includes('Customer Credit'));assert(d.querySelector('#customerList').textContent.includes('Outstanding'));
 d.querySelector('#customerSearch').value='not-a-customer';click('#findCustomers');await until(()=>d.querySelector('#customers').textContent.includes('0 customer(s)'),'customer search');
 d.querySelector('#customerSearch').value='';click('#findCustomers');await until(()=>d.querySelector('[data-customer-statement]'),'customer statement button');click('[data-customer-statement]');await until(()=>d.querySelector('#printStatement'),'customer page statement');click('#closeAdmin');
 click('#addProduct');d.querySelector('#productCode').value='840205744336';d.querySelector('#productCode').dispatchEvent(new w.Event('input',{bubbles:true}));await until(()=>d.querySelector('#productName').value==='Catalog test noodles','automatic catalog name');assert.equal(d.querySelector('#productForm').elements.category.value,'Noodles');assert.equal(d.querySelector('#productForm').elements.price.value,'');d.querySelector('#productDialog').close();

 // Two independent browser contexts: laptop is signed in; phone has no ERP cookie.
 const beforeSyncStock=(await query('state')).products[0].stock;
 click('#pairPhone');d.querySelector('#pairTarget').value='product';click('#startPairing');await until(()=>d.querySelector('#pairLink a'),'pairing QR/link');assert(d.querySelector('#pairQr svg'));assert(w.photoDecoder);assert(d.querySelector('#stopPhotoScan'));
 const phoneURL=new URL(d.querySelector('#pairLink a').href);phoneURL.host=new URL(base).host;
 phoneDom=await JSDOM.fromURL(phoneURL.href,{resources:'usable',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(p){
   p.matchMedia=()=>({matches:false,addEventListener(){}});p.confirm=()=>true;p.print=()=>{};p.alert=(m)=>errors.push(m);
   p.HTMLDialogElement.prototype.showModal=function(){this.open=true;};p.HTMLDialogElement.prototype.close=function(){this.open=false;};
   p.fetch=(url,options={})=>fetch(new URL(url,base),options);
 }});
 const phone=phoneDom.window.document,pw=phoneDom.window;
 await until(()=>phone.querySelector('#phoneScannerStatus')?.textContent.includes('Ready to scan'),'phone paired');assert(phone.querySelector('#login').hidden);assert(phone.querySelector('#workspace').hidden);
 phone.querySelector('#phoneCode').value='840205744336';phone.querySelector('#phoneSendForm').dispatchEvent(new pw.Event('submit',{cancelable:true}));
 await until(()=>d.querySelector('#productName').value==='Catalog test noodles'&&d.querySelector('#scannerLaptopStatus').textContent.includes('Review the item'),'phone fills laptop');
 await until(()=>phone.querySelector('#phoneScannerStatus').textContent.includes('Finish the item'),'phone acknowledgment');assert(phone.querySelector('#phoneSend').disabled);assert.equal((await query('state')).products[0].stock,beforeSyncStock);
 click('#scannerReady');await until(()=>!phone.querySelector('#phoneSend').disabled,'ready next scan');
 click('#pairPhone');click('#stopPairing');await until(()=>phone.querySelector('#phoneScannerStatus').textContent.includes('session ended'),'phone revoked');phoneDom.window.close();phoneDom=null;
 click('#closePairing');if(d.querySelector('#productDialog').open)d.querySelector('#productDialog').close();
 // Existing product goes to laptop sale fields without recording a sale.
 click('#pairPhone');d.querySelector('#pairTarget').value='sale';click('#startPairing');await until(()=>d.querySelector('#pairLink a'),'sale pair');const params=new URLSearchParams(new URL(d.querySelector('#pairLink a').href).hash.slice(1));const channel=params.get('channel'),scannerToken=params.get('token'),device='test-second-phone-123456';
 async function phonePost(action,extra={}){const res=await fetch(base+'/api/scanner/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Scanner-Token':scannerToken},body:JSON.stringify({channel,device,...extra})});assert.equal(res.status,200);return res.json();}
 await phonePost('connect');await until(()=>!d.querySelector('#pairScannerDialog').open,'sale pair connected');await phonePost('send',{code:'FIX',scan_id:'fixture-sale-scan-123456'});await until(()=>d.querySelector('#saleName')?.value==='Fixture product','sale field synchronized');assert.equal((await query('state')).products[0].stock,beforeSyncStock);click('#pairPhone');click('#stopPairing');
 await new Promise((r)=>setTimeout(r,100));assert.deepEqual(errors,[]);console.log('PASS: paired independent phone and laptop, catalog autofill, acknowledgment, pause/resume, revocation, sale selection; automatic catalog fill, customer list/search/statements; customer creation, partial sale, unpaid vendor purchase, draft persistence, payment retry deduplication, later installments, historical confirmation, statements, invoice balances and unchanged stock after payments.');
})().catch((e)=>{console.error(e);process.exitCode=1;}).finally(()=>{if(phoneDom)phoneDom.window.close();if(dom)dom.window.close();lines.close();fixture.kill();});
