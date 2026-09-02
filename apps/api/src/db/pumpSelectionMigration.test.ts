import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('pump selection migration', () => {
  const migration = fs.readFileSync(path.join(process.cwd(), 'apps/api/src/db/migrate.ts'), 'utf8');

  it('removes legacy two-column uniqueness by discovered constraint or index name', () => {
    expect(migration).toContain("c.conrelid='system_pump_selections'::regclass");
    expect(migration).toContain("ARRAY['circuit_key','system_id']::name[]");
    expect(migration).toContain("DROP INDEX IF EXISTS %I");
  });

  it('rebuilds a repeatable role-aware uniqueness constraint', () => {
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS uq_system_pump_selections_circuit_role');
    expect(migration).toContain(
      'ADD CONSTRAINT uq_system_pump_selections_circuit_role UNIQUE (system_id, circuit_key, pump_role)',
    );
  });

  it('preserves historical side-stream pump intent during upgrade', () => {
    expect(migration).toContain('SET has_dedicated_pump=true');
    expect(migration).toContain('ALTER COLUMN has_dedicated_pump SET NOT NULL');
  });

  it('adds a bounded pump quantity with a safe default', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS pump_quantity INTEGER NOT NULL DEFAULT 1');
    expect(migration).toContain('CHECK (pump_quantity > 0 AND pump_quantity <= 99)');
  });

  it('creates and seeds the governed pump duty relationship table', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS pump_duty_types');
    for (const tag of ['FFSP', 'FFVP', 'SFSP', 'CIRCP', 'VACP']) {
      expect(migration).toContain(`('${tag}'`);
    }
    expect(migration).toContain('pump_duty_snapshot JSONB');
  });
});