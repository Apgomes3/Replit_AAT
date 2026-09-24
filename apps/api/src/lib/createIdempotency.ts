// Lock before looking up the key: a concurrent retry must wait for the first
// transaction to commit (or roll back) before deciding whether to create.
export async function findCreateRetry(
  db: { query: (sql: string, params?: any[]) => Promise<any> },
  table: 'enquiries' | 'purchase_orders',
  userId: string,
  key: string | null,
) {
  if (!key) return null;
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${table}:${userId}:${key}`]);
  const found = await db.query(`SELECT * FROM ${table} WHERE created_by=$1 AND idempotency_key=$2`, [userId, key]);
  return found.rows[0] || null;
}

export function createKeyError(value: unknown): string | null {
  return value == null || (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    ? null : 'idempotency_key must be a UUID.';
}