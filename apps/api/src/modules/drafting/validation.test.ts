// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateGroupInput, validatePlanInput, validateTaskInput, validateTeamInput } from './validation';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('validateTeamInput', () => {
  it('requires a name when creating and trims it', () => {
    expect(validateTeamInput({}, { creating: true }).error).toBe('name is required.');
    expect(validateTeamInput({ name: '   ' }, { creating: true }).error).toBe('name is required.');
    expect(validateTeamInput({ name: '  Fabrication  ' }, { creating: true }).value).toEqual({ name: 'Fabrication' });
  });

  it('de-duplicates members and rejects invalid ids', () => {
    expect(validateTeamInput({ name: 'T', member_ids: [A, A, B] }, { creating: true }).value?.member_ids).toEqual([A, B]);
    expect(validateTeamInput({ name: 'T', member_ids: ['nope'] }, { creating: true }).error).toMatch(/member_ids/);
    expect(validateTeamInput({ name: 'T', manager_user_id: 'x' }, { creating: true }).error).toMatch(/manager_user_id/);
  });

  it('allows clearing the manager and partial updates, but not empty updates', () => {
    expect(validateTeamInput({ manager_user_id: null }, { creating: false }).value).toEqual({ manager_user_id: null });
    expect(validateTeamInput({ active: false }, { creating: false }).value).toEqual({ active: false });
    expect(validateTeamInput({}, { creating: false }).error).toBe('Nothing to update.');
    expect(validateTeamInput({ active: 'no' }, { creating: false }).error).toMatch(/active/);
  });
});

describe('validatePlanInput', () => {
  const base = { name: 'Fabrication drawings', project_id: A, team_id: B };

  it('requires name, project and team when creating', () => {
    expect(validatePlanInput(base, { creating: true }).value).toEqual({ ...base, visibility: 'team' });
    expect(validatePlanInput({ ...base, project_id: undefined }, { creating: true }).error).toMatch(/project_id/);
    expect(validatePlanInput({ name: 'x', project_id: A }, { creating: true }).error).toBe('team_id is required.');
  });

  it('validates status and calendar dates', () => {
    expect(validatePlanInput({ ...base, status: 'done' }, { creating: true }).error).toMatch(/status must be one of/);
    expect(validatePlanInput({ ...base, start_date: '2026-02-30' }, { creating: true }).error).toMatch(/start_date/);
    expect(validatePlanInput({ ...base, start_date: '2026-03-01', target_date: '2026-02-01' }, { creating: true }).error)
      .toBe('target_date cannot be before start_date.');
    expect(validatePlanInput({ ...base, start_date: '2026-02-13', target_date: '2026-11-19' }, { creating: true }).value)
      .toMatchObject({ start_date: '2026-02-13', target_date: '2026-11-19' });
  });

  it('treats empty dates as cleared and allows status-only updates', () => {
    expect(validatePlanInput({ target_date: '' }, { creating: false }).value).toEqual({ target_date: null });
    expect(validatePlanInput({ status: 'on_hold' }, { creating: false }).value).toEqual({ status: 'on_hold' });
    expect(validatePlanInput({}, { creating: false }).error).toBe('Nothing to update.');
  });
});

describe('validateTaskInput', () => {
  it('requires a title when creating and applies the agreed status and priority sets', () => {
    expect(validateTaskInput({}, { creating: true }).error).toBe('title is required.');
    expect(validateTaskInput({ title: '  T02 Touch Tank FD ' }, { creating: true }).value).toEqual({ title: 'T02 Touch Tank FD' });
    expect(validateTaskInput({ title: 'x', status: 'blocked' }, { creating: true }).error).toMatch(/not_started, in_progress, review, done/);
    expect(validateTaskInput({ title: 'x', priority: 'high' }, { creating: true }).error).toMatch(/urgent, important, medium, low/);
  });

  it('checks dates, assignees and group ids', () => {
    expect(validateTaskInput({ title: 'x', start_date: '2026-03-10', due_date: '2026-03-01' }, { creating: true }).error)
      .toBe('due_date cannot be before start_date.');
    expect(validateTaskInput({ title: 'x', assignee_ids: [A, A, B] }, { creating: true }).value?.assignee_ids).toEqual([A, B]);
    expect(validateTaskInput({ title: 'x', assignee_ids: ['bob'] }, { creating: true }).error).toMatch(/assignee_ids/);
    expect(validateTaskInput({ group_id: '' }, { creating: false }).value).toEqual({ group_id: null });
    expect(validateTaskInput({ group_id: 'nope' }, { creating: false }).error).toMatch(/group_id/);
  });

  it('allows single-field updates but not empty ones', () => {
    expect(validateTaskInput({ status: 'done' }, { creating: false }).value).toEqual({ status: 'done' });
    expect(validateTaskInput({}, { creating: false }).error).toBe('Nothing to update.');
  });
});

describe('validateGroupInput', () => {
  it('requires a name and a non-negative whole sort order', () => {
    expect(validateGroupInput({ name: ' LSS ' }, { creating: true }).value).toEqual({ name: 'LSS' });
    expect(validateGroupInput({}, { creating: true }).error).toBe('name is required.');
    expect(validateGroupInput({ sort_order: -1 }, { creating: false }).error).toMatch(/sort_order/);
    expect(validateGroupInput({ sort_order: 20 }, { creating: false }).value).toEqual({ sort_order: 20 });
  });
});
