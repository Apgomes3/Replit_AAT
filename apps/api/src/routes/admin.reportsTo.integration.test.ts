// @vitest-environment node
// Runs against the PostgreSQL test database (TEST_DATABASE_URL).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../db';
import { reportsToProblem } from './admin';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const ids: string[] = [];

describe.skipIf(!process.env.DATABASE_URL)('reports to (PostgreSQL)', () => {
  beforeAll(async () => {
    for (const name of ['boss', 'lead', 'drafter']) {
      ids.push((await query(
        `INSERT INTO users (email, password_hash, first_name, role) VALUES ($1, 'x', $2, 'user') RETURNING id`,
        [`${name}-${suffix}@example.test`, name],
      )).rows[0].id);
    }
    const [boss, lead, drafter] = ids;
    await query(`UPDATE users SET reports_to_user_id = $1 WHERE id = $2`, [boss, lead]);
    await query(`UPDATE users SET reports_to_user_id = $1 WHERE id = $2`, [lead, drafter]);
  });

  afterAll(async () => {
    await query(`UPDATE users SET reports_to_user_id = NULL WHERE id = ANY($1::uuid[])`, [ids]);
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]);
  });

  it('allows a normal line manager and refuses self and loops', async () => {
    const [boss, lead, drafter] = ids as [string, string, string];
    expect(await reportsToProblem(drafter, boss)).toBeNull();
    expect(await reportsToProblem(drafter, drafter)).toMatch(/themselves/);
    // boss → lead → drafter: the boss cannot report to either of them.
    expect(await reportsToProblem(boss, drafter)).toMatch(/loop/);
    expect(await reportsToProblem(boss, lead)).toMatch(/loop/);
  });

  it('refuses inactive managers', async () => {
    const [boss, lead] = ids as [string, string, string];
    await query(`UPDATE users SET is_active = false WHERE id = $1`, [boss]);
    expect(await reportsToProblem(lead, boss)).toMatch(/not an active user/);
    await query(`UPDATE users SET is_active = true WHERE id = $1`, [boss]);
  });
});
