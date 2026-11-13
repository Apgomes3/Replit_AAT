// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isEditorRole } from './roles';
import { canPerformDesignBookWorkflowAction, DESIGN_BOOK_DESIGNER_ROLES } from './designBookWorkflow';

describe('access roles', () => {
  it('lets admin, manager, user and the legacy engineer role edit; not viewers or approver-only roles', () => {
    for (const role of ['admin', 'manager', 'user', 'engineer']) expect(isEditorRole(role)).toBe(true);
    for (const role of ['viewer', 'hq_manager', 'pmo', '', null, undefined]) expect(isEditorRole(role)).toBe(false);
  });

  it('treats manager and user as design book designers', () => {
    expect(DESIGN_BOOK_DESIGNER_ROLES).toEqual(expect.arrayContaining(['manager', 'user']));
    expect(typeof canPerformDesignBookWorkflowAction).toBe('function');
  });
});
