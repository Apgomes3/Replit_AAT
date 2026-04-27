import { query } from './index';

export type NotificationType =
  | 'po_submitted'
  | 'po_approved'
  | 'po_rejected'
  | 'po_transitioned'
  | 'system';

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
