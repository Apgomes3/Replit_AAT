import { afterAll, describe, expect, it } from 'vitest';
import pool from './index';
import { pimAssignmentIndexMigration } from './pimAssignmentIndexMigration';

afterAll(async () => {
  await pool.end();
});

describe('PIM assignment uniqueness migration', () => {
  it('defers the index instead of aborting when legacy duplicate links exist', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL search_path TO pg_temp');
      await client.query(`
        CREATE TEMP TABLE tanks (
          project_id UUID,
          exhibit_id UUID,
          product_master_id UUID
        )
      `);
      await client.query(`
        INSERT INTO tanks (project_id, exhibit_id, product_master_id)
        VALUES
          ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003'),
          ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003')
      `);

      await expect(client.query(pimAssignmentIndexMigration)).resolves.toBeDefined();
      const result = await client.query(`SELECT to_regclass('idx_tanks_pim_assignment') AS index_name`);
      expect(result.rows[0].index_name).toBeNull();
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});