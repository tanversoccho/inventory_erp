"""Settlements use temporary databases; no business records are opened."""
import datetime as dt
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
import server
import payments
import erp_features as f


class PaymentTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.old=server.DB
        server.DB=Path(self.temp.name)/'test.sqlite3';server.initialize()
        server.create_product({'name':'Product','code':'PAY-TEST','quantity':100,'cost':5,'price':10})
        payments.customer(server,{'name':'Customer A','phone':'01000'})
        f.supplier(server,{'name':'Vendor A'})
    def tearDown(self):server.DB=self.old;self.temp.cleanup()
    def tx(self,kind='sale',mode='partial',paid='30',quantity=10,key=None,due=''):
        data={'kind':kind,'items':[{'id':1,'quantity':quantity,'price':10}],'payment_mode':mode,'amount_paid':paid,'customer_id':1,'supplier_id':1,'due_date':due}
        if key:data['request_id']=key
        return server.transaction(data)['reference']
    def account(self,ref):
        with server.connect() as c:return payments.account(server,c,ref)
    def pay(self,ref,amount,key='installment-123456789',kind='payment'):
        return payments.record(server,{'reference':ref,'amount':amount,'method':'Cash','kind':kind,'request_id':key})
    def test_full_partial_and_unpaid_sales_and_purchases(self):
        for kind in ('sale','purchase'):
            for mode,expected in [('full',10000),('partial',3000),('unpaid',0)]:
                ref=self.tx(kind,mode);r=self.account(ref)
                self.assertEqual(r['net_paid'],expected);self.assertEqual(r['due'],10000-expected)
                self.assertEqual(r['status'],{'full':'Paid','partial':'Partially paid','unpaid':'Unpaid'}[mode])
    def test_multiple_installments_close_balance_without_stock_or_profit_changes(self):
        ref=self.tx();before=f.report(server,{} )['summary']
        with server.connect() as c:stock=c.execute('SELECT stock FROM products').fetchone()[0];lines=c.execute('SELECT count(*) FROM movements').fetchone()[0]
        self.pay(ref,20);self.pay(ref,50,'second-installment-12345')
        self.assertEqual(self.account(ref)['status'],'Paid')
        self.assertEqual(before,f.report(server,{})['summary'])
        with server.connect() as c:
            self.assertEqual(c.execute('SELECT stock FROM products').fetchone()[0],stock)
            self.assertEqual(c.execute('SELECT count(*) FROM movements').fetchone()[0],lines)
    def test_credit_requires_matching_saved_party_and_rolls_back(self):
        for kind in ('sale','purchase'):
            with server.connect() as c:before=c.execute('SELECT stock FROM products').fetchone()[0]
            with self.assertRaises(ValueError):server.transaction({'kind':kind,'items':[{'id':1,'quantity':1,'price':10}],'payment_mode':'unpaid'})
            with server.connect() as c:self.assertEqual(c.execute('SELECT stock FROM products').fetchone()[0],before)
    def test_invalid_partial_and_overpayment_rejected(self):
        for amount in (0,100,101,-1):
            with self.assertRaises(ValueError):self.tx(paid=amount)
        ref=self.tx()
        for amount in (0,-1,71):
            with self.assertRaises(ValueError):self.pay(ref,amount)
        self.assertEqual(self.account(ref)['due'],7000)
    def test_duplicate_invoice_and_payment_retries_are_safe(self):
        ref=self.tx(key='invoice-retry-123456789');other=self.tx(key='invoice-retry-123456789')
        self.assertEqual(ref,other)
        a=self.pay(ref,20);server.initialize();b=self.pay(ref,20)
        self.assertEqual(a['receipt'],b['receipt']);self.assertEqual(self.account(ref)['net_paid'],5000)
        with self.assertRaises(ValueError):self.pay(ref,21)
    def test_concurrent_installments_do_not_overpay(self):
        ref=self.tx(mode='unpaid');outcomes=[]
        def pay(i):
            try:self.pay(ref,70,'concurrent-payment-'+str(i));outcomes.append(True)
            except ValueError:outcomes.append(False)
        threads=[threading.Thread(target=pay,args=(i,)) for i in range(2)]
        for t in threads:t.start()
        for t in threads:t.join()
        self.assertEqual(sorted(outcomes),[False,True]);self.assertEqual(self.account(ref)['due'],3000)
    def test_returns_reduce_dues_and_create_refund_balance(self):
        for kind,return_kind in [('sale','sale_return'),('purchase','purchase_return')]:
            ref=self.tx(kind,'full')
            with server.connect() as c:line=c.execute('SELECT id FROM movements WHERE reference=?',(ref,)).fetchone()[0]
            f.correction(server,{'kind':return_kind,'product_id':1,'quantity':4,'original_id':line,'reason':'Returned'})
            r=self.account(ref);self.assertEqual(r['net_total'],6000);self.assertEqual(r['refund_due'],4000)
            self.pay(ref,40,'refund-request-'+kind+'-123456','refund')
            self.assertEqual(self.account(ref)['status'],'Paid')
            with self.assertRaises(ValueError):self.pay(ref,1,'extra-refund-'+kind+'-123456','refund')
    def test_unpaid_return_and_partial_return_do_not_fabricate_cash(self):
        ref=self.tx(mode='unpaid')
        with server.connect() as c:line=c.execute('SELECT id FROM movements WHERE reference=?',(ref,)).fetchone()[0]
        f.correction(server,{'kind':'sale_return','product_id':1,'quantity':3,'original_id':line,'reason':'Returned'})
        self.assertEqual(self.account(ref)['due'],7000);self.assertEqual(self.account(ref)['net_paid'],0)
    def test_historical_opening_is_explicit_and_not_new_cash(self):
        ref=server.transaction({'kind':'sale','items':[{'id':1,'quantity':10,'price':10}]})['reference']
        self.assertEqual(self.account(ref)['status'],'Unconfirmed')
        with self.assertRaises(ValueError):self.pay(ref,10)
        payments.confirm_legacy(server,{'reference':ref,'opening_paid':40,'customer_id':1,'note':'Checked customer ledger','due_date':'2026-01-01'})
        self.assertEqual(self.account(ref)['due'],6000);self.assertTrue(self.account(ref)['overdue'])
        cash=payments.cash_summary(server,'2000-01-01','2099-12-31');self.assertEqual(cash['customer_receipts'],0)
        self.pay(ref,10);self.assertEqual(payments.cash_summary(server,'2000-01-01','2099-12-31')['customer_receipts'],1000)
        with self.assertRaises(ValueError):payments.confirm_legacy(server,{'reference':ref,'opening_paid':40,'customer_id':1,'note':'Again'})
    def test_customer_and_vendor_statements_and_export(self):
        sale=self.tx();purchase=self.tx('purchase','unpaid')
        a=payments.statement(server,{'type':['customer'],'id':['1']});b=payments.statement(server,{'type':['vendor'],'id':['1']})
        self.assertEqual(a['due'],7000);self.assertEqual(b['due'],10000)
        self.assertEqual(a['invoices'][0]['reference'],sale);self.assertEqual(b['invoices'][0]['reference'],purchase)
        summary=payments.list_accounts(server)['summary'];self.assertEqual(summary['receivables'],7000);self.assertEqual(summary['payables'],10000);self.assertEqual(summary['unconfirmed'],1)
        exported=payments.csv_accounts(server,{'kind':['sale']}).decode('utf-8');self.assertIn(sale,exported);self.assertNotIn(purchase,exported)
    def test_migration_v2_preserves_old_data_and_marks_unknown(self):
        with server.connect() as c:
            c.execute('DROP INDEX movements_reference');c.execute('DROP TABLE payment_events');c.execute('DROP TABLE invoice_accounts');c.execute('DROP TABLE customers');c.execute('DELETE FROM migrations WHERE version=3');c.execute('PRAGMA user_version=2')
        server.initialize();server.initialize()
        with server.connect() as c:
            self.assertEqual(c.execute('PRAGMA user_version').fetchone()[0],3)
            self.assertEqual(c.execute('SELECT stock FROM products').fetchone()[0],100)
            self.assertEqual(c.execute('SELECT confirmed FROM invoice_accounts').fetchone()[0],0)
            self.assertEqual(c.execute('SELECT count(*) FROM payment_events').fetchone()[0],0)
    def test_dates_and_unconfirmed_balances_are_validated(self):
        ref=self.tx()
        base={'reference':ref,'amount':1,'method':'Cash','request_id':'invalid-date-123456789'}
        for date in ('2000-01-01','2099-01-01','bad'):
            with self.assertRaises(ValueError):payments.record(server,{**base,'date':date})
        with self.assertRaises(ValueError):self.tx(due='2000-01-01')
    def test_cash_report_uses_payment_dates_not_sale_dates(self):
        with patch.object(f,'now',return_value='2026-08-10T10:00:00+06:00'):ref=self.tx(mode='unpaid')
        payments.record(server,{'reference':ref,'amount':25,'method':'Cash','date':'2026-09-10','request_id':'cash-month-123456789'})
        self.assertEqual(f.report(server,{'month':['2026-08']})['payment_cash']['customer_receipts'],0)
        self.assertEqual(f.report(server,{'month':['2026-09']})['payment_cash']['customer_receipts'],2500)
        self.assertIn('2500',f.csv_report(f.report(server,{'month':['2026-09']}),'cash').decode('utf-8'))
        with self.assertRaises(ValueError):f.csv_report(f.report(server,{'month':['2026-09'],'product':['1']}),'cash')
        self.assertIsNone(f.report(server,{'month':['2026-09'],'product':['1']})['payment_cash'])


class PaymentHTTPTests(unittest.TestCase):
    def setUp(self):
        import hashlib
        from http.server import ThreadingHTTPServer
        self.temp=tempfile.TemporaryDirectory();self.old=server.DB;server.DB=Path(self.temp.name)/'http.sqlite3';server.initialize();server.SESSIONS.clear();server.LOGIN_ATTEMPTS.clear()
        salt='00'*16;stored=salt+':'+hashlib.scrypt(b'paymenttest',salt=bytes.fromhex(salt),n=16384,r=8,p=1).hex()
        with server.connect() as c:c.execute("INSERT INTO settings VALUES('password',?)",(stored,))
        class QuietHandler(server.Handler):
            def log_message(self,*args):pass
        self.http=ThreadingHTTPServer(('127.0.0.1',0),QuietHandler);self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start();self.cookie=''
    def tearDown(self):self.http.shutdown();self.http.server_close();self.thread.join();server.DB=self.old;self.temp.cleanup()
    def call(self,path,data=None):
        import http.client
        conn=http.client.HTTPConnection('127.0.0.1',self.http.server_port)
        conn.request('GET' if data is None else 'POST',path,None if data is None else json.dumps(data),{'Cookie':self.cookie,'Content-Type':'application/json'})
        response=conn.getresponse();body=response.read();status=response.status
        if response.getheader('Set-Cookie'):self.cookie=response.getheader('Set-Cookie').split(';')[0]
        conn.close();return status,body
    def test_payment_endpoints_require_authentication(self):
        for path in ('/api/customers','/api/payments','/api/payments.csv','/api/payment-account','/api/party-statement'):
            self.assertEqual(self.call(path)[0],401)
        for path in ('/api/customer','/api/payment','/api/payment-confirm'):
            self.assertEqual(self.call(path,{})[0],401)
    def test_partial_sale_and_installment_http_flow(self):
        self.assertEqual(self.call('/api/login',{'password':'paymenttest'})[0],200)
        self.assertEqual(self.call('/api/customer',{'name':'HTTP Customer'})[0],200)
        self.assertEqual(self.call('/api/product',{'name':'Product','quantity':10,'cost':5,'price':10})[0],201)
        status,body=self.call('/api/transaction',{'kind':'sale','payment_mode':'partial','amount_paid':5,'customer_id':1,'items':[{'id':1,'quantity':2,'price':10}]})
        self.assertEqual(status,200);ref=json.loads(body)['reference']
        self.assertEqual(json.loads(self.call('/api/payment-account?reference='+ref)[1])['due'],1500)
        payload={'reference':ref,'amount':5,'method':'Cash','request_id':'http-installment-123456789'}
        first=self.call('/api/payment',payload);second=self.call('/api/payment',payload)
        self.assertEqual(first[0],200);self.assertEqual(json.loads(first[1])['receipt'],json.loads(second[1])['receipt'])
        invoice=json.loads(self.call('/api/invoice?reference='+ref)[1]);self.assertEqual(invoice['settlement']['due'],1000);self.assertEqual(invoice['settlement']['net_paid'],1000)
        self.assertEqual(self.call('/api/payment',{**payload,'amount':11,'request_id':'http-overpayment-123456789'})[0],400)
        self.assertEqual(self.call('/api/party-statement?type=customer&id=1')[0],200)
        self.assertIn(ref,self.call('/api/payments.csv')[1].decode('utf-8'))

if __name__=='__main__':unittest.main()
