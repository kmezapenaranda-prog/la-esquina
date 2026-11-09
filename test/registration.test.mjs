import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import jsQR from 'jsqr';
import {PNG} from 'pngjs';
const directory=mkdtempSync(path.join(os.tmpdir(),'esquina-registration-'));
const base='http://127.0.0.1:3197';let process;
before(async()=>{
 process=spawn(globalThis.process.execPath,['server.mjs'],{env:{...globalThis.process.env,DATABASE_URL:globalThis.process.env.TEST_DATABASE_URL||'',VERCEL:'',PUBLIC_APP_URL:'',VERCEL_PROJECT_PRODUCTION_URL:'',PORT:'3197',HOST:'127.0.0.1',DATA_DIR:directory},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{process.stdout.once('data',resolve);process.once('error',reject);process.once('exit',code=>reject(Error('Server exited '+code)))});
});
after(()=>{process?.kill();rmSync(directory,{recursive:true,force:true})});
async function api(route,method='GET',body,cookie){
 const r=await fetch(base+'/api/'+route,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
}

test('QR decodes to the invitation and self-registration always creates an isolated consumer',async()=>{
 const admin=(await api('login','POST',{email:'admin@laesquina.demo',password:'Esquina2026!'})).cookie;
 const consumer=(await api('login','POST',{email:'maria@laesquina.demo',password:'Consumo2026!'})).cookie;
 assert.equal((await api('registration')).status,401);
 assert.equal((await api('registration','GET',null,consumer)).status,403);
 const share=await api('registration','GET',null,admin);
 assert.equal(share.status,200);assert.match(share.data.qr,/^data:image\/png;base64,/);
 const image=PNG.sync.read(Buffer.from(share.data.qr.split(',')[1],'base64'));
 const decoded=jsQR(new Uint8ClampedArray(image.data),image.width,image.height);
 assert.equal(decoded.data,share.data.url);assert.ok(share.data.url.startsWith(base+'/#registro?invitacion='));
 const invitation=new URLSearchParams(new URL(share.data.url).hash.split('?')[1]).get('invitacion');
 const body={invitation,name:'  Nuevo Consumidor  ',email:' NUEVO@example.com ',password:'UnaClavePersonal2026!',confirmPassword:'UnaClavePersonal2026!',role:'admin'};
 assert.equal((await api('register','POST',{...body,invitation:'mal'})).status,400);
 assert.equal((await api('register','POST',{...body,invitation:'é'.repeat(64)})).status,400);
 assert.equal((await api('register','POST',{...body,confirmPassword:'OtraClavePersonal'})).status,400);
 assert.equal((await api('register','POST',{...body,password:'corta',confirmPassword:'corta'})).status,400);
 assert.equal((await api('register','POST',{...body,email:'incorrecto'})).status,400);
 const created=await api('register','POST',body);
 assert.equal(created.status,201);assert.equal(created.data.user.role,'consumer');
 assert.equal(created.data.user.email,'nuevo@example.com');assert.equal(created.data.user.name,'Nuevo Consumidor');
 assert.ok(created.cookie);
 const state=(await api('state','GET',null,created.cookie)).data;
 assert.equal(state.user.role,'consumer');assert.equal(state.users.length,1);assert.equal(state.invoices.length,0);
 assert.equal((await api('registration','GET',null,created.cookie)).status,403);
 assert.equal((await api('users','POST',{name:'No permitido'},created.cookie)).status,403);
 assert.equal((await api('register','POST',body)).status,409);
 assert.equal((await api('login','POST',{email:'nuevo@example.com',password:body.password})).status,200);
 assert.equal((await api('registration','GET',null,admin)).data.url,share.data.url);
 const duplicate={...body,email:'duplicado@example.com'};
 const simultaneous=await Promise.all([api('register','POST',duplicate),api('register','POST',duplicate)]);
 assert.deepEqual(simultaneous.map(r=>r.status).sort(),[201,409]);
 const users=(await api('state','GET',null,admin)).data.users;
 assert.equal(users.filter(u=>u.email==='duplicado@example.com').length,1);
 assert.equal(users.filter(u=>u.role==='admin').length,1);
});

test('invalid invitations are rate limited without preventing normal batch signups',async()=>{
 for(let i=0;i<20;i++)assert.equal((await api('register','POST',{invitation:'inválida'})).status,400);
 assert.equal((await api('register','POST',{invitation:'inválida'})).status,429);
});
