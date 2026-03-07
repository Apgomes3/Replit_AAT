import pool from './index';
import dotenv from 'dotenv';
dotenv.config();

const schema = `
-- USERS & AUTH
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  role VARCHAR(50) NOT NULL DEFAULT 'viewer',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PROJECT DOMAIN
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_code VARCHAR(50) UNIQUE NOT NULL,
  project_name VARCHAR(255) NOT NULL,
  client_name VARCHAR(255),
  site_name VARCHAR(255),
  country VARCHAR(100),
  city VARCHAR(100),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  timezone VARCHAR(100),
  project_status VARCHAR(50) DEFAULT 'Concept',
  project_phase VARCHAR(100),
  contract_reference VARCHAR(100),
  start_date DATE,
  target_completion_date DATE,
  actual_completion_date DATE,
  project_manager VARCHAR(255),
  engineering_manager VARCHAR(255),
  qa_owner VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_code VARCHAR(50) NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  area_name VARCHAR(255) NOT NULL,
  discipline_scope VARCHAR(255),
  status VARCHAR(50) DEFAULT 'Active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, area_code)
);

CREATE TABLE IF NOT EXISTS exhibits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exhibit_code VARCHAR(50) NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  area_id UUID REFERENCES areas(id) ON DELETE CASCADE,
  exhibit_name VARCHAR(255) NOT NULL,
  water_type VARCHAR(50),
  design_temperature_min NUMERIC,
  design_temperature_max NUMERIC,
  design_salinity NUMERIC,
  status VARCHAR(50) DEFAULT 'Active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, exhibit_code)
);

CREATE TABLE IF NOT EXISTS tanks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tank_code VARCHAR(50) NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  area_id UUID REFERENCES areas(id),
  exhibit_id UUID REFERENCES exhibits(id),
  tank_name VARCHAR(255) NOT NULL,
  tank_type VARCHAR(100),
  shape_type VARCHAR(50),
  gross_volume_m3 NUMERIC,
  operating_volume_m3 NUMERIC,
  length_mm NUMERIC,
  width_mm NUMERIC,
  height_mm NUMERIC,
  design_water_level_mm NUMERIC,
  primary_material VARCHAR(100),
  status VARCHAR(50) DEFAULT 'Active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, tank_code)
);

CREATE TABLE IF NOT EXISTS systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_code VARCHAR(50) NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  area_id UUID REFERENCES areas(id),
  exhibit_id UUID REFERENCES exhibits(id),
  system_name VARCHAR(255) NOT NULL,
  system_type VARCHAR(100),
  design_flow_m3h NUMERIC,
  turnover_rate_hr NUMERIC,
  water_type VARCHAR(50),
  status VARCHAR(50) DEFAULT 'Draft',
  primary_control_panel_code VARCHAR(50),
  duty_description TEXT,
  redundancy_strategy TEXT,
  design_basis_reference VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, system_code)
);

CREATE TABLE IF NOT EXISTS equipment_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_code VARCHAR(50) NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  system_id UUID REFERENCES systems(id),
  equipment_type VARCHAR(100),
  equipment_subtype VARCHAR(100),
  equipment_name VARCHAR(255) NOT NULL,
  product_usage_id UUID,
  operational_duty VARCHAR(100),
  design_flow_m3h NUMERIC,
  design_head_m NUMERIC,
  power_kw NUMERIC,
  material_code VARCHAR(50),
  status VARCHAR(50) DEFAULT 'Draft',
  location_reference VARCHAR(100),
  serial_number VARCHAR(100),
  installation_date DATE,
  commissioning_date DATE,
  vendor_option_id UUID,
  po_reference VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, equipment_code)
);

-- PRODUCT LIBRARY
CREATE TABLE IF NOT EXISTS product_families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_family_code VARCHAR(50) UNIQUE NOT NULL,
  product_family_name VARCHAR(255) NOT NULL,
  category_code VARCHAR(50),
  status VARCHAR(50) DEFAULT 'Active',
  owner_role VARCHAR(100),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_masters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code VARCHAR(50) UNIQUE NOT NULL,
  product_family_id UUID REFERENCES product_families(id),
  product_name VARCHAR(255) NOT NULL,
  product_category VARCHAR(100),
  application_type VARCHAR(100),
  design_flow_m3h NUMERIC,
  design_pressure_bar NUMERIC,
  design_head_m NUMERIC,
  power_kw NUMERIC,
  primary_material_code VARCHAR(50),
  standard_status VARCHAR(50) DEFAULT 'Concept',
  salinity_class VARCHAR(50),
  temperature_class VARCHAR(50),
  regional_compliance VARCHAR(255),
  image_url TEXT,
  notes TEXT,
  status VARCHAR(50) DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_code VARCHAR(50) UNIQUE NOT NULL,
  product_master_id UUID REFERENCES product_masters(id) ON DELETE CASCADE,
  variant_name VARCHAR(255) NOT NULL,
  variant_reason TEXT,
  override_material_code VARCHAR(50),
  override_power_kw NUMERIC,
  override_region VARCHAR(100),
  status VARCHAR(50) DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS standard_boms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_code VARCHAR(50) NOT NULL,
  product_master_id UUID REFERENCES product_masters(id) ON DELETE CASCADE,
  revision_code VARCHAR(20) DEFAULT 'A',
  status VARCHAR(50) DEFAULT 'Active',
  effective_from DATE DEFAULT CURRENT_DATE,
  effective_to DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_code VARCHAR(50) UNIQUE NOT NULL,
  component_name VARCHAR(255) NOT NULL,
  component_type VARCHAR(100),
  component_category VARCHAR(100),
  description TEXT,
  primary_material_code VARCHAR(50) REFERENCES materials(material_code),
  standard_size VARCHAR(100),
  weight_kg NUMERIC,
  unit VARCHAR(50) DEFAULT 'EA',
  status VARCHAR(50) DEFAULT 'Active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS bom_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  standard_bom_id UUID REFERENCES standard_boms(id) ON DELETE CASCADE,
  component_id UUID REFERENCES components(id),
  line_number INTEGER NOT NULL,
  component_type VARCHAR(100),
  component_reference_code VARCHAR(100),
  component_name VARCHAR(255),
  quantity NUMERIC DEFAULT 1,
  unit VARCHAR(50),
  is_optional BOOLEAN DEFAULT false,
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendor_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_option_code VARCHAR(50) UNIQUE NOT NULL,
  product_master_id UUID REFERENCES product_masters(id),
  vendor_name VARCHAR(255),
  manufacturer_name VARCHAR(255),
  vendor_item_code VARCHAR(100),
  approved_status VARCHAR(50) DEFAULT 'Approved',
  lead_time_days INTEGER,
  region_scope VARCHAR(100),
  status VARCHAR(50) DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- KNOWLEDGE DOMAIN
CREATE TABLE IF NOT EXISTS materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_code VARCHAR(50) UNIQUE NOT NULL,
  material_name VARCHAR(255) NOT NULL,
  material_category VARCHAR(100),
  density NUMERIC,
  chemical_resistance TEXT,
  temperature_limit NUMERIC,
  status VARCHAR(50) DEFAULT 'Active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS specifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_code VARCHAR(50) UNIQUE NOT NULL,
  spec_name VARCHAR(255) NOT NULL,
  spec_type VARCHAR(100),
  standard_reference VARCHAR(100),
  discipline VARCHAR(100),
  status VARCHAR(50) DEFAULT 'Active',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS design_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code VARCHAR(50) UNIQUE NOT NULL,
  rule_name VARCHAR(255) NOT NULL,
  discipline VARCHAR(100),
  applies_to VARCHAR(100),
  rule_description TEXT,
  reference_spec VARCHAR(100),
  status VARCHAR(50) DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calculation_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_code VARCHAR(50) UNIQUE NOT NULL,
  template_name VARCHAR(255) NOT NULL,
  discipline VARCHAR(100),
  applies_to VARCHAR(100),
  description TEXT,
  formula_notes TEXT,
  status VARCHAR(50) DEFAULT 'Active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- BRIDGE ENTITIES
CREATE TABLE IF NOT EXISTS product_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  product_master_id UUID REFERENCES product_masters(id),
  equipment_instance_id UUID REFERENCES equipment_instances(id),
  usage_type VARCHAR(50) DEFAULT 'Standard',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_usage_id UUID REFERENCES product_usages(id) ON DELETE CASCADE,
  parameter_name VARCHAR(100),
  original_value TEXT,
  configured_value TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- DOCUMENTS & REVISIONS
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_code VARCHAR(100) UNIQUE NOT NULL,
  document_title VARCHAR(500) NOT NULL,
  document_type VARCHAR(100),
  discipline VARCHAR(100),
  project_id UUID REFERENCES projects(id),
  system_id UUID REFERENCES systems(id),
  equipment_id UUID REFERENCES equipment_instances(id),
  product_id UUID REFERENCES product_masters(id),
  current_revision VARCHAR(20) DEFAULT 'A',
  status VARCHAR(50) DEFAULT 'Draft',
  owner VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS document_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  revision_code VARCHAR(20) NOT NULL,
  revision_purpose TEXT,
  status VARCHAR(50) DEFAULT 'Draft',
  issued_by UUID REFERENCES users(id),
  issued_at TIMESTAMPTZ,
  file_path TEXT,
  file_name VARCHAR(500),
  file_size BIGINT,
  mime_type VARCHAR(100),
  checksum VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id),
  revision_id UUID REFERENCES document_revisions(id),
  approver_id UUID REFERENCES users(id),
  role VARCHAR(100),
  action VARCHAR(50),
  comment TEXT,
  acted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS release_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_code VARCHAR(50) UNIQUE NOT NULL,
  project_id UUID REFERENCES projects(id),
  package_type VARCHAR(100),
  package_name VARCHAR(255),
  status VARCHAR(50) DEFAULT 'Draft',
  issued_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS release_package_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_package_id UUID REFERENCES release_packages(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id),
  revision_code VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- GRAPH RELATIONSHIPS
CREATE TABLE IF NOT EXISTS entity_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id VARCHAR(255) NOT NULL,
  source_type VARCHAR(100) NOT NULL,
  target_id VARCHAR(255) NOT NULL,
  target_type VARCHAR(100) NOT NULL,
  edge_type VARCHAR(100) NOT NULL,
  properties JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_er_source ON entity_relationships(source_id, source_type);
CREATE INDEX IF NOT EXISTS idx_er_target ON entity_relationships(target_id, target_type);
CREATE INDEX IF NOT EXISTS idx_er_edge ON entity_relationships(edge_type);

-- LIFECYCLE & WORKFLOW
CREATE TABLE IF NOT EXISTS lifecycle_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  from_state VARCHAR(50),
  to_state VARCHAR(50) NOT NULL,
  actor_id UUID REFERENCES users(id),
  comment TEXT,
  transitioned_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  change_code VARCHAR(50) UNIQUE NOT NULL,
  project_id UUID REFERENCES projects(id),
  title VARCHAR(500) NOT NULL,
  change_reason TEXT,
  risk_level VARCHAR(50) DEFAULT 'Medium',
  status VARCHAR(50) DEFAULT 'Proposed',
  affected_entities JSONB DEFAULT '[]',
  requested_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- AUDIT
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(100),
  entity_id VARCHAR(255),
  action VARCHAR(100),
  actor_id UUID REFERENCES users(id),
  details JSONB,
  ip_address VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS product_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  code VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  sort_order INT DEFAULT 0,
  is_system BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO product_categories (name, code, description, is_system, sort_order) VALUES
  ('Filtration', 'FILTRATION', 'Filtration systems and equipment', true, 10),
  ('Pumping', 'PUMPING', 'Pumps, blowers and fluid movers', true, 20),
  ('Disinfection', 'DISINFECTION', 'UV, ozone and chemical dosing', true, 30),
  ('Thermal', 'THERMAL', 'Heating and chilling equipment', true, 40),
  ('Piping', 'PIPING', 'Pipes, fittings, valves and flanges', true, 50),
  ('Control', 'CONTROL', 'Controllers, PLCs and automation', true, 60),
  ('Structural', 'STRUCTURAL', 'Frames, supports and enclosures', true, 70),
  ('Instrumentation', 'INSTRUMENTATION', 'Sensors, probes and meters', true, 80),
  ('Tank', 'TANK', 'Display tanks, sumps and reservoirs', true, 90),
  ('Electrical', 'ELECTRICAL', 'Electrical panels and distribution', true, 100),
  ('Other', 'OTHER', 'Miscellaneous equipment', true, 999)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS component_id UUID REFERENCES components(id);
ALTER TABLE product_masters ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE product_masters ADD COLUMN IF NOT EXISTS shape_type VARCHAR(50);
ALTER TABLE product_masters ADD COLUMN IF NOT EXISTS length_mm NUMERIC;
ALTER TABLE product_masters ADD COLUMN IF NOT EXISTS width_mm NUMERIC;
ALTER TABLE product_masters ADD COLUMN IF NOT EXISTS height_mm NUMERIC;
ALTER TABLE product_masters ADD COLUMN IF NOT EXISTS design_water_level_mm NUMERIC;
ALTER TABLE product_masters ADD COLUMN IF NOT EXISTS gross_volume_m3 NUMERIC;
ALTER TABLE product_masters ADD COLUMN IF NOT EXISTS operating_volume_m3 NUMERIC;
ALTER TABLE tanks ADD COLUMN IF NOT EXISTS product_master_id UUID REFERENCES product_masters(id);

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  is_system BOOLEAN DEFAULT false,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO roles (name, description, is_system, sort_order) VALUES
  ('admin', 'Full platform access including user and configuration management', true, 10),
  ('engineer', 'Create and edit library data, projects and documents', true, 20),
  ('viewer', 'Read-only access to all platform data', true, 30)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE product_masters ADD COLUMN IF NOT EXISTS synonyms TEXT[] DEFAULT '{}';
ALTER TABLE components ADD COLUMN IF NOT EXISTS synonyms TEXT[] DEFAULT '{}';

-- PROJECT EQUIPMENT ITEMS (products assigned directly to a project/system)
CREATE TABLE IF NOT EXISTS project_equipment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equip_code VARCHAR(50) NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  system_id UUID REFERENCES systems(id),
  product_master_id UUID REFERENCES product_masters(id),
  description VARCHAR(255),
  quantity NUMERIC DEFAULT 1,
  unit VARCHAR(50) DEFAULT 'EA',
  notes TEXT,
  status VARCHAR(50) DEFAULT 'Design',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, equip_code)
);

-- PROJECT PIPING ITEMS (pipes & fittings assigned to a project)
CREATE TABLE IF NOT EXISTS project_piping_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  piping_code VARCHAR(50) NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  system_id UUID REFERENCES systems(id),
  product_master_id UUID REFERENCES product_masters(id),
  description VARCHAR(255),
  quantity NUMERIC DEFAULT 1,
  unit VARCHAR(50) DEFAULT 'EA',
  notes TEXT,
  status VARCHAR(50) DEFAULT 'Design',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, piping_code)
);

-- FAMILY CLASSIFIERS (dynamic attributes defined per product family)
CREATE TABLE IF NOT EXISTS family_classifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID REFERENCES product_families(id) ON DELETE CASCADE,
  label VARCHAR(100) NOT NULL,
  unit VARCHAR(50),
  field_type VARCHAR(20) DEFAULT 'text',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PRODUCT CLASSIFIER VALUES (per-product values for family classifiers)
CREATE TABLE IF NOT EXISTS product_classifier_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES product_masters(id) ON DELETE CASCADE,
  classifier_id UUID REFERENCES family_classifiers(id) ON DELETE CASCADE,
  value_text TEXT,
  UNIQUE(product_id, classifier_id)
);

-- USER TO-DOs (personal task list per user)
CREATE TABLE IF NOT EXISTS todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- BOM RELEASES (project-level material release documents)
CREATE TABLE IF NOT EXISTS bom_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_code VARCHAR(50) NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR(255),
  revision VARCHAR(20) DEFAULT 'A',
  status VARCHAR(50) DEFAULT 'Draft',
  issued_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  UNIQUE(project_id, release_code)
);

-- BOM RELEASE LINES (snapshot of items captured at release time)
CREATE TABLE IF NOT EXISTS bom_release_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_release_id UUID REFERENCES bom_releases(id) ON DELETE CASCADE,
  section VARCHAR(50) NOT NULL,
  line_number INT,
  tag_code VARCHAR(100),
  description VARCHAR(255),
  product_code VARCHAR(100),
  product_name VARCHAR(255),
  quantity NUMERIC DEFAULT 1,
  unit VARCHAR(50) DEFAULT 'EA',
  area_ref VARCHAR(100),
  system_ref VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Running migrations...');
    await client.query(schema);
    console.log('Migrations complete.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
