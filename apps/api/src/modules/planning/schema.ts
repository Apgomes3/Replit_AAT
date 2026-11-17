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

-- Public holiday sets (country + year, see holidays.ts) already applied, so none is re-applied.
CREATE TABLE IF NOT EXISTS planning_holiday_sets (
  set_key VARCHAR(30) PRIMARY KEY,
  calendar_id UUID REFERENCES planning_calendars(id) ON DELETE SET NULL,
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

-- Company teams. drafting_teams holds every team in the company; department groups them
-- (Drafting, Engineering, Design, Management, ...). Teams that existed before this were all
-- drafting teams, and teams created from the Drafting screen stay in Drafting.
-- A person can be in several teams.
ALTER TABLE drafting_teams ADD COLUMN IF NOT EXISTS department VARCHAR(100) NOT NULL DEFAULT 'Drafting';
CREATE INDEX IF NOT EXISTS idx_drafting_teams_department ON drafting_teams (LOWER(department));

-- Resources (the company-wide view): admins manage it, managers, HQ managers and the PMO can look,
-- everyone else is hidden until an admin opens it up in Admin > Roles.
INSERT INTO role_module_access (role_id, module_key, access_level)
SELECT r.id, 'resources', CASE WHEN r.name = 'admin' THEN 'manage' WHEN r.name IN ('manager', 'hq_manager', 'pmo') THEN 'view' ELSE 'hidden' END
FROM roles r
ON CONFLICT (role_id, module_key) DO NOTHING;

-- My Work: a person's own tasks, outside any plan, optionally tied to a project.
-- planned_hours (optional) is spread evenly over the working days from start to due.
CREATE TABLE IF NOT EXISTS planning_personal_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  notes TEXT,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'review', 'done')),
  progress_pct INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  start_date DATE,
  due_date DATE,
  planned_hours NUMERIC(6,2) CHECK (planned_hours IS NULL OR (planned_hours > 0 AND planned_hours <= 2000)),
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_planning_personal_tasks_user ON planning_personal_tasks (user_id, status);

-- Standing commitments that take part of a person's time: meetings, a role ("BD 40%"), site visits.
-- Either hours on chosen weekdays (weekdays: 0 = Monday ... 6 = Sunday) or a share of their capacity.
CREATE TABLE IF NOT EXISTS planning_commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  kind VARCHAR(20) NOT NULL DEFAULT 'meeting' CHECK (kind IN ('meeting', 'role', 'other')),
  weekdays SMALLINT[],
  hours_per_day NUMERIC(4,2) CHECK (hours_per_day IS NULL OR (hours_per_day > 0 AND hours_per_day <= 24)),
  capacity_pct INTEGER CHECK (capacity_pct IS NULL OR capacity_pct BETWEEN 1 AND 100),
  start_date DATE NOT NULL,
  end_date DATE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK ((capacity_pct IS NOT NULL AND weekdays IS NULL AND hours_per_day IS NULL)
      OR (capacity_pct IS NULL AND weekdays IS NOT NULL AND hours_per_day IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_planning_commitments_user ON planning_commitments (user_id);

-- Global plans: anyone can make a plan. drafting_plans holds every plan in the company; a plan
-- may be linked to a project, a design book or an enquiry, or stand alone, and may have no team.
--   visibility: private  = owner, shared members and task assignees
--               team     = also everyone in the plan's team
--               everyone = every signed-in user
-- Plans that existed before this were Drafting team plans: visibility 'team', owner = creator.
ALTER TABLE drafting_plans ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE drafting_plans ALTER COLUMN team_id DROP NOT NULL;
ALTER TABLE drafting_plans ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE drafting_plans ADD COLUMN IF NOT EXISTS visibility VARCHAR(10) NOT NULL DEFAULT 'team'
  CHECK (visibility IN ('private', 'team', 'everyone'));
ALTER TABLE drafting_plans ADD COLUMN IF NOT EXISTS design_book_id UUID REFERENCES design_books(id) ON DELETE SET NULL;
ALTER TABLE drafting_plans ADD COLUMN IF NOT EXISTS enquiry_id UUID REFERENCES enquiries(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_drafting_plans_owner ON drafting_plans (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_drafting_plans_design_book ON drafting_plans (design_book_id) WHERE design_book_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drafting_plans_enquiry ON drafting_plans (enquiry_id) WHERE enquiry_id IS NOT NULL;
UPDATE drafting_plans SET owner_user_id = created_by WHERE owner_user_id IS NULL AND created_by IS NOT NULL;

-- People a plan is shared with (they can see and edit it whatever its visibility).
CREATE TABLE IF NOT EXISTS planning_plan_members (
  plan_id UUID NOT NULL REFERENCES drafting_plans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (plan_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_planning_plan_members_user ON planning_plan_members (user_id);
CREATE SEQUENCE IF NOT EXISTS planning_plan_code_seq START 1;

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

-- A person's own task is for one thing at most: a project, an enquiry, a design book or (see the
-- initiatives schema) an initiative. The API keeps it to one.
ALTER TABLE planning_personal_tasks ADD COLUMN IF NOT EXISTS enquiry_id UUID REFERENCES enquiries(id) ON DELETE SET NULL;
ALTER TABLE planning_personal_tasks ADD COLUMN IF NOT EXISTS design_book_id UUID REFERENCES design_books(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_personal_tasks_enquiry ON planning_personal_tasks (enquiry_id) WHERE enquiry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_personal_tasks_design_book ON planning_personal_tasks (design_book_id) WHERE design_book_id IS NOT NULL;
`;
