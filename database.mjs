import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export async function openDatabase({ directory, url = process.env.DATABASE_URL } = {}) {
  const context = new AsyncLocalStorage();
  let revisions=false;
  if (url) {
    const { Pool, types } = await import('pg');
    types.setTypeParser(20, Number);
    types.setTypeParser(1700, Number);
    const configured=Number(process.env.DB_POOL_MAX||8);
    if(!Number.isInteger(configured)||configured<1||configured>20)throw Error('DB_POOL_MAX debe estar entre 1 y 20.');
    const pool = new Pool({ connectionString: url, max:configured, connectionTimeoutMillis:10000, idleTimeoutMillis:30000, statement_timeout:15000, idle_in_transaction_session_timeout:20000 });
    pool.on('error',error=>console.error('PostgreSQL idle connection:',error.code||error.name));
    const target=new URL(url),testDelay=['localhost','127.0.0.1','[::1]'].includes(target.hostname)&&/^\/loadtest_/.test(target.pathname)?Math.min(100,Math.max(0,Number(process.env.LOAD_TEST_DB_DELAY_MS)||0)):0;
    const execute=async(client,sql,args=[])=>{if(testDelay)await new Promise(resolve=>setTimeout(resolve,testDelay));return client.query(sql,args)};
    const acquire=async()=>{if(pool.waitingCount>=200)throw Object.assign(Error('La tienda está ocupada. Vuelve a intentar en unos segundos.'),{status:503});return pool.connect()};
    const translate = sql => {
      let index = 0;
      return sql.replace(/strftime\('%Y-%m-%d',created,'-5 hours'\)/g, "to_char(created::timestamptz AT TIME ZONE 'America/Bogota','YYYY-MM-DD')")
        .replace(/strftime\('%Y-%m',created,'-5 hours'\)/g, "to_char(created::timestamptz AT TIME ZONE 'America/Bogota','YYYY-MM')")
        .replace(/\?/g, () => '$' + (++index));
    };
    const query = async(sql,args=[])=>{const active=context.getStore();if(active){if(/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(sql))active.dirty=true;return execute(active.client,translate(sql),args);}const client=await acquire();try{return await execute(client,translate(sql),args)}finally{client.release()}};
    return {
      dialect: 'postgres',
      enableRevisions:()=>{revisions=true},
      exec: sql => query(sql),
      prepare(sql) {
        return {
          get: async (...args) => (await query(sql,args)).rows[0],
          all: async (...args) => (await query(sql,args)).rows,
          run: async (...args) => {
            const returnsId = /^INSERT INTO (users|categories|products|invoices|invoice_lines|movements|payments|suppliers|purchases|purchase_lines|purchase_payments|expenses|returns|losses|audit_log)\b/i.test(sql);
            const result = await query(sql + (returnsId ? ' RETURNING id' : ''), args);
            return { changes: result.rowCount, lastInsertRowid: result.rows[0]?.id };
          }
        };
      },
      async transaction(fn,{exclusive=false}={}) {
        const client = await acquire();
        try {
          await execute(client,'BEGIN');
          await execute(client,exclusive?'SELECT pg_advisory_xact_lock(21472433)':'SELECT pg_advisory_xact_lock_shared(21472433)');
          const transaction={client,dirty:false};
          const result = await context.run(transaction, fn);
          await execute(client,revisions&&transaction.dirty?"UPDATE settings SET value=(value::bigint+1)::text WHERE key='data_revision'; COMMIT":'COMMIT');
          return result;
        } catch (error) {
          try{await client.query('ROLLBACK')}catch{}
          throw error;
        } finally { client.release(); }
      },
      close: () => pool.end()
    };
  }
  if (process.env.VERCEL) throw new Error('Configura DATABASE_URL con una base PostgreSQL persistente antes de desplegar.');
  if (!directory) throw new Error('Falta el directorio local de datos.');
  mkdirSync(directory,{recursive:true});
  const { DatabaseSync } = await import('node:sqlite');
  const sqlite = new DatabaseSync(path.join(directory,'tienda.sqlite'));
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  let queue = Promise.resolve();
  const exclusive = fn => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  const run = fn => context.getStore() ? Promise.resolve().then(fn) : exclusive(fn);
  return {
    dialect: 'sqlite',
    enableRevisions:()=>{revisions=true},
    exec: sql => run(() => sqlite.exec(sql)),
    prepare(sql) {
      return Object.fromEntries(['get','all','run'].map(method=>[method,(...args)=>run(()=>sqlite.prepare(sql)[method](...args))]));
    },
    transaction: fn => exclusive(async () => {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = await context.run(true,fn);
        if(revisions)sqlite.exec("UPDATE settings SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='data_revision'");
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {sqlite.exec('ROLLBACK');throw error;}
    }),
    close: () => exclusive(() => sqlite.close())
  };
}
