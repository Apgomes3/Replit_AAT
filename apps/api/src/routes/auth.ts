import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db';
import { authenticate, AuthRequest, JWT_SECRET } from '../middleware/auth';
import { logAudit } from '../db/audit';

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

router.get('/reset-password/validate', async (req: Request, res: Response) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Token required' } });
  }
  const result = await query(
    `SELECT prt.id, u.email, u.first_name, u.last_name
     FROM password_reset_tokens prt
     JOIN users u ON prt.user_id = u.id
     WHERE prt.token = $1 AND prt.used_at IS NULL AND prt.expires_at > NOW() AND u.is_active = true`,
    [token]
  );
  if (!result.rows[0]) {
    return res.status(400).json({ error: { code: 'INVALID_TOKEN', message: 'This link is invalid or has expired' } });
  }
  const user = result.rows[0];
  res.json({ email: user.email, name: [user.first_name, user.last_name].filter(Boolean).join(' ') });
});

router.post('/reset-password', async (req: Request, res: Response) => {
  const { token, password } = req.body;
  if (!token || !password || password.length < 8) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Valid token and password (min 8 chars) required' } });
  }
  const claimed = await query(
    `UPDATE password_reset_tokens
     SET used_at = NOW()
     WHERE token = $1
       AND used_at IS NULL
       AND expires_at > NOW()
     RETURNING user_id`,
    [token]
  );
  if (!claimed.rows[0]) {
    return res.status(400).json({ error: { code: 'INVALID_TOKEN', message: 'This link is invalid or has expired' } });
  }
  const { user_id } = claimed.rows[0];
  const userResult = await query('SELECT email FROM users WHERE id=$1 AND is_active=true', [user_id]);
  if (!userResult.rows[0]) {
    return res.status(400).json({ error: { code: 'INVALID_TOKEN', message: 'This link is invalid or has expired' } });
  }
  const { email } = userResult.rows[0];
  const hash = await bcrypt.hash(password, 10);
  await query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, user_id]);
  await query('DELETE FROM refresh_tokens WHERE user_id=$1', [user_id]);
  await logAudit(user_id, 'user', user_id, 'RESET_PASSWORD_VIA_LINK', { target_email: email });
  res.json({ ok: true });
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
