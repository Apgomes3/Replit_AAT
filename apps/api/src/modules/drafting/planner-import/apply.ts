// Writes a Planner import into the drafting tables. All-or-nothing, and safe to re-run:
// projects/plans/groups are matched by code/name and tasks by their [Planner #N] marker.
import type { PoolClient } from 'pg';
import { ImportPlan, plannerMarker } from './plannerPlan';

export type ImportOptions = {
  teamName: string;
  /** Use this existing plan (by plan code) for a project instead of the project's first plan. */
  planOverrides?: Record<string, string>;
  createdProjectNote?: string;
};

export type ImportReport = {
  projectsCreated: string[];
  plansCreated: string[];
  plansReused: string[];
  groupsCreated: number;
  tasksCreated: number;
  tasksSkipped: number;
  unknownAssignees: string[];
};

type Db = Pick<PoolClient, 'query'>;

/** Users by display name ("First Last"), lower-cased. */
async function loadPeople(db: Db): Promise<Map<string, string>> {
  const rows = (await db.query(`SELECT id, TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) AS name FROM users`)).rows;
  return new Map(rows.filter(r => r.name).map(r => [String(r.name).toLowerCase(), r.id]));
}

export async function unknownAssignees(db: Db, plans: ImportPlan[]): Promise<string[]> {
  const people = await loadPeople(db);
  const names = new Set(plans.flatMap(p => p.tasks.flatMap(t => t.assigneeNames)));
  return [...names].filter(n => !people.has(n.toLowerCase())).sort();
}

export async function applyImport(db: Db, plans: ImportPlan[], opts: ImportOptions, actorId: string | null): Promise<ImportReport> {
  const report: ImportReport = { projectsCreated: [], plansCreated: [], plansReused: [], groupsCreated: 0, tasksCreated: 0, tasksSkipped: 0, unknownAssignees: [] };
  const people = await loadPeople(db);
  report.unknownAssignees = await unknownAssignees(db, plans);

  const team = (await db.query(`SELECT id FROM drafting_teams WHERE LOWER(name) = LOWER($1)`, [opts.teamName])).rows[0];
  if (!team) throw new Error(`Drafting team "${opts.teamName}" not found.`);

  for (const plan of plans) {
    // 1. Project
    let project = (await db.query(`SELECT id FROM projects WHERE UPPER(project_code) = $1`, [plan.project.code])).rows[0];
    if (!project) {
      project = (await db.query(
        `INSERT INTO projects (project_code, project_name, project_status, start_date, target_completion_date, notes, created_by)
         VALUES ($1, $2, 'Concept', $3, $4, $5, $6) RETURNING id`,
        [plan.project.code, plan.project.name, plan.startDate, plan.targetDate, opts.createdProjectNote ?? null, actorId],
      )).rows[0];
      report.projectsCreated.push(`${plan.project.code} ${plan.project.name}`);
    }

    // 2. Plan: explicit override, else the project's existing plan for this team, else a new one.
    const allDone = plan.tasks.length > 0 && plan.tasks.every(t => t.status === 'done');
    const override = opts.planOverrides?.[plan.project.code];
    let planRow = override
      ? (await db.query(`SELECT id, plan_code FROM drafting_plans WHERE plan_code = $1 AND project_id = $2`, [override, project.id])).rows[0]
      : (await db.query(`SELECT id, plan_code FROM drafting_plans WHERE project_id = $1 AND team_id = $2 ORDER BY created_at LIMIT 1`, [project.id, team.id])).rows[0];
    if (override && !planRow) throw new Error(`Plan ${override} not found for project ${plan.project.code}.`);
    if (planRow) {
      report.plansReused.push(`${planRow.plan_code} (${plan.project.code})`);
    } else {
      const seq = (await db.query(`SELECT to_char(NOW(), 'YYYY') AS year, nextval('drafting_plan_code_seq') AS n`)).rows[0];
      const code = `DP-${seq.year}-${String(seq.n).padStart(4, '0')}`;
      planRow = (await db.query(
        `INSERT INTO drafting_plans (plan_code, name, project_id, team_id, status, start_date, target_date, description, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id, plan_code`,
        [code, plan.project.name, project.id, team.id, allDone ? 'completed' : 'active', plan.startDate, plan.targetDate, plan.description, actorId],
      )).rows[0];
      report.plansCreated.push(`${code} ${plan.project.code} ${plan.project.name}`);
    }

    // 3. Groups (Planner labels)
    const groups = new Map<string, string>(
      (await db.query(`SELECT id, name FROM drafting_task_groups WHERE plan_id = $1`, [planRow.id])).rows.map(g => [g.name.toLowerCase(), g.id]),
    );
    let groupOrder = Number((await db.query(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM drafting_task_groups WHERE plan_id = $1`, [planRow.id])).rows[0].n);
    for (const name of new Set(plan.tasks.map(t => t.group).filter((g): g is string => !!g))) {
      if (groups.has(name.toLowerCase())) continue;
      const g = (await db.query(`INSERT INTO drafting_task_groups (plan_id, name, sort_order, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
        [planRow.id, name, groupOrder++, actorId])).rows[0];
      groups.set(name.toLowerCase(), g.id);
      report.groupsCreated++;
    }

    // 4. Tasks
    const existingNotes: string[] = (await db.query(`SELECT notes FROM drafting_tasks WHERE plan_id = $1 AND notes IS NOT NULL`, [planRow.id])).rows.map(r => r.notes);
    let taskOrder = Number((await db.query(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM drafting_tasks WHERE plan_id = $1`, [planRow.id])).rows[0].n);
    for (const t of plan.tasks) {
      if (existingNotes.some(n => n.includes(plannerMarker(t.plannerNumber)))) { report.tasksSkipped++; continue; }
      const task = (await db.query(
        `INSERT INTO drafting_tasks (plan_id, group_id, title, status, priority, start_date, due_date, notes, sort_order, completed_at, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) RETURNING id`,
        [planRow.id, t.group ? groups.get(t.group.toLowerCase()) : null, t.title.slice(0, 500), t.status, t.priority,
          t.startDate, t.dueDate, t.notes, taskOrder++, t.status === 'done' ? (t.completedOn ?? new Date().toISOString().slice(0, 10)) : null, actorId],
      )).rows[0];
      for (const userId of new Set(t.assigneeNames.map(n => people.get(n.toLowerCase())).filter(Boolean))) {
        await db.query(`INSERT INTO drafting_task_assignees (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [task.id, userId]);
      }
      report.tasksCreated++;
    }
  }
  return report;
}
