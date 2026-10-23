"""Schema v2: durable request deduplication, expense corrections and paged history."""
import csv
import datetime as dt
import hashlib
import io
import json
import re
import secrets
import sqlite3
from contextlib import closing
from pathlib import Path


def migrate(s):
    with s.connect() as c:
        version=c.execute('PRAGMA user_version').fetchone()[0]
        if version==2:return
        if version!=1:raise RuntimeError('Expected schema v1 before reliability migration')
        backup=Path(str(s.DB)+'.pre-v2-'+secrets.token_hex(4)+'.backup')
        with closing(sqlite3.connect(backup)) as target:c.backup(target)
        c.execute('BEGIN IMMEDIATE')
        c.execute('CREATE TABLE request_receipts(request_id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,reference TEXT NOT NULL REFERENCES transactions(reference))')
        c.execute('CREATE TABLE expense_reversals(id INTEGER PRIMARY KEY,expense_id INTEGER NOT NULL UNIQUE REFERENCES expenses(id),created TEXT NOT NULL,reason TEXT NOT NULL,reference TEXT NOT NULL UNIQUE)')
        c.execute('CREATE INDEX expense_reversals_created ON expense_reversals(created)')
        c.execute('INSERT INTO migrations VALUES(2,?)',(dt.datetime.now(dt.timezone.utc).isoformat(),))
        c.execute('PRAGMA user_version=2')


def request_key(data):
    key=data.get('request_id')
    if key is None:return None,None  # Compatibility for older clients and scripts.
    if not isinstance(key,str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,100}',key):
        raise ValueError('Invalid transaction request identifier')
    body={k:v for k,v in data.items() if k!='request_id'}
    return key,hashlib.sha256(json.dumps(body,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest()


def previous_request(c,key,digest):
    if key is None:return None
    row=c.execute('SELECT * FROM request_receipts WHERE request_id=?',(key,)).fetchone()
    if row:
        if row['payload_hash']!=digest:raise ValueError('This transaction identifier was already used with different data; start a new transaction')
        return {'reference':row['reference'],'replayed':True}
    return None


def reverse_expense(s,data):
    import erp_features as f
    reason=str(data.get('reason','')).strip()
    if not reason or len(reason)>1000:raise ValueError('Enter a reversal reason (max 1000 characters)')
    config=f.settings(s)
    day=dt.date.fromisoformat(data['date'])
    created=dt.datetime.combine(day,dt.time(12),f.zone(config)).isoformat()
    with s.connect() as c:
        c.execute('BEGIN IMMEDIATE')
        original=c.execute('SELECT * FROM expenses WHERE id=?',(s.integer(data['expense_id']),)).fetchone()
        if not original:raise ValueError('Expense not found')
        if day<f.instant(original['created'],config).astimezone(f.zone(config)).date():raise ValueError('Reversal date cannot precede the original expense')
        if c.execute('SELECT 1 FROM expense_reversals WHERE expense_id=?',(original['id'],)).fetchone():raise ValueError('This expense has already been reversed')
        ref='EXR-'+secrets.token_hex(6).upper()
        c.execute('INSERT INTO expense_reversals(expense_id,created,reason,reference) VALUES(?,?,?,?)',(original['id'],created,reason,ref))
    return {'reference':ref}


def expense_rows(c):
    rows=[dict(r) for r in c.execute('SELECT * FROM expenses ORDER BY created,id')]
    for r in c.execute('SELECT e.*,r.created reversal_created,r.reference reversal_reference,r.reason FROM expense_reversals r JOIN expenses e ON e.id=r.expense_id ORDER BY r.created,r.id'):
        row=dict(r)
        row.update(created=row.pop('reversal_created'),reference=row.pop('reversal_reference'),amount=-row['amount'],description='Reversal: '+row.pop('reason'),reversal=True)
        rows.append(row)
    return rows


def history(s,query,export=False):
    get=lambda key,default='':query.get(key,[default])[0]
    search=get('q').strip()
    if len(search)>200:raise ValueError('Search is too long')
    page=max(1,int(get('page','1')))
    size=int(get('size','25'))
    if not 1<=size<=100:raise ValueError('Page size must be 1–100')
    sort=get('sort','id');direction=get('direction','desc')
    allowed={'id':'m.id','created':'julianday(m.created)','name':'m.name_snapshot','reference':'m.reference','kind':'m.kind','quantity':'m.quantity','unit_price':'m.unit_price','unit_cost':'m.unit_cost','note':'m.note'}
    if sort not in allowed or direction not in ('asc','desc'):raise ValueError('Invalid sort order')
    where='';args=[]
    if search:
        # Escape wildcard characters so searches are literal, not a SQL pattern API.
        pattern='%'+search.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
        where=" WHERE (m.name_snapshot LIKE ? ESCAPE '\\' OR p.code LIKE ? ESCAPE '\\' OR m.reference LIKE ? ESCAPE '\\' OR m.kind LIKE ? ESCAPE '\\' OR m.note LIKE ? ESCAPE '\\')"
        args=[pattern]*5
    join=' FROM movements m JOIN products p ON p.id=m.product_id'
    select='SELECT m.*,m.name_snapshot name,p.code'
    order=' ORDER BY '+allowed[sort]+' '+direction+',m.id '+direction
    with s.connect() as c:
        total=c.execute('SELECT count(*)'+join+where,args).fetchone()[0]
        page=min(page,max(1,(total+size-1)//size))
        sql=select+join+where+order
        if not export:
            sql+=' LIMIT ? OFFSET ?';args=args+[size,(page-1)*size]
        rows=[dict(r) for r in c.execute(sql,args)]
    if not export:return {'rows':rows,'total':total,'page':page,'size':size}
    import erp_features as f
    config=f.settings(s)
    out=io.StringIO(newline='');writer=csv.writer(out)
    writer.writerow(['Date','Reference','Type','Code','Recorded product name','Quantity','Unit price '+config['currency'],'Total '+config['currency']])
    def safe(value):
        return "'"+value if isinstance(value,str) and value.lstrip().startswith(('=','+','-','@','\t','\r','\n')) else value
    def money(value):return f'{value//100}.{value%100:02d}'
    for r in rows:
        writer.writerow([safe(v) for v in [r['created'],r['reference'],r['kind'],r['code'],r['name'],r['quantity'],money(r['unit_price']),money(r['quantity']*r['unit_price'])]])
    return ('\ufeff'+out.getvalue()).encode()
