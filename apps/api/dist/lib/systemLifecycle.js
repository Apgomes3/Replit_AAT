"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RETIRED_SYSTEM_STATUSES = void 0;
exports.isRetiredSystem = isRetiredSystem;
exports.systemLifecycleError = systemLifecycleError;
exports.loadEditableSystem = loadEditableSystem;
exports.RETIRED_SYSTEM_STATUSES = ['Archived', 'Decommissioned', 'Superseded'];
function isRetiredSystem(system) {
    return exports.RETIRED_SYSTEM_STATUSES.includes(system?.status);
}
function systemLifecycleError(system) {
    return {
        code: 'SYSTEM_RETIRED',
        message: system?.status === 'Superseded'
            ? 'This Life Support System has been superseded and is read-only.'
            : 'This Life Support System has been archived/decommissioned and is read-only.',
    };
}
async function loadEditableSystem(runner, systemId, lock = false) {
    const result = await runner(`SELECT * FROM systems WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [systemId]);
    const system = result.rows[0] || null;
    return {
        system,
        error: system && isRetiredSystem(system) ? systemLifecycleError(system) : null,
    };
}
