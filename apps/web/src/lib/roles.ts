// Mirrors apps/api/src/lib/roles.ts: roles that can create and change engineering data
// (module access in Admin > Roles still decides which modules).
export const EDITOR_ROLES = ['admin', 'engineer', 'manager', 'user'] as const;

export function isEditorRole(role: string | null | undefined): boolean {
  return !!role && (EDITOR_ROLES as readonly string[]).includes(role);
}
