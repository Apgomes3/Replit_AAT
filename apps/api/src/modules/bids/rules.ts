// Bid rules (pure, tested without a database).

export const STAGES = ['new', 'qualifying', 'bidding', 'submitted', 'won', 'lost', 'closed'] as const;
export type Stage = typeof STAGES[number];
export const OPEN_STAGES: Stage[] = ['new', 'qualifying', 'bidding', 'submitted'];
export const ENQUIRY_TYPES = ['direct', 'tender'] as const;
export const DECISIONS = ['pending', 'bid', 'no_bid'] as const;
export type Decision = typeof DECISIONS[number];
export const OUTCOME_REASONS = ['price', 'technical', 'delivery_time', 'relationship', 'scope_changed', 'client_cancelled', 'no_decision', 'no_bid', 'other'] as const;

/** Default chance of winning by stage, used when nobody has set one. */
export const DEFAULT_PROBABILITY: Record<Stage, number> = { new: 10, qualifying: 20, bidding: 40, submitted: 50, won: 100, lost: 0, closed: 0 };

export interface StageFacts { type: 'direct' | 'tender'; decision: Decision; reason?: string | null }

/**
 * Why an enquiry cannot move from one stage to another, or null. A tender needs a "bid" decision
 * before work on the bid starts; lost and closed need a reason; won goes through "Create project".
 */
export function stageProblem(from: Stage, to: Stage, f: StageFacts): string | null {
  if (!(STAGES as readonly string[]).includes(to)) return 'Unknown stage';
  if (from === to) return null;
  if (f.type === 'tender' && (to === 'bidding' || to === 'submitted') && f.decision !== 'bid') {
    return 'Record the bid / no-bid decision first: a tender is only worked on after deciding to bid';
  }
  if ((to === 'lost' || to === 'closed') && !f.reason) return to === 'lost' ? 'Say why it was lost' : 'Say why it was closed';
  if (f.reason && !(OUTCOME_REASONS as readonly string[]).includes(f.reason)) return 'Unknown reason';
  return null;
}

export interface BidInput {
  enquiry_type?: 'direct' | 'tender'; estimated_value?: number | null; value_currency?: string;
  win_probability?: number | null; bid_owner_user_id?: string | null;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const has = (b: any, k: string) => Object.prototype.hasOwnProperty.call(b ?? {}, k);

/** Bid details on an enquiry: only the fields sent are checked. */
export function validateBidInput(body: any): { value: BidInput } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Request body must be an object' };
  const out: BidInput = {};
  if (has(body, 'enquiry_type')) {
    if (!(ENQUIRY_TYPES as readonly string[]).includes(body.enquiry_type)) return { error: 'Type must be direct or tender' };
    out.enquiry_type = body.enquiry_type;
  }
  if (has(body, 'estimated_value')) {
    const v = body.estimated_value === '' || body.estimated_value === null ? null : Number(body.estimated_value);
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1e12)) return { error: 'Estimated value must be a positive number' };
    out.estimated_value = v === null ? null : Math.round(v * 100) / 100;
  }
  if (has(body, 'value_currency')) {
    if (typeof body.value_currency !== 'string' || !/^[A-Z]{3}$/.test(body.value_currency)) return { error: 'Currency must be a 3-letter code such as USD' };
    out.value_currency = body.value_currency;
  }
  if (has(body, 'win_probability')) {
    const p = body.win_probability === '' || body.win_probability === null ? null : Number(body.win_probability);
    if (p !== null && (!Number.isInteger(p) || p < 0 || p > 100)) return { error: 'Win chance must be a whole number from 0 to 100' };
    out.win_probability = p;
  }
  if (has(body, 'bid_owner_user_id')) {
    if (body.bid_owner_user_id !== null && body.bid_owner_user_id !== '' && !isUuid(body.bid_owner_user_id)) return { error: 'bid_owner_user_id must be a person id' };
    out.bid_owner_user_id = body.bid_owner_user_id || null;
  }
  return { value: out };
}

/** The chance used for the weighted pipeline: the one set, else the stage default. */
export const effectiveProbability = (stage: Stage, set: number | null | undefined) => set ?? DEFAULT_PROBABILITY[stage];
