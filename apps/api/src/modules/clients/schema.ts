// Client directory: one list of companies (clients, consultants, contractors, partners, suppliers)
// and their people, shared by every module. The tables themselves (clients, client_contacts) are
// created by the core schema; this widens them. See docs/client-directory-proposal.md.
export const CLIENTS_SCHEMA = `
ALTER TABLE clients ADD COLUMN IF NOT EXISTS kinds TEXT[] NOT NULL DEFAULT ARRAY['client']::text[];
ALTER TABLE clients ADD COLUMN IF NOT EXISTS parent_client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS city VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_clients_parent ON clients(parent_client_id);
CREATE INDEX IF NOT EXISTS idx_clients_kinds ON clients USING GIN (kinds);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_parent_not_self') THEN
    ALTER TABLE clients ADD CONSTRAINT clients_parent_not_self CHECK (parent_client_id IS NULL OR parent_client_id <> id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_kinds_valid') THEN
    ALTER TABLE clients ADD CONSTRAINT clients_kinds_valid CHECK (
      cardinality(kinds) > 0 AND kinds <@ ARRAY['client','consultant','contractor','partner','supplier']::text[]);
  END IF;
END $$;

-- People: email is no longer required (a phone number is enough); people who leave keep their
-- record and are marked with the date they left, so history still shows who it was.
ALTER TABLE client_contacts ALTER COLUMN email DROP NOT NULL;
ALTER TABLE client_contacts ADD COLUMN IF NOT EXISTS mobile VARCHAR(100);
ALTER TABLE client_contacts ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE client_contacts ADD COLUMN IF NOT EXISTS left_on DATE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_contacts_reachable') THEN
    ALTER TABLE client_contacts ADD CONSTRAINT client_contacts_reachable CHECK (
      NULLIF(BTRIM(COALESCE(email, '')), '') IS NOT NULL
      OR NULLIF(BTRIM(COALESCE(phone, '')), '') IS NOT NULL
      OR NULLIF(BTRIM(COALESCE(mobile, '')), '') IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_contacts_primary_not_left') THEN
    ALTER TABLE client_contacts ADD CONSTRAINT client_contacts_primary_not_left CHECK (NOT (is_primary AND left_on IS NOT NULL));
  END IF;
END $$;

-- Projects point at their client company. client_name stays as the company's name (kept in step by
-- the API) for older screens and for projects whose client is not in the directory yet.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);

-- Clients & contacts module: everyone can look; admins, managers, HQ managers and the PMO edit.
INSERT INTO role_module_access (role_id, module_key, access_level)
SELECT r.id, 'clients', CASE WHEN r.name IN ('admin', 'manager', 'hq_manager', 'pmo') THEN 'manage' ELSE 'view' END
FROM roles r
ON CONFLICT (role_id, module_key) DO NOTHING;
`;
