import { query } from './index';

export async function logAudit(
  actor_id: string | null,
  entity_type: string,
  entity_id: string,
  action: string,
  details?: Record<string, any>,
  ip_address?: string,
) {
  try {
    await query(
      'INSERT INTO audit_logs (entity_type, entity_id, action, actor_id, details, ip_address) VALUES ($1,$2,$3,$4,$5,$6)',
      [entity_type, entity_id, action, actor_id || null, details ?? null, ip_address || null],
    );
  } catch (e) {
    console.error('[audit] failed to write log:', e);
  }
}
