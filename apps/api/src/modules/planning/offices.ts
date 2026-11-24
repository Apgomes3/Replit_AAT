// Offices: where each person works. An office has a default working calendar; giving someone an
// office (or a different one) sets their planning calendar to it. Admins manage the list.
import { query } from '../../db';

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export type Office = {
  id: string; name: string; address: string | null; time_zone: string | null;
  calendar_id: string | null; calendar_name: string | null; people: number;
};

/**
 * The starting offices, the calendar each one uses (found by name) and, where the country has a
 * single time zone, that zone. Australia and the United States have several, so are left to choose.
 */
export const STARTING_OFFICES: Array<{ name: string; calendar: string; alsoFrom?: string[]; timeZone?: string }> = [
  { name: 'China office', calendar: 'China office 08:00–17:00', alsoFrom: ['China office 08:00–18:00'], timeZone: 'Asia/Shanghai' },
  { name: 'China factory', calendar: 'China Production', timeZone: 'Asia/Shanghai' },
  { name: 'Australia', calendar: 'Australia' },
  { name: 'New Zealand', calendar: 'New Zealand', timeZone: 'Pacific/Auckland' },
  { name: 'Philippines', calendar: 'Philippines', timeZone: 'Asia/Manila' },
  { name: 'United States', calendar: 'United States' },
];

const TIME_ZONE_MARKER = 'offices-starting-time-zones';

/**
 * Adds the starting offices when there are none yet (if an admin removes every office, the next
 * migration adds them again). People who already have one of those calendars set get that office;
 * people on the default calendar are left without an office, to be chosen.
 * Returns the names added.
 */
export async function seedOffices(db: Db): Promise<string[]> {
  await fillStartingTimeZones(db);
  if ((await db.query(`SELECT 1 FROM offices LIMIT 1`)).rows.length) return [];
  const added: string[] = [];
  for (const o of STARTING_OFFICES) {
    const office = (await db.query(
      `INSERT INTO offices (name, calendar_id, time_zone)
       VALUES ($1, (SELECT id FROM planning_calendars WHERE LOWER(name) = LOWER($2)), $3) RETURNING id`,
      [o.name, o.calendar, o.timeZone ?? null],
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

/** Once: gives starting offices that were added before time zones existed their zone, if still blank. */
async function fillStartingTimeZones(db: Db): Promise<void> {
  if ((await db.query(`SELECT 1 FROM platform_migration_markers WHERE migration_key = $1`, [TIME_ZONE_MARKER])).rows.length) return;
  for (const o of STARTING_OFFICES) {
    if (o.timeZone) await db.query(`UPDATE offices SET time_zone = $2 WHERE LOWER(name) = LOWER($1) AND time_zone IS NULL`, [o.name, o.timeZone]);
  }
  await db.query(`INSERT INTO platform_migration_markers (migration_key) VALUES ($1)`, [TIME_ZONE_MARKER]);
}

/** True for an IANA time zone this server knows, e.g. "Asia/Shanghai". */
export function isTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz.includes('/') || tz === 'UTC'; } catch { return false; }
}

const SELECT = `
  SELECT o.id, o.name, o.address, o.time_zone, o.calendar_id, c.name AS calendar_name,
    (SELECT COUNT(*)::int FROM users u WHERE u.office_id = o.id AND u.is_active IS NOT FALSE) AS people
  FROM offices o LEFT JOIN planning_calendars c ON c.id = o.calendar_id`;

export async function listOffices(): Promise<Office[]> {
  return (await query(`${SELECT} ORDER BY LOWER(o.name)`)).rows;
}

export async function getOffice(id: string): Promise<Office | null> {
  return (await query(`${SELECT} WHERE o.id = $1`, [id])).rows[0] ?? null;
}

export type OfficeInput = { name: string; calendar_id: string | null; address: string | null; time_zone: string | null };

export function validateOfficeInput(body: any): { value?: OfficeInput; error?: string } {
  if (!body || typeof body !== 'object') return { error: 'Request body must be an object.' };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 100) return { error: 'name is required (at most 100 characters).' };
  const cal = body.calendar_id || null;
  if (cal !== null && (typeof cal !== 'string' || !/^[0-9a-f-]{36}$/i.test(cal))) return { error: 'calendar_id must be a calendar id or empty.' };
  if (body.address != null && typeof body.address !== 'string') return { error: 'address must be text.' };
  const address = typeof body.address === 'string' ? body.address.replace(/\r\n/g, '\n').trim() || null : null;
  if (address && address.length > 1000) return { error: 'address must be at most 1000 characters.' };
  const tz = typeof body.time_zone === 'string' ? body.time_zone.trim() || null : null;
  if (body.time_zone != null && typeof body.time_zone !== 'string') return { error: 'time_zone must be text.' };
  if (tz && !isTimeZone(tz)) return { error: `${tz} is not a time zone (use a name such as Asia/Shanghai).` };
  return { value: { name, calendar_id: cal, address, time_zone: tz } };
}

export async function saveOffice(input: OfficeInput, id?: string): Promise<Office | null> {
  const r = id
    ? await query(`UPDATE offices SET name = $2, calendar_id = $3, address = $4, time_zone = $5, updated_at = NOW() WHERE id = $1 RETURNING id`,
      [id, input.name, input.calendar_id, input.address, input.time_zone])
    : await query(`INSERT INTO offices (name, calendar_id, address, time_zone) VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.name, input.calendar_id, input.address, input.time_zone]);
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
