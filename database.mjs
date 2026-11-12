import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export async function openDatabase({ directory, url = process.env.DATABASE_URL } = {}) {
  const context = new AsyncLocalStorage();
  if (url) {
    const { Pool, types } = await import('pg');
    types.setTypeParser(20, Number);
    types.setTypeParser(1700, Number);
    const pool = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000 });
    const translate = sql => {
      let index = 0;
      return sql.replace(/strftime\('%Y-%m-%d',created,'-5 hours'\)/g, "to_char(created::timestamptz AT TIME ZONE 'America/Bogota','YYYY-MM-DD')")
        .replace(/strftime\('%Y-%m',created,'-5 hours'\)/g, "to_char(created::timestamptz AT TIME ZONE 'America/Bogota','YYYY-MM')")
        .replace(/\?/g, () => '$' + (++index));
    };
    const query = (sql, args = []) => (context.getStore() || pool).query(translate(sql), args);
    return {
      dialect: 'postgres',
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
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT pg_advisory_xact_lock(21472433)');
          const result = await context.run(client, fn);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
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
    exec: sql => run(() => sqlite.exec(sql)),
    prepare(sql) {
      return Object.fromEntries(['get','all','run'].map(method=>[method,(...args)=>run(()=>sqlite.prepare(sql)[method](...args))]));
    },
    transaction: fn => exclusive(async () => {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const result = await context.run(true,fn);
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {sqlite.exec('ROLLBACK');throw error;}
    }),
    close: () => exclusive(() => sqlite.close())
  };
}
