import { describe, expect, it } from 'vitest';
import {
  canPerformDesignBookWorkflowAction,
  isDesignBookContentEditable,
} from './designBookWorkflow';

describe('Design Book review workflow policy', () => {
  it('lets designers submit editable books for review', () => {
    expect(canPerformDesignBookWorkflowAction('engineer', 'Draft', 'submit-review')).toBe(true);
    expect(canPerformDesignBookWorkflowAction('engineer', 'In Progress', 'submit-review')).toBe(true);
  });

  it('does not let designers approve or release', () => {
    expect(canPerformDesignBookWorkflowAction('engineer', 'For Review', 'approve')).toBe(false);
    expect(canPerformDesignBookWorkflowAction('engineer', 'Approved', 'release')).toBe(false);
  });

  it.each(['admin', 'hq_manager', 'pmo'])('lets the %s manager role approve a reviewed book', role => {
    expect(canPerformDesignBookWorkflowAction(role, 'For Review', 'approve')).toBe(true);
  });

  it('requires approval before a manager can release', () => {
    expect(canPerformDesignBookWorkflowAction('hq_manager', 'For Review', 'release')).toBe(false);
    expect(canPerformDesignBookWorkflowAction('hq_manager', 'Approved', 'release')).toBe(true);
  });

  it('does not require a handover report to approve', () => {
    // Report count is intentionally not an input to policy: the handover is optional.
    expect(canPerformDesignBookWorkflowAction('pmo', 'For Review', 'approve')).toBe(true);
  });

  it('locks design content after submission while leaving new revisions editable', () => {
    expect(isDesignBookContentEditable('For Review')).toBe(false);
    expect(isDesignBookContentEditable('Approved')).toBe(false);
    expect(isDesignBookContentEditable('Released')).toBe(false);
    expect(isDesignBookContentEditable('Draft')).toBe(true);
  });
});