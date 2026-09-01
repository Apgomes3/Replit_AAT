export const RETIRED_SYSTEM_STATUSES = ['Archived', 'Decommissioned', 'Superseded'] as const;

export function isRetiredSystem(system: any): boolean {
  return RETIRED_SYSTEM_STATUSES.includes(system?.status);
}

export function systemLifecycleError(system: any) {
  return {
    code: 'SYSTEM_RETIRED',
    message: system?.status === 'Superseded'
      ? 'This Life Support System has been superseded and is read-only.'
      : 'This Life Support System has been archived/decommissioned and is read-only.',
  };
}

export async function loadEditableSystem(
  runner: (sql: string, params?: any[]) => Promise<{ rows: any[] }>,
  systemId: string,
  lock = false,
) {
  const result = await runner(
    `SELECT * FROM systems WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
    [systemId],
  );
  const system = result.rows[0] || null;
  return {
    system,
    error: system && isRetiredSystem(system) ? systemLifecycleError(system) : null,
  };
}