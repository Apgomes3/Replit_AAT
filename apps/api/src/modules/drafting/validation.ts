// Pure input validation for the drafting module (no database access).
// Each validator returns either { value } with a normalised payload or { error }.

export const PLAN_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'archived'] as const;
export type PlanStatus = typeof PLAN_STATUSES[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

type Result<T> = { value: T; error?: undefined } | { value?: undefined; error: string };

export type TeamInput = {
  name?: string;
  description?: string | null;
  manager_user_id?: string | null;
  member_ids?: string[];
  active?: boolean;
};

export type PlanInput = {
  name?: string;
  project_id?: string;
  team_id?: string;
  status?: PlanStatus;
  start_date?: string | null;
  target_date?: string | null;
  description?: string | null;
};

const has = (body: any, key: string) => Object.prototype.hasOwnProperty.call(body, key);

function optionalText(body: any, key: string, max: number, out: Record<string, unknown>): string | null {
  if (!has(body, key)) return null;
  const v = body[key];
  if (v === null || v === '') { out[key] = null; return null; }
  if (typeof v !== 'string') return `${key} must be text.`;
  if (v.trim().length > max) return `${key} must be at most ${max} characters.`;
  out[key] = v.trim();
  return null;
}

function requiredName(body: any, creating: boolean, max: number, out: Record<string, unknown>): string | null {
  if (!has(body, 'name')) return creating ? 'name is required.' : null;
  if (typeof body.name !== 'string' || !body.name.trim()) return 'name is required.';
  if (body.name.trim().length > max) return `name must be at most ${max} characters.`;
  out.name = body.name.trim();
  return null;
}

function validDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function optionalDate(body: any, key: string, out: Record<string, unknown>): string | null {
  if (!has(body, key)) return null;
  const v = body[key];
  if (v === null || v === '') { out[key] = null; return null; }
  if (typeof v !== 'string' || !validDate(v)) return `${key} must be a date (YYYY-MM-DD).`;
  out[key] = v;
  return null;
}

export function validateTeamInput(body: any, { creating }: { creating: boolean }): Result<TeamInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Request body must be an object.' };
  const out: TeamInput & Record<string, unknown> = {};
  const error = requiredName(body, creating, 150, out) || optionalText(body, 'description', 2000, out);
  if (error) return { error };

  if (has(body, 'manager_user_id')) {
    const v = body.manager_user_id;
    if (v !== null && v !== '' && !isUuid(v)) return { error: 'manager_user_id must be a valid user id.' };
    out.manager_user_id = v || null;
  }
  if (has(body, 'member_ids')) {
    if (!Array.isArray(body.member_ids) || !body.member_ids.every(isUuid)) return { error: 'member_ids must be a list of user ids.' };
    out.member_ids = [...new Set<string>(body.member_ids)];
  }
  if (has(body, 'active')) {
    if (typeof body.active !== 'boolean') return { error: 'active must be true or false.' };
    out.active = body.active;
  }
  if (!creating && Object.keys(out).length === 0) return { error: 'Nothing to update.' };
  return { value: out };
}

export function validatePlanInput(body: any, { creating }: { creating: boolean }): Result<PlanInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Request body must be an object.' };
  const out: PlanInput & Record<string, unknown> = {};
  let error = requiredName(body, creating, 255, out) || optionalText(body, 'description', 4000, out);
  if (error) return { error };

  for (const key of ['project_id', 'team_id'] as const) {
    if (!has(body, key)) { if (creating) return { error: `${key} is required.` }; continue; }
    if (!isUuid(body[key])) return { error: `${key} must be a valid id.` };
    out[key] = body[key];
  }
  if (has(body, 'status')) {
    if (!PLAN_STATUSES.includes(body.status)) return { error: `status must be one of: ${PLAN_STATUSES.join(', ')}.` };
    out.status = body.status;
  }
  error = optionalDate(body, 'start_date', out) || optionalDate(body, 'target_date', out);
  if (error) return { error };
  if (out.start_date && out.target_date && out.target_date < out.start_date) {
    return { error: 'target_date cannot be before start_date.' };
  }
  if (!creating && Object.keys(out).length === 0) return { error: 'Nothing to update.' };
  return { value: out };
}
