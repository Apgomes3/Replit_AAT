import { describe, expect, it } from 'vitest';
import { canEdit, stageChangeProblem, validateCost, validateInitiativeInput, validateTimeEntry, type Actor } from './validation';

const nobody: Actor = { isAdmin: false, manages: false, isOwner: false, isSponsor: false, isCreator: false };

describe('validateInitiativeInput', () => {
  it('needs a title and checks type, dates, hours and money', () => {
    expect(validateInitiativeInput({}, true)).toEqual({ error: 'Title is required' });
    expect(validateInitiativeInput({ title: ' UV skid range ', estimated_hours: '120', budget_amount: 15000.456, currency: 'AUD' }, true))
      .toEqual({ value: { title: 'UV skid range', estimated_hours: 120, budget_amount: 15000.46, currency: 'AUD' } });
    expect(validateInitiativeInput({ type: 'research' }, false)).toEqual({ error: expect.stringMatching(/^Type must be one of/) });
    expect(validateInitiativeInput({ start_date: '2027-03-01', target_date: '2027-01-01' }, false)).toEqual({ error: expect.stringMatching(/before the start/) });
    expect(validateInitiativeInput({ budget_amount: -1 }, false)).toEqual({ error: expect.stringMatching(/^Budget/) });
    expect(validateInitiativeInput({ owner_user_id: '' }, false)).toEqual({ value: { owner_user_id: null } });
  });
});

describe('who may do what', () => {
  it('lets the creator edit only while it is an idea; owner, sponsor and managers always', () => {
    expect(canEdit({ ...nobody, isCreator: true }, 'idea')).toBe(true);
    expect(canEdit({ ...nobody, isCreator: true }, 'approved')).toBe(false);
    expect(canEdit({ ...nobody, isOwner: true }, 'in_progress')).toBe(true);
    expect(canEdit(nobody, 'idea')).toBe(false);
  });

  it('keeps approving ideas and reopening finished work for the sponsor or a manager', () => {
    expect(stageChangeProblem('idea', 'approved', { ...nobody, isOwner: true })).toMatch(/Only the sponsor or a manager/);
    expect(stageChangeProblem('idea', 'approved', { ...nobody, isSponsor: true })).toBeNull();
    expect(stageChangeProblem('idea', 'in_progress', { ...nobody, manages: true })).toMatch(/first approved or dropped/);
    expect(stageChangeProblem('approved', 'in_progress', { ...nobody, isOwner: true })).toBeNull();
    expect(stageChangeProblem('in_progress', 'done', { ...nobody, isOwner: true })).toBeNull();
    expect(stageChangeProblem('done', 'in_progress', { ...nobody, isOwner: true })).toMatch(/reopen/);
    expect(stageChangeProblem('done', 'in_progress', { ...nobody, isSponsor: true })).toBeNull();
    expect(stageChangeProblem('on_hold', 'idea', { ...nobody, isAdmin: true })).toMatch(/back to idea/);
    expect(stageChangeProblem('approved', 'on_hold', nobody)).toMatch(/Only the owner/);
  });
});

describe('hours and costs', () => {
  it('logs past or today hours in quarter hours', () => {
    expect(validateTimeEntry({ work_date: '2026-11-16', hours: 1.3 }, '2026-11-16')).toEqual({ value: { work_date: '2026-11-16', hours: 1.25, note: null } });
    expect(validateTimeEntry({ work_date: '2026-11-17', hours: 2 }, '2026-11-16')).toEqual({ error: expect.stringMatching(/future/) });
    expect(validateTimeEntry({ work_date: '2026-11-16', hours: 25 }, '2026-11-16')).toEqual({ error: expect.stringMatching(/at most 24/) });
  });

  it('records a cost in the initiative currency unless another is given', () => {
    expect(validateCost({ description: 'Prototype acrylic', amount: '850', category: 'materials', cost_date: '2026-11-10' }, 'AUD'))
      .toEqual({ value: { cost_date: '2026-11-10', category: 'materials', description: 'Prototype acrylic', amount: 850, currency: 'AUD', supplier_client_id: null } });
    expect(validateCost({ description: 'x' }, 'USD')).toEqual({ error: 'Enter the amount' });
    expect(validateCost({ description: 'x', amount: 1, category: 'food' }, 'USD')).toEqual({ error: expect.stringMatching(/^Category/) });
  });
});
