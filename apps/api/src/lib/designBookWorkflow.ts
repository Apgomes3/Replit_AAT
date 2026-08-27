export const DESIGN_BOOK_DESIGNER_ROLES = ['admin', 'engineer'] as const;
export const DESIGN_BOOK_MANAGER_ROLES = ['admin', 'hq_manager', 'pmo'] as const;

export type DesignBookWorkflowAction = 'submit-review' | 'approve' | 'release';

export function canPerformDesignBookWorkflowAction(
  role: string | undefined,
  status: string,
  action: DesignBookWorkflowAction,
): boolean {
  if (!role) return false;
  if (action === 'submit-review') {
    return DESIGN_BOOK_DESIGNER_ROLES.includes(role as any)
      && ['Draft', 'In Progress'].includes(status);
  }
  if (action === 'approve') {
    return DESIGN_BOOK_MANAGER_ROLES.includes(role as any) && status === 'For Review';
  }
  return DESIGN_BOOK_MANAGER_ROLES.includes(role as any) && status === 'Approved';
}

export function isDesignBookContentEditable(status: string): boolean {
  return status === 'Draft' || status === 'In Progress';
}