import { Pool, PoolClient } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // Do not let HTTP requests wait indefinitely when every database connection
  // is occupied (for example while a migration is holding catalogue locks).
  connectionTimeoutMillis: 10_000,
});

export const query = (text: string, params?: any[]) => pool.query(text, params);

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
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
