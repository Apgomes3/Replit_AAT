import { Pool, PoolClient } from 'pg';
import { databaseEvent, isDatabaseError } from '../lib/telemetry';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // Do not let HTTP requests wait indefinitely when every database connection
  // is occupied (for example while a migration is holding catalogue locks).
  connectionTimeoutMillis: 10_000,
});

// Observe leased clients too: most domain transactions use pool.connect()
// directly rather than the convenience query() wrapper. Never log SQL/params.
pool.on('acquire', client => {
  if ((client as any).__observedQueries) return;
  (client as any).__observedQueries = true;
  const original = client.query.bind(client);
  (client as any).query = (...args: any[]) => {
    const start = Date.now();
    const last = args.length - 1;
    if (typeof args[last] === 'function') {
      const callback = args[last];
      args[last] = (...values: any[]) => {
        databaseEvent(Date.now() - start, !!values[0]);
        callback(...values);
      };
      return (original as any)(...args);
    }
    try {
      const result = (original as any)(...args);
      if (result && typeof result.then === 'function') {
        return result.then(
          (value: any) => { databaseEvent(Date.now() - start, false); return value; },
          (error: unknown) => { databaseEvent(Date.now() - start, true); throw error; },
        );
      }
      return result;
    } catch (error) {
      databaseEvent(Date.now() - start, true);
      throw error;
    }
  };
});

export const query = (text: string, params?: any[]) => pool.query(text, params);

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const start = Date.now();
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    if (isDatabaseError(error)) databaseEvent(Date.now() - start, true);
    throw error;
  }
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (isDatabaseError(error)) databaseEvent(Date.now() - start, true);
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original failure; the connection is released below.
    }
    throw error;
  } finally {
    client.release();
  }
}

export default pool;
