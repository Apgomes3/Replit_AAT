// @vitest-environment node
// Plans (global planner) for an initiative. Runs against the PostgreSQL test database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../db';
import * as repo from '../drafting/repository';
import { validatePlanInput } from '../drafting/validation';

const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let userId = '';
let initiativeId = '';
let projectId = '';
const planIds: string[] = [];

describe('plan input for initiatives', () => {
  it('accepts an initiative alone but not with a client-side link', () => {
    const ini = '11111111-1111-4111-8111-111111111111';
    expect(validatePlanInput({ name: 'Prototype', initiative_id: ini }, { creating: true, required: false }).value)
      .toMatchObject({ initiative_id: ini });
    expect(validatePlanInput({ name: 'x', initiative_id: ini, project_id: ini }, { creating: true, required: false }).error)
      .toMatch(/initiative .* not also linked/);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('plans for initiatives (PostgreSQL)', () => {
  beforeAll(async () => {
    userId = (await query(`INSERT INTO users (email, password_hash, first_name, role) VALUES ($1, 'x', 'Planner', 'user') RETURNING id`, [`plan-ini-${tag}@example.test`])).rows[0].id;
    initiativeId = (await query(`INSERT INTO initiatives (code, title, created_by) VALUES ($1, 'Plan me', $2) RETURNING id`, [`T-INT-${tag}`, userId])).rows[0].id;
    projectId = (await query(`INSERT INTO projects (project_code, project_name) VALUES ($1, 'Client job') RETURNING id`, [`T-P-${tag}`])).rows[0].id;
  });

  afterAll(async () => {
    await query(`DELETE FROM drafting_plans WHERE id = ANY($1::uuid[])`, [planIds]);
    await query(`DELETE FROM initiatives WHERE id = $1`, [initiativeId]);
    await query(`DELETE FROM projects WHERE id = $1`, [projectId]);
    await query(`DELETE FROM users WHERE id = $1`, [userId]);
  });

  it('creates, lists and re-links a plan for an initiative', async () => {
    const plan = await repo.createPlan({ name: 'UV skid prototype', initiative_id: initiativeId }, userId, { codePrefix: 'PL' });
    planIds.push(plan.id);
    expect(plan.initiative).toMatchObject({ id: initiativeId, code: `T-INT-${tag}` });
    expect(plan.project).toBeNull();
    expect((await repo.listPlans({ initiative_id: initiativeId })).map(p => p.id)).toEqual([plan.id]);
    expect((await repo.listInitiativeOptions()).some(o => o.id === initiativeId)).toBe(true);

    // Moving it to a client project drops the initiative link, and back again drops the project.
    const moved = await repo.updatePlan(plan.id, { project_id: projectId }, userId);
    expect(moved).toMatchObject({ project: { id: projectId }, initiative: null });
    const back = await repo.updatePlan(plan.id, { initiative_id: initiativeId }, userId);
    expect(back).toMatchObject({ project: null, initiative: { id: initiativeId } });
  });
});
