-- Inventory ERP schema v3. Money uses integer minor units; invoice payments never change stock.
PRAGMA foreign_keys=ON;
CREATE TABLE assets(role TEXT PRIMARY KEY,filename TEXT NOT NULL,mime TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL);
CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '');
CREATE TABLE expense_reversals(id INTEGER PRIMARY KEY,expense_id INTEGER NOT NULL UNIQUE REFERENCES expenses(id),created TEXT NOT NULL,reason TEXT NOT NULL,reference TEXT NOT NULL UNIQUE);
CREATE TABLE expenses(id INTEGER PRIMARY KEY,created TEXT NOT NULL,category TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),payment_method TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',reference TEXT NOT NULL,payee TEXT NOT NULL DEFAULT '');
CREATE TABLE invoice_accounts(reference TEXT PRIMARY KEY REFERENCES transactions(reference),
            confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN (0,1)),
            customer_id INTEGER REFERENCES customers(id),supplier_id INTEGER REFERENCES suppliers(id),due_date TEXT NOT NULL DEFAULT '',
            opening_paid INTEGER NOT NULL DEFAULT 0 CHECK(opening_paid>=0),verified_created TEXT NOT NULL DEFAULT '',verification_note TEXT NOT NULL DEFAULT '');
CREATE TABLE migrations(version INTEGER PRIMARY KEY, applied TEXT NOT NULL);
CREATE TABLE movements(id INTEGER PRIMARY KEY,created TEXT NOT NULL,kind TEXT NOT NULL,product_id INTEGER NOT NULL REFERENCES products(id),quantity INTEGER NOT NULL,unit_price INTEGER NOT NULL,unit_cost INTEGER NOT NULL,reference TEXT NOT NULL, original_id INTEGER REFERENCES movements(id), actual_unit_cost INTEGER, name_snapshot TEXT NOT NULL DEFAULT '', category_snapshot TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '');
CREATE TABLE payment_events(id INTEGER PRIMARY KEY,reference TEXT NOT NULL REFERENCES invoice_accounts(reference),
            created TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),kind TEXT NOT NULL CHECK(kind IN ('payment','refund')),
            method TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',receipt TEXT NOT NULL UNIQUE,request_id TEXT NOT NULL UNIQUE,payload_hash TEXT NOT NULL);
CREATE TABLE products(id INTEGER PRIMARY KEY,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL DEFAULT '',stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),cost INTEGER NOT NULL DEFAULT 0,price INTEGER NOT NULL DEFAULT 0,minimum INTEGER NOT NULL DEFAULT 5, unit TEXT NOT NULL DEFAULT 'piece', custom_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE request_receipts(request_id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,reference TEXT NOT NULL REFERENCES transactions(reference));
CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE suppliers(id INTEGER PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '');
CREATE TABLE transactions(reference TEXT PRIMARY KEY,created TEXT NOT NULL,kind TEXT NOT NULL,supplier_id INTEGER REFERENCES suppliers(id),payment_method TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '');
CREATE INDEX expense_reversals_created ON expense_reversals(created);
CREATE INDEX expenses_created ON expenses(created);
CREATE INDEX invoice_accounts_customer ON invoice_accounts(customer_id);
CREATE INDEX invoice_accounts_supplier ON invoice_accounts(supplier_id);
CREATE INDEX movements_created ON movements(created);
CREATE INDEX movements_original ON movements(original_id);
CREATE INDEX movements_product ON movements(product_id,created);
CREATE INDEX movements_reference ON movements(reference,kind);
CREATE INDEX payment_events_created ON payment_events(created);
CREATE INDEX payment_events_reference ON payment_events(reference,id);
PRAGMA user_version=3;
INSERT INTO migrations VALUES(1,CURRENT_TIMESTAMP);
INSERT INTO migrations VALUES(2,CURRENT_TIMESTAMP);
INSERT INTO migrations VALUES(3,CURRENT_TIMESTAMP);
