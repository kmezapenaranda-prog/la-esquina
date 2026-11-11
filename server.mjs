import http from 'node:http';
import {ensureInventoryImportSchema,previewInventoryImport,commitInventoryImport} from './inventory-import.mjs';
import QRCode from 'qrcode';
import { salesWorkbook, monthlyWorkbook, inventoryTemplate } from './excel.mjs';
import { salesReport, monthlyAccounts } from './analytics.mjs';
import { openDatabase } from './database.mjs';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const db=await openDatabase({directory:process.env.DATA_DIR||path.join(root,'data')});
const schema="CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','consumer'))); CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER); CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY,name TEXT UNIQUE NOT NULL,type TEXT NOT NULL CHECK(type IN ('Comida','Bebida'))); CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,name TEXT NOT NULL,category_id INTEGER REFERENCES categories(id),price INTEGER NOT NULL CHECK(price>=0),stock INTEGER NOT NULL CHECK(stock>=0),minimum INTEGER NOT NULL DEFAULT 5,icon TEXT NOT NULL DEFAULT '🛍️',active INTEGER NOT NULL DEFAULT 1); CREATE TABLE IF NOT EXISTS invoices(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),created TEXT NOT NULL,total INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'Pendiente' CHECK(status IN ('Pendiente','Pagada'))); CREATE TABLE IF NOT EXISTS invoice_lines(id INTEGER PRIMARY KEY,invoice_id INTEGER REFERENCES invoices(id),product_id INTEGER REFERENCES products(id),name TEXT NOT NULL,quantity INTEGER NOT NULL,price INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS movements(id INTEGER PRIMARY KEY,product_id INTEGER REFERENCES products(id),actor_id INTEGER REFERENCES users(id),user_id INTEGER REFERENCES users(id),kind TEXT NOT NULL,quantity INTEGER NOT NULL,note TEXT NOT NULL,created TEXT NOT NULL,invoice_id INTEGER REFERENCES invoices(id));";
const passwordHash=p=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(p,salt,64).toString('hex')};
const passwordCheck=(p,h)=>{const [s,k]=h.split(':');return timingSafeEqual(scryptSync(p,s,64),Buffer.from(k,'hex'))};
await db.transaction(async()=>{
 if(db.dialect==='postgres')await db.exec('SELECT pg_advisory_xact_lock(21472431)');
 await db.exec(db.dialect==='postgres'?schema.replaceAll('INTEGER PRIMARY KEY','SERIAL PRIMARY KEY').replace('expires INTEGER','expires BIGINT'):schema);
await ensureInventoryImportSchema(db);
if(!(await db.prepare('SELECT value FROM settings WHERE key=?').get('registration_invitation'))){await db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('registration_invitation',randomBytes(32).toString('hex'));}
if(!(await db.prepare('SELECT id FROM users LIMIT 1').get())){
 if(process.env.VERCEL){
  const email=process.env.ADMIN_EMAIL?.trim().toLowerCase(),password=process.env.ADMIN_PASSWORD;
  if(!email||!/^\S+@\S+\.\S+$/.test(email)||!password||password.length<12)throw new Error('Configura ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 12 caracteres) para crear el primer administrador.');
  (await db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run('Administrador',email,passwordHash(password),'admin'));
  return;
 }
 (await db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run('Administrador','admin@laesquina.demo',passwordHash('Esquina2026!'),'admin'));
 (await db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run('María Rodríguez','maria@laesquina.demo',passwordHash('Consumo2026!'),'consumer'));
 const cats=[['Papas y snacks','Comida'],['Dulces','Comida'],['Galletas','Comida'],['Gaseosas','Bebida'],['Jugos','Bebida'],['Agua','Bebida']];
 for(const c of cats)(await db.prepare('INSERT INTO categories(name,type) VALUES(?,?)').run(...c));
 const products=[['Papas Margarita',1,2500,24,8,'🥔'],['Chocolatina Jet',2,1800,36,10,'🍫'],['Coca-Cola · 400 ml',4,3500,18,6,'🥤'],['Galletas Oreo',3,2200,4,8,'🍪'],['Agua Cristal · 600 ml',6,2000,30,8,'💧'],['Choclitos',1,2000,16,6,'🌽'],['Jugo Hit · 500 ml',5,3000,5,8,'🧃'],['Gomitas Trululu',2,1500,22,6,'🍬']];
 for(const p of products){const r=(await db.prepare('INSERT INTO products(name,category_id,price,stock,minimum,icon) VALUES(?,?,?,?,?,?)').run(...p));(await db.prepare('INSERT INTO movements(product_id,actor_id,kind,quantity,note,created) VALUES(?,1,?,?,?,?)').run(r.lastInsertRowid,'Entrada',p[3],'Inventario inicial',new Date().toISOString()))}
}
});
const json=(res,status,value,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(value))};
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e};
const int=(n,min=0)=>{if(!Number.isSafeInteger(n)||n<min||n>1000000000)fail('Ingresa un número entero válido.');return n};
const str=(s,max=100)=>{if(typeof s!=='string'||!s.trim()||s.trim().length>max)fail('Completa todos los campos correctamente.');return s.trim()};
const userView=u=>({id:u.id,name:u.name,email:u.email,role:u.role});
const transaction=fn=>db.transaction(fn);
const attempts=new Map();
async function handler(req,res){
 try{
 const url=new URL(req.url,'http://localhost');const route=url.pathname;
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
 res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
 if(route==='/api/config'&&req.method==='GET')return json(res,200,{demo:!process.env.VERCEL});
 if(route==='/api/health'&&req.method==='GET')return json(res,200,{app:'la-esquina',ok:true});
 if(!route.startsWith('/api/')){const name=route==='/app.js'?'app.js':route==='/style.css'?'style.css':route==='/analytics-ui.js'?'analytics-ui.js':route==='/registration-ui.js'?'registration-ui.js':route==='/inventory-import-ui.js'?'inventory-import-ui.js':route==='/'?'index.html':null;if(!name)return json(res,404,{error:'No encontrado'});res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-cache'});return res.end(readFileSync(path.join(root,'public',name)))}
 let body={};if(!['GET','HEAD'].includes(req.method)){if(req.headers.origin&&req.headers.origin!==`${req.headers['x-forwarded-proto']||'http'}://${req.headers.host}`)fail('Origen no permitido.',403);if(req.body&&typeof req.body==='object')body=req.body;else{let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>(route==='/api/inventory-import/preview'?3000000:100000))fail('Solicitud demasiado grande.',413);chunks.push(c)}try{body=JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{fail('Solicitud inválida.')}}}
 if(!body||typeof body!=='object'||Array.isArray(body))fail('Solicitud inválida.');
 const token=Object.fromEntries((req.headers.cookie||'').split(';').filter(x=>x.includes('=')).map(x=>x.trim().split('='))).session;
 let user=token?(await db.prepare('SELECT u.* FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(token,Date.now())):null;
 const secure=Boolean(process.env.VERCEL)||process.env.COOKIE_SECURE==='1'||req.headers['x-forwarded-proto']==='https';
 const cookie=t=>`session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${t?86400:0}${secure?'; Secure':''}`;
 if(route==='/api/login'&&req.method==='POST'){
 const email=str(body.email).toLowerCase();const ip=req.socket.remoteAddress;const key=ip+email;const prev=attempts.get(key);if(prev&&prev.count>=10&&prev.until>Date.now())fail('Demasiados intentos. Espera 15 minutos.',429);
 const u=(await db.prepare('SELECT * FROM users WHERE email=?').get(email));if(typeof body.password!=='string'||body.password.length>200||!u||!passwordCheck(body.password,u.password)){const a=prev&&prev.until>Date.now()?prev:{count:0,until:Date.now()+900000};a.count++;attempts.set(key,a);fail('Correo o contraseña incorrectos.',401)}
 attempts.delete(key);(await db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now()));const t=randomBytes(32).toString('hex');(await db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(t,u.id,Date.now()+86400000));return json(res,200,{user:userView(u)},{'Set-Cookie':cookie(t)})}
 if(route==='/api/register'&&req.method==='POST'){
 const ip=process.env.VERCEL?String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',')[0].trim():req.socket.remoteAddress;
 const key='registration:'+ip, previous=attempts.get(key);
 if(previous&&previous.count>=20&&previous.until>Date.now())fail('Demasiados intentos fallidos. Espera 15 minutos y vuelve a intentar.',429);
 const reject=message=>{const attempt=previous&&previous.until>Date.now()?previous:{count:0,until:Date.now()+900000};attempt.count++;attempts.set(key,attempt);fail(message)};
 const invitation=await db.prepare('SELECT value FROM settings WHERE key=?').get('registration_invitation');
 const supplied=typeof body.invitation==='string'?body.invitation:'';
 if(!invitation||!/^[a-f0-9]{64}$/.test(supplied)||supplied.length!==invitation.value.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(invitation.value)))reject('La invitación no es válida. Pide a la tienda su QR o enlace de registro.');
 const name=str(body.name),email=str(body.email).toLowerCase();
 if(name.length<2)fail('Escribe tu nombre completo.');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Escribe un correo electrónico válido.');
 if(typeof body.password!=='string'||body.password.length<10||body.password.length>200)fail('La contraseña debe tener entre 10 y 200 caracteres.');
 if(body.password!==body.confirmPassword)fail('Las contraseñas no coinciden.');
 const session=randomBytes(32).toString('hex');
 const created=await transaction(async()=>{
   const result=await db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run(name,email,passwordHash(body.password),'consumer');
   const id=Number(result.lastInsertRowid);
   await db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)').run(session,id,Date.now()+86400000);
   return {id,name,email,role:'consumer'};
 });
 attempts.delete(key);return json(res,201,{user:created},{'Set-Cookie':cookie(session)});
 }
 if(!user)fail('Inicia sesión para continuar.',401);
 if(route==='/api/logout'&&req.method==='POST'){(await db.prepare('DELETE FROM sessions WHERE token=?').run(token));return json(res,200,{ok:true},{'Set-Cookie':cookie('')})}
 if(route==='/api/state'&&req.method==='GET'){
 const products=(await db.prepare('SELECT * FROM products WHERE active=1 ORDER BY id').all());
 for(const product of products){delete product.category_id;if(user.role!=='admin')delete product.unit_cost;}
 const invoices=(await db.prepare(`SELECT i.*,u.name consumer FROM invoices i JOIN users u ON i.user_id=u.id ${user.role==='admin'?'':'WHERE i.user_id=?'} ORDER BY i.id DESC`).all(...(user.role==='admin'?[]:[user.id])));
 for(const i of invoices)i.lines=(await db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=?').all(i.id));
 const movements=(await db.prepare(`SELECT m.*,p.name product,p.icon,u.name actor,c.name consumer FROM movements m JOIN products p ON p.id=m.product_id JOIN users u ON u.id=m.actor_id LEFT JOIN users c ON c.id=m.user_id ${user.role==='admin'?'':'WHERE m.user_id=?'} ORDER BY m.id DESC LIMIT 200`).all(...(user.role==='admin'?[]:[user.id])));
 const users=user.role==='admin'?(await db.prepare('SELECT id,name,email,role FROM users ORDER BY id').all()):[userView(user)];
 return json(res,200,{user:userView(user),products,invoices,movements,users})}
 if(route==='/api/checkout'&&req.method==='POST'){
 if(!Array.isArray(body.items)||!body.items.length||body.items.length>100)fail('Agrega productos a la cuenta.');
 const uid=user.role==='admin'?int(body.user_id,1):user.id;if(!(await db.prepare('SELECT id FROM users WHERE id=?').get(uid)))fail('Selecciona un consumidor.');
 const result=await transaction(async()=>{const ids=new Set();const lines=await Promise.all([...body.items].sort((a,b)=>a.id-b.id).map(async i=>{const id=int(i.id,1),q=int(i.quantity,1);if(ids.has(id))fail('Producto duplicado.');ids.add(id);const p=(await db.prepare('SELECT * FROM products WHERE id=? AND active=1'+(db.dialect==='postgres'?' FOR UPDATE':'')).get(id));if(!p)fail('Producto no disponible.');if(p.stock<q)fail(`No hay suficientes unidades de ${p.name}.`);return {...p,quantity:q}}));const total=lines.reduce((s,p)=>s+p.price*p.quantity,0);int(total);const date=new Date().toISOString();const id=Number((await db.prepare('INSERT INTO invoices(user_id,created,total) VALUES(?,?,?)').run(uid,date,total)).lastInsertRowid);for(const p of lines){(await db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(p.quantity,p.id));(await db.prepare('INSERT INTO invoice_lines(invoice_id,product_id,name,quantity,price) VALUES(?,?,?,?,?)').run(id,p.id,p.name,p.quantity,p.price));(await db.prepare('INSERT INTO movements(product_id,actor_id,user_id,kind,quantity,note,created,invoice_id) VALUES(?,?,?,?,?,?,?,?)').run(p.id,user.id,uid,'Salida',p.quantity,'Consumo registrado',date,id))}return {id,total}});return json(res,201,result)}
 if(route==='/api/password'&&req.method==='POST'){if(!passwordCheck(String(body.current||''),user.password))fail('La contraseña actual no es correcta.');const p=str(body.password,200);if(p.length<10)fail('Usa al menos 10 caracteres.');(await db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash(p),user.id));(await db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(user.id,token));return json(res,200,{ok:true})}
 if(user.role!=='admin')fail('Solo el administrador puede realizar esta acción.',403);
 if(route==='/api/registration'&&req.method==='GET'){
   const invitation=await db.prepare('SELECT value FROM settings WHERE key=?').get('registration_invitation');
   const configured=process.env.PUBLIC_APP_URL||(process.env.VERCEL_PROJECT_PRODUCTION_URL?'https://'+process.env.VERCEL_PROJECT_PRODUCTION_URL:'');
   const origin=new URL(configured||`${req.headers['x-forwarded-proto']||'http'}://${req.headers.host}`).origin;
   const registrationUrl=origin+'/#registro?invitacion='+encodeURIComponent(invitation.value);
   const qr=await QRCode.toDataURL(registrationUrl,{width:720,margin:4,errorCorrectionLevel:'M'});
   return json(res,200,{url:registrationUrl,qr});
 }
 if(route==='/api/monthly-accounts'&&req.method==='GET')return json(res,200,await monthlyAccounts(db,url.searchParams.get('month'),url.searchParams.get('person')||''));
 if(['/api/analytics.xlsx','/api/monthly-accounts.xlsx'].includes(route)&&req.method==='GET'){
   const monthly=route==='/api/monthly-accounts.xlsx';
   const report=monthly?await monthlyAccounts(db,url.searchParams.get('month'),url.searchParams.get('person')||''):await salesReport(db,url.searchParams.get('from'),url.searchParams.get('to'));
   const content=monthly?await monthlyWorkbook(report):await salesWorkbook(report);
   const suffix=monthly?report.month:(report.range.from+'-'+report.range.to);
   res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="la-esquina-${monthly?'cuentas':'ventas'}-${suffix}.xlsx"`,'Cache-Control':'no-store','Content-Length':content.length});return res.end(content);
 }
 if(route==='/api/analytics'&&req.method==='GET')return json(res,200,await salesReport(db,url.searchParams.get('from'),url.searchParams.get('to')));
 if(route==='/api/inventory-template.xlsx'&&req.method==='GET'){
   const content=await inventoryTemplate();res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="plantilla-inventario.xlsx"','Cache-Control':'no-store'});return res.end(content);
 }
 if(route==='/api/inventory-import/preview'&&req.method==='POST')return json(res,200,await previewInventoryImport(db,body,user.id));
 if(route==='/api/inventory-import/commit'&&req.method==='POST')return json(res,200,await commitInventoryImport(db,body.token,user.id));
 if(route==='/api/products'&&req.method==='POST'){
  const name=str(body.name),price=int(body.price,1),stock=int(body.stock),minimum=int(body.minimum),cost=body.unit_cost==null||body.unit_cost===''?null:int(body.unit_cost);
  const id=await transaction(async()=>{
   if(db.dialect==='postgres')await db.exec('SELECT pg_advisory_xact_lock(21472432)');
   const id=Number((await db.prepare('INSERT INTO products(name,price,stock,minimum,icon,unit_cost) VALUES(?,?,?,?,?,?)').run(name,price,stock,minimum,str(body.icon||'🛍️',10),cost)).lastInsertRowid);
   await db.prepare('INSERT INTO movements(product_id,actor_id,kind,quantity,note,created) VALUES(?,?,?,?,?,?)').run(id,user.id,'Entrada',stock,'Inventario inicial',new Date().toISOString());return id;
  });return json(res,201,{id});
 }
 if(/^\/api\/products\/\d+$/.test(route)&&req.method==='PATCH'){
  const id=+route.split('/').pop(),existing=await db.prepare('SELECT unit_cost FROM products WHERE id=? AND active=1').get(id);
  if(!existing)fail('Producto no encontrado.',404);
  const cost=body.unit_cost===undefined?existing.unit_cost:body.unit_cost==null||body.unit_cost===''?null:int(body.unit_cost);
  await db.prepare('UPDATE products SET name=?,price=?,minimum=?,icon=?,unit_cost=? WHERE id=?').run(str(body.name),int(body.price,1),int(body.minimum),str(body.icon||'🛍️',10),cost,id);return json(res,200,{ok:true});
 }
 if(route==='/api/movements'&&req.method==='POST'){const id=int(body.product_id,1),q=int(body.quantity,1),kind=body.kind;if(!['Entrada','Salida'].includes(kind))fail('Tipo inválido.');const note=str(body.note,200);await transaction(async()=>{const p=(await db.prepare('SELECT * FROM products WHERE id=? AND active=1'+(db.dialect==='postgres'?' FOR UPDATE':'')).get(id));if(!p)fail('Producto no encontrado.');if(kind==='Salida'&&p.stock<q)fail('Existencias insuficientes.');int(p.stock+(kind==='Entrada'?q:-q));(await db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(kind==='Entrada'?q:-q,id));(await db.prepare('INSERT INTO movements(product_id,actor_id,kind,quantity,note,created) VALUES(?,?,?,?,?,?)').run(id,user.id,kind,q,note,new Date().toISOString()))});return json(res,201,{ok:true})}
 if(/^\/api\/invoices\/\d+\/pay$/.test(route)&&req.method==='POST'){const r=(await db.prepare("UPDATE invoices SET status='Pagada' WHERE id=? AND status='Pendiente'").run(+route.split('/')[3]));if(!r.changes)fail('La cuenta ya está pagada o no existe.');return json(res,200,{ok:true})}
 if(route==='/api/users'&&req.method==='POST'){const name=str(body.name),email=str(body.email).toLowerCase(),p=str(body.password,200);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Correo inválido.');if(p.length<10)fail('La contraseña debe tener al menos 10 caracteres.');if(!['admin','consumer'].includes(body.role))fail('Rol inválido.');(await db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run(name,email,passwordHash(p),body.role));return json(res,201,{ok:true})}
 fail('Ruta no encontrada.',404);
 }catch(e){if(e.code==='23505'||(e.code?.startsWith('ERR_SQLITE')&&e.message.includes('UNIQUE')))return json(res,409,{error:'Ya existe un registro con ese nombre o correo.'});if(!e.status)console.error(e);json(res,e.status||500,{error:e.status?e.message:'Ocurrió un error. Inténtalo de nuevo.',...(Array.isArray(e.errors)?{errors:e.errors}:{})})}
}
const portIndex=process.argv.indexOf('--port');
const port=Number(process.env.PORT||(portIndex>=0?process.argv[portIndex+1]:3000));
export default handler;
if(!process.env.VERCEL){const server=http.createServer(handler);server.listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`La Esquina: http://localhost:${port}`));}
