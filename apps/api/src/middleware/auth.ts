import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../db';
import { ModuleAccessKey } from '../lib/moduleAccess';

const JWT_SECRET = process.env.JWT_SECRET || 'edp-secret-change-in-production';

export interface AuthRequest extends Request {
  user?: { id: string; email: string; role: string };
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No token provided' } });
  }
  const token = auth.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
  }
};

export const requireRole = (...roles: string[]) => (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
  }
  next();
};

export const requireModuleAccess = (moduleKey: ModuleAccessKey) => async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await query(
      `SELECT rma.access_level
       FROM users u
       LEFT JOIN roles r ON r.name=u.role
       LEFT JOIN role_module_access rma ON rma.role_id=r.id AND rma.module_key=$2
       WHERE u.id=$1`,
      [req.user!.id, moduleKey],
    );
    // Missing rows preserve access for legacy/custom accounts until an administrator
    // explicitly configures that role's module visibility.
    if (result.rows[0]?.access_level === 'hidden') {
      return res.status(403).json({
        error: { code: 'MODULE_HIDDEN', message: 'This module is hidden for your role.' },
      });
    }
    next();
  } catch (error) {
    next(error);
  }
};

export const requireModuleManage = (moduleKey: ModuleAccessKey) => async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await query(
      `SELECT rma.access_level
       FROM users u
       LEFT JOIN roles r ON r.name=u.role
       LEFT JOIN role_module_access rma ON rma.role_id=r.id AND rma.module_key=$2
       WHERE u.id=$1`,
      [req.user!.id, moduleKey],
    );
    const accessLevel = result.rows[0]?.access_level;
    // Preserve legacy/custom accounts without an explicit row, as requireModuleAccess does.
    if (accessLevel && accessLevel !== 'manage') {
      return res.status(403).json({
        error: { code: 'MODULE_READ_ONLY', message: 'Manage access is required for this module.' },
      });
    }
    next();
  } catch (error) {
    next(error);
  }
};

async function accessLevels(userId: string, keys: ModuleAccessKey[]): Promise<Array<string | null>> {
  const result = await query(
    `SELECT k.key, rma.access_level
     FROM users u
     CROSS JOIN unnest($2::text[]) AS k(key)
     LEFT JOIN roles r ON r.name=u.role
     LEFT JOIN role_module_access rma ON rma.role_id=r.id AND rma.module_key=k.key
     WHERE u.id=$1`,
    [userId, keys],
  );
  return result.rows.map(row => row.access_level ?? null);
}

/** The user's access to one module: 'manage', 'view' or 'hidden' (a missing row counts as manage). */
export async function getModuleAccessLevel(userId: string, key: ModuleAccessKey): Promise<'manage' | 'view' | 'hidden'> {
  const [level] = await accessLevels(userId, [key]);
  return level === 'view' || level === 'hidden' ? level : 'manage';
}

/** Passes when any of the modules is visible to the user's role (a missing row counts as visible). */
export const requireAnyModuleAccess = (...keys: ModuleAccessKey[]) => async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const levels = await accessLevels(req.user!.id, keys);
    if (levels.length && levels.every(level => level === 'hidden')) {
      return res.status(403).json({ error: { code: 'MODULE_HIDDEN', message: 'This module is hidden for your role.' } });
    }
    next();
  } catch (error) {
    next(error);
  }
};

/** Passes when the user's role can manage any of the modules (a missing row counts as manage). */
export const requireAnyModuleManage = (...keys: ModuleAccessKey[]) => async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const levels = await accessLevels(req.user!.id, keys);
    if (levels.length && !levels.some(level => level === null || level === 'manage')) {
      return res.status(403).json({ error: { code: 'MODULE_READ_ONLY', message: 'Manage access is required for this module.' } });
    }
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Bulk imports are available to platform administrators or roles with manage
 * access to the governing module. Unlike legacy mutation guards, this returns
 * distinct errors for read-only and hidden roles before an upload is accepted.
 */
export const requireImportManage = (moduleKey: ModuleAccessKey) => async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role === 'admin') {
    return next();
  }

  try {
    const result = await query(
      `SELECT rma.access_level
       FROM users u
       LEFT JOIN roles r ON r.name=u.role
       LEFT JOIN role_module_access rma ON rma.role_id=r.id AND rma.module_key=$2
       WHERE u.id=$1`,
      [req.user!.id, moduleKey],
    );
    const accessLevel = result.rows[0]?.access_level;
    if (accessLevel === 'hidden') {
      return res.status(403).json({
        error: { code: 'MODULE_HIDDEN', message: 'This module is hidden for your role.' },
      });
    }
    if (accessLevel && accessLevel !== 'manage') {
      return res.status(403).json({
        error: { code: 'MODULE_READ_ONLY', message: 'Manage access is required for this module.' },
      });
    }
    next();
  } catch (error) {
    next(error);
  }
};

export { JWT_SECRET };
