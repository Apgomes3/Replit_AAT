import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { query } from '../db/index';

const router = Router();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const filters = ['all', 'unread', 'action'] as const;
type Filter = typeof filters[number];
const visibility = `n.user_id = $1
 AND (n.entity_type IS NULL OR access.access_level IS DISTINCT FROM 'hidden')
 AND (n.entity_type IS DISTINCT FROM 'uv_engineering_revision' OR u.role IN ('admin', 'engineer'))
 AND (n.entity_type IS DISTINCT FROM 'purchase_order' OR EXISTS (
   SELECT 1 FROM purchase_orders po JOIN users owner ON owner.id = $1
   WHERE po.id::text = n.entity_id::text
     AND (owner.can_see_all_pos OR po.created_by = $1
       OR EXISTS (SELECT 1 FROM po_designated_users d WHERE d.po_id = po.id AND d.user_id = $1)
       OR EXISTS (SELECT 1 FROM po_stage_assignees a WHERE a.stage = po.status AND a.user_id = $1))
 ))`;
const source = `FROM notifications n
 JOIN users u ON u.id = n.user_id
 LEFT JOIN roles r ON r.name = u.role
 LEFT JOIN role_module_access access ON access.role_id = r.id
   AND access.module_key = CASE n.entity_type
     WHEN 'purchase_order' THEN 'orders' WHEN 'design_book' THEN 'design_books'
     WHEN 'enquiry' THEN 'business_development' WHEN 'project' THEN 'projects'
     WHEN 'uv_engineering_revision' THEN 'pim' END`;
const filterSql = (filter: Filter) => filter === 'unread' ? 'AND NOT n.is_read' : filter === 'action' ? 'AND n.action_required AND NOT n.is_read' : '';
const subscriptionEntities: Record<string, { table: string; module: string }> = {
  design_book: { table: 'design_books', module: 'design_books' },
  enquiry: { table: 'enquiries', module: 'business_development' },
  project: { table: 'projects', module: 'projects' },
  purchase_order: { table: 'purchase_orders', module: 'orders' },
};

async function subscriptionAccess(req: AuthRequest, res: Response): Promise<boolean> {
  const entityType = String(req.params.entityType);
  const entityId = String(req.params.entityId);
  const entity = subscriptionEntities[entityType];
  if (!entity || !uuid.test(entityId)) {
    res.status(400).json({ error: { code: 'VALIDATION' } });
    return false;
  }
  // The table name comes only from the fixed allowlist above. Check record visibility
  // before reading even the caller's subscription, to avoid leaking restricted POs.
  const record = await query(
    `SELECT 1 FROM ${entity.table} record
     JOIN users u ON u.id=$2 AND u.is_active=true
     LEFT JOIN roles r ON r.name=u.role
     LEFT JOIN role_module_access access ON access.role_id=r.id AND access.module_key=$3
     WHERE record.id=$1 AND access.access_level IS DISTINCT FROM 'hidden'
     ${entityType === 'purchase_order' ? `AND (u.can_see_all_pos OR record.created_by=u.id
       OR EXISTS (SELECT 1 FROM po_designated_users d WHERE d.po_id=record.id AND d.user_id=u.id)
       OR EXISTS (SELECT 1 FROM po_stage_assignees a WHERE a.stage=record.status AND a.user_id=u.id))` : ''}`,
    [entityId, req.user!.id, entity.module],
  );
  if (!record.rowCount) {
    res.status(404).json({ error: { code: 'NOT_FOUND' } });
    return false;
  }
  return true;
}

router.get('/notifications/subscriptions/:entityType/:entityId', authenticate, async (req: AuthRequest, res: Response, next) => {
  try {
    if (!await subscriptionAccess(req, res)) return;
    const result = await query(
      'SELECT 1 FROM notification_subscriptions WHERE user_id=$1 AND entity_type=$2 AND entity_id=$3',
      [req.user!.id, req.params.entityType, req.params.entityId],
    );
    res.json({ following: !!result.rowCount });
  } catch (error) { next(error); }
});

router.put('/notifications/subscriptions/:entityType/:entityId', authenticate, async (req: AuthRequest, res: Response, next) => {
  try {
    if (!await subscriptionAccess(req, res)) return;
    await query(`INSERT INTO notification_subscriptions(user_id, entity_type, entity_id)
      VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [req.user!.id, req.params.entityType, req.params.entityId]);
    res.json({ following: true });
  } catch (error) { next(error); }
});

router.delete('/notifications/subscriptions/:entityType/:entityId', authenticate, async (req: AuthRequest, res: Response, next) => {
  try {
    if (!await subscriptionAccess(req, res)) return;
    await query('DELETE FROM notification_subscriptions WHERE user_id=$1 AND entity_type=$2 AND entity_id=$3',
      [req.user!.id, req.params.entityType, req.params.entityId]);
    res.json({ following: false });
  } catch (error) { next(error); }
});

router.get('/notifications', authenticate, async (req: AuthRequest, res: Response, next) => {
  try {
    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);
    const filter = String(req.query.filter ?? 'all') as Filter;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
        !Number.isInteger(offset) || offset < 0 || !filters.includes(filter)) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid notification pagination or filter' } });
    }
    const [page, counts] = await Promise.all([
      query(`SELECT n.id, n.type, n.title, n.body, n.entity_type, n.entity_id, n.href,
                    n.severity, n.action_required, n.is_read, n.created_at
               ${source} WHERE ${visibility} ${filterSql(filter)}
              ORDER BY n.created_at DESC, n.id DESC LIMIT $2 OFFSET $3`,
        [req.user!.id, limit, offset]),
      query(`SELECT count(*) FILTER (WHERE NOT n.is_read)::int AS unread_count,
                    count(*) FILTER (WHERE true ${filterSql(filter)})::int AS total
               ${source} WHERE ${visibility}`, [req.user!.id]),
    ]);
    res.json({ notifications: page.rows, unread_count: counts.rows[0].unread_count, total: counts.rows[0].total });
  } catch (error) { next(error); }
});

router.patch('/notifications/read-all', authenticate, async (req: AuthRequest, res: Response, next) => {
  try {
    const filter = String(req.body?.filter ?? 'all') as Filter;
    if (!filters.includes(filter)) return res.status(400).json({ error: { code: 'VALIDATION' } });
    const result = await query(
      `UPDATE notifications SET is_read = true WHERE id IN (
        SELECT n.id ${source} WHERE ${visibility} AND NOT n.is_read ${filterSql(filter)}
      ) RETURNING id`, [req.user!.id],
    );
    res.json({ ok: true, updated: result.rowCount });
  } catch (error) { next(error); }
});

router.patch('/notifications/:id/read', authenticate, async (req: AuthRequest, res: Response, next) => {
  try {
    if (!uuid.test(String(req.params.id))) return res.status(400).json({ error: { code: 'VALIDATION' } });
    const result = await query(
      `UPDATE notifications SET is_read = true WHERE id IN (
        SELECT n.id ${source} WHERE ${visibility} AND n.id = $2
      ) RETURNING id`, [req.user!.id, req.params.id],
    );
    if (!result.rowCount) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.delete('/notifications/:id', authenticate, async (req: AuthRequest, res: Response, next) => {
  try {
    if (!uuid.test(String(req.params.id))) return res.status(400).json({ error: { code: 'VALIDATION' } });
    const result = await query('DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.user!.id]);
    if (!result.rowCount) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

export default router;