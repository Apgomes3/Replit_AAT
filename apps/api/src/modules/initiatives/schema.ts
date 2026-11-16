// Initiatives: internal work that is not a client project (new products, process improvements,
// standards, IT, training…). Light structure: owner, sponsor, stage, hours and costs. Client
// projects stay in `projects`. See docs/internal-work-and-knowledge-proposal.md.
export const INITIATIVES_SCHEMA = `
CREATE TABLE IF NOT EXISTS initiatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(30) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL CHECK (BTRIM(title) <> ''),
  goal TEXT,
  description TEXT,
  type VARCHAR(40) NOT NULL DEFAULT 'process_improvement' CHECK (type IN
    ('product_development','process_improvement','standards_knowledge','it_tools','training','facility','sales_marketing','other')),
  stage VARCHAR(20) NOT NULL DEFAULT 'idea' CHECK (stage IN ('idea','approved','in_progress','on_hold','done','dropped')),
  priority VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sponsor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  team_id UUID REFERENCES drafting_teams(id) ON DELETE SET NULL,
  start_date DATE,
  target_date DATE,
  completed_at TIMESTAMPTZ,
  estimated_hours NUMERIC(8,2) CHECK (estimated_hours IS NULL OR estimated_hours >= 0),
  budget_amount NUMERIC(14,2) CHECK (budget_amount IS NULL OR budget_amount >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  outcome TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT initiatives_dates CHECK (target_date IS NULL OR start_date IS NULL OR target_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_initiatives_stage ON initiatives(stage);
CREATE INDEX IF NOT EXISTS idx_initiatives_owner ON initiatives(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_initiatives_sponsor ON initiatives(sponsor_user_id);

-- Every stage change, with who did it and why.
CREATE TABLE IF NOT EXISTS initiative_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
  from_stage VARCHAR(20),
  to_stage VARCHAR(20) NOT NULL,
  note TEXT,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_initiative_events ON initiative_events(initiative_id, created_at);

-- Hours actually spent, logged by the person who did them.
CREATE TABLE IF NOT EXISTS initiative_time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  hours NUMERIC(5,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_initiative_time ON initiative_time_entries(initiative_id, work_date);
CREATE INDEX IF NOT EXISTS idx_initiative_time_user ON initiative_time_entries(user_id, work_date);

-- Money spent: materials, external services, travel, equipment… (labour is the hours above).
CREATE TABLE IF NOT EXISTS initiative_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
  cost_date DATE NOT NULL DEFAULT CURRENT_DATE,
  category VARCHAR(30) NOT NULL DEFAULT 'other' CHECK (category IN ('materials','external_services','equipment','travel','software','training','other')),
  description VARCHAR(255) NOT NULL CHECK (BTRIM(description) <> ''),
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  supplier_client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_initiative_costs ON initiative_costs(initiative_id, cost_date);

-- What it produced or relates to: products, product families, documents, projects, clients.
CREATE TABLE IF NOT EXISTS initiative_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
  entity_type VARCHAR(30) NOT NULL CHECK (entity_type IN ('product','product_family','document','project','client')),
  entity_id UUID NOT NULL,
  note TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (initiative_id, entity_type, entity_id)
);

-- A plan (the global planner) can be for an initiative, as it can be for a project or enquiry.
ALTER TABLE drafting_plans ADD COLUMN IF NOT EXISTS initiative_id UUID REFERENCES initiatives(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_drafting_plans_initiative ON drafting_plans (initiative_id) WHERE initiative_id IS NOT NULL;

-- A person's own task can belong to an initiative (as it can to a project).
ALTER TABLE planning_personal_tasks ADD COLUMN IF NOT EXISTS initiative_id UUID REFERENCES initiatives(id) ON DELETE SET NULL;

-- Initiatives module: everyone can look and propose ideas; admins, managers, HQ managers and the PMO manage.
INSERT INTO role_module_access (role_id, module_key, access_level)
SELECT r.id, 'initiatives', CASE WHEN r.name IN ('admin', 'manager', 'hq_manager', 'pmo') THEN 'manage' ELSE 'view' END
FROM roles r
ON CONFLICT (role_id, module_key) DO NOTHING;
`;
