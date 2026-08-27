"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const designBookWorkflow_1 = require("./designBookWorkflow");
(0, vitest_1.describe)('Design Book review workflow policy', () => {
    (0, vitest_1.it)('lets designers submit editable books for review', () => {
        (0, vitest_1.expect)((0, designBookWorkflow_1.canPerformDesignBookWorkflowAction)('engineer', 'Draft', 'submit-review')).toBe(true);
        (0, vitest_1.expect)((0, designBookWorkflow_1.canPerformDesignBookWorkflowAction)('engineer', 'In Progress', 'submit-review')).toBe(true);
    });
    (0, vitest_1.it)('does not let designers approve or release', () => {
        (0, vitest_1.expect)((0, designBookWorkflow_1.canPerformDesignBookWorkflowAction)('engineer', 'For Review', 'approve')).toBe(false);
        (0, vitest_1.expect)((0, designBookWorkflow_1.canPerformDesignBookWorkflowAction)('engineer', 'Approved', 'release')).toBe(false);
    });
    vitest_1.it.each(['admin', 'hq_manager', 'pmo'])('lets the %s manager role approve a reviewed book', role => {
        (0, vitest_1.expect)((0, designBookWorkflow_1.canPerformDesignBookWorkflowAction)(role, 'For Review', 'approve')).toBe(true);
    });
    (0, vitest_1.it)('requires approval before a manager can release', () => {
        (0, vitest_1.expect)((0, designBookWorkflow_1.canPerformDesignBookWorkflowAction)('hq_manager', 'For Review', 'release')).toBe(false);
        (0, vitest_1.expect)((0, designBookWorkflow_1.canPerformDesignBookWorkflowAction)('hq_manager', 'Approved', 'release')).toBe(true);
    });
    (0, vitest_1.it)('does not require a handover report to approve', () => {
        // Report count is intentionally not an input to policy: the handover is optional.
        (0, vitest_1.expect)((0, designBookWorkflow_1.canPerformDesignBookWorkflowAction)('pmo', 'For Review', 'approve')).toBe(true);
    });
    (0, vitest_1.it)('locks design content after submission while leaving new revisions editable', () => {
        (0, vitest_1.expect)((0, designBookWorkflow_1.isDesignBookContentEditable)('For Review')).toBe(false);
        (0, vitest_1.expect)((0, designBookWorkflow_1.isDesignBookContentEditable)('Approved')).toBe(false);
        (0, vitest_1.expect)((0, designBookWorkflow_1.isDesignBookContentEditable)('Released')).toBe(false);
        (0, vitest_1.expect)((0, designBookWorkflow_1.isDesignBookContentEditable)('Draft')).toBe(true);
    });
});
