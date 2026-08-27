"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DESIGN_BOOK_MANAGER_ROLES = exports.DESIGN_BOOK_DESIGNER_ROLES = void 0;
exports.canPerformDesignBookWorkflowAction = canPerformDesignBookWorkflowAction;
exports.isDesignBookContentEditable = isDesignBookContentEditable;
exports.DESIGN_BOOK_DESIGNER_ROLES = ['admin', 'engineer'];
exports.DESIGN_BOOK_MANAGER_ROLES = ['admin', 'hq_manager', 'pmo'];
function canPerformDesignBookWorkflowAction(role, status, action) {
    if (!role)
        return false;
    if (action === 'submit-review') {
        return exports.DESIGN_BOOK_DESIGNER_ROLES.includes(role)
            && ['Draft', 'In Progress'].includes(status);
    }
    if (action === 'approve') {
        return exports.DESIGN_BOOK_MANAGER_ROLES.includes(role) && status === 'For Review';
    }
    return exports.DESIGN_BOOK_MANAGER_ROLES.includes(role) && status === 'Approved';
}
function isDesignBookContentEditable(status) {
    return status === 'Draft' || status === 'In Progress';
}
