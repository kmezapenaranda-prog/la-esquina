import {audit} from './operations.mjs';
import {readSheet} from 'read-excel-file/node';
import {unzipSync} from 'fflate';
import {randomBytes} from 'node:crypto';

const MAX_FILE=2*1024*1024,MAX_ROWS=1000,TTL=15*60*1000;
const headers={producto:'name',nombreproducto:'name',precioventa:'price',preciodeventa:'price',cantidad:'stock',existencias:'stock',preciounitario:'unit_cost',costounitario:'unit_cost'};
const title={name:'Producto',price:'Precio venta',stock:'Cantidad',unit_cost:'Precio unitario'};
const error=(message,status=400,errors)=>{throw Object.assign(new Error(message),{status,...(errors?{errors}: {})})};
const normalizeHeader=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export const productKey=value=>String(value).normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('es-CO');

export async function ensureInventoryImportSchema(db){
 const exists=db.dialect==='postgres'
  ?await db.prepare("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='products' AND column_name='unit_cost'").get()
  :(await db.prepare('PRAGMA table_info(products)').all()).some(column=>column.name==='unit_cost');
 if(!exists)await db.exec('ALTER TABLE products ADD COLUMN unit_cost INTEGER CHECK(unit_cost>=0)');
 await db.exec(`CREATE TABLE IF NOT EXISTS inventory_imports(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),payload TEXT NOT NULL,created BIGINT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','applied')),result TEXT)`);
}

function integer(value,min,label){
 if(typeof value==='string'){
  let text=value.trim().replace(/^COP\s*/i,'').replace(/^\$\s*/,'').replace(/\s/g,'');
  if(/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(text))text=text.replace(/\./g,'');
  if(/^\d+(?:,\d{1,2})?$/.test(text))text=text.replace(',','.');
  if(!/^\d+(?:\.\d{1,2})?$/.test(text))error(`${label}: usa una celda numérica o un valor como 2.500,00.`);
  value=Number(text);
 }
 if(!Number.isSafeInteger(value)||value<min||value>1000000000)error(`${label}: usa un número entero ${min?'mayor que cero':'igual o mayor que cero'}, en pesos sin decimales.`);
 return value;
}

export async function parseInventoryWorkbook(fileBase64,filename){
 if(typeof filename!=='string'||!filename.toLowerCase().endsWith('.xlsx'))error('Selecciona un archivo Excel .xlsx. Si tienes un .xls, guárdalo como .xlsx.');
 if(typeof fileBase64!=='string'||fileBase64.length>Math.ceil(MAX_FILE/3)*4||!fileBase64.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(fileBase64))error('El archivo no es válido o supera el límite de 2 MB.');
 const buffer=Buffer.from(fileBase64,'base64');
 if(buffer.length>MAX_FILE||buffer.length<4||buffer.subarray(0,2).toString()!=='PK')error('No es un archivo .xlsx válido.');
 let data;
 try{
  let total=0,count=0;
  unzipSync(buffer,{filter:entry=>{total+=entry.originalSize;count++;if(total>12*1024*1024||count>1500)error('El Excel es demasiado grande al descomprimirlo.');return false;}});
  data=await readSheet(buffer);
 }catch(cause){if(cause.status)throw cause;error('No pudimos leer el Excel. Comprueba que no esté dañado ni protegido con contraseña.');}
 const first=data.findIndex(row=>row.some(cell=>cell!==null&&String(cell).trim()!==''));
 if(first<0)error('El Excel está vacío.');
 const columns={};
 for(let i=0;i<data[first].length;i++){
  const key=headers[normalizeHeader(data[first][i])];
  if(!key)continue;
  if(columns[key]!==undefined)error(`La columna ${title[key]} aparece más de una vez.`);
  columns[key]=i;
 }
 const missing=Object.keys(title).filter(key=>columns[key]===undefined);
 if(missing.length)error('Faltan columnas en la primera fila: '+missing.map(key=>title[key]).join(', ')+'.');
 const rows=[],errors=[],seen=new Map();
 for(let i=first+1;i<data.length;i++){
  const values=data[i];
  if(values.every(cell=>cell===null||String(cell).trim()===''))continue;
  if(rows.length+errors.length>=MAX_ROWS)error('El archivo puede contener hasta 1.000 productos. Divídelo en varios archivos.');
  try{
   const raw=values[columns.name];
   if(typeof raw!=='string'||!raw.trim()||raw.trim().length>100)error('Producto: escribe un nombre de hasta 100 caracteres.');
   const name=raw.trim().replace(/\s+/g,' '),key=productKey(name);
   if(seen.has(key))error(`Producto repetido; ya aparece en la fila ${seen.get(key)}. Conserva una sola fila por producto.`);
   seen.set(key,i+1);
   rows.push({row:i+1,name,price:integer(values[columns.price],1,'Precio venta'),stock:integer(values[columns.stock],0,'Cantidad'),unit_cost:integer(values[columns.unit_cost],0,'Precio unitario')});
  }catch(cause){errors.push({row:i+1,message:cause.message});}
 }
 if(errors.length)error('Revisa las filas indicadas y vuelve a seleccionar el archivo. No se modificó el inventario.',422,errors.slice(0,50));
 if(!rows.length)error('El Excel no contiene productos. Agrega datos debajo de los encabezados.');
 return rows;
}

function indexProducts(products){
 const index=new Map();
 for(const product of products){const key=productKey(product.name);if(!index.has(key))index.set(key,[]);index.get(key).push(product);}
 return index;
}
const snapshot=p=>({id:p.id,name:p.name,price:p.price,stock:p.stock,unit_cost:p.unit_cost??null,active:p.active});

export async function previewInventoryImport(db,{fileBase64,filename},actor){
 const rows=await parseInventoryWorkbook(fileBase64,filename);
 const current=indexProducts(await db.prepare('SELECT * FROM products WHERE active=1').all());
 const planned=rows.map(row=>{
  const matches=current.get(productKey(row.name))||[];
  if(matches.length>1)error(`Fila ${row.row}: hay varios productos llamados ${row.name} en el inventario. Cambia sus nombres para distinguirlos.`,409);
  const existing=matches[0];
  return {...row,expected:existing?snapshot(existing):null};
 });
 const safeName=filename.split(/[\\/]/).at(-1).slice(0,100);
 const token=randomBytes(16).toString('hex'),created=Date.now();
 await db.prepare('DELETE FROM inventory_imports WHERE created<?').run(created-24*60*60*1000);
 await db.prepare('INSERT INTO inventory_imports(id,user_id,payload,created,status) VALUES(?,?,?,?,?)').run(token,actor,JSON.stringify({rows:planned,filename:safeName}),created,'pending');
 return {token,filename:safeName,expiresAt:new Date(created+TTL).toISOString(),mode:'replace',created:planned.filter(row=>!row.expected).length,updated:planned.filter(row=>row.expected).length,
  rows:planned.map(row=>({row:row.row,name:row.name,price:row.price,stock:row.stock,unit_cost:row.unit_cost,oldStock:row.expected?.stock??null,action:row.expected?'Actualizar':'Crear'}))};
}

export async function commitInventoryImport(db,token,actor){
 if(typeof token!=='string'||!/^[a-f0-9]{32}$/.test(token))error('Vista previa no válida. Vuelve a seleccionar el archivo.');
 return db.transaction(async()=>{
  if(db.dialect==='postgres')await db.exec('SELECT pg_advisory_xact_lock(21472432)');
  const batch=await db.prepare('SELECT * FROM inventory_imports WHERE id=?'+(db.dialect==='postgres'?' FOR UPDATE':'')).get(token);
  if(!batch||batch.user_id!==actor)error('No se encontró tu vista previa. Vuelve a cargar el archivo.',404);
  if(batch.status==='applied')return JSON.parse(batch.result);
  if(Date.now()-batch.created>TTL)error('La vista previa venció. Vuelve a cargar el archivo.',409);
  const {rows,filename}=JSON.parse(batch.payload);
  const ids=rows.filter(row=>row.expected).map(row=>row.expected.id).sort((a,b)=>a-b);
  const locked=ids.length?await db.prepare(`SELECT * FROM products WHERE id IN (${ids.map(()=>'?').join(',')}) ORDER BY id${db.dialect==='postgres'?' FOR UPDATE':''}`).all(...ids):[];
  const byId=new Map(locked.map(p=>[p.id,p]));
  const current=indexProducts(await db.prepare('SELECT * FROM products WHERE active=1').all());
  for(const row of rows){
   const matches=current.get(productKey(row.name))||[];
   if(row.expected){const actual=byId.get(row.expected.id);if(!actual||JSON.stringify(snapshot(actual))!==JSON.stringify(row.expected)||matches.length!==1||matches[0].id!==actual.id)error(`El producto ${row.name} cambió después de la vista previa. Revisa otra vez el Excel antes de importar.`,409);}
   else if(matches.length)error(`El producto ${row.name} se creó después de la vista previa. Vuelve a cargar el Excel.`,409);
  }
  let created=0,updated=0,entries=0,exits=0;
  const now=new Date().toISOString();
  for(const row of rows){
   let id=row.expected?.id;
   if(id){await db.prepare('UPDATE products SET name=?,price=?,stock=?,unit_cost=? WHERE id=?').run(row.name,row.price,row.stock,row.unit_cost,id);updated++;}
   else {id=Number((await db.prepare('INSERT INTO products(name,price,stock,unit_cost) VALUES(?,?,?,?)').run(row.name,row.price,row.stock,row.unit_cost)).lastInsertRowid);created++;}
   const difference=row.stock-(row.expected?.stock||0);
   if(difference){
    if(difference>0)entries+=difference;else exits-=difference;
    await db.prepare('INSERT INTO movements(product_id,actor_id,kind,quantity,note,created) VALUES(?,?,?,?,?,?)').run(id,actor,difference>0?'Entrada':'Salida',Math.abs(difference),'Ajuste por Excel: '+filename,now);
   }
  }
  const result={created,updated,products:rows.length,entries,exits,mode:'replace'};
  await db.prepare('UPDATE inventory_imports SET status=?,payload=?,result=? WHERE id=?').run('applied','{}',JSON.stringify(result),token);
  await audit(db,actor,'Inventario importado',filename,null,{...result,rows:rows.map(row=>({name:row.name,before:row.expected,stock:row.stock,price:row.price,unit_cost:row.unit_cost}))});
  return result;
 });
}
