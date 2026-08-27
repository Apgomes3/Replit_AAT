"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const index_1 = __importDefault(require("./index"));
const pimAssignmentIndexMigration_1 = require("./pimAssignmentIndexMigration");
(0, vitest_1.afterAll)(async () => {
    await index_1.default.end();
});
(0, vitest_1.describe)('PIM assignment uniqueness migration', () => {
    (0, vitest_1.it)('defers the index instead of aborting when legacy duplicate links exist', async () => {
        const client = await index_1.default.connect();
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
            await (0, vitest_1.expect)(client.query(pimAssignmentIndexMigration_1.pimAssignmentIndexMigration)).resolves.toBeDefined();
            const result = await client.query(`SELECT to_regclass('idx_tanks_pim_assignment') AS index_name`);
            (0, vitest_1.expect)(result.rows[0].index_name).toBeNull();
        }
        finally {
            await client.query('ROLLBACK');
            client.release();
        }
    });
});
