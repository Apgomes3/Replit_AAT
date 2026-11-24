// Departments: the company's departments, managed on Admin -> Departments. A department has a head,
// an optional parent (Design and Drafting sit under Engineering), a colour and short code, and the
// menu areas its people see open by default. People hold its key (users.department); company teams
// hold its name (drafting_teams.department). Foreign keys keep both in step with this table.
import { query } from '../../db';

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/** Menu areas a department can open by default (the ids of the left menu's areas). */
export const NAV_AREAS = ['business-development', 'procurement', 'engineering', 'management', 'logistics', 'factory'] as const;
export const COLOURS = ['slate', 'blue', 'sky', 'indigo', 'violet', 'emerald', 'amber', 'orange', 'rose', 'teal'] as const;
/** The Drafting screen finds its teams by this department's name, so it cannot be renamed. */
export const DRAFTING_KEY = 'drafting';

type Starting = { key: string; name: string; code: string; colour: string; nav: string[] | null; parent?: string; description?: string };
export const STARTING_DEPARTMENTS: Starting[] = [
  { key: 'engineering', name: 'Engineering', code: 'ENG', colour: 'blue', nav: ['engineering'] },
  { key: 'design', name: 'Design', code: 'DES', colour: 'indigo', nav: ['engineering'], parent: 'engineering' },
  { key: 'drafting', name: 'Drafting', code: 'DRF', colour: 'sky', nav: ['engineering'], parent: 'engineering' },
  { key: 'business_development', name: 'Business Development', code: 'BD', colour: 'emerald', nav: ['business-development'], description: 'Sales, enquiries and bids.' },
  { key: 'procurement', name: 'Procurement', code: 'PRC', colour: 'amber', nav: ['procurement'] },
  { key: 'management', name: 'Management', code: 'MGT', colour: 'violet', nav: null },
  { key: 'logistics', name: 'Logistics', code: 'LOG', colour: 'orange', nav: ['logistics'] },
  { key: 'factory', name: 'Factory production', code: 'FAC', colour: 'rose', nav: ['factory'] },
];

/** "Business Development" -> "business_development" (at most 40 characters). */
export function slugKey(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'department';
}

const titleCase = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/**
 * Makes sure every department in use exists, then ties people and teams to this table.
 * First run: adds the starting departments. Every run: adds a department for any value still in
 * use without one (a person's key, or a team's department name), matches team names to the
 * department's exact spelling, and adds the foreign keys once. Returns the names added.
 */
export async function seedDepartments(db: Db): Promise<string[]> {
  const added: string[] = [];
  if (!(await db.query(`SELECT 1 FROM departments LIMIT 1`)).rows.length) {
    for (const d of STARTING_DEPARTMENTS) {
      await db.query(
        `INSERT INTO departments (key, name, code, colour, nav_areas, description) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [d.key, d.name, d.code, d.colour, d.nav, d.description ?? null],
      );
      added.push(d.name);
    }
    for (const d of STARTING_DEPARTMENTS.filter(x => x.parent)) {
      await db.query(`UPDATE departments SET parent_id = (SELECT id FROM departments WHERE key = $2) WHERE key = $1`, [d.key, d.parent]);
    }
  }
  // People whose department key has no department yet.
  for (const r of (await db.query(
    `SELECT DISTINCT u.department FROM users u WHERE u.department IS NOT NULL AND NOT EXISTS (SELECT 1 FROM departments d WHERE d.key = u.department)`,
  )).rows) {
    const name = titleCase(r.department);
    const clash = (await db.query(`SELECT key FROM departments WHERE LOWER(name) = LOWER($1)`, [name])).rows[0];
    if (clash) { await db.query(`UPDATE users SET department = $1 WHERE department = $2`, [clash.key, r.department]); continue; }
    await db.query(`INSERT INTO departments (key, name) VALUES ($1, $2)`, [r.department, name]);
    added.push(name);
  }
  // Teams whose department name has no department yet.
  for (const r of (await db.query(
    `SELECT DISTINCT ON (LOWER(t.department)) t.department FROM drafting_teams t
     WHERE NOT EXISTS (SELECT 1 FROM departments d WHERE LOWER(d.name) = LOWER(t.department))`,
  )).rows) {
    let key = slugKey(r.department);
    while ((await db.query(`SELECT 1 FROM departments WHERE key = $1`, [key])).rows.length) key = `${key.slice(0, 37)}_${Math.floor(Math.random() * 90 + 10)}`;
    await db.query(`INSERT INTO departments (key, name) VALUES ($1, $2)`, [key, r.department]);
    added.push(r.department);
  }
  await db.query(`UPDATE drafting_teams t SET department = d.name FROM departments d WHERE LOWER(d.name) = LOWER(t.department) AND t.department <> d.name`);
  await db.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_department_fk') THEN
        ALTER TABLE users ADD CONSTRAINT users_department_fk FOREIGN KEY (department) REFERENCES departments(key) ON UPDATE CASCADE ON DELETE SET NULL;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drafting_teams_department_fk') THEN
        ALTER TABLE drafting_teams ADD CONSTRAINT drafting_teams_department_fk FOREIGN KEY (department) REFERENCES departments(name) ON UPDATE CASCADE;
      END IF;
    END $$;`);
  return added;
}

export type Department = {
  id: string; key: string; name: string; code: string | null; colour: string; description: string | null;
  head_user_id: string | null; head_name: string | null; parent_id: string | null; parent_name: string | null;
  nav_areas: string[] | null; is_active: boolean; people: number;
  teams: Array<{ id: string; name: string; active: boolean; manager_name: string | null; members: number }>;
};
/** What every signed-in user may read: enough for pickers and menus. */
export type DepartmentOption = { id: string; key: string; name: string; parent_id: string | null; colour: string; is_active: boolean };

const NAME = (a: string) => `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ${a}.first_name, ${a}.last_name)), ''), ${a}.email)`;
const SELECT = `
  SELECT d.id, d.key, d.name, d.code, d.colour, d.description, d.head_user_id, ${NAME('h')} AS head_name,
    d.parent_id, p.name AS parent_name, d.nav_areas, d.is_active,
    (SELECT COUNT(*)::int FROM users u WHERE u.department = d.key AND u.is_active IS NOT FALSE) AS people,
    COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'active', t.active,
        'manager_name', (SELECT ${NAME('m')} FROM users m WHERE m.id = t.manager_user_id),
        'members', (SELECT COUNT(*)::int FROM drafting_team_members tm WHERE tm.team_id = t.id))
      ORDER BY t.active DESC, LOWER(t.name)) FROM drafting_teams t WHERE t.department = d.name), '[]'::json) AS teams
  FROM departments d
  LEFT JOIN users h ON h.id = d.head_user_id
  LEFT JOIN departments p ON p.id = d.parent_id`;

export async function listDepartments(): Promise<Department[]> {
  return (await query(`${SELECT} ORDER BY d.is_active DESC, LOWER(d.name)`)).rows;
}

export async function getDepartment(id: string): Promise<Department | null> {
  return (await query(`${SELECT} WHERE d.id = $1`, [id])).rows[0] ?? null;
}

export async function listDepartmentOptions(): Promise<DepartmentOption[]> {
  return (await query(`SELECT id, key, name, parent_id, colour, is_active FROM departments ORDER BY LOWER(name)`)).rows;
}

/** The department with this name or key (any case), or null. */
export async function findDepartment(nameOrKey: string, db: Db = { query }): Promise<{ id: string; key: string; name: string; is_active: boolean } | null> {
  return (await db.query(
    `SELECT id, key, name, is_active FROM departments WHERE LOWER(name) = LOWER($1) OR key = LOWER($1) ORDER BY (LOWER(name) = LOWER($1)) DESC LIMIT 1`,
    [nameOrKey.trim()],
  )).rows[0] ?? null;
}

export type DepartmentInput = {
  name: string; code: string | null; colour: string; description: string | null;
  head_user_id: string | null; parent_id: string | null; nav_areas: string[] | null; is_active: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateDepartmentInput(body: any): { value?: DepartmentInput; error?: string } {
  if (!body || typeof body !== 'object') return { error: 'Request body must be an object.' };
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > 100) return { error: 'name is required (at most 100 characters).' };
  if (body.code != null && typeof body.code !== 'string') return { error: 'code must be text.' };
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() || null : null;
  if (code && code.length > 10) return { error: 'code must be at most 10 characters.' };
  const colour = body.colour == null || body.colour === '' ? 'slate' : body.colour;
  if (!(COLOURS as readonly string[]).includes(colour)) return { error: `colour must be one of: ${COLOURS.join(', ')}.` };
  if (body.description != null && typeof body.description !== 'string') return { error: 'description must be text.' };
  const description = typeof body.description === 'string' ? body.description.trim() || null : null;
  if (description && description.length > 1000) return { error: 'description must be at most 1000 characters.' };
  const head = body.head_user_id || null;
  if (head !== null && (typeof head !== 'string' || !UUID.test(head))) return { error: 'head_user_id must be a person id or empty.' };
  const parent = body.parent_id || null;
  if (parent !== null && (typeof parent !== 'string' || !UUID.test(parent))) return { error: 'parent_id must be a department id or empty.' };
  let nav: string[] | null = null;
  if (body.nav_areas != null) {
    if (!Array.isArray(body.nav_areas) || body.nav_areas.some((a: unknown) => !(NAV_AREAS as readonly unknown[]).includes(a))) {
      return { error: `nav_areas must be a list of: ${NAV_AREAS.join(', ')} (or empty for every area).` };
    }
    nav = NAV_AREAS.filter(a => body.nav_areas.includes(a));
  }
  if (body.is_active != null && typeof body.is_active !== 'boolean') return { error: 'is_active must be true or false.' };
  return { value: { name, code, colour, description, head_user_id: head, parent_id: parent, nav_areas: nav, is_active: body.is_active ?? true } };
}

export class DepartmentError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Adds or updates a department. Refuses a parent that would make a loop, and renaming Drafting. */
export async function saveDepartment(input: DepartmentInput, id?: string): Promise<Department> {
  if (input.parent_id) {
    const parent = (await query(`SELECT id FROM departments WHERE id = $1`, [input.parent_id])).rows[0];
    if (!parent) throw new DepartmentError(400, 'That parent department no longer exists.');
    if (id) {
      const loop = (await query(
        `WITH RECURSIVE up(id) AS (SELECT $1::uuid UNION ALL SELECT d.parent_id FROM departments d JOIN up ON d.id = up.id WHERE d.parent_id IS NOT NULL)
         SELECT 1 FROM up WHERE id = $2`, [input.parent_id, id])).rows.length;
      if (loop) throw new DepartmentError(400, 'A department cannot sit under itself or one of its own sub-departments.');
    }
  }
  if (input.head_user_id && !(await query(`SELECT 1 FROM users WHERE id = $1`, [input.head_user_id])).rows.length) {
    throw new DepartmentError(400, 'That person no longer exists.');
  }
  const values = [input.name, input.code, input.colour, input.description, input.head_user_id, input.parent_id, input.nav_areas, input.is_active];
  let savedId: string;
  if (id) {
    const before = (await query(`SELECT key, name FROM departments WHERE id = $1`, [id])).rows[0];
    if (!before) throw new DepartmentError(404, 'Department not found.');
    if (before.key === DRAFTING_KEY && before.name !== input.name) {
      throw new DepartmentError(400, 'Drafting cannot be renamed: the Drafting screen finds its teams by this name.');
    }
    if (before.key === DRAFTING_KEY && !input.is_active) throw new DepartmentError(400, 'Drafting cannot be archived: the Drafting screen uses it.');
    await query(
      `UPDATE departments SET name = $1, code = $2, colour = $3, description = $4, head_user_id = $5, parent_id = $6,
         nav_areas = $7, is_active = $8, updated_at = NOW() WHERE id = $9`, [...values, id]);
    savedId = id;
  } else {
    let key = slugKey(input.name);
    while ((await query(`SELECT 1 FROM departments WHERE key = $1`, [key])).rows.length) key = `${key.slice(0, 37)}_${Math.floor(Math.random() * 90 + 10)}`;
    savedId = (await query(
      `INSERT INTO departments (name, code, colour, description, head_user_id, parent_id, nav_areas, is_active, key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, [...values, key])).rows[0].id;
  }
  return (await getDepartment(savedId))!;
}

/**
 * Removes a department that nobody uses. One that still has people (active or blocked), teams or
 * sub-departments is refused: archive it instead.
 */
export async function deleteDepartment(id: string): Promise<Department> {
  const d = await getDepartment(id);
  if (!d) throw new DepartmentError(404, 'Department not found.');
  if (d.key === DRAFTING_KEY) throw new DepartmentError(400, 'Drafting cannot be removed: the Drafting screen uses it.');
  const used = (await query(
    `SELECT (SELECT COUNT(*) FROM users WHERE department = $1)::int AS people,
            (SELECT COUNT(*) FROM drafting_teams WHERE department = $2)::int AS teams,
            (SELECT COUNT(*) FROM departments WHERE parent_id = $3)::int AS children`, [d.key, d.name, d.id])).rows[0];
  const parts = [
    used.people ? `${used.people} ${used.people === 1 ? 'person' : 'people'}` : null,
    used.teams ? `${used.teams} ${used.teams === 1 ? 'team' : 'teams'}` : null,
    used.children ? `${used.children} sub-${used.children === 1 ? 'department' : 'departments'}` : null,
  ].filter(Boolean);
  if (parts.length) throw new DepartmentError(409, `${d.name} still has ${parts.join(', ')}. Move them first, or archive the department.`);
  await query(`DELETE FROM departments WHERE id = $1`, [id]);
  return d;
}

/**
 * What the app needs at sign-in about the person's department: its name and the menu areas it
 * opens (null = every area). No department, or an unknown one, opens every area.
 */
export async function departmentForUser(key: string | null | undefined): Promise<{ department_name: string | null; department_areas: string[] | null }> {
  if (!key) return { department_name: null, department_areas: null };
  const d = (await query(`SELECT name, nav_areas FROM departments WHERE key = $1`, [key])).rows[0];
  return { department_name: d?.name ?? null, department_areas: d?.nav_areas ?? null };
}
