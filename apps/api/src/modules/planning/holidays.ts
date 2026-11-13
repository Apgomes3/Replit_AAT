// Public holiday sets for the working calendars, loaded once each by migrate.
//
// Every set (country + year) is applied a single time and remembered in planning_holiday_sets,
// so a holiday or a whole calendar that a manager removes is not put back on the next migrate.
// To add a year, add a new set here (e.g. 'US-2028'); existing sets are never re-run.
//
// Sources:
// - China 2027: State Council General Office notice on 2027 holidays (5 Nov 2026).
//   (China 2026 is in PLANNING_SCHEMA, seeded with the default calendar.)
// - Philippines: Proclamation No. 1006 (2026), with Eid'l Fitr No. 1189 and Eid'l Adha No. 1264;
//   Proclamation No. 1427 (2027). Special non-working days are days off; special working days
//   are ordinary working days and are not listed. Eid 2027 is proclaimed later - add it then.
// - Australia: national public holidays plus King's Birthday (second Monday of June, most states),
//   with the Monday/Tuesday substitutes when Christmas or Boxing Day fall on a weekend.
//   State-only days (Labour Day, Melbourne Cup, ...) are left for the manager to add.
// - New Zealand: Holidays Act 2003 national holidays incl. Matariki (Te Kahui o Matariki Public
//   Holiday Act 2022), with Mondayised dates. Regional anniversary days are left to add.
// - United States: federal holidays (5 U.S.C. 6103) with their observed weekday.
import type { PoolClient } from 'pg';

type Db = Pick<PoolClient, 'query'>;

export type HolidayDay = [day: string, hours: number, name: string];
export type CalendarSpec = { name: string; description: string; week_hours: number[] };
export type HolidaySet = { key: string; calendar: CalendarSpec; days: HolidayDay[] };

const MON_FRI_8 = [8, 8, 8, 8, 8, 0, 0];

export const CHINA: CalendarSpec = {
  name: 'China office', description: 'Mon-Fri 9 h, Sat 8 h, Sun off; mainland China public holidays.', week_hours: [9, 9, 9, 9, 9, 8, 0],
};
export const AUSTRALIA: CalendarSpec = {
  name: 'Australia',
  description: 'Mon-Fri 7.6 h (38 h week); national public holidays and King\'s Birthday. Add your state\'s own days (Labour Day, show days).',
  week_hours: [7.6, 7.6, 7.6, 7.6, 7.6, 0, 0],
};
export const NEW_ZEALAND: CalendarSpec = {
  name: 'New Zealand', description: 'Mon-Fri 8 h; national public holidays incl. Matariki. Add your region\'s anniversary day.', week_hours: MON_FRI_8,
};
export const PHILIPPINES: CalendarSpec = {
  name: 'Philippines', description: 'Mon-Fri 8 h; regular holidays and special non-working days (presidential proclamations).', week_hours: MON_FRI_8,
};
export const UNITED_STATES: CalendarSpec = {
  name: 'United States', description: 'Mon-Fri 8 h; federal holidays on their observed weekday.', week_hours: MON_FRI_8,
};

export const HOLIDAY_SETS: HolidaySet[] = [
  {
    key: 'CN-2027', calendar: CHINA, days: [
      ['2027-01-01', 0, 'New Year'], ['2027-01-02', 0, 'New Year'], ['2027-01-03', 0, 'New Year'],
      ['2027-01-31', 9, 'Make-up working day (Spring Festival)'],
      ['2027-02-05', 0, 'Spring Festival'], ['2027-02-06', 0, 'Spring Festival'], ['2027-02-07', 0, 'Spring Festival'],
      ['2027-02-08', 0, 'Spring Festival'], ['2027-02-09', 0, 'Spring Festival'], ['2027-02-10', 0, 'Spring Festival'],
      ['2027-02-11', 0, 'Spring Festival'], ['2027-02-12', 0, 'Spring Festival'], ['2027-02-13', 0, 'Spring Festival'],
      ['2027-02-14', 9, 'Make-up working day (Spring Festival)'],
      ['2027-04-03', 0, 'Qingming Festival'], ['2027-04-04', 0, 'Qingming Festival'], ['2027-04-05', 0, 'Qingming Festival'],
      ['2027-05-01', 0, 'Labour Day'], ['2027-05-02', 0, 'Labour Day'], ['2027-05-03', 0, 'Labour Day'],
      ['2027-05-04', 0, 'Labour Day'], ['2027-05-05', 0, 'Labour Day'],
      ['2027-05-08', 9, 'Make-up working day (Labour Day)'],
      ['2027-06-09', 0, 'Dragon Boat Festival'],
      ['2027-09-15', 0, 'Mid-Autumn Festival'],
      ['2027-09-26', 9, 'Make-up working day (National Day)'],
      ['2027-10-01', 0, 'National Day'], ['2027-10-02', 0, 'National Day'], ['2027-10-03', 0, 'National Day'],
      ['2027-10-04', 0, 'National Day'], ['2027-10-05', 0, 'National Day'], ['2027-10-06', 0, 'National Day'],
      ['2027-10-07', 0, 'National Day'],
      ['2027-10-09', 9, 'Make-up working day (National Day)'],
    ],
  },
  {
    key: 'AU-2026', calendar: AUSTRALIA, days: [
      ['2026-01-01', 0, 'New Year\'s Day'], ['2026-01-26', 0, 'Australia Day'],
      ['2026-04-03', 0, 'Good Friday'], ['2026-04-06', 0, 'Easter Monday'], ['2026-04-25', 0, 'Anzac Day'],
      ['2026-06-08', 0, 'King\'s Birthday (most states)'],
      ['2026-12-25', 0, 'Christmas Day'], ['2026-12-26', 0, 'Boxing Day'], ['2026-12-28', 0, 'Boxing Day (substitute)'],
    ],
  },
  {
    key: 'AU-2027', calendar: AUSTRALIA, days: [
      ['2027-01-01', 0, 'New Year\'s Day'], ['2027-01-26', 0, 'Australia Day'],
      ['2027-03-26', 0, 'Good Friday'], ['2027-03-29', 0, 'Easter Monday'], ['2027-04-25', 0, 'Anzac Day'],
      ['2027-06-14', 0, 'King\'s Birthday (most states)'],
      ['2027-12-25', 0, 'Christmas Day'], ['2027-12-26', 0, 'Boxing Day'],
      ['2027-12-27', 0, 'Christmas Day (substitute)'], ['2027-12-28', 0, 'Boxing Day (substitute)'],
    ],
  },
  {
    key: 'NZ-2026', calendar: NEW_ZEALAND, days: [
      ['2026-01-01', 0, 'New Year\'s Day'], ['2026-01-02', 0, 'Day after New Year\'s Day'], ['2026-02-06', 0, 'Waitangi Day'],
      ['2026-04-03', 0, 'Good Friday'], ['2026-04-06', 0, 'Easter Monday'],
      ['2026-04-25', 0, 'Anzac Day'], ['2026-04-27', 0, 'Anzac Day (observed)'],
      ['2026-06-01', 0, 'King\'s Birthday'], ['2026-07-10', 0, 'Matariki'], ['2026-10-26', 0, 'Labour Day'],
      ['2026-12-25', 0, 'Christmas Day'], ['2026-12-26', 0, 'Boxing Day'], ['2026-12-28', 0, 'Boxing Day (observed)'],
    ],
  },
  {
    key: 'NZ-2027', calendar: NEW_ZEALAND, days: [
      ['2027-01-01', 0, 'New Year\'s Day'], ['2027-01-02', 0, 'Day after New Year\'s Day'],
      ['2027-01-04', 0, 'Day after New Year\'s Day (observed)'],
      ['2027-02-06', 0, 'Waitangi Day'], ['2027-02-08', 0, 'Waitangi Day (observed)'],
      ['2027-03-26', 0, 'Good Friday'], ['2027-03-29', 0, 'Easter Monday'],
      ['2027-04-25', 0, 'Anzac Day'], ['2027-04-26', 0, 'Anzac Day (observed)'],
      ['2027-06-07', 0, 'King\'s Birthday'], ['2027-06-25', 0, 'Matariki'], ['2027-10-25', 0, 'Labour Day'],
      ['2027-12-25', 0, 'Christmas Day'], ['2027-12-26', 0, 'Boxing Day'],
      ['2027-12-27', 0, 'Christmas Day (observed)'], ['2027-12-28', 0, 'Boxing Day (observed)'],
    ],
  },
  {
    key: 'PH-2026', calendar: PHILIPPINES, days: [
      ['2026-01-01', 0, 'New Year\'s Day'], ['2026-02-17', 0, 'Chinese New Year (special)'],
      ['2026-03-20', 0, 'Eid\'l Fitr'],
      ['2026-04-02', 0, 'Maundy Thursday'], ['2026-04-03', 0, 'Good Friday'], ['2026-04-04', 0, 'Black Saturday (special)'],
      ['2026-04-09', 0, 'Araw ng Kagitingan'], ['2026-05-01', 0, 'Labor Day'], ['2026-05-27', 0, 'Eid\'l Adha'],
      ['2026-06-12', 0, 'Independence Day'], ['2026-08-21', 0, 'Ninoy Aquino Day (special)'],
      ['2026-08-31', 0, 'National Heroes Day'], ['2026-11-01', 0, 'All Saints\' Day (special)'],
      ['2026-11-02', 0, 'All Souls\' Day (special)'], ['2026-11-30', 0, 'Bonifacio Day'],
      ['2026-12-08', 0, 'Immaculate Conception (special)'], ['2026-12-24', 0, 'Christmas Eve (special)'],
      ['2026-12-25', 0, 'Christmas Day'], ['2026-12-30', 0, 'Rizal Day'], ['2026-12-31', 0, 'Last Day of the Year (special)'],
    ],
  },
  {
    key: 'PH-2027', calendar: PHILIPPINES, days: [
      ['2027-01-01', 0, 'New Year\'s Day'], ['2027-02-06', 0, 'Chinese New Year (special)'],
      ['2027-03-25', 0, 'Maundy Thursday'], ['2027-03-26', 0, 'Good Friday'], ['2027-03-27', 0, 'Black Saturday (special)'],
      ['2027-04-09', 0, 'Araw ng Kagitingan'], ['2027-05-01', 0, 'Labor Day'], ['2027-06-12', 0, 'Independence Day'],
      ['2027-08-21', 0, 'Ninoy Aquino Day (special)'], ['2027-08-30', 0, 'National Heroes Day'],
      ['2027-11-01', 0, 'All Saints\' Day (special)'], ['2027-11-02', 0, 'All Souls\' Day (special)'],
      ['2027-11-30', 0, 'Bonifacio Day'], ['2027-12-08', 0, 'Immaculate Conception (special)'],
      ['2027-12-24', 0, 'Christmas Eve (special)'], ['2027-12-25', 0, 'Christmas Day'],
      ['2027-12-30', 0, 'Rizal Day'], ['2027-12-31', 0, 'Last Day of the Year (special)'],
    ],
  },
  {
    key: 'US-2026', calendar: UNITED_STATES, days: [
      ['2026-01-01', 0, 'New Year\'s Day'], ['2026-01-19', 0, 'Martin Luther King Jr. Day'],
      ['2026-02-16', 0, 'Washington\'s Birthday'], ['2026-05-25', 0, 'Memorial Day'], ['2026-06-19', 0, 'Juneteenth'],
      ['2026-07-03', 0, 'Independence Day (observed)'], ['2026-07-04', 0, 'Independence Day'],
      ['2026-09-07', 0, 'Labor Day'], ['2026-10-12', 0, 'Columbus Day'], ['2026-11-11', 0, 'Veterans Day'],
      ['2026-11-26', 0, 'Thanksgiving Day'], ['2026-12-25', 0, 'Christmas Day'],
    ],
  },
  {
    key: 'US-2027', calendar: UNITED_STATES, days: [
      ['2027-01-01', 0, 'New Year\'s Day'], ['2027-01-18', 0, 'Martin Luther King Jr. Day'],
      ['2027-02-15', 0, 'Washington\'s Birthday'], ['2027-05-31', 0, 'Memorial Day'],
      ['2027-06-18', 0, 'Juneteenth (observed)'], ['2027-06-19', 0, 'Juneteenth'],
      ['2027-07-04', 0, 'Independence Day'], ['2027-07-05', 0, 'Independence Day (observed)'],
      ['2027-09-06', 0, 'Labor Day'], ['2027-10-11', 0, 'Columbus Day'], ['2027-11-11', 0, 'Veterans Day'],
      ['2027-11-25', 0, 'Thanksgiving Day'], ['2027-12-24', 0, 'Christmas Day (observed)'], ['2027-12-25', 0, 'Christmas Day'],
      ['2027-12-31', 0, 'New Year\'s Day 2028 (observed)'],
    ],
  },
];

/**
 * Applies every holiday set not applied before. A set's calendar is found by name (China falls
 * back to the default calendar, in case it was renamed) or created. Existing exception days are
 * kept as the manager left them. Returns the keys of the sets applied now.
 */
export async function loadHolidaySets(db: Db, sets: HolidaySet[] = HOLIDAY_SETS): Promise<string[]> {
  const applied: string[] = [];
  for (const set of sets) {
    const done = await db.query(`SELECT 1 FROM planning_holiday_sets WHERE set_key = $1`, [set.key]);
    if (done.rows.length) continue;
    let calendarId: string | undefined = (await db.query(
      `SELECT id FROM planning_calendars WHERE LOWER(name) = LOWER($1)`, [set.calendar.name],
    )).rows[0]?.id;
    if (!calendarId && set.calendar === CHINA) {
      calendarId = (await db.query(`SELECT id FROM planning_calendars WHERE is_default`)).rows[0]?.id;
    }
    if (!calendarId) {
      calendarId = (await db.query(
        `INSERT INTO planning_calendars (name, description, week_hours, is_default)
         VALUES ($1, $2, $3, NOT EXISTS (SELECT 1 FROM planning_calendars WHERE is_default)) RETURNING id`,
        [set.calendar.name, set.calendar.description, set.calendar.week_hours],
      )).rows[0].id;
    }
    for (const [day, hours, name] of set.days) {
      await db.query(
        `INSERT INTO planning_calendar_days (calendar_id, day, hours, name) VALUES ($1, $2, $3, $4)
         ON CONFLICT (calendar_id, day) DO NOTHING`,
        [calendarId, day, hours, name],
      );
    }
    await db.query(`INSERT INTO planning_holiday_sets (set_key, calendar_id) VALUES ($1, $2)`, [set.key, calendarId]);
    applied.push(set.key);
  }
  return applied;
}
