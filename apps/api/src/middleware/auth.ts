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

export { JWT_SECRET };
