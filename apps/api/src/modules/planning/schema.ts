// Shared planning engine: working calendars, people (resources), leave, and the scheduling
// fields on plans/tasks. Drafting is the first user; Project Management will reuse it.
// Applied after the drafting schema (it extends drafting tables).
export const PLANNING_SCHEMA = `
-- Working calendars. week_hours = hours per weekday, Monday first (0 = not a working day).
CREATE TABLE IF NOT EXISTS planning_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  description TEXT,
  week_hours NUMERIC(4,2)[] NOT NULL DEFAULT '{9,9,9,9,9,8,0}',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (array_length(week_hours, 1) = 7)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_planning_calendars_name ON planning_calendars (LOWER(name));
CREATE UNIQUE INDEX IF NOT EXISTS uq_planning_calendars_default ON planning_calendars (is_default) WHERE is_default;

-- Exceptions to the working week: public holidays (hours = 0) and make-up working days (hours > 0).
CREATE TABLE IF NOT EXISTS planning_calendar_days (
  calendar_id UUID NOT NULL REFERENCES planning_calendars(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  hours NUMERIC(4,2) NOT NULL CHECK (hours >= 0 AND hours <= 24),
  name VARCHAR(120),
  PRIMARY KEY (calendar_id, day)
);

-- A person's planning settings. No row = default calendar at 100%.
CREATE TABLE IF NOT EXISTS planning_resources (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  calendar_id UUID REFERENCES planning_calendars(id) ON DELETE SET NULL,
  capacity_pct INTEGER NOT NULL DEFAULT 100 CHECK (capacity_pct BETWEEN 0 AND 100),
  notes TEXT,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Leave and other absence. hours_per_day NULL = whole days off.
CREATE TABLE IF NOT EXISTS planning_leave (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  hours_per_day NUMERIC(4,2) CHECK (hours_per_day IS NULL OR (hours_per_day > 0 AND hours_per_day <= 24)),
  reason VARCHAR(200),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_planning_leave_user ON planning_leave (user_id, start_date);

-- Scheduling fields on plans and tasks.
ALTER TABLE drafting_plans ADD COLUMN IF NOT EXISTS calendar_id UUID REFERENCES planning_calendars(id) ON DELETE SET NULL;
ALTER TABLE drafting_plans ADD COLUMN IF NOT EXISTS auto_schedule BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE drafting_plans ADD COLUMN IF NOT EXISTS baseline_set_at TIMESTAMPTZ;
ALTER TABLE drafting_tasks ADD COLUMN IF NOT EXISTS progress_pct INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100);
ALTER TABLE drafting_tasks ADD COLUMN IF NOT EXISTS is_milestone BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE drafting_tasks ADD COLUMN IF NOT EXISTS baseline_start DATE;
ALTER TABLE drafting_tasks ADD COLUMN IF NOT EXISTS baseline_due DATE;
ALTER TABLE drafting_task_assignees ADD COLUMN IF NOT EXISTS allocation_pct INTEGER NOT NULL DEFAULT 100 CHECK (allocation_pct BETWEEN 1 AND 100);

-- Finished tasks are 100% complete.
UPDATE drafting_tasks SET progress_pct = 100 WHERE status = 'done' AND progress_pct <> 100;

-- First run only: the default calendar (China office, Mon-Fri 9 h, Sat 8 h) with the 2026
-- mainland China public holidays and the Sunday make-up working days (State Council notice).
-- Nothing is re-added later, so holidays a manager removes stay removed.
WITH cal AS (
  INSERT INTO planning_calendars (name, description, week_hours, is_default)
  SELECT 'China office', 'Mon-Fri 9 h, Sat 8 h, Sun off; mainland China public holidays.', '{9,9,9,9,9,8,0}', true
  WHERE NOT EXISTS (SELECT 1 FROM planning_calendars)
  RETURNING id
)
INSERT INTO planning_calendar_days (calendar_id, day, hours, name)
SELECT cal.id, d.day::date, d.hours, d.name FROM cal, (VALUES
  ('2026-01-01', 0, 'New Year'), ('2026-01-02', 0, 'New Year'), ('2026-01-03', 0, 'New Year'),
  ('2026-01-04', 9, 'Make-up working day (New Year)'),
  ('2026-02-15', 0, 'Spring Festival'), ('2026-02-16', 0, 'Spring Festival'), ('2026-02-17', 0, 'Spring Festival'),
  ('2026-02-18', 0, 'Spring Festival'), ('2026-02-19', 0, 'Spring Festival'), ('2026-02-20', 0, 'Spring Festival'),
  ('2026-02-21', 0, 'Spring Festival'), ('2026-02-22', 0, 'Spring Festival'), ('2026-02-23', 0, 'Spring Festival'),
  ('2026-04-04', 0, 'Qingming Festival'), ('2026-04-05', 0, 'Qingming Festival'), ('2026-04-06', 0, 'Qingming Festival'),
  ('2026-05-01', 0, 'Labour Day'), ('2026-05-02', 0, 'Labour Day'), ('2026-05-03', 0, 'Labour Day'),
  ('2026-05-04', 0, 'Labour Day'), ('2026-05-05', 0, 'Labour Day'),
  ('2026-06-19', 0, 'Dragon Boat Festival'), ('2026-06-20', 0, 'Dragon Boat Festival'), ('2026-06-21', 0, 'Dragon Boat Festival'),
  ('2026-09-20', 9, 'Make-up working day (National Day)'),
  ('2026-09-25', 0, 'Mid-Autumn Festival'), ('2026-09-26', 0, 'Mid-Autumn Festival'), ('2026-09-27', 0, 'Mid-Autumn Festival'),
  ('2026-10-01', 0, 'National Day'), ('2026-10-02', 0, 'National Day'), ('2026-10-03', 0, 'National Day'),
  ('2026-10-04', 0, 'National Day'), ('2026-10-05', 0, 'National Day'), ('2026-10-06', 0, 'National Day'),
  ('2026-10-07', 0, 'National Day')
) AS d(day, hours, name);
`;
