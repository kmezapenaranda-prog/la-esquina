import {randomUUID,createHash} from 'node:crypto';
import {reportRange} from './analytics.mjs';
export const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
export const integer=(v,min=0)=>{if(!Number.isSafeInteger(v)||v<min||v>1e9)fail('Usa cantidades y valores enteros válidos (máximo 1.000.000.000).');return v};
export const text=(v,max=200)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)fail('Completa los campos correctamente.');return v.trim()};
const now=()=>new Date().toISOString();
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const lock=db=>db.dialect==='postgres'?' FOR UPDATE':'';
export async function audit(db,actor,action,entity,before=null,after=null){await db.prepare('INSERT INTO audit_log(actor_id,action,entity,before_json,after_json,created) VALUES(?,?,?,?,?,?)').run(actor,action,String(entity),JSON.stringify(before),JSON.stringify(after),now())}
async function column(db,table,name,definition){const exists=db.dialect==='postgres'?await db.prepare('SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=? AND column_name=?').get(table,name):(await db.prepare(`PRAGMA table_info(${table})`).all()).some(c=>c.name===name);if(!exists)await db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)}
export async function ensureOperationsSchema(db){
 await column(db,'invoice_lines','unit_cost','INTEGER CHECK(unit_cost>=0)');
 await column(db,'invoice_lines','returned_quantity','INTEGER NOT NULL DEFAULT 0 CHECK(returned_quantity>=0 AND returned_quantity<=quantity)');
 await column(db,'invoices','original_total','INTEGER CHECK(original_total>=0)');
 await db.exec('UPDATE invoices SET original_total=total WHERE original_total IS NULL');
 const id=db.dialect==='postgres'?'SERIAL PRIMARY KEY':'INTEGER PRIMARY KEY';
 await db.exec(`CREATE TABLE IF NOT EXISTS payments(id ${id},invoice_id INTEGER NOT NULL REFERENCES invoices(id),actor_id INTEGER NOT NULL REFERENCES users(id),amount INTEGER NOT NULL CHECK(amount<>0),method TEXT NOT NULL CHECK(method IN ('cash','transfer','card')),note TEXT NOT NULL,created TEXT NOT NULL,legacy INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS suppliers(id ${id},name TEXT NOT NULL,contact TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS purchases(id ${id},supplier_id INTEGER NOT NULL REFERENCES suppliers(id),actor_id INTEGER NOT NULL REFERENCES users(id),total INTEGER NOT NULL CHECK(total>=0),reference TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS purchase_lines(id ${id},purchase_id INTEGER NOT NULL REFERENCES purchases(id),product_id INTEGER NOT NULL REFERENCES products(id),quantity INTEGER NOT NULL CHECK(quantity>0),unit_cost INTEGER NOT NULL CHECK(unit_cost>=0));
 CREATE TABLE IF NOT EXISTS purchase_payments(id ${id},purchase_id INTEGER NOT NULL REFERENCES purchases(id),actor_id INTEGER NOT NULL REFERENCES users(id),amount INTEGER NOT NULL CHECK(amount>0),method TEXT NOT NULL CHECK(method IN ('cash','transfer','card')),created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS expenses(id ${id},actor_id INTEGER NOT NULL REFERENCES users(id),amount INTEGER NOT NULL CHECK(amount>0),method TEXT NOT NULL CHECK(method IN ('cash','transfer','card')),note TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS returns(id ${id},invoice_id INTEGER NOT NULL REFERENCES invoices(id),line_id INTEGER NOT NULL REFERENCES invoice_lines(id),actor_id INTEGER NOT NULL REFERENCES users(id),quantity INTEGER NOT NULL CHECK(quantity>0),amount INTEGER NOT NULL CHECK(amount>=0),restock INTEGER NOT NULL CHECK(restock IN (0,1)),note TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS losses(id ${id},product_id INTEGER NOT NULL REFERENCES products(id),actor_id INTEGER NOT NULL REFERENCES users(id),quantity INTEGER NOT NULL CHECK(quantity>0),unit_cost INTEGER CHECK(unit_cost>=0),reason TEXT NOT NULL CHECK(reason IN ('Daño','Vencimiento','Pérdida')),note TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS day_closures(day TEXT PRIMARY KEY,actor_id INTEGER NOT NULL REFERENCES users(id),opening INTEGER NOT NULL,counted INTEGER NOT NULL,expected INTEGER NOT NULL,difference INTEGER NOT NULL,report TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('Cerrado','Reabierto')),note TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit_log(id ${id},actor_id INTEGER REFERENCES users(id),action TEXT NOT NULL,entity TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS operation_receipts(id TEXT PRIMARY KEY,actor_id INTEGER NOT NULL REFERENCES users(id),fingerprint TEXT NOT NULL,result TEXT NOT NULL,created TEXT NOT NULL)`);
 // Existing paid invoices have no reliable receipt date; retain their balance, exclude from cash flow.
 await db.exec(`INSERT INTO payments(invoice_id,actor_id,amount,method,note,created,legacy) SELECT i.id,i.user_id,i.total,'cash','Saldo pagado anterior: fecha de cobro no disponible',i.created,1 FROM invoices i WHERE i.status='Pagada' AND i.total>0 AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.invoice_id=i.id)`);
 if(!await db.prepare('SELECT value FROM settings WHERE key=?').get('store_id'))await db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('store_id',randomUUID());
 await db.exec('CREATE INDEX IF NOT EXISTS payments_date ON payments(created); CREATE INDEX IF NOT EXISTS audit_date ON audit_log(created); CREATE INDEX IF NOT EXISTS invoice_lines_product ON invoice_lines(product_id);');
}
export async function mutate(db,actor,key,action,body,fn){
 if(typeof key!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(key))fail('Identificador de operación inválido. Recarga el formulario.');
 const fingerprint=createHash('sha256').update(JSON.stringify({action,body})).digest('hex');
 return db.transaction(async()=>{
  const receipt=await db.prepare('SELECT * FROM operation_receipts WHERE id=?').get(key);
  if(receipt){if(receipt.actor_id!==actor||receipt.fingerprint!==fingerprint)fail('Este identificador ya se usó para otra operación.',409);return JSON.parse(receipt.result)}
  const result=await fn();
  await db.prepare('INSERT INTO operation_receipts VALUES(?,?,?,?,?)').run(key,actor,fingerprint,JSON.stringify(result),now());return result;
 });
}
const method=v=>{if(!['cash','transfer','card'].includes(v))fail('Selecciona efectivo, transferencia o tarjeta.');return v};
export async function assertDayOpen(db){if((await db.prepare('SELECT status FROM day_closures WHERE day=?').get(today()))?.status==='Cerrado')fail('La caja de hoy está cerrada. Reábrela con un motivo antes de registrar dinero.',409)}
export async function invoiceBalance(db,id){const i=await db.prepare('SELECT * FROM invoices WHERE id=?'+lock(db)).get(id);if(!i)fail('Cuenta no encontrada.',404);const paid=(await db.prepare('SELECT COALESCE(SUM(amount),0) value FROM payments WHERE invoice_id=?').get(id)).value;return {...i,paid,balance:i.total-paid}}
async function updateStatus(db,id){await db.prepare("UPDATE invoices SET status=CASE WHEN total<=(SELECT COALESCE(SUM(amount),0) FROM payments WHERE invoice_id=?) THEN 'Pagada' ELSE 'Pendiente' END WHERE id=?").run(id,id)}
export async function payInvoice(db,actor,id,body,full=false){await assertDayOpen(db);const i=await invoiceBalance(db,id),amount=full?i.balance:integer(body.amount,1);if(amount<=0||amount>i.balance)fail('El abono debe ser mayor que cero y no superar el saldo pendiente.');const m=method(body.method||'cash');const result=await db.prepare('INSERT INTO payments(invoice_id,actor_id,amount,method,note,created) VALUES(?,?,?,?,?,?)').run(id,actor,amount,m,text(body.note||'Pago recibido'),now());await updateStatus(db,id);await audit(db,actor,'Abono recibido',`cuenta:${id}`,{balance:i.balance},{amount,method:m,balance:i.balance-amount});return {id:Number(result.lastInsertRowid),balance:i.balance-amount}}
export async function supplier(db,actor,body){const name=text(body.name,100),contact=String(body.contact||'').trim(),note=String(body.note||'').trim();if(contact.length>200||note.length>200)fail('Contacto o nota demasiado largos.');const r=await db.prepare('INSERT INTO suppliers(name,contact,note) VALUES(?,?,?)').run(name,contact,note);await audit(db,actor,'Proveedor creado',r.lastInsertRowid,null,{name,contact,note});return {id:Number(r.lastInsertRowid)}}
export async function purchase(db,actor,body){
 const sid=integer(body.supplier_id,1);if(!await db.prepare('SELECT id FROM suppliers WHERE id=?').get(sid))fail('Selecciona un proveedor.');
 if(!Array.isArray(body.items)||!body.items.length||body.items.length>100)fail('Agrega entre 1 y 100 productos.');
 const seen=new Set(),rows=[];let total=0;
 for(const row of [...body.items].sort((a,b)=>a.product_id-b.product_id)){const id=integer(row.product_id,1),q=integer(row.quantity,1),cost=integer(row.unit_cost);if(seen.has(id))fail('Producto repetido.');seen.add(id);const p=await db.prepare('SELECT * FROM products WHERE id=? AND active=1'+lock(db)).get(id);if(!p)fail('Producto no disponible.');integer(p.stock+q);total+=q*cost;integer(total);rows.push({p,q,cost})}
 const paid=integer(body.paid||0);if(paid>total)fail('El pago no puede superar la compra.');if(paid)await assertDayOpen(db);
 const id=Number((await db.prepare('INSERT INTO purchases(supplier_id,actor_id,total,reference,created) VALUES(?,?,?,?,?)').run(sid,actor,total,text(body.reference||'Sin referencia'),now())).lastInsertRowid);
 for(const {p,q,cost} of rows){
  // Weighted moving average. If previous stock has no known cost, do not invent one.
  const average=p.stock===0?cost:p.unit_cost===null?null:Math.round((p.stock*p.unit_cost+q*cost)/(p.stock+q));
  await db.prepare('UPDATE products SET stock=stock+?,unit_cost=? WHERE id=?').run(q,average,p.id);
  await db.prepare('INSERT INTO purchase_lines(purchase_id,product_id,quantity,unit_cost) VALUES(?,?,?,?)').run(id,p.id,q,cost);
  await db.prepare('INSERT INTO movements(product_id,actor_id,kind,quantity,note,created) VALUES(?,?,?,?,?,?)').run(p.id,actor,'Entrada',q,`Compra #${id}`,now());
 }
 if(paid)await db.prepare('INSERT INTO purchase_payments(purchase_id,actor_id,amount,method,created) VALUES(?,?,?,?,?)').run(id,actor,paid,method(body.method),now());
 await audit(db,actor,'Compra recibida',id,null,{supplier_id:sid,total,paid,items:body.items});return {id,total,paid};
}
export async function payPurchase(db,actor,id,body){await assertDayOpen(db);const p=await db.prepare('SELECT * FROM purchases WHERE id=?'+lock(db)).get(id);if(!p)fail('Compra no encontrada.',404);const paid=(await db.prepare('SELECT COALESCE(SUM(amount),0) value FROM purchase_payments WHERE purchase_id=?').get(id)).value;const amount=integer(body.amount,1);if(amount>p.total-paid)fail('El pago supera la deuda con el proveedor.');await db.prepare('INSERT INTO purchase_payments(purchase_id,actor_id,amount,method,created) VALUES(?,?,?,?,?)').run(id,actor,amount,method(body.method),now());await audit(db,actor,'Pago a proveedor',id,{balance:p.total-paid},{amount,balance:p.total-paid-amount});return {balance:p.total-paid-amount}}
export async function returnSale(db,actor,body){
 const id=integer(body.invoice_id,1),i=await invoiceBalance(db,id),line=await db.prepare('SELECT * FROM invoice_lines WHERE id=? AND invoice_id=?').get(integer(body.line_id,1),id),q=integer(body.quantity,1);if(!line||q>line.quantity-line.returned_quantity)fail('La cantidad supera las unidades disponibles para devolución.');
 const restock=body.restock===true?1:0,note=text(body.note),credit=q*line.price,refund=Math.max(0,i.paid-(i.total-credit));if(refund)await assertDayOpen(db);
 const p=await db.prepare('SELECT * FROM products WHERE id=?'+lock(db)).get(line.product_id);
 if(restock){integer(p.stock+q);const cost=p.stock===0?line.unit_cost:p.unit_cost===null||line.unit_cost===null?null:Math.round((p.stock*p.unit_cost+q*line.unit_cost)/(p.stock+q));await db.prepare('UPDATE products SET stock=stock+?,unit_cost=? WHERE id=?').run(q,cost,p.id);await db.prepare('INSERT INTO movements(product_id,actor_id,user_id,kind,quantity,note,created,invoice_id) VALUES(?,?,?,?,?,?,?,?)').run(p.id,actor,i.user_id,'Entrada',q,'Devolución: '+note,now(),id)}
 if(!restock)await db.prepare('INSERT INTO losses(product_id,actor_id,quantity,unit_cost,reason,note,created) VALUES(?,?,?,?,?,?,?)').run(p.id,actor,q,line.unit_cost,'Daño','Devolución no vendible: '+note,now());
 await db.prepare('UPDATE invoice_lines SET returned_quantity=returned_quantity+? WHERE id=?').run(q,line.id);
 await db.prepare('UPDATE invoices SET total=total-? WHERE id=?').run(credit,id);
 await db.prepare('INSERT INTO returns(invoice_id,line_id,actor_id,quantity,amount,restock,note,created) VALUES(?,?,?,?,?,?,?,?)').run(id,line.id,actor,q,credit,restock,note,now());
 if(refund)await db.prepare('INSERT INTO payments(invoice_id,actor_id,amount,method,note,created) VALUES(?,?,?,?,?,?)').run(id,actor,-refund,method(body.method),'Reembolso por devolución: '+note,now());
 await updateStatus(db,id);await audit(db,actor,'Devolución de consumo',id,{total:i.total},{line_id:line.id,quantity:q,restock,credit,refund,note});return {credit,refund,balance:Math.max(0,i.balance-credit)};
}
export async function loss(db,actor,body){const id=integer(body.product_id,1),q=integer(body.quantity,1),reason=body.reason,note=text(body.note);if(!['Daño','Vencimiento','Pérdida'].includes(reason))fail('Selecciona el motivo de la pérdida.');const p=await db.prepare('SELECT * FROM products WHERE id=? AND active=1'+lock(db)).get(id);if(!p||q>p.stock)fail('Existencias insuficientes.');await db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(q,id);await db.prepare('INSERT INTO losses(product_id,actor_id,quantity,unit_cost,reason,note,created) VALUES(?,?,?,?,?,?,?)').run(id,actor,q,p.unit_cost,reason,note,now());await db.prepare('INSERT INTO movements(product_id,actor_id,kind,quantity,note,created) VALUES(?,?,?,?,?,?)').run(id,actor,'Salida',q,reason+': '+note,now());await audit(db,actor,'Pérdida de inventario',id,{stock:p.stock},{quantity:q,reason,note,unit_cost:p.unit_cost});return {ok:true}}
export async function dayReport(db,day){
 const range=reportRange(day,day);if(day>today())fail('No puedes consultar un cierre futuro.');const args=[range.start,range.end];
 const payments=await db.prepare('SELECT p.*,u.name actor FROM payments p JOIN users u ON u.id=p.actor_id WHERE p.created>=? AND p.created<? AND p.legacy=0 ORDER BY p.id').all(...args);
 const expenses=await db.prepare('SELECT * FROM expenses WHERE created>=? AND created<? ORDER BY id').all(...args);
 const purchases=await db.prepare('SELECT * FROM purchase_payments WHERE created>=? AND created<? ORDER BY id').all(...args);
 const sum=(rows,fn)=>rows.reduce((s,p)=>s+fn(p),0);
 const methods=['cash','transfer','card'].map(method=>({method,received:sum(payments.filter(p=>p.method===method&&p.amount>0),p=>p.amount),refunds:sum(payments.filter(p=>p.method===method&&p.amount<0),p=>-p.amount),expenses:sum(expenses.filter(p=>p.method===method),p=>p.amount),purchases:sum(purchases.filter(p=>p.method===method),p=>p.amount)}));
 for(const m of methods)m.net=m.received-m.refunds-m.expenses-m.purchases;
 const sales=await db.prepare('SELECT COUNT(*) orders,COALESCE(SUM(total),0) total FROM invoices WHERE created>=? AND created<?').get(...args);
 const credit=(await db.prepare('SELECT COALESCE(SUM(i.total-(SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.invoice_id=i.id)),0) value FROM invoices i WHERE i.created>=? AND i.created<?').get(...args)).value;
 const returns=await db.prepare('SELECT COALESCE(SUM(amount),0) amount FROM returns WHERE created>=? AND created<?').get(...args);
 const losses=await db.prepare('SELECT COALESCE(SUM(CASE WHEN unit_cost IS NOT NULL THEN unit_cost*CAST(quantity AS BIGINT) ELSE 0 END),0) cost,COALESCE(SUM(CASE WHEN unit_cost IS NULL THEN quantity ELSE 0 END),0) unknown FROM losses WHERE created>=? AND created<?').get(...args);
 const closure=await db.prepare('SELECT * FROM day_closures WHERE day=?').get(day);
 return {day,methods,sales,credit,returns,losses,payments,expenses,purchases,closure};
}
export async function closeDay(db,actor,body){const day=text(body.day,10);if((await db.prepare('SELECT status FROM day_closures WHERE day=?').get(day))?.status==='Cerrado')fail('Este día ya está cerrado.',409);const report=await dayReport(db,day),opening=integer(body.opening),counted=integer(body.counted),expected=opening+report.methods.find(m=>m.method==='cash').net,note=text(body.note||'Cierre de caja');const values=[actor,opening,counted,expected,counted-expected,JSON.stringify({...report,closure:null}),'Cerrado',note,now()];if(report.closure)await db.prepare('UPDATE day_closures SET actor_id=?,opening=?,counted=?,expected=?,difference=?,report=?,status=?,note=?,created=? WHERE day=?').run(...values,day);else await db.prepare('INSERT INTO day_closures(actor_id,opening,counted,expected,difference,report,status,note,created,day) VALUES(?,?,?,?,?,?,?,?,?,?)').run(...values,day);await audit(db,actor,'Cierre de caja',day,report.closure,{opening,counted,expected,difference:counted-expected,note});return {expected,difference:counted-expected}}
export async function operationsState(db){return {suppliers:await db.prepare('SELECT * FROM suppliers ORDER BY name,id').all(),purchases:await db.prepare('SELECT p.*,s.name supplier,COALESCE((SELECT SUM(amount) FROM purchase_payments pp WHERE pp.purchase_id=p.id),0) paid FROM purchases p JOIN suppliers s ON s.id=p.supplier_id ORDER BY p.id DESC LIMIT 200').all(),losses:await db.prepare('SELECT l.*,p.name product FROM losses l JOIN products p ON p.id=l.product_id ORDER BY l.id DESC LIMIT 100').all(),audit:(await db.prepare('SELECT a.*,u.name actor FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200').all()).map(a=>({...a,truncated:a.before_json.length+a.after_json.length>4000,...(a.before_json.length+a.after_json.length>4000?{before_json:'null',after_json:JSON.stringify({detalle:'Registro extenso. Abre el detalle completo.'})}:{})}))}}
