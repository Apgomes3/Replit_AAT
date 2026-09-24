/**
 * updated_at is the optimistic-concurrency token used by draft-write APIs.
 * PostgreSQL timestamps are exposed by node-postgres as Dates (millisecond
 * precision); normalize both sides the same way before comparing.
 */
export function versionToken(record: any): string | null {
  // Routes select xmin as an opaque row revision. Unlike timestamp tokens it
  // cannot collide when two writes happen within the same clock millisecond.
  if (record?.version != null && String(record.version)) return String(record.version);
  if (!record?.updated_at) return null;
  const date = record.updated_at instanceof Date
    ? record.updated_at
    : new Date(record.updated_at);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function versionMatches(record: any, expectedVersion: unknown): boolean {
  const current = versionToken(record);
  if (!current || typeof expectedVersion !== 'string') return false;
  if (record?.version != null) return expectedVersion === current;
  const expected = new Date(expectedVersion);
  return !Number.isNaN(expected.getTime()) && expected.toISOString() === current;
}

export function withVersion<T extends Record<string, any>>(record: T): T & { version: string | null } {
  return { ...record, version: versionToken(record) };
}

export function versionConflict(record: any) {
  const current = withVersion(record);
  return {
    error: {
      code: 'VERSION_CONFLICT',
      message: 'This record changed since it was loaded. Refresh and reapply your changes.',
      current_record: current,
      current_version: current.version,
    },
  };
}