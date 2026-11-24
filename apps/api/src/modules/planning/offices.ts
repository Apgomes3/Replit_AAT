// Offices: where each person works. An office has a default working calendar; giving someone an
// office (or a different one) sets their planning calendar to it. Admins manage the list.
import { query } from '../../db';

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export type Office = { id: string; name: string; calendar_id: string | null; calendar_name: string | null; people: number };

/** The starting offices and the calendar each one uses (found by name). */
export const STARTING_OFFICES: Array<{ name: string; calendar: string; alsoFrom?: string[] }> = [
  { name: 'China office', calendar: 'China office 08:00–17:00', alsoFrom: ['China office 08:00–18:00'] },
  { name: 'China factory', calendar: 'China Production' },
  { name: 'Australia', calendar: 'Australia' },
  { name: 'New Zealand', calendar: 'New Zealand' },
  { name: 'Philippines', calendar: 'Philippines' },
  { name: 'United States', calendar: 'United States' },
];

/**
 * Adds the starting offices when there are none yet (if an admin removes every office, the next
 * migration adds them again). People who already have one of those calendars set get that office;
 * people on the default calendar are left without an office, to be chosen.
 * Returns the names added.
 */
export async function seedOffices(db: Db): Promise<string[]> {
  if ((await db.query(`SELECT 1 FROM offices LIMIT 1`)).rows.length) return [];
  const added: string[] = [];
  for (const o of STARTING_OFFICES) {
    const office = (await db.query(
      `INSERT INTO offices (name, calendar_id)
       VALUES ($1, (SELECT id FROM planning_calendars WHERE LOWER(name) = LOWER($2))) RETURNING id`,
      [o.name, o.calendar],
    )).rows[0];
    await db.query(
      `UPDATE users u SET office_id = $1
       FROM planning_resources r JOIN planning_calendars c ON c.id = r.calendar_id
       WHERE r.user_id = u.id AND u.office_id IS NULL AND LOWER(c.name) = ANY($2::text[])`,
      [office.id, [o.calendar, ...(o.alsoFrom ?? [])].map(n => n.toLowerCase())],
    );
    added.push(o.name);
  }
  return added;
}

const SELECT = `
  SELECT o.id, o.name, o.calendar_id, c.name AS calendar_name,
    (SELECT COUNT(*)::int FROM users u WHERE u.office_id = o.id AND u.is_active IS NOT FALSE) AS people
  FROM offices o LEFT JOIN planning_calendars c ON c.id = o.calendar_id`;

export async function listOffices(): Promise<Office[]> {
  return (await query(`${SELECT} ORDER BY LOWER(o.name)`)).rows;
}

export async function getOffice(id: string): Promise<Office | null> {
  return (await query(`${SELECT} WHERE o.id = $1`, [id])).rows[0] ?? null;
}

export type OfficeInput = { name: string; calendar_id: string | null };

export function validateOfficeInput(body: any): { value?: OfficeInput; error?: string } {
  if (!body || typeof body !== 'object') return { error: 'Request body must be an object.' };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 100) return { error: 'name is required (at most 100 characters).' };
  const cal = body.calendar_id || null;
  if (cal !== null && (typeof cal !== 'string' || !/^[0-9a-f-]{36}$/i.test(cal))) return { error: 'calendar_id must be a calendar id or empty.' };
  return { value: { name, calendar_id: cal } };
}

export async function saveOffice(input: OfficeInput, id?: string): Promise<Office | null> {
  const r = id
    ? await query(`UPDATE offices SET name = $2, calendar_id = $3, updated_at = NOW() WHERE id = $1 RETURNING id`, [id, input.name, input.calendar_id])
    : await query(`INSERT INTO offices (name, calendar_id) VALUES ($1, $2) RETURNING id`, [input.name, input.calendar_id]);
  return r.rows[0] ? getOffice(r.rows[0].id) : null;
}

/** Removing an office leaves its people without one (their calendars stay as they are). */
export async function deleteOffice(id: string): Promise<boolean> {
  return ((await query(`DELETE FROM offices WHERE id = $1`, [id])).rowCount ?? 0) > 0;
}

/**
 * Gives a person an office (or none). When the office changes to one with a calendar, their
 * planning calendar becomes that calendar. Returns false when the office does not exist.
 */
export async function setUserOffice(
  userId: string, officeId: string | null, actorId: string, db: Db = { query },
): Promise<{ ok: boolean; calendarChanged: boolean }> {
  const before = (await db.query(`SELECT office_id FROM users WHERE id = $1`, [userId])).rows[0];
  if (!before) return { ok: false, calendarChanged: false };
  if (before.office_id === officeId) return { ok: true, calendarChanged: false };
  let calendarId: string | null = null;
  if (officeId) {
    const office = (await db.query(`SELECT calendar_id FROM offices WHERE id = $1`, [officeId])).rows[0];
    if (!office) return { ok: false, calendarChanged: false };
    calendarId = office.calendar_id;
  }
  await db.query(`UPDATE users SET office_id = $2, updated_at = NOW() WHERE id = $1`, [userId, officeId]);
  if (!calendarId) return { ok: true, calendarChanged: false };
  await db.query(
    `INSERT INTO planning_resources (user_id, calendar_id, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET calendar_id = EXCLUDED.calendar_id, updated_by = $3, updated_at = NOW()`,
    [userId, calendarId, actorId],
  );
  return { ok: true, calendarChanged: true };
}
