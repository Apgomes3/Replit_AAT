import { query } from './index';
import { correlationId, emit } from '../lib/telemetry';

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
      [entity_type, entity_id, action, actor_id || null, { ...(details ?? {}), ...(correlationId() ? { correlationId: correlationId() } : {}) }, ip_address || null],
    );
  } catch {
    emit({ event: 'audit_write_failure', correlationId: correlationId(), category: 'database' });
  }
}
