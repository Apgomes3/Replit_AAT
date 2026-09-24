import { describe, expect, it, vi } from 'vitest';
import { emitNotification } from './notifications';

const actorId = '11111111-1111-4111-8111-111111111111';
const recipientId = '22222222-2222-4222-8222-222222222222';
const entityId = '33333333-3333-4333-8333-333333333333';

function options(overrides: Record<string, unknown> = {}) {
  return {
    eventKey: 'po:333:submitted',
    type: 'po_submitted',
    title: 'Purchase order submitted',
    body: 'Review requested',
    entityType: 'purchase_order',
    entityId,
    actorId,
    recipientIds: [recipientId],
    actionRequired: true,
    severity: 'warning' as const,
    ...overrides,
  };
}

describe('emitNotification', () => {
  it('targets active non-actor recipients, respects hidden-module access, and deduplicates retries', async () => {
    const persisted = new Set<string>();
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      expect(sql).toContain('u.is_active = true');
      expect(sql).toContain('u.id <> $11');
      expect(sql).toContain('u.id = ANY($12::uuid[])');
      expect(sql).toContain('notification_subscriptions');
      expect(sql).toContain('access.access_level IS DISTINCT FROM \'hidden\'');
      expect(sql).toContain('ON CONFLICT (event_key, user_id)');
      expect(params).toEqual([
        'po:333:submitted', 'po_submitted', 'Purchase order submitted', 'Review requested',
        'purchase_order', entityId, `/purchase-orders/${entityId}`, true, 'warning',
        'orders', actorId, [recipientId], true, [],
      ]);

      const uniquenessKey = `${params[0]}:${recipientId}`;
      persisted.add(uniquenessKey);
      return { rowCount: 1, rows: [] };
    });
    const db = { query } as any;

    await emitNotification(db, options());
    await emitNotification(db, options());

    expect(query).toHaveBeenCalledTimes(2);
    expect(persisted.size).toBe(1);
  });

  it('uses a canonical deep link and allows only record-scoped query context', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await emitNotification({ query } as any, options({ href: `/purchase-orders/${entityId}?tab=approvals` }));
    expect(query.mock.calls[0][1][6]).toBe(`/purchase-orders/${entityId}?tab=approvals`);
    await emitNotification({ query } as any, options({ href: undefined }));
    expect(query.mock.calls[1][1][6]).toBe(`/purchase-orders/${entityId}`);
  });

  it('limits assigned review actions to the reviewer while leaving subscriber updates informational', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const db = { query } as any;
    await emitNotification(db, options({
      entityType: 'uv_engineering_revision',
      eventKey: 'uv-review:1',
      includeSubscribers: false,
    }));
    await emitNotification(db, options({
      entityType: 'uv_engineering_revision',
      eventKey: 'uv-review-info:1',
      recipientIds: [],
      actionRequired: false,
      excludeUserIds: [recipientId],
    }));
    expect(query.mock.calls[0][1].slice(-3)).toEqual([[recipientId], false, []]);
    expect(query.mock.calls[0][0]).toContain('$13::boolean AND EXISTS');
    expect(query.mock.calls[1][1].slice(-3)).toEqual([[], true, [recipientId]]);
    expect(query.mock.calls[1][1][7]).toBe(false);
  });

  it('rejects unknown entities, missing event keys, and links to a different record', async () => {
    const query = vi.fn();
    await expect(emitNotification({ query } as any, options({ entityType: 'unknown' }))).rejects.toThrow(
      'Notification requires a known entity and event key',
    );
    await expect(emitNotification({ query } as any, options({ eventKey: '' }))).rejects.toThrow(
      'Notification requires a known entity and event key',
    );
    await expect(emitNotification({ query } as any, options({ href: 'https://example.com' }))).rejects.toThrow(
      'Notification link must point to its record',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('propagates an insert failure so the caller transaction can roll back, then permits retry with the same key', async () => {
    const query = vi.fn()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({ rows: [] });
    const db = { query } as any;

    await expect(emitNotification(db, options())).rejects.toThrow('database unavailable');
    await expect(emitNotification(db, options())).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][1][0]).toBe('po:333:submitted');
    expect(query.mock.calls[1][1][0]).toBe('po:333:submitted');
    expect(query.mock.calls[0][0]).toContain('ON CONFLICT (event_key, user_id)');
  });
});