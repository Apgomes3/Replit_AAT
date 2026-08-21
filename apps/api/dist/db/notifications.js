"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNotification = createNotification;
exports.notifyAdminsAndManagers = notifyAdminsAndManagers;
const index_1 = require("./index");
async function createNotification(opts) {
    await (0, index_1.query)(`INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id)
     VALUES ($1, $2, $3, $4, $5, $6)`, [opts.userId, opts.type, opts.title, opts.body || null, opts.entityType || null, opts.entityId || null]);
}
async function notifyAdminsAndManagers(opts) {
    const result = await (0, index_1.query)(`SELECT id FROM users WHERE role IN ('admin','hq_manager') AND is_active = true AND id != $1`, [opts.excludeUserId || '00000000-0000-0000-0000-000000000000']);
    for (const row of result.rows) {
        await createNotification({ userId: row.id, ...opts });
    }
}
