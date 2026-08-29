// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Biological Media run database protections', () => {
  const migration = fs.readFileSync(path.join(process.cwd(), 'apps/api/src/db/migrate.ts'), 'utf8');

  it('stores calculation and profile evidence as immutable JSON snapshots', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS lss_biological_media_runs');
    expect(migration).toContain('normalized_input_snapshot JSONB NOT NULL');
    expect(migration).toContain('linked_volume_context_snapshot JSONB NOT NULL');
    expect(migration).toContain('media_profile_snapshot JSONB NOT NULL');
    expect(migration).toContain('tan_profile_snapshot JSONB NOT NULL');
    expect(migration).toContain('result_snapshot JSONB NOT NULL');
    expect(migration).toContain('overrides_snapshot JSONB NOT NULL');
  });

  it('rejects evidence mutation, approved-run updates, deletes, and audit rewrites', () => {
    expect(migration).toContain('CREATE TRIGGER guard_biological_media_runs');
    expect(migration).toContain("IF TG_OP = 'DELETE'");
    expect(migration).toContain("IF OLD.status = 'Approved'");
    expect(migration).toContain('Biological Media calculation run evidence is immutable');
    expect(migration).toContain('CREATE TRIGGER guard_biological_media_run_audit');
    expect(migration).toContain('Biological Media run audit records are append-only');
  });
});