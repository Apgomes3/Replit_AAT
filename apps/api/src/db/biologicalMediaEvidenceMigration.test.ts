// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Biological Media evidence database boundary', () => {
  const migration = fs.readFileSync(path.join(process.cwd(), 'apps/api/src/db/migrate.ts'), 'utf8');

  it('keeps evidence records and observations separate from selectable profiles', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS lss_biological_media_evidence_records');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS lss_biological_media_evidence_observations');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS lss_biological_media_evidence_links');
    expect(migration).toContain("review_status VARCHAR(40) NOT NULL DEFAULT 'Review Needed'");
    expect(migration).toContain('is_approved BOOLEAN NOT NULL DEFAULT false');
    expect(migration).toContain('promotable BOOLEAN NOT NULL DEFAULT false');
    expect(migration).not.toContain('media_profile_revision_id UUID REFERENCES lss_biological_media_evidence');
  });
});