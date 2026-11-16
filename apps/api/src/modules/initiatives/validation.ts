// Rules for initiatives (pure, tested without a database).

export const INITIATIVE_TYPES = ['product_development', 'process_improvement', 'standards_knowledge', 'it_tools', 'training', 'facility', 'sales_marketing', 'other'] as const;
export const STAGES = ['idea', 'approved', 'in_progress', 'on_hold', 'done', 'dropped'] as const;
export const PRIORITIES = ['low', 'medium', 'high'] as const;
export const COST_CATEGORIES = ['materials', 'external_services', 'equipment', 'travel', 'software', 'training', 'other'] as const;
export const LINK_TYPES = ['product', 'product_family', 'document', 'project', 'client'] as const;
export type Stage = typeof STAGES[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const has = (b: any, k: string) => Object.prototype.hasOwnProperty.call(b ?? {}, k);

export interface InitiativeInput {
  title?: string; goal?: string | null; description?: string | null; type?: string; priority?: string;
  owner_user_id?: string | null; sponsor_user_id?: string | null; team_id?: string | null;
  start_date?: string | null; target_date?: string | null; estimated_hours?: number | null;
  budget_amount?: number | null; currency?: string; outcome?: string | null;
}

function text(v: unknown, label: string, max: number): { v: string | null } | { error: string } {
  if (v === null || v === undefined) return { v: null };
  if (typeof v !== 'string') return { error: `${label} must be text` };
  const t = v.trim();
  if (t.length > max) return { error: `${label} must be ${max} characters or fewer` };
  return { v: t || null };
}

function amount(v: unknown, label: string, max: number): { v: number | null } | { error: string } {
  if (v === null || v === '' || v === undefined) return { v: null };
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > max) return { error: `${label} must be a number from 0 to ${max}` };
  return { v: Math.round(n * 100) / 100 };
}

/** An initiative's details. Title is required on create; on update only the fields sent are checked. */
export function validateInitiativeInput(body: any, creating: boolean): { value: InitiativeInput } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Request body must be an object' };
  const out: InitiativeInput = {};
  if (creating || has(body, 'title')) {
    const t = text(body.title, 'Title', 255);
    if ('error' in t) return t;
    if (!t.v) return { error: 'Title is required' };
    out.title = t.v;
  }
  for (const [k, label, max] of [['goal', 'Goal', 2000], ['description', 'Description', 20000], ['outcome', 'Outcome', 5000]] as const) {
    if (!has(body, k)) continue;
    const t = text(body[k], label, max);
    if ('error' in t) return t;
    out[k] = t.v;
  }
  if (has(body, 'type')) {
    if (!(INITIATIVE_TYPES as readonly string[]).includes(body.type)) return { error: `Type must be one of: ${INITIATIVE_TYPES.join(', ')}` };
    out.type = body.type;
  }
  if (has(body, 'priority')) {
    if (!(PRIORITIES as readonly string[]).includes(body.priority)) return { error: 'Priority must be low, medium or high' };
    out.priority = body.priority;
  }
  for (const k of ['owner_user_id', 'sponsor_user_id', 'team_id'] as const) {
    if (!has(body, k)) continue;
    if (body[k] !== null && body[k] !== '' && !isUuid(body[k])) return { error: `${k} must be an id or empty` };
    out[k] = body[k] || null;
  }
  for (const k of ['start_date', 'target_date'] as const) {
    if (!has(body, k)) continue;
    if (body[k] !== null && body[k] !== '' && !(typeof body[k] === 'string' && DATE.test(body[k]))) return { error: `${k} must be a date (YYYY-MM-DD) or empty` };
    out[k] = body[k] || null;
  }
  if (out.start_date && out.target_date && out.target_date < out.start_date) return { error: 'The target date cannot be before the start date' };
  if (has(body, 'estimated_hours')) { const a = amount(body.estimated_hours, 'Estimated hours', 100000); if ('error' in a) return a; out.estimated_hours = a.v; }
  if (has(body, 'budget_amount')) { const a = amount(body.budget_amount, 'Budget', 1e11); if ('error' in a) return a; out.budget_amount = a.v; }
  if (has(body, 'currency')) {
    if (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency)) return { error: 'Currency must be a 3-letter code such as USD' };
    out.currency = body.currency;
  }
  return { value: out };
}

/** Who is asking, relative to one initiative. */
export interface Actor { isAdmin: boolean; manages: boolean; isOwner: boolean; isSponsor: boolean; isCreator: boolean }

/** May this person change the initiative's details, costs and outcome links? */
export function canEdit(a: Actor, stage: Stage): boolean {
  return a.isAdmin || a.manages || a.isOwner || a.isSponsor || (a.isCreator && stage === 'idea');
}

/**
 * Whether a stage change is allowed, and by whom: approving or dropping an idea is the sponsor's
 * (or a manager's) decision; after that the owner can move it along too. Done and dropped are final
 * except for managers and the sponsor, who can reopen.
 */
export function stageChangeProblem(from: Stage, to: Stage, a: Actor): string | null {
  if (from === to) return 'It is already at that stage';
  const decider = a.isAdmin || a.manages || a.isSponsor;
  if (from === 'idea') {
    if (!['approved', 'dropped'].includes(to)) return 'An idea is first approved or dropped';
    return decider ? null : 'Only the sponsor or a manager can approve or drop an idea';
  }
  if (from === 'done' || from === 'dropped') return decider ? null : 'Only the sponsor or a manager can reopen it';
  if (to === 'idea') return 'It cannot go back to idea';
  return decider || a.isOwner ? null : 'Only the owner, the sponsor or a manager can change the stage';
}

/** Can hours be logged at this stage? (Not on ideas waiting for approval, nor on dropped work.) */
export const acceptsTime = (stage: Stage) => !['idea', 'dropped'].includes(stage);

export interface TimeInput { work_date: string; hours: number; note: string | null }
export function validateTimeEntry(body: any, today = new Date().toISOString().slice(0, 10)): { value: TimeInput } | { error: string } {
  if (!body || typeof body.work_date !== 'string' || !DATE.test(body.work_date)) return { error: 'Choose the date the work was done' };
  if (body.work_date > today) return { error: 'Hours cannot be logged for a future date' };
  const h = typeof body.hours === 'string' ? Number(body.hours) : body.hours;
  if (typeof h !== 'number' || !Number.isFinite(h) || h <= 0 || h > 24) return { error: 'Hours must be more than 0 and at most 24' };
  const n = text(body.note, 'Note', 500);
  if ('error' in n) return n;
  return { value: { work_date: body.work_date, hours: Math.round(h * 4) / 4 || 0.25, note: n.v } };
}

export interface CostInput { cost_date: string; category: string; description: string; amount: number; currency: string; supplier_client_id: string | null }
export function validateCost(body: any, defaultCurrency: string): { value: CostInput } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Request body must be an object' };
  const d = text(body.description, 'Description', 255);
  if ('error' in d) return d;
  if (!d.v) return { error: 'Describe the cost' };
  const a = amount(body.amount, 'Amount', 1e11);
  if ('error' in a) return a;
  if (a.v === null) return { error: 'Enter the amount' };
  const category = body.category ?? 'other';
  if (!(COST_CATEGORIES as readonly string[]).includes(category)) return { error: `Category must be one of: ${COST_CATEGORIES.join(', ')}` };
  const date = body.cost_date || new Date().toISOString().slice(0, 10);
  if (typeof date !== 'string' || !DATE.test(date)) return { error: 'cost_date must be a date (YYYY-MM-DD)' };
  const currency = body.currency || defaultCurrency;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return { error: 'Currency must be a 3-letter code such as USD' };
  if (body.supplier_client_id && !isUuid(body.supplier_client_id)) return { error: 'supplier_client_id must be a company id' };
  return { value: { cost_date: date, category, description: d.v, amount: a.v, currency, supplier_client_id: body.supplier_client_id || null } };
}
