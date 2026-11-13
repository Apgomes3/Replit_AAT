// Drafting module tables. Run by db/migrate.ts after the core schema.
// Every statement is idempotent so it is safe on every migrate run.
//
// v1 scope: teams (a manager + drafters) and plans (a body of drafting work
// for one project, owned by one team). Task groups and tasks come next and
// will hang off drafting_plans.

export const DRAFTING_SCHEMA = `
CREATE TABLE IF NOT EXISTS drafting_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(150) NOT NULL,
  description TEXT,
  manager_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_drafting_teams_name ON drafting_teams (LOWER(name));

CREATE TABLE IF NOT EXISTS drafting_team_members (
  team_id UUID NOT NULL REFERENCES drafting_teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_drafting_team_members_user ON drafting_team_members (user_id);

CREATE SEQUENCE IF NOT EXISTS drafting_plan_code_seq START 1;

CREATE TABLE IF NOT EXISTS drafting_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  team_id UUID NOT NULL REFERENCES drafting_teams(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('planning', 'active', 'on_hold', 'completed', 'archived')),
  start_date DATE,
  target_date DATE,
  description TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (target_date IS NULL OR start_date IS NULL OR target_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_drafting_plans_project ON drafting_plans (project_id);
CREATE INDEX IF NOT EXISTS idx_drafting_plans_team ON drafting_plans (team_id);

-- D.2: optional groups inside a plan, and tasks.
CREATE TABLE IF NOT EXISTS drafting_task_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES drafting_plans(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_drafting_task_groups_plan ON drafting_task_groups (plan_id, sort_order);

CREATE TABLE IF NOT EXISTS drafting_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES drafting_plans(id) ON DELETE CASCADE,
  -- Deleting a group keeps its tasks (they become ungrouped).
  group_id UUID REFERENCES drafting_task_groups(id) ON DELETE SET NULL,
  title VARCHAR(500) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'review', 'done')),
  priority VARCHAR(20) NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('urgent', 'important', 'medium', 'low')),
  start_date DATE,
  due_date DATE,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_drafting_tasks_plan ON drafting_tasks (plan_id, group_id, sort_order);

CREATE TABLE IF NOT EXISTS drafting_task_assignees (
  task_id UUID NOT NULL REFERENCES drafting_tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_drafting_task_assignees_user ON drafting_task_assignees (user_id);

-- D.3: links between tasks ("successor waits for predecessor"), MS Project style.
-- FS = start after the predecessor finishes, SS = start together, FF = finish together,
-- SF = finish once the predecessor starts. lag_days shifts the constraint (negative = overlap).
-- Links may cross plans. Cycles are refused in the repository.
CREATE TABLE IF NOT EXISTS drafting_task_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  predecessor_id UUID NOT NULL REFERENCES drafting_tasks(id) ON DELETE CASCADE,
  successor_id UUID NOT NULL REFERENCES drafting_tasks(id) ON DELETE CASCADE,
  link_type VARCHAR(2) NOT NULL DEFAULT 'FS' CHECK (link_type IN ('FS', 'SS', 'FF', 'SF')),
  lag_days INTEGER NOT NULL DEFAULT 0 CHECK (lag_days BETWEEN -365 AND 365),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (predecessor_id <> successor_id),
  UNIQUE (predecessor_id, successor_id)
);
CREATE INDEX IF NOT EXISTS idx_drafting_task_links_successor ON drafting_task_links (successor_id);

-- Module visibility: viewers can look, every other role can manage.
-- Admins can change this per role in Admin > Roles.
INSERT INTO role_module_access (role_id, module_key, access_level)
SELECT r.id, 'drafting', CASE WHEN r.name = 'viewer' THEN 'view' ELSE 'manage' END
FROM roles r
ON CONFLICT (role_id, module_key) DO NOTHING;
`;
