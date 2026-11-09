import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { reportRange, salesReport, monthlyAccounts } from '../analytics.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE invoices(id INTEGER PRIMARY KEY,user_id INTEGER,created TEXT,total INTEGER,status TEXT);
    CREATE TABLE invoice_lines(invoice_id INTEGER,product_id INTEGER,name TEXT,quantity INTEGER,price INTEGER,id INTEGER PRIMARY KEY);
    CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,email TEXT,role TEXT);
    INSERT INTO users VALUES(1,'Administrador','admin@test.co','admin'),(2,'Ana','ana@test.co','consumer'),(3,'Luis','luis@test.co','consumer'),(4,'Sin consumo','sin@test.co','consumer');
    CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT,category_id INTEGER,price INTEGER,stock INTEGER,minimum INTEGER,active INTEGER);
    CREATE TABLE categories(id INTEGER PRIMARY KEY,name TEXT,type TEXT);
    INSERT INTO categories VALUES(1,'Papas','Comida'),(2,'Bebidas','Bebida');
    INSERT INTO products VALUES(1,'Papas',1,99999,4,5,1),(2,'Agua',2,2000,20,5,1),(3,'Sin ventas',1,1500,8,5,1);
    INSERT INTO invoices VALUES
      (1,2,'2026-11-01T04:59:59.999Z',1000,'Pagada'),
      (2,2,'2026-11-01T05:00:00.000Z',5000,'Pendiente'),
      (3,3,'2026-12-01T04:59:59.999Z',2000,'Pagada'),
      (4,2,'2026-12-01T05:00:00.000Z',9000,'Pendiente');
    INSERT INTO invoice_lines(invoice_id,product_id,name,quantity,price) VALUES(1,1,'Papas',1,1000),(2,1,'Nombre histórico',2,2500),(3,2,'Agua',1,2000),(4,1,'Papas',3,3000);`);
  return db;
}

test('Bogotá date bounds, inclusive last day and equal-length preceding period', () => {
  const r = reportRange('2026-11-01','2026-11-30');
  assert.equal(r.days,30);
  assert.equal(r.start,'2026-11-01T05:00:00.000Z');
  assert.equal(r.end,'2026-12-01T05:00:00.000Z');
  assert.equal(r.previousStart,'2026-10-02T05:00:00.000Z');
  for (const args of [[null,null],['2026-02-30','2026-03-01'],['2026-12-01','2026-11-01'],['2000-01-01','2026-01-01'],['2026-1-1','2026-01-01']]) {
    assert.throws(() => reportRange(...args), error => error.status === 400);
  }
  assert.equal(reportRange('2024-02-29','2024-02-29').days,1);
});

test('sales use historical invoice prices and complete period, not current prices or inventory exits', async () => {
  const db=fixture();
  try {
    const r=await salesReport(db,'2026-11-01','2026-11-30');
    assert.equal(r.summary.sales,7000);
    assert.equal(r.summary.units,3);
    assert.equal(r.summary.orders,2);
    assert.equal(r.summary.customers,2);
    assert.equal(r.summary.average,3500);
    assert.equal(r.summary.pending,5000);
    assert.equal(r.summary.settled,2000);
    assert.equal(r.comparison.sales,1000);
    assert.equal(r.comparison.change,6000);
    assert.equal(r.comparison.percent,600);
    assert.deepEqual(r.products.map(p=>[p.id,p.units,p.sales]),[[1,2,5000],[2,1,2000]]);
    assert.equal(r.categories.reduce((s,c)=>s+c.sales,0),r.summary.sales);
    assert.equal(r.trend.length,30);
    assert.equal(r.trend[0].sales,5000);
    assert.equal(r.trend[29].sales,2000);
    assert.equal(r.trend[1].sales,0);
    assert.equal(r.stock[0].id,1);
    assert.deepEqual(r.noSales.map(p=>p.id),[3]);
    const empty=await salesReport(db,'2026-08-01','2026-08-31');
    assert.equal(empty.summary.sales,0);
    assert.equal(empty.summary.average,0);
    assert.equal(empty.comparison.percent,null);
    assert.equal(empty.products.length,0);
    assert.equal(empty.trend.length,31);
    const monthly=await salesReport(db,'2026-10-01','2026-12-31');
    assert.equal(monthly.granularity,'month');
    assert.deepEqual(monthly.trend.map(t=>[t.period,t.sales]),[['2026-10',1000],['2026-11',7000],['2026-12',9000]]);
    // Reports must not inherit the 200-row limit of the movements screen.
    const invoice=db.prepare('INSERT INTO invoices VALUES(?,?,?,?,?)');
    const line=db.prepare('INSERT INTO invoice_lines(invoice_id,product_id,name,quantity,price) VALUES(?,?,?,?,?)');
    for(let id=10;id<215;id++){invoice.run(id,2,'2026-11-10T12:00:00.000Z',10,'Pendiente');line.run(id,1,'Papas',1,10)}
    const large=await salesReport(db,'2026-11-01','2026-11-30');
    assert.equal(large.summary.orders,207);
    assert.equal(large.summary.sales,9050);
    assert.equal(large.summary.units,208);
  } finally {db.close()}
});


test('monthly accounts group each person, preserve zero-consumption people and isolate months', async () => {
  const db=fixture();
  try {
    const report=await monthlyAccounts(db,'2026-11');
    assert.deepEqual(report.totals,{orders:2,total:7000,pending:5000,settled:2000});
    assert.equal(report.people.length,3);
    assert.equal(report.people.find(p=>p.id===2).pending,5000);
    assert.equal(report.people.find(p=>p.id===3).settled,2000);
    assert.equal(report.people.find(p=>p.id===4).total,0);
    assert.deepEqual(report.invoices.map(i=>i.id),[2,3]);
    assert.equal(report.lines.reduce((s,l)=>s+l.price*l.quantity,0),7000);
    const ana=await monthlyAccounts(db,'2026-11','2');
    assert.equal(ana.people.length,1);assert.equal(ana.invoices.length,1);
    assert.ok(ana.lines.every(l=>l.user_id===2));assert.equal(ana.totals.total,5000);
    assert.equal((await monthlyAccounts(db,'2026-10')).totals.total,1000);
    assert.equal((await monthlyAccounts(db,'2026-12')).totals.total,9000);
    assert.equal((await monthlyAccounts(db,'2024-02')).range.to,'2024-02-29');
    for(const month of ['2026-13','2026-1','no',null])await assert.rejects(()=>monthlyAccounts(db,month),e=>e.status===400);
    await assert.rejects(()=>monthlyAccounts(db,'2026-11','999'),e=>e.status===400);
  } finally {db.close()}
});
