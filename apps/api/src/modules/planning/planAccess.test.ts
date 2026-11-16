import { describe, expect, it } from 'vitest';
import { canEditPlan, canViewPlan } from './planAccess';
import type { PlanAccessFacts } from '../drafting/repository';

const facts = (over: Partial<PlanAccessFacts> = {}): PlanAccessFacts => ({
  visibility: 'private', department: null, is_owner: false, is_member: false, is_assignee: false,
  is_team_member: false, is_team_manager: false, ...over,
});
const user = { role: 'engineer', drafting: 'hidden' as const };

describe('plan access', () => {
  it('keeps private plans to the owner, shared people and assignees', () => {
    expect(canViewPlan(facts(), user)).toBe(false);
    expect(canViewPlan(facts({ is_team_member: true }), user)).toBe(false);
    for (const k of ['is_owner', 'is_member', 'is_assignee'] as const) expect(canViewPlan(facts({ [k]: true }), user)).toBe(true);
    expect(canViewPlan(facts(), { role: 'admin' })).toBe(true);
  });

  it('shows team plans to the team and everyone plans to all', () => {
    expect(canViewPlan(facts({ visibility: 'team', is_team_member: true }), user)).toBe(true);
    expect(canViewPlan(facts({ visibility: 'team' }), user)).toBe(false);
    expect(canViewPlan(facts({ visibility: 'everyone' }), user)).toBe(true);
  });

  it('lets assignees and team members look but not change the plan', () => {
    expect(canEditPlan(facts({ is_assignee: true }), user)).toBe(false);
    expect(canEditPlan(facts({ visibility: 'team', is_team_member: true }), user)).toBe(false);
    for (const k of ['is_owner', 'is_member', 'is_team_manager'] as const) expect(canEditPlan(facts({ [k]: true }), user)).toBe(true);
  });

  it('gives Drafting module roles their access on Drafting team plans only', () => {
    const drafting = facts({ visibility: 'team', department: 'Drafting' });
    expect(canViewPlan(drafting, { role: 'viewer', drafting: 'view' })).toBe(true);
    expect(canEditPlan(drafting, { role: 'viewer', drafting: 'view' })).toBe(false);
    expect(canEditPlan(drafting, { role: 'engineer', drafting: 'manage' })).toBe(true);
    expect(canViewPlan(facts({ department: 'Engineering' }), { role: 'engineer', drafting: 'manage' })).toBe(false);
  });
});
