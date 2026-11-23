import { query } from './index';
import { PoolClient } from 'pg';

export type NotificationType =
  | 'po_submitted'
  | 'po_approved'
  | 'po_rejected'
  | 'po_transitioned'
  | 'po_assigned'
  | 'system';

export const notificationModules: Record<string, string> = {
  purchase_order: 'orders',
  design_book: 'design_books',
  enquiry: 'business_development',
  project: 'projects',
  uv_engineering_revision: 'pim',
  knowledge_article: 'knowledge',
};

/** Persist a transition and its deliveries in the same transaction as the record change.
 * A failed insert aborts the transition; replaying the event key never creates a second delivery.
 */
export async function emitNotification(db: PoolClient, opts: {
  eventKey: string;
  type: string;
  title: string;
  body?: string;
  entityType: string;
  entityId: string;
  actorId: string;
  recipientIds: string[];
  actionRequired?: boolean;
  severity?: 'info' | 'warning' | 'critical';
  href?: string;
  includeSubscribers?: boolean;
  excludeUserIds?: string[];
}) {
  const moduleKey = notificationModules[opts.entityType];
  if (!moduleKey || !opts.eventKey) throw new Error('Notification requires a known entity and event key');
  const base: Record<string, string> = {
    purchase_order: '/purchase-orders',
    design_book: '/design-books',
    enquiry: '/enquiries',
    project: '/projects',
    knowledge_article: '/knowledge/articles',
  };
  const canonical = opts.entityType === 'uv_engineering_revision'
    ? `/admin/uv-engineering?revision=${encodeURIComponent(opts.entityId)}`
    : `${base[opts.entityType]}/${opts.entityId}`;
  // Only internal links into the actual record, with a narrowly scoped context suffix.
  if (opts.href && opts.href !== canonical && !opts.href.startsWith(`${canonical}?`)) {
    throw new Error('Notification link must point to its record');
  }
  const href = opts.href || canonical;
  const delivered = await db.query(
    `INSERT INTO notifications
       (user_id, event_key, type, title, body, entity_type, entity_id, href, action_required, severity)
     SELECT DISTINCT u.id, $1::text, $2::text, $3::text, $4::text,
            $5::text, $6::text, $7::text, $8::boolean, $9::text
       FROM users u
       LEFT JOIN roles r ON r.name = u.role
       LEFT JOIN role_module_access access ON access.role_id = r.id AND access.module_key = $10
      WHERE u.is_active = true AND u.id <> $11
        AND ($5 <> 'uv_engineering_revision' OR u.role IN ('admin', 'engineer', 'manager', 'user'))
        AND u.id <> ALL($14::uuid[])
        AND (u.id = ANY($12::uuid[]) OR ($13::boolean AND EXISTS (
          SELECT 1 FROM notification_subscriptions s
           WHERE s.user_id = u.id AND s.entity_type = $5 AND s.entity_id = $6
        )))
        AND ($5 <> 'purchase_order' OR EXISTS (
          SELECT 1 FROM purchase_orders po WHERE po.id::text = $6
            AND (u.can_see_all_pos OR po.created_by = u.id
              OR EXISTS (SELECT 1 FROM po_designated_users d WHERE d.po_id = po.id AND d.user_id = u.id)
              OR EXISTS (SELECT 1 FROM po_stage_assignees a WHERE a.stage = po.status AND a.user_id = u.id))
        ))
        AND access.access_level IS DISTINCT FROM 'hidden'
     ON CONFLICT (event_key, user_id) WHERE event_key IS NOT NULL DO NOTHING`,
    [opts.eventKey, opts.type, opts.title, opts.body || null, opts.entityType, opts.entityId,
      href, !!opts.actionRequired, opts.severity || 'info', moduleKey, opts.actorId,
      opts.recipientIds, opts.includeSubscribers !== false, opts.excludeUserIds || []],
  );
  if (opts.actionRequired && opts.recipientIds.length > 0 && delivered.rowCount === 0) {
    const existing = await db.query('SELECT 1 FROM notifications WHERE event_key=$1 LIMIT 1', [opts.eventKey]);
    if (!existing.rows[0]) throw new Error('No eligible recipient for required notification');
  }
}

export async function createNotification(opts: {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
}) {
  await query(
    `INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [opts.userId, opts.type, opts.title, opts.body || null, opts.entityType || null, opts.entityId || null]
  );
}

export async function notifyAdminsAndManagers(opts: {
  type: NotificationType;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  excludeUserId?: string;
}) {
  const result = await query(
    `SELECT id FROM users WHERE role IN ('admin','hq_manager') AND is_active = true AND id != $1`,
    [opts.excludeUserId || '00000000-0000-0000-0000-000000000000']
  );
  for (const row of result.rows) {
    await createNotification({ userId: row.id, ...opts });
  }
}
