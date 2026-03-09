import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db';
import { authenticate, AuthRequest, JWT_SECRET } from '../middleware/auth';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Email and password required' } });

  const result = await query('SELECT * FROM users WHERE email = $1 AND is_active = true', [email]);
  const user = result.rows[0];
  if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } });

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
  res.json({
    token,
    user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, role: user.role }
  });
});

router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT id, email, first_name, last_name, role, created_at FROM users WHERE id = $1', [req.user!.id]);
  if (!result.rows[0]) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
  res.json(result.rows[0]);
});

router.get('/dashboard-prefs', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT dashboard_prefs FROM users WHERE id = $1', [req.user!.id]);
  res.json(result.rows[0]?.dashboard_prefs || {});
});

router.put('/dashboard-prefs', authenticate, async (req: AuthRequest, res: Response) => {
  const prefs = req.body;
  if (typeof prefs !== 'object' || prefs === null) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Body must be a JSON object' } });
  }
  await query('UPDATE users SET dashboard_prefs = $1 WHERE id = $2', [JSON.stringify(prefs), req.user!.id]);
  res.json({ ok: true });
});

export default router;
