import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { query } from '../db/index';

const router = Router();

router.get('/notifications', authenticate, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const limit = parseInt((req.query.limit as string) || '50');
  const result = await query(
    `SELECT id, type, title, body, entity_type, entity_id, is_read, created_at
     FROM notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  const unread = result.rows.filter(r => !r.is_read).length;
  res.json({ notifications: result.rows, unread_count: unread });
});

router.patch('/notifications/:id/read', authenticate, async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  await query(
    `UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2`,
    [id, req.user!.id]
  );
  res.json({ ok: true });
});

router.patch('/notifications/read-all', authenticate, async (req: AuthRequest, res: Response) => {
  await query(
    `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
    [req.user!.id]
  );
  res.json({ ok: true });
});

router.delete('/notifications/:id', authenticate, async (req: AuthRequest, res: Response) => {
  await query(
    `DELETE FROM notifications WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user!.id]
  );
  res.json({ ok: true });
});

export default router;
