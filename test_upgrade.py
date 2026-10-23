import base64
from contextlib import closing
import datetime as dt
import hashlib
import http.client
import io
import json
import sqlite3
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from PIL import Image
import server
import erp_features as f
from create_sample_database import create_sample, validate
from backup_database import backup


class UpgradeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.old=server.DB
        server.DB=Path(self.temp.name)/'test.sqlite3';server.initialize()
        self.p=server.create_product({'code':'TEST','name':'Test product','category':'Food','quantity':20,'cost':10,'price':20})
    def tearDown(self):
        server.DB=self.old;self.temp.cleanup()
    def tx(self,kind,q=2,price=20):return server.transaction({'kind':kind,'items':[{'id':1,'quantity':q,'price':price}]})
    def report(self,month='2026-01',**kwargs):return f.report(server,{'month':[month],**{k:[v] for k,v in kwargs.items()}})
    def test_settings_validation_persistence_public(self):
        with server.connect() as c:c.execute("INSERT INTO settings VALUES('password','private')")
        f.save_settings(server,{'app_name':'My shop','theme':'dark','company':'Private shop','primary':'#123456'})
        server.initialize()
        self.assertEqual(f.settings(server)['app_name'],'My shop')
        self.assertEqual(f.settings(server,True)['theme'],'dark')
        self.assertNotIn('password',json.dumps(f.settings(server,True)))
        self.assertNotIn('company',f.settings(server,True))
        for data in ({'language':'bn'},{'primary':'red'},{'timezone':'Bad/Zone'},{'widgets':['bad']},{'precision':8},{'currency':'USD'}):
            with self.assertRaises(ValueError):f.save_settings(server,data)
    def test_migration_backup_idempotent_and_preserve(self):
        path=Path(self.temp.name)/'legacy.sqlite3';server.DB=path
        with closing(sqlite3.connect(path)) as c, c:
            c.executescript("CREATE TABLE products(id INTEGER PRIMARY KEY,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL DEFAULT '',stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),cost INTEGER NOT NULL DEFAULT 0,price INTEGER NOT NULL DEFAULT 0,minimum INTEGER NOT NULL DEFAULT 5);CREATE TABLE movements(id INTEGER PRIMARY KEY,created TEXT NOT NULL,kind TEXT NOT NULL,product_id INTEGER NOT NULL REFERENCES products(id),quantity INTEGER NOT NULL,unit_price INTEGER NOT NULL,unit_cost INTEGER NOT NULL,reference TEXT NOT NULL);CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);INSERT INTO settings VALUES('password','keep-me');INSERT INTO products(code,name,stock,cost) VALUES('OLD','Old',5,1200);INSERT INTO movements(created,kind,product_id,quantity,unit_price,unit_cost,reference) VALUES('2025-12-31T23:00:00+06:00','purchase',1,5,1000,1200,'OLD-REF');")
        server.initialize();server.initialize()
        with server.connect() as c:
            self.assertEqual(c.execute('PRAGMA user_version').fetchone()[0],2)
            self.assertEqual(c.execute('SELECT value FROM settings').fetchone()[0],'keep-me')
            row=c.execute('SELECT * FROM movements').fetchone()
            self.assertEqual(row['unit_cost'],1200);self.assertEqual(row['actual_unit_cost'],1000)
            self.assertEqual(c.execute('SELECT stock FROM products').fetchone()[0],5)
        self.assertEqual(len(list(path.parent.glob('legacy.sqlite3.pre-v1-*.backup'))),1)
    def test_month_boundaries_timezone_and_distinct_lines(self):
        with patch.object(f,'now',return_value='2025-12-31T18:00:00+00:00'):
            server.transaction({'kind':'sale','items':[{'id':1,'quantity':2,'price':20},{'id':1,'quantity':3,'price':30}]})
        with patch.object(f,'now',return_value='2026-01-31T18:00:00+00:00'):self.tx('sale',1,40)
        january=self.report()['summary'];february=self.report('2026-02')['summary']
        self.assertEqual(january['sales'],13000);self.assertEqual(january['transactions'],1);self.assertEqual(january['cogs'],5000)
        self.assertEqual(february['sales'],4000)
        self.assertEqual(self.report('2024-02')['summary']['sales'],0)
        self.assertEqual(self.report('2026-12')['end'],'2026-12-31')
        with self.assertRaises(ValueError):self.report(start='2026-02-01',end='2026-01-01')
    def test_returns_cost_basis_partial_and_rollback(self):
        with patch.object(f,'now',return_value='2026-01-12T12:00:00+06:00'):self.tx('sale',5,20)
        with server.connect() as c:line=c.execute("SELECT id FROM movements WHERE kind='sale'").fetchone()[0]
        with patch.object(f,'now',return_value='2026-01-13T12:00:00+06:00'):
            f.correction(server,{'kind':'sale_return','quantity':2,'original_id':line,'product_id':1,'reason':'Customer return'})
        r=self.report()['summary'];self.assertEqual(r['sales'],6000);self.assertEqual(r['cogs'],3000);self.assertEqual(r['profit'],3000)
        with self.assertRaises(ValueError):f.correction(server,{'kind':'sale_return','quantity':4,'original_id':line,'product_id':1,'reason':'Too many'})
        with server.connect() as c:self.assertEqual(c.execute('SELECT stock FROM products').fetchone()[0],17)
    def test_purchase_return_adjustments_expenses(self):
        with server.connect() as c:line=c.execute('SELECT id FROM movements LIMIT 1').fetchone()[0]
        with patch.object(f,'now',return_value='2026-01-13T12:00:00+06:00'):
            f.correction(server,{'kind':'purchase_return','quantity':2,'original_id':line,'product_id':1,'reason':'Supplier refund'})
            f.correction(server,{'kind':'adjust_out','quantity':1,'product_id':1,'reason':'Damaged'})
            f.correction(server,{'kind':'adjust_in','quantity':2,'cost':12,'product_id':1,'reason':'Found stock'})
        f.expense(server,{'date':'2026-01-20','category':'Rent','amount':50,'payment_method':'Cash'})
        r=self.report();self.assertEqual(r['summary']['purchase_returns'],2000);self.assertEqual(r['summary']['expenses'],5000)
        self.assertEqual(self.report(category='Food')['summary']['expenses'],0)
        with self.assertRaises(ValueError):f.expense(server,{'date':'2026-01-20','category':'Rent','amount':0})
    def test_product_edit_snapshot_and_custom(self):
        f.save_settings(server,{'custom_fields':['Size']})
        f.product_edit(server,{'id':1,'name':'Renamed','code':'TEST','price':30,'category':'New','unit':'pack','custom':{'Size':'Large'}})
        with server.connect() as c:
            self.assertEqual(c.execute('SELECT name_snapshot FROM movements').fetchone()[0],'Test product')
            self.assertEqual(c.execute('SELECT stock FROM products').fetchone()[0],20)
        with self.assertRaises(ValueError):f.product_edit(server,{'id':1,'name':'A','code':'B','custom':{'Unknown':'x'}})
    def test_upload_preserves_previous_and_removal(self):
        image=io.BytesIO();Image.new('RGB',(32,32),'red').save(image,'PNG')
        result=f.upload_asset(server,{'role':'logo','content':base64.b64encode(image.getvalue()).decode()})
        logo=result['assets']['logo']
        for raw in (b'<svg/>',b'not an image'):
            with self.assertRaises(ValueError):f.upload_asset(server,{'role':'logo','content':base64.b64encode(raw).decode()})
            self.assertEqual(f.settings(server)['assets']['logo'],logo)
        image=io.BytesIO();Image.new('RGB',(5,5)).save(image,'PNG')
        with self.assertRaises(ValueError):f.upload_asset(server,{'role':'logo','content':base64.b64encode(image.getvalue()).decode()})
        self.assertNotIn('logo',f.upload_asset(server,{'role':'logo','remove':True})['assets'])
    def test_csv_filtered_safe_and_integral(self):
        with patch.object(f,'now',return_value='2026-01-12T12:00:00+06:00'):self.tx('sale')
        report=self.report(kind='sale');out=f.csv_report(report,'movements').decode()
        self.assertIn('INV-',out);self.assertNotIn('purchase',out)
        report['movements'][0]['name']=' =WEBSERVICE("bad")'
        self.assertIn("' =WEBSERVICE",f.csv_report(report).decode())
        self.assertIn('4000',f.csv_report(report,'summary').decode())
    def test_concurrent_oversell_one_succeeds(self):
        results=[]
        def sell():
            try:self.tx('sale',15);results.append(True)
            except ValueError:results.append(False)
        ts=[threading.Thread(target=sell) for _ in range(2)]
        for t in ts:t.start()
        for t in ts:t.join()
        self.assertEqual(sorted(results),[False,True])
    def test_schema_and_backup(self):
        target=Path(self.temp.name)/'from-schema.sqlite3'
        with closing(sqlite3.connect(target)) as c, c:
            c.executescript((Path(__file__).parent/'schema.sql').read_text())
            self.assertEqual(c.execute('PRAGMA integrity_check').fetchone()[0],'ok')
        dest=Path(self.temp.name)/'backup.zip';backup(server.DB,dest)
        import zipfile
        with zipfile.ZipFile(dest) as archive:self.assertIn('inventory.sqlite3',archive.namelist())
        with self.assertRaises(FileExistsError):backup(server.DB,dest)
    def test_demo_reproducible_and_consistent(self):
        a=Path(self.temp.name)/'demo-a.sqlite3';b=Path(self.temp.name)/'demo-b.sqlite3'
        self.assertEqual(create_sample(a),create_sample(b))
        self.assertEqual(validate(a)['stock_reconciliation'],'ok')
        with self.assertRaises(FileExistsError):create_sample(a)


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.old=server.DB;server.DB=Path(self.temp.name)/'http.sqlite3';server.initialize();server.SESSIONS.clear();server.LOGIN_ATTEMPTS.clear()
        salt='00'*16;hashed=hashlib.scrypt(b'testpassword',salt=bytes.fromhex(salt),n=16384,r=8,p=1).hex()
        with server.connect() as c:c.execute("INSERT INTO settings VALUES('password',?)",(salt+':'+hashed,))
        self.http=ThreadingHTTPServer(('127.0.0.1',0),server.Handler);self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start();self.cookie=''
    def tearDown(self):self.http.shutdown();self.http.server_close();self.thread.join();server.DB=self.old;self.temp.cleanup()
    def call(self,path,data=None,headers=None):
        conn=http.client.HTTPConnection('127.0.0.1',self.http.server_port)
        h={'Cookie':self.cookie,'Content-Type':'application/json',**(headers or {})}
        conn.request('GET' if data is None else 'POST',path,None if data is None else json.dumps(data),h)
        r=conn.getresponse();body=r.read();status=r.status
        if r.getheader('Set-Cookie'):self.cookie=r.getheader('Set-Cookie').split(';')[0]
        conn.close();return status,body
    def login(self):self.assertEqual(self.call('/api/login',{'password':'testpassword'})[0],200)
    def test_real_http_auth_settings_reports_session_csrf(self):
        self.assertEqual(self.call('/api/settings')[0],401)
        self.assertEqual(self.call('/api/history')[0],401)
        public=json.loads(self.call('/api/public-settings')[1]);self.assertNotIn('password',public)
        self.assertEqual(self.call('/api/settings',{'app_name':'Bad'})[0],401)
        self.login();self.assertEqual(self.call('/api/settings',{'app_name':'Live Brand'})[0],200)
        self.assertEqual(json.loads(self.call('/api/public-settings')[1])['app_name'],'Live Brand')
        self.assertEqual(self.call('/api/settings',{'app_name':'CSRF'},{'Origin':'http://evil.test'})[0],403)
        self.assertEqual(self.call('/api/settings',{'app_name':'Bad'},{'Content-Type':'text/plain'})[0],415)
        self.assertEqual(self.call('/api/product',{'name':'HTTP product','quantity':10,'cost':10,'price':20})[0],201)
        self.assertEqual(self.call('/api/transaction',{'kind':'sale','items':[{'id':1,'quantity':2,'price':20}]})[0],200)
        self.assertEqual(self.call('/api/reports?month=2026-10')[0],200)
        self.assertEqual(self.call('/api/reports?month=wrong')[0],400)
        self.assertEqual(self.call('/api/reports.csv?month=2026-10&table=summary')[0],200)
        body={'kind':'sale','request_id':'http-retry-123456789','items':[{'id':1,'quantity':1,'price':20}]}
        first=json.loads(self.call('/api/transaction',body)[1]);second=json.loads(self.call('/api/transaction',body)[1])
        self.assertEqual(first['reference'],second['reference'])
        self.assertEqual(json.loads(self.call('/api/history?size=1')[1])['size'],1)
        self.assertEqual(self.call('/api/history.csv?q=HTTP')[0],200)
        self.assertEqual(self.call('/api/expense',{'date':'2026-08-10','amount':50,'category':'Rent','payment_method':'Cash'})[0],200)
        self.assertEqual(self.call('/api/expense-reverse',{'expense_id':1,'date':'2026-09-10','reason':'Mistake'})[0],200)
        self.assertEqual(self.call('/api/expense-reverse',{'expense_id':1,'date':'2026-09-10','reason':'Again'})[0],400)
        self.assertEqual(self.call('/api/backup')[0],200)
        self.assertEqual(self.call('/assets/../../server.py')[0],404)
        self.assertEqual(self.call('/api/logout',{})[0],200);self.assertEqual(self.call('/api/state')[0],401)
        self.login()
        for key in server.SESSIONS:server.SESSIONS[key]=time.monotonic()-1
        self.assertEqual(self.call('/api/state')[0],401)
    def test_login_rate_limit(self):
        for _ in range(10):self.assertEqual(self.call('/api/login',{'password':'wrong'})[0],401)
        self.assertEqual(self.call('/api/login',{'password':'wrong'})[0],429)

if __name__=='__main__':unittest.main()
