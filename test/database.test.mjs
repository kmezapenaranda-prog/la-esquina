import { test } from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../database.mjs';

test('local transactions roll back and keep concurrent writes outside the transaction',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'esquina-db-'));
  const db=await openDatabase({directory,url:''});
  try {
    await db.exec('CREATE TABLE stock(value INTEGER); INSERT INTO stock VALUES(1);');
    let entered,release;
    const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
    const transaction=db.transaction(async()=>{
      await db.prepare('UPDATE stock SET value=7').run();entered();await gate;throw Error('cancelar');
    });
    const rejected=assert.rejects(transaction,/cancelar/);
    await started;
    const outside=db.prepare('UPDATE stock SET value=value+1').run();
    release();await rejected;await outside;
    assert.equal((await db.prepare('SELECT value FROM stock').get()).value,2);
  } finally {await db.close();rmSync(directory,{recursive:true,force:true})}
});
