// Access roles. Job titles live on users.job_title; roles only decide what someone can do.
//
// Editors can create and change engineering data (projects, design books, products, ...),
// within what their role's module access allows (Admin > Roles). "engineer" is the original
// editor role and is kept for existing accounts; new accounts use "manager" or "user".
export const EDITOR_ROLES = ['admin', 'engineer', 'manager', 'user'] as const;

export function isEditorRole(role: string | null | undefined): boolean {
  return !!role && (EDITOR_ROLES as readonly string[]).includes(role);
}
