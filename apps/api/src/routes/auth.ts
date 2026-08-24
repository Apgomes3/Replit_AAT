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

  await query('UPDATE users SET last_login_at=NOW() WHERE id=$1', [user.id]);

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
  res.json({
    token,
    user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, role: user.role }
  });
});

router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  const result = await query('SELECT id, email, first_name, last_name, role, can_see_all_pos, created_at FROM users WHERE id = $1', [req.user!.id]);
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

router.patch('/change-password', authenticate, async (req: AuthRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Current and new password are required' } });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'New password must be at least 8 characters' } });
  }
  const result = await query('SELECT password_hash, email FROM users WHERE id = $1', [req.user!.id]);
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Current password is incorrect' } });
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, req.user!.id]);
  await logAudit(req.user!.id, 'user', req.user!.id, 'RESET_PASSWORD', {
    summary: 'User password reset',
    self_service: true,
    email: user.email,
  });
  res.status(204).end();
});

router.post('/reset-password', async (req: Request, res: Response) => {
  const { token, password } = req.body;
  if (!token || !password || password.length < 8) {
    return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Valid token and password (min 8 chars) are required' } });
  }

  const tokenResult = await query(
    `SELECT prt.*, u.id as uid, u.email FROM password_reset_tokens prt
     JOIN users u ON u.id = prt.user_id
     WHERE prt.token = $1 AND prt.used_at IS NULL AND prt.expires_at > NOW()`,
    [token]
  );

  if (!tokenResult.rows[0]) {
    return res.status(400).json({ error: { code: 'INVALID_TOKEN', message: 'This reset link is invalid or has expired' } });
  }

  const { uid, email, id: tokenId } = tokenResult.rows[0];
  const hash = await bcrypt.hash(password, 10);

  await query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, uid]);
  await query('UPDATE password_reset_tokens SET used_at=NOW() WHERE id=$1', [tokenId]);
  await query('DELETE FROM refresh_tokens WHERE user_id=$1', [uid]);
  await logAudit(uid, 'user', uid, 'RESET_PASSWORD', {
    summary: 'User password reset through reset link',
    via_reset_link: true,
    email,
  });

  res.json({ ok: true });
});

export default router;
