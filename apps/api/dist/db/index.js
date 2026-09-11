"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.query = void 0;
exports.withTransaction = withTransaction;
const pg_1 = require("pg");
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    // Do not let HTTP requests wait indefinitely when every database connection
    // is occupied (for example while a migration is holding catalogue locks).
    connectionTimeoutMillis: 10000,
});
const query = (text, params) => pool.query(text, params);
exports.query = query;
async function withTransaction(work) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    }
    catch (error) {
        try {
            await client.query('ROLLBACK');
        }
        catch {
            // Preserve the original failure; the connection is released below.
        }
        throw error;
    }
    finally {
        client.release();
    }
}
exports.default = pool;
