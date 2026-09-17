"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isLifeSupportSystem = isLifeSupportSystem;
/**
 * Project system types are configurable. The seeded catalog uses names such
 * as "Single Exhibit LSS", while older records use the literal "Life
 * Support" value. Both forms represent an LSS system for Design Book
 * engineering packages.
 */
function isLifeSupportSystem(system) {
    const type = String(system?.system_type || '')
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, ' ');
    const code = String(system?.system_code || '').trim();
    return type === 'lss' ||
        /(^|[^a-z])lss([^a-z]|$)/.test(type) ||
        type === 'life support' ||
        type.startsWith('life support ') ||
        /^LSS(?:[\s_-]|\d|$)/i.test(code);
}
