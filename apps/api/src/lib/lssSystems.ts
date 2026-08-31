/**
 * Project system types are configurable. The seeded catalog uses names such
 * as "Single Exhibit LSS", while older records use the literal "Life
 * Support" value. Both forms represent an LSS system for Design Book
 * engineering packages.
 */
export function isLifeSupportSystem(system: any) {
  const type = String(system?.system_type || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
  return type === 'lss' ||
    /(^|[^a-z])lss([^a-z]|$)/.test(type) ||
    type === 'life support' ||
    type.startsWith('life support ');
}