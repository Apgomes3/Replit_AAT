"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logAudit = logAudit;
const index_1 = require("./index");
async function logAudit(actor_id, entity_type, entity_id, action, details, ip_address) {
    try {
        await (0, index_1.query)('INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, details, ip_address) VALUES ($1,$2,$3,$4,$5,$6)', [entity_type, entity_id, action, actor_id || null, details ?? null, ip_address || null]);
    }
    catch (e) {
        console.error('[audit] failed to write log:', e);
    }
}
