-- Inventory ERP v1 schema. Money: integer minor units; quantities: whole units.
PRAGMA foreign_keys=ON;
CREATE TABLE assets(role TEXT PRIMARY KEY,filename TEXT NOT NULL,mime TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL);
CREATE TABLE expenses(id INTEGER PRIMARY KEY,created TEXT NOT NULL,category TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),payment_method TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',reference TEXT NOT NULL,payee TEXT NOT NULL DEFAULT '');
CREATE TABLE migrations(version INTEGER PRIMARY KEY, applied TEXT NOT NULL);
CREATE TABLE movements(id INTEGER PRIMARY KEY,created TEXT NOT NULL,kind TEXT NOT NULL,product_id INTEGER NOT NULL REFERENCES products(id),quantity INTEGER NOT NULL,unit_price INTEGER NOT NULL,unit_cost INTEGER NOT NULL,reference TEXT NOT NULL, original_id INTEGER REFERENCES movements(id), actual_unit_cost INTEGER, name_snapshot TEXT NOT NULL DEFAULT '', category_snapshot TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '');
CREATE TABLE products(id INTEGER PRIMARY KEY,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL DEFAULT '',stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),cost INTEGER NOT NULL DEFAULT 0,price INTEGER NOT NULL DEFAULT 0,minimum INTEGER NOT NULL DEFAULT 5, unit TEXT NOT NULL DEFAULT 'piece', custom_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE suppliers(id INTEGER PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '');
CREATE TABLE transactions(reference TEXT PRIMARY KEY,created TEXT NOT NULL,kind TEXT NOT NULL,supplier_id INTEGER REFERENCES suppliers(id),payment_method TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '');
CREATE INDEX expenses_created ON expenses(created);
CREATE INDEX movements_created ON movements(created);
CREATE INDEX movements_original ON movements(original_id);
CREATE INDEX movements_product ON movements(product_id,created);
PRAGMA user_version=1;
INSERT INTO migrations VALUES(1,CURRENT_TIMESTAMP);
