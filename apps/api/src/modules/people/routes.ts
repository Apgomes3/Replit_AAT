// Person card (/api/v1/people/:id): a colleague's position, access role, line manager, direct
// reports, teams and working calendar. Open to everyone signed in; no private data (no login times,
// no leave reasons, no access settings beyond the role name).
import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { query } from '../../db';
import { listDepartmentOptions } from './departments';

const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME = `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email)`;

/** Active colleagues for pickers (owner, sponsor…): id, name, job position. */
router.get('/', authenticate, async (_req, res, next) => {
  try {
    const rows = await query(`SELECT u.id, ${NAME} AS name, u.job_title FROM users u WHERE u.is_active IS NOT FALSE ORDER BY 2`);
    res.json({ data: rows.rows });
  } catch (e) { next(e); }
});

/** Departments for pickers and labels: id, key, name, parent, colour, active. */
router.get('/departments', authenticate, async (_req, res, next) => {
  try { res.json({ data: await listDepartmentOptions() }); } catch (e) { next(e); }
});

/** The org chart: every active person and who they report to (only if that manager is active too). */
router.get('/org-chart', authenticate, async (_req, res, next) => {
  try {
    const rows = await query(
      `SELECT u.id, ${NAME} AS name, u.job_title,
         CASE WHEN m.is_active IS NOT FALSE THEN m.id END AS manager_id,
         d.name AS department, d.colour AS department_colour, o.name AS office
       FROM users u
       LEFT JOIN users m ON m.id = u.reports_to_user_id AND m.id <> u.id
       LEFT JOIN departments d ON d.key = u.department
       LEFT JOIN offices o ON o.id = u.office_id
       WHERE u.is_active IS NOT FALSE ORDER BY 2`);
    res.json({ data: rows.rows });
  } catch (e) { next(e); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    if (!UUID.test(id)) return res.status(400).json({ error: { code: 'VALIDATION', message: 'Not a valid person' } });
    const person = (await query(
      `SELECT u.id, u.email, u.first_name, u.last_name, ${NAME} AS name, u.job_title, u.role, u.is_active,
         u.reports_to_user_id, (SELECT o.name FROM offices o WHERE o.id = u.office_id) AS office,
         (SELECT json_build_object('name', d.name, 'colour', d.colour, 'parent', p.name,
            'head', CASE WHEN h.id IS NULL THEN NULL ELSE json_build_object('id', h.id, 'name', COALESCE(NULLIF(TRIM(CONCAT_WS(' ', h.first_name, h.last_name)), ''), h.email)) END)
          FROM departments d LEFT JOIN departments p ON p.id = d.parent_id LEFT JOIN users h ON h.id = d.head_user_id
          WHERE d.key = u.department) AS department
       FROM users u WHERE u.id = $1`, [id])).rows[0];
    if (!person) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Person not found' } });

    const [manager, reports, teams, calendar] = await Promise.all([
      person.reports_to_user_id
        ? query(`SELECT u.id, ${NAME} AS name, u.job_title, u.email FROM users u WHERE u.id = $1`, [person.reports_to_user_id])
        : Promise.resolve({ rows: [] as any[] }),
      query(`SELECT u.id, ${NAME} AS name, u.job_title, u.email,
               (SELECT COUNT(*) FROM users r WHERE r.reports_to_user_id = u.id AND r.is_active IS NOT FALSE)::int AS report_count
             FROM users u WHERE u.reports_to_user_id = $1 AND u.is_active IS NOT FALSE ORDER BY 2`, [id]),
      query(`SELECT t.id, t.name, t.department, (t.manager_user_id = $1) AS is_manager,
               m.id AS manager_id, NULLIF(TRIM(CONCAT_WS(' ', m.first_name, m.last_name)), '') AS manager_name
             FROM drafting_teams t
             LEFT JOIN users m ON m.id = t.manager_user_id
             WHERE t.active AND (t.manager_user_id = $1 OR EXISTS (SELECT 1 FROM drafting_team_members tm WHERE tm.team_id = t.id AND tm.user_id = $1))
             ORDER BY t.department, t.name`, [id]),
      query(`SELECT c.name FROM planning_calendars c
             WHERE c.id = COALESCE((SELECT calendar_id FROM planning_resources WHERE user_id = $1), (SELECT id FROM planning_calendars WHERE is_default LIMIT 1))`, [id]),
    ]);
    // The chain above them, up to the top (for "CEO › COO › Engineering Director").
    const chain = (await query(
      `WITH RECURSIVE up(id, depth) AS (
         SELECT reports_to_user_id, 1 FROM users WHERE id = $1
         UNION ALL SELECT u.reports_to_user_id, up.depth + 1 FROM users u JOIN up ON u.id = up.id
         WHERE up.id IS NOT NULL AND up.depth < 20)
       SELECT u.id, ${NAME} AS name, u.job_title FROM up JOIN users u ON u.id = up.id ORDER BY up.depth DESC`, [id])).rows;

    res.json({
      ...person,
      reports_to: manager.rows[0] ?? null,
      direct_reports: reports.rows,
      chain,
      teams: teams.rows,
      calendar: calendar.rows[0]?.name ?? null,
    });
  } catch (e) { next(e); }
});

export default router;
