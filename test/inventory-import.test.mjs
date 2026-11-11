import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import writeExcelFile from 'write-excel-file/node';
import {readSheet} from 'read-excel-file/node';
import {zipSync} from 'fflate';
import {parseInventoryWorkbook} from '../inventory-import.mjs';
import {openDatabase} from '../database.mjs';

const columns=['Producto','Precio venta','Cantidad','Precio unitario'];
const workbook=async(rows,headers=columns)=>(await writeExcelFile([headers,...rows]).toBuffer()).toString('base64');
const payload=async(rows)=>({filename:'inventario.xlsx',fileBase64:await workbook(rows)});
const directory=mkdtempSync(path.join(os.tmpdir(),'esquina-import-')),base='http://127.0.0.1:3196';let server,admin,consumer;
async function api(route,method='GET',body,cookie=admin){const r=await fetch(base+'/api/'+route,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
before(async()=>{
 server=spawn(process.execPath,['server.mjs'],{env:{...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL||'',VERCEL:'',PORT:'3196',HOST:'127.0.0.1',DATA_DIR:directory},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(Error('Server exited '+code)))});
 admin=(await api('login','POST',{email:'admin@laesquina.demo',password:'Esquina2026!'},null)).cookie;
 consumer=(await api('login','POST',{email:'maria@laesquina.demo',password:'Consumo2026!'},null)).cookie;
});
after(()=>{server?.kill();rmSync(directory,{recursive:true,force:true})});

test('reads four Excel columns and Colombian numeric formats without guessing fractional money',async()=>{
 const data=await workbook([['  Café   molido ', '$ 4.500,00','1.000','COP 2.300'],[null,null,null,null],['Agua',2000,0,0]],[' PRODUCTO ','Precio de venta',' CANTIDAD ','Precio unitario']);
 const rows=await parseInventoryWorkbook(data,'test.xlsx');
 assert.deepEqual(rows.map(r=>[r.name,r.price,r.stock,r.unit_cost]),[['Café molido',4500,1000,2300],['Agua',2000,0,0]]);
 await assert.rejects(()=>parseInventoryWorkbook(data,'test.xls'),/xlsx/);
 const bad=await workbook([['Producto',2500,1.5,1000],['Otro',1500,2,'1,50']]);
 await assert.rejects(()=>parseInventoryWorkbook(bad,'test.xlsx'),e=>e.status===422&&e.errors[0].row===2&&e.errors.length===2);
 const duplicate=await workbook([['Café',2500,2,1000],[' CAFÉ ',2500,3,1000]]);
 await assert.rejects(()=>parseInventoryWorkbook(duplicate,'test.xlsx'),e=>e.status===422&&e.errors[0].message.includes('repetido'));
 const missing=await workbook([['Producto',2500,2]],['Producto','Precio venta','Cantidad']);
 await assert.rejects(()=>parseInventoryWorkbook(missing,'test.xlsx'),/Precio unitario/);
 const bomb=Buffer.from(zipSync({'xl/big.xml':new Uint8Array(13*1024*1024)})).toString('base64');
 await assert.rejects(()=>parseInventoryWorkbook(bomb,'test.xlsx'),/descomprimir/);
});

test('admin previews and atomically replaces stock, preserving omitted products and historical sales',async()=>{
 assert.equal((await api('inventory-import/preview','POST',{},null)).status,401);
 assert.equal((await api('inventory-import/preview','POST',{},consumer)).status,403);
 assert.equal((await api('inventory-import/commit','POST',{},consumer)).status,403);
 const template=await fetch(base+'/api/inventory-template.xlsx',{headers:{cookie:admin}});
 assert.equal(template.status,200);assert.deepEqual((await readSheet(Buffer.from(await template.arrayBuffer())))[0],columns);
 const before=(await api('state')).data,p=before.products[0],omitted=before.products[1];
 assert.equal(before.categories,undefined);assert.equal(p.category,undefined);
 const sale=await api('checkout','POST',{user_id:2,items:[{id:p.id,quantity:1}]});assert.equal(sale.status,201);
 const upload=await payload([[p.name.toUpperCase(),3100,2,2200],['Nuevo importado',4500,7,1800]]);
 const preview=await api('inventory-import/preview','POST',upload);
 assert.equal(preview.status,200);assert.equal(preview.data.created,1);assert.equal(preview.data.updated,1);assert.equal(preview.data.mode,'replace');
 let current=(await api('state')).data;
 assert.equal(current.products.find(row=>row.id===p.id).stock,p.stock-1);
 assert.ok(!current.products.some(row=>row.name==='Nuevo importado'));
 const applied=await Promise.all([1,2].map(()=>api('inventory-import/commit','POST',{token:preview.data.token})));
 assert.ok(applied.every(r=>r.status===200));assert.deepEqual(applied[0].data,applied[1].data);
 assert.deepEqual(applied[0].data,{created:1,updated:1,products:2,entries:7,exits:p.stock-3,mode:'replace'});
 current=(await api('state')).data;
 const updated=current.products.find(row=>row.id===p.id),created=current.products.find(row=>row.name==='Nuevo importado');
 assert.equal(updated.stock,2);assert.equal(updated.price,3100);assert.equal(updated.unit_cost,2200);
 assert.equal(created.stock,7);assert.equal(created.price,4500);assert.equal(created.unit_cost,1800);
 assert.deepEqual(current.products.find(row=>row.id===omitted.id),omitted);
 const invoice=current.invoices.find(i=>i.id===sale.data.id);assert.equal(invoice.lines[0].price,p.price);
 assert.equal(current.movements.filter(m=>m.note.startsWith('Ajuste por Excel:')).length,2);
 const publicState=(await api('state','GET',null,consumer)).data;
 assert.ok(publicState.products.every(row=>!Object.hasOwn(row,'unit_cost')));
 const day=new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'});
 const report=(await api('analytics?from='+day+'&to='+day)).data;
 assert.equal(report.summary.sales,p.price);assert.equal(report.summary.units,1);
 assert.ok(report.products.some(row=>row.id===p.id));
});

test('rejects stale, expired and malformed imports with no partial inventory changes',async()=>{
 const before=(await api('state')).data,p=before.products[0];
 const pending=await api('inventory-import/preview','POST',await payload([[p.name,5000,20,1000],['No debe crearse',2000,3,500]]));
 assert.equal(pending.status,200);
 await api('movements','POST',{product_id:p.id,kind:'Entrada',quantity:1,note:'Movimiento posterior a vista previa'});
 const result=await api('inventory-import/commit','POST',{token:pending.data.token});assert.equal(result.status,409);
 let after=(await api('state')).data;
 assert.equal(after.products.find(row=>row.id===p.id).stock,p.stock+1);
 assert.equal(after.products.find(row=>row.id===p.id).price,p.price);
 assert.ok(!after.products.some(row=>row.name==='No debe crearse'));
 const malformed=await api('inventory-import/preview','POST',await payload([['Fila válida',2000,2,1000],['Fila inválida',2000,-1,1000]]));
 assert.equal(malformed.status,422);assert.equal(malformed.data.errors[0].row,3);
 after=(await api('state')).data;assert.ok(!after.products.some(row=>row.name==='Fila válida'));
 const expiring=await api('inventory-import/preview','POST',await payload([['Vista que vence',2000,1,1000]]));
 const db=await openDatabase({directory,url:process.env.TEST_DATABASE_URL||''});
 try{await db.prepare('UPDATE inventory_imports SET created=? WHERE id=?').run(0,expiring.data.token);}finally{await db.close()}
 assert.equal((await api('inventory-import/commit','POST',{token:expiring.data.token})).status,409);
});
