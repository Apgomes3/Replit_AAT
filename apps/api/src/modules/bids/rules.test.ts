import { describe, expect, it } from 'vitest';
import { effectiveProbability, stageProblem, validateBidInput } from './rules';

describe('stage rules', () => {
  it('needs a bid decision before a tender is worked on', () => {
    expect(stageProblem('qualifying', 'bidding', { type: 'tender', decision: 'pending' })).toMatch(/bid \/ no-bid decision/);
    expect(stageProblem('qualifying', 'bidding', { type: 'tender', decision: 'bid' })).toBeNull();
    expect(stageProblem('new', 'bidding', { type: 'direct', decision: 'pending' })).toBeNull();
  });

  it('needs a known reason to lose or close', () => {
    expect(stageProblem('submitted', 'lost', { type: 'direct', decision: 'bid' })).toBe('Say why it was lost');
    expect(stageProblem('submitted', 'lost', { type: 'direct', decision: 'bid', reason: 'price' })).toBeNull();
    expect(stageProblem('new', 'closed', { type: 'direct', decision: 'pending', reason: 'because' })).toBe('Unknown reason');
    expect(stageProblem('new', 'quoted' as any, { type: 'direct', decision: 'pending' })).toBe('Unknown stage');
  });
});

describe('bid details', () => {
  it('checks type, value, currency, chance and owner', () => {
    expect(validateBidInput({ enquiry_type: 'tender', estimated_value: '250000.555', value_currency: 'AUD', win_probability: 35 }))
      .toEqual({ value: { enquiry_type: 'tender', estimated_value: 250000.56, value_currency: 'AUD', win_probability: 35 } });
    expect(validateBidInput({ win_probability: 120 })).toEqual({ error: expect.stringMatching(/0 to 100/) });
    expect(validateBidInput({ value_currency: 'dollars' })).toEqual({ error: expect.stringMatching(/3-letter/) });
    expect(validateBidInput({ enquiry_type: 'rfq' })).toEqual({ error: 'Type must be direct or tender' });
    expect(validateBidInput({ estimated_value: '', bid_owner_user_id: '' })).toEqual({ value: { estimated_value: null, bid_owner_user_id: null } });
  });

  it('uses the stage default chance when none is set', () => {
    expect(effectiveProbability('submitted', null)).toBe(50);
    expect(effectiveProbability('submitted', 80)).toBe(80);
  });
});
