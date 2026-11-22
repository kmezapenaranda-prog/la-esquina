import {scrypt,randomBytes,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt),queue=[];let active=0;
// Bound expensive work without blocking the HTTP event loop or allocating unbounded scrypt memory.
async function work(fn){if(active>=4){if(queue.length>=128)throw Object.assign(Error('Muchos accesos simultáneos. Vuelve a intentar en unos segundos.'),{status:429});await new Promise(resolve=>queue.push(resolve))}else active++;try{return await fn()}finally{const next=queue.shift();if(next)next();else active--}}
const dummySalt='dummy-account-timing-salt';
const dummyKey=await derive('dummy-not-a-user-password',dummySalt,64);
export async function passwordHash(password){return work(async()=>{const salt=randomBytes(16).toString('hex');return salt+':'+(await derive(password,salt,64)).toString('hex')})}
export async function passwordCheck(password,hash){return work(async()=>{const [salt,key]=String(hash||'').split(':');const valid=typeof salt==='string'&&salt.length>0&&salt.length<=100&&/^[a-f0-9]{128}$/.test(key||'');const actual=await derive(password,valid?salt:dummySalt,64);return timingSafeEqual(actual,valid?Buffer.from(key,'hex'):dummyKey)&&valid})}
