// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { HOLIDAY_SETS } from './holidays';

const weekday = (iso: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${iso}T00:00:00Z`).getUTCDay()];
const day = (key: string, name: string) => HOLIDAY_SETS.find(s => s.key === key)!.days.find(d => d[2] === name)![0];

describe('public holiday sets', () => {
  it('has unique keys, real dates in the set\'s year and no duplicate days', () => {
    expect(new Set(HOLIDAY_SETS.map(s => s.key)).size).toBe(HOLIDAY_SETS.length);
    for (const set of HOLIDAY_SETS) {
      const year = set.key.slice(-4);
      const days = set.days.map(d => d[0]);
      expect(new Set(days).size, set.key).toBe(days.length);
      for (const [iso, hours] of set.days) {
        expect(new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10), iso).toBe(iso);
        expect(iso.startsWith(year), `${set.key} ${iso}`).toBe(true);
        expect(hours).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('puts observed and substitute days on weekdays, and make-up working days on weekends', () => {
    for (const set of HOLIDAY_SETS) {
      for (const [iso, hours, name] of set.days) {
        if (/observed|substitute/.test(name)) expect(['Sat', 'Sun'], `${set.key} ${name}`).not.toContain(weekday(iso));
        if (hours > 0) expect(['Sat', 'Sun'], `${set.key} ${name}`).toContain(weekday(iso));
      }
    }
  });

  it('follows the weekday rules for rule-based holidays', () => {
    expect(weekday(day('US-2026', 'Thanksgiving Day'))).toBe('Thu');
    expect(weekday(day('US-2027', 'Thanksgiving Day'))).toBe('Thu');
    for (const key of ['US-2026', 'US-2027']) {
      for (const name of ['Martin Luther King Jr. Day', 'Washington\'s Birthday', 'Memorial Day', 'Labor Day', 'Columbus Day']) {
        expect(weekday(day(key, name)), `${key} ${name}`).toBe('Mon');
      }
    }
    // Memorial Day is the last Monday of May; Labour Day (NZ) the fourth Monday of October.
    expect(day('US-2027', 'Memorial Day')).toBe('2027-05-31');
    expect(day('NZ-2026', 'Labour Day')).toBe('2026-10-26');
    expect(weekday(day('AU-2027', 'King\'s Birthday (most states)'))).toBe('Mon');
    expect(weekday(day('NZ-2027', 'King\'s Birthday'))).toBe('Mon');
    // Easter: Good Friday is a Friday and Easter Monday three days later.
    for (const key of ['AU-2026', 'AU-2027', 'NZ-2026', 'NZ-2027']) {
      expect(weekday(day(key, 'Good Friday'))).toBe('Fri');
      expect(weekday(day(key, 'Easter Monday'))).toBe('Mon');
    }
  });

  it('has the 2027 mainland China schedule from the State Council notice', () => {
    const cn = HOLIDAY_SETS.find(s => s.key === 'CN-2027')!;
    // 3 + 9 + 3 + 5 + 1 + 1 + 7 days off across the seven holiday periods.
    expect(cn.days.filter(d => d[1] === 0)).toHaveLength(29);
    expect(cn.days.filter(d => d[1] > 0).map(d => d[0])).toEqual(['2027-01-31', '2027-02-14', '2027-05-08', '2027-09-26', '2027-10-09']);
  });
});
