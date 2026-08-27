"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JWT_SECRET = exports.requireModuleManage = exports.requireModuleAccess = exports.requireRole = exports.authenticate = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../db");
const JWT_SECRET = process.env.JWT_SECRET || 'edp-secret-change-in-production';
exports.JWT_SECRET = JWT_SECRET;
const authenticate = (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No token provided' } });
    }
    const token = auth.split(' ')[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    }
    catch {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
    }
};
exports.authenticate = authenticate;
const requireRole = (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    }
    next();
};
exports.requireRole = requireRole;
const requireModuleAccess = (moduleKey) => async (req, res, next) => {
    try {
        const result = await (0, db_1.query)(`SELECT rma.access_level
       FROM users u
       LEFT JOIN roles r ON r.name=u.role
       LEFT JOIN role_module_access rma ON rma.role_id=r.id AND rma.module_key=$2
       WHERE u.id=$1`, [req.user.id, moduleKey]);
        // Missing rows preserve access for legacy/custom accounts until an administrator
        // explicitly configures that role's module visibility.
        if (result.rows[0]?.access_level === 'hidden') {
            return res.status(403).json({
                error: { code: 'MODULE_HIDDEN', message: 'This module is hidden for your role.' },
            });
        }
        next();
    }
    catch (error) {
        next(error);
    }
};
exports.requireModuleAccess = requireModuleAccess;
const requireModuleManage = (moduleKey) => async (req, res, next) => {
    try {
        const result = await (0, db_1.query)(`SELECT rma.access_level
       FROM users u
       LEFT JOIN roles r ON r.name=u.role
       LEFT JOIN role_module_access rma ON rma.role_id=r.id AND rma.module_key=$2
       WHERE u.id=$1`, [req.user.id, moduleKey]);
        const accessLevel = result.rows[0]?.access_level;
        // Preserve legacy/custom accounts without an explicit row, as requireModuleAccess does.
        if (accessLevel && accessLevel !== 'manage') {
            return res.status(403).json({
                error: { code: 'MODULE_READ_ONLY', message: 'Manage access is required for this module.' },
            });
        }
        next();
    }
    catch (error) {
        next(error);
    }
};
exports.requireModuleManage = requireModuleManage;
