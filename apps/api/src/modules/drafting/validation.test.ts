// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validatePlanInput, validateTeamInput } from './validation';

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
    expect(validatePlanInput(base, { creating: true }).value).toEqual(base);
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
