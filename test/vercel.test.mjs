import {test} from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/index.mjs';

test('Vercel refuses ephemeral SQLite when no production database is configured',async()=>{
 const old={VERCEL:process.env.VERCEL,DATABASE_URL:process.env.DATABASE_URL};
 process.env.VERCEL='1';delete process.env.DATABASE_URL;
 let status,body;const previous=console.error;console.error=()=>{};
 try {
   const req={url:'/api/index?__path=state',method:'GET'};
   const res={headersSent:false,writeHead(code){status=code},end(value){body=JSON.parse(value)}};
   await handler(req,res);
   assert.equal(req.url,'/api/state');assert.equal(status,503);
   assert.match(body.error,/configuración/);
 } finally {
   console.error=previous;
   for(const [key,value] of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});
