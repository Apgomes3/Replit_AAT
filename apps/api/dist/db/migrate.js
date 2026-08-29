"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = __importDefault(require("./index"));
const dotenv_1 = __importDefault(require("dotenv"));
const pimAssignmentIndexMigration_1 = require("./pimAssignmentIndexMigration");
dotenv_1.default.config();
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
  system_id UUID REFERENCES systems(id) ON DELETE SET NULL,
  tank_name VARCHAR(255) NOT NULL,
  tank_type VARCHAR(100),
  shape_type VARCHAR(50),
  gross_volume_m3 NUMERIC,
  operating_volume_m3 NUMERIC,
  length_mm NUMERIC,
  width_mm NUMERIC,
  height_mm NUMERIC,
  design_water_level_mm NUMERIC,
  custom_footprint JSONB,
  primary_material VARCHAR(100),
  status VARCHAR(50) DEFAULT 'Active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, tank_code)
);
ALTER TABLE tanks ADD COLUMN IF NOT EXISTS system_id UUID REFERENCES systems(id) ON DELETE SET NULL;
ALTER TABLE tanks ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tanks ADD COLUMN IF NOT EXISTS custom_footprint JSONB;

CREATE TABLE IF NOT EXISTS tank_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tank_id UUID NOT NULL REFERENCES tanks(id) ON DELETE CASCADE,
  instance_index INT NOT NULL,
  tag VARCHAR(100) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tank_id, instance_index)
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

CREATE TABLE IF NOT EXISTS document_project_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  linked_by UUID REFERENCES users(id),
  UNIQUE(document_id, project_id)
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
ALTER TABLE product_masters ADD COLUMN IF NOT EXISTS surface_area_m2 NUMERIC;
ALTER TABLE product_masters ADD COLUMN IF NOT EXISTS wall_thickness_mm NUMERIC;
ALTER TABLE product_masters ADD COLUMN IF NOT EXISTS weight_kg NUMERIC;
ALTER TABLE tanks ADD COLUMN IF NOT EXISTS product_master_id UUID REFERENCES product_masters(id);
${pimAssignmentIndexMigration_1.pimAssignmentIndexMigration}
ALTER TABLE tanks ADD COLUMN IF NOT EXISTS surface_area_m2 NUMERIC;

CREATE TABLE IF NOT EXISTS tank_families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  sort_order INT DEFAULT 0,
  is_system BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


ALTER TABLE product_masters ADD COLUMN IF NOT EXISTS tank_family_id UUID REFERENCES tank_families(id) ON DELETE SET NULL;
ALTER TABLE product_masters ADD COLUMN IF NOT EXISTS source_tank_id UUID REFERENCES tanks(id) ON DELETE SET NULL;
ALTER TABLE product_masters ADD COLUMN IF NOT EXISTS source_tank_snapshot JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_masters_source_tank
  ON product_masters(source_tank_id) WHERE source_tank_id IS NOT NULL;

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
  ('viewer', 'Read-only access to all platform data', true, 30),
  ('hq_manager', 'HQ management and approval access', true, 40),
  ('pmo', 'Project management office access', true, 50)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS role_module_access (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  module_key VARCHAR(50) NOT NULL,
  access_level VARCHAR(20) NOT NULL DEFAULT 'manage'
    CHECK (access_level IN ('manage', 'view', 'hidden')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (role_id, module_key)
);

INSERT INTO role_module_access (role_id, module_key, access_level)
SELECT r.id, m.module_key, 'manage'
FROM roles r
CROSS JOIN (VALUES
  ('pim'), ('orders'), ('projects'), ('design_books'),
  ('documents'), ('knowledge'), ('graph')
) AS m(module_key)
ON CONFLICT (role_id, module_key) DO NOTHING;

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

ALTER TABLE project_equipment_items ADD COLUMN IF NOT EXISTS component_id UUID REFERENCES components(id);

ALTER TABLE product_masters ADD COLUMN IF NOT EXISTS manufacturer VARCHAR(255);
ALTER TABLE product_masters ADD COLUMN IF NOT EXISTS model VARCHAR(255);
ALTER TABLE components ADD COLUMN IF NOT EXISTS manufacturer VARCHAR(255);
ALTER TABLE components ADD COLUMN IF NOT EXISTS model VARCHAR(255);

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

ALTER TABLE product_masters ADD COLUMN IF NOT EXISTS cost NUMERIC;
ALTER TABLE product_masters ADD COLUMN IF NOT EXISTS sell_price NUMERIC;
ALTER TABLE components ADD COLUMN IF NOT EXISTS cost NUMERIC;
ALTER TABLE components ADD COLUMN IF NOT EXISTS sell_price NUMERIC;

UPDATE product_masters SET
  cost = ROUND((RANDOM() * 4500 + 500)::numeric, 2)
WHERE cost IS NULL;

UPDATE product_masters SET
  sell_price = ROUND((RANDOM() * 7000 + 800)::numeric, 2)
WHERE sell_price IS NULL;

UPDATE components SET
  cost = ROUND((RANDOM() * 900 + 50)::numeric, 2)
WHERE cost IS NULL;

UPDATE components SET
  sell_price = ROUND((RANDOM() * 1500 + 100)::numeric, 2)
WHERE sell_price IS NULL;

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

-- PRODUCT SPEC TABLES
CREATE TABLE IF NOT EXISTS product_dimensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_master_id UUID REFERENCES product_masters(id) ON DELETE CASCADE UNIQUE,
  length_mm NUMERIC, width_mm NUMERIC, height_mm NUMERIC, diameter_mm NUMERIC, weight_kg NUMERIC,
  inlet_dn_mm NUMERIC, outlet_dn_mm NUMERIC, notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE product_dimensions ADD COLUMN IF NOT EXISTS diameter_mm NUMERIC;
CREATE TABLE IF NOT EXISTS product_electrical (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_master_id UUID REFERENCES product_masters(id) ON DELETE CASCADE UNIQUE,
  rated_power_kw NUMERIC, voltage_v NUMERIC, phases INTEGER, frequency_hz NUMERIC,
  full_load_current_a NUMERIC, rated_speed_rpm NUMERIC, motor_type VARCHAR(100),
  insulation_class VARCHAR(20), protection_class VARCHAR(20), efficiency_class VARCHAR(20),
  notes TEXT, updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS product_hydraulic (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_master_id UUID REFERENCES product_masters(id) ON DELETE CASCADE UNIQUE,
  design_flow_m3h NUMERIC, min_flow_m3h NUMERIC, max_flow_m3h NUMERIC, venturi_flow_m3h NUMERIC,
  design_head_m NUMERIC, design_pressure_bar NUMERIC, max_pressure_bar NUMERIC,
  npsh_required_m NUMERIC, fluid_type VARCHAR(100),
  min_temperature_c NUMERIC, max_temperature_c NUMERIC,
  notes TEXT, updated_at TIMESTAMPTZ DEFAULT NOW()
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

CREATE TABLE IF NOT EXISTS system_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO system_types (name, sort_order) VALUES
  ('Single Exhibit LSS', 1),
  ('Multiple Exhibit LSS', 2),
  ('Main System LSS', 3),
  ('Quarantine', 4),
  ('Central Services', 5),
  ('Intake System', 6),
  ('Coral Propagation', 7),
  ('Penguin', 8),
  ('Marine Mammals', 9),
  ('Reptiles', 10)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS document_url VARCHAR(500);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS document_name VARCHAR(500);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(128) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);

-- PO COMMENTS
CREATE TABLE IF NOT EXISTS po_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_comments_po ON po_comments(po_id);

-- PO ATTACHMENTS (multi-file per PO, separate from single document_url)
CREATE TABLE IF NOT EXISTS po_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  file_name VARCHAR(500) NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT,
  mime_type VARCHAR(100),
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_attachments_po ON po_attachments(po_id);

-- STAGE DUE DATE (per-PO, for the current stage)
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS stage_due_date DATE;

-- ITEM BUDGET (budgeted amount per line item)
ALTER TABLE po_items ADD COLUMN IF NOT EXISTS budget_amount NUMERIC;

-- FACTORY ORDER NUMBER (assigned when PO is released)
CREATE SEQUENCE IF NOT EXISTS fo_code_seq START 1;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS fo_number VARCHAR(30);

-- PO VISIBILITY FLAG (users who can see all POs regardless of ownership)
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_see_all_pos BOOLEAN DEFAULT false;

-- PO STAGE ASSIGNEES (admin-configurable actors per pipeline stage)
CREATE TABLE IF NOT EXISTS po_stage_assignees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage VARCHAR(50) NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(stage, user_id)
);
CREATE INDEX IF NOT EXISTS idx_po_stage_assignees_stage ON po_stage_assignees(stage);

-- BOM sub-assembly support (product-as-BOM-line)
ALTER TABLE bom_lines ADD COLUMN IF NOT EXISTS sub_product_id UUID REFERENCES product_masters(id);

-- PO item source tracking: link each PO line back to the project item it was released from
ALTER TABLE po_items ADD COLUMN IF NOT EXISTS project_equipment_item_id UUID REFERENCES project_equipment_items(id) ON DELETE SET NULL;
ALTER TABLE po_items ADD COLUMN IF NOT EXISTS tank_id UUID REFERENCES tanks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_po_items_pei ON po_items(project_equipment_item_id) WHERE project_equipment_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_po_items_tank ON po_items(tank_id) WHERE tank_id IS NOT NULL;

-- TANK COST RATES (admin-configurable cost per m² for shell fabrication estimates)
CREATE TABLE IF NOT EXISTS tank_cost_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_code VARCHAR(50),
  label VARCHAR(100) NOT NULL,
  cost_per_sqm_usd NUMERIC NOT NULL DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'USD',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO tank_cost_rates (material_code, label, cost_per_sqm_usd, notes)
SELECT 'MAT-FRP-VE', 'FRP (Vinyl Ester)', 350, 'Base rate for FRP tank shell fabrication'
WHERE NOT EXISTS (SELECT 1 FROM tank_cost_rates WHERE material_code = 'MAT-FRP-VE');

ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_scopes TEXT[] DEFAULT ARRAY['LSS','Tanks','Waterproofing','Theming','Acrylic'];

-- DESIGN BOOKS
CREATE TABLE IF NOT EXISTS design_books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_code VARCHAR(50) UNIQUE NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  book_title VARCHAR(255) NOT NULL,
  description TEXT,
  revision VARCHAR(20) DEFAULT 'A',
  status VARCHAR(50) DEFAULT 'Draft',
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_design_books_project ON design_books(project_id) WHERE project_id IS NOT NULL;
ALTER TABLE design_books ADD COLUMN IF NOT EXISTS release_scope TEXT[];
ALTER TABLE design_books ADD COLUMN IF NOT EXISTS release_notes TEXT;
ALTER TABLE design_books ADD COLUMN IF NOT EXISTS released_by UUID REFERENCES users(id);
ALTER TABLE design_books ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;
ALTER TABLE design_books ADD COLUMN IF NOT EXISTS release_snapshot JSONB;
ALTER TABLE design_books ADD COLUMN IF NOT EXISTS review_submitted_by UUID REFERENCES users(id);
ALTER TABLE design_books ADD COLUMN IF NOT EXISTS review_submitted_at TIMESTAMPTZ;
ALTER TABLE design_books ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
ALTER TABLE design_books ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE design_books ADD COLUMN IF NOT EXISTS approval_notes TEXT;
ALTER TABLE design_books ADD COLUMN IF NOT EXISTS review_snapshot JSONB;

CREATE TABLE IF NOT EXISTS design_book_review_handovers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_book_id UUID NOT NULL REFERENCES design_books(id) ON DELETE CASCADE,
  meeting_date DATE NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT 'Design–Engineering Review Handover',
  attendees TEXT[] NOT NULL DEFAULT '{}',
  purpose TEXT,
  discussion_summary TEXT,
  decisions TEXT,
  action_items TEXT,
  open_items TEXT,
  acceptance_notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_db_review_handovers_book
  ON design_book_review_handovers(design_book_id, meeting_date DESC);

CREATE OR REPLACE FUNCTION prevent_released_design_book_parent_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'Released' THEN
    RAISE EXCEPTION 'Released Design Books are read-only'
      USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guard_released_design_book_parent ON design_books;
CREATE TRIGGER guard_released_design_book_parent
BEFORE UPDATE OR DELETE ON design_books
FOR EACH ROW EXECUTE FUNCTION prevent_released_design_book_parent_mutation();

-- Released Design Book-owned engineering records are immutable. Locking the
-- parent row also serializes these writes against the atomic release action.
CREATE OR REPLACE FUNCTION prevent_released_design_book_mutation()
RETURNS TRIGGER AS $$
DECLARE
  parent_status TEXT;
BEGIN
  SELECT status INTO parent_status
  FROM design_books
  WHERE id = COALESCE(NEW.design_book_id, OLD.design_book_id)
  FOR UPDATE;

  IF parent_status = 'Released' THEN
    RAISE EXCEPTION 'Released Design Books are read-only'
      USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guard_released_design_book_handovers ON design_book_review_handovers;
CREATE TRIGGER guard_released_design_book_handovers
BEFORE INSERT OR UPDATE OR DELETE ON design_book_review_handovers
FOR EACH ROW EXECUTE FUNCTION prevent_released_design_book_mutation();

-- DESIGN BOOK: Exhibit Species
CREATE TABLE IF NOT EXISTS design_book_exhibit_species (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_book_id UUID NOT NULL REFERENCES design_books(id) ON DELETE CASCADE,
  exhibit_id UUID NOT NULL REFERENCES exhibits(id) ON DELETE CASCADE,
  species_name VARCHAR(255) NOT NULL,
  common_name VARCHAR(255),
  quantity INTEGER,
  avg_size_cm NUMERIC,
  biomass_kg NUMERIC,
  notes TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_db_species_book ON design_book_exhibit_species(design_book_id);
DROP TRIGGER IF EXISTS guard_released_design_book_species ON design_book_exhibit_species;
CREATE TRIGGER guard_released_design_book_species
BEFORE INSERT OR UPDATE OR DELETE ON design_book_exhibit_species
FOR EACH ROW EXECUTE FUNCTION prevent_released_design_book_mutation();
CREATE INDEX IF NOT EXISTS idx_db_species_exhibit ON design_book_exhibit_species(exhibit_id);

-- AQUARIUM SPECIES: shared reference catalog. Values copied onto allocations
-- are intentionally independent so catalog corrections never rewrite history.
CREATE TABLE IF NOT EXISTS aquarium_species_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scientific_name VARCHAR(255) NOT NULL,
  common_name VARCHAR(255),
  family VARCHAR(150) NOT NULL,
  water_type VARCHAR(50) NOT NULL,
  average_size_cm NUMERIC(10,2),
  reference_average_mass_kg NUMERIC(12,4),
  source TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (length(trim(scientific_name)) > 0),
  CHECK (length(trim(family)) > 0),
  CHECK (length(trim(water_type)) > 0),
  CHECK (average_size_cm IS NULL OR average_size_cm > 0),
  CHECK (reference_average_mass_kg IS NULL OR reference_average_mass_kg > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_aquarium_species_scientific_name
  ON aquarium_species_catalog (LOWER(scientific_name));
CREATE INDEX IF NOT EXISTS idx_aquarium_species_search
  ON aquarium_species_catalog (LOWER(scientific_name), LOWER(common_name), LOWER(family));
CREATE INDEX IF NOT EXISTS idx_aquarium_species_filters
  ON aquarium_species_catalog (water_type, family, active);

ALTER TABLE design_book_exhibit_species
  ADD COLUMN IF NOT EXISTS catalog_species_id UUID REFERENCES aquarium_species_catalog(id) ON DELETE SET NULL;
ALTER TABLE design_book_exhibit_species
  ADD COLUMN IF NOT EXISTS reference_average_mass_kg NUMERIC(12,4);
ALTER TABLE design_book_exhibit_species
  ADD COLUMN IF NOT EXISTS avg_size_override_cm NUMERIC(10,2);
ALTER TABLE design_book_exhibit_species
  ADD COLUMN IF NOT EXISTS reference_mass_override_kg NUMERIC(12,4);
ALTER TABLE design_book_exhibit_species
  ADD COLUMN IF NOT EXISTS biomass_override_kg NUMERIC(12,4);
CREATE INDEX IF NOT EXISTS idx_db_species_catalog ON design_book_exhibit_species(catalog_species_id);

-- DESIGN BOOK: Exhibit Hydraulics (water flow / turnover config)
CREATE TABLE IF NOT EXISTS design_book_exhibit_hydraulics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_book_id UUID NOT NULL REFERENCES design_books(id) ON DELETE CASCADE,
  exhibit_id UUID NOT NULL REFERENCES exhibits(id) ON DELETE CASCADE,
  target_turnover_rate NUMERIC(6,2),
  surface_skim_pct NUMERIC(5,2) DEFAULT 30,
  bottom_drain_pct NUMERIC(5,2) DEFAULT 70,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(design_book_id, exhibit_id)
);
CREATE INDEX IF NOT EXISTS idx_db_hydraulics_book ON design_book_exhibit_hydraulics(design_book_id);
DROP TRIGGER IF EXISTS guard_released_design_book_hydraulics ON design_book_exhibit_hydraulics;
CREATE TRIGGER guard_released_design_book_hydraulics
BEFORE INSERT OR UPDATE OR DELETE ON design_book_exhibit_hydraulics
FOR EACH ROW EXECUTE FUNCTION prevent_released_design_book_mutation();
ALTER TABLE design_book_exhibit_hydraulics ADD COLUMN IF NOT EXISTS weir_head_mm NUMERIC(8,2);
ALTER TABLE design_book_exhibit_hydraulics ADD COLUMN IF NOT EXISTS weir_length_mm NUMERIC(10,2);
-- Francis sizing basis. Existing head values are retained; these fields stay
-- NULL until the saved design basis has been explicitly confirmed.
ALTER TABLE design_book_exhibit_hydraulics ADD COLUMN IF NOT EXISTS weir_formula_method VARCHAR(50);
ALTER TABLE design_book_exhibit_hydraulics ADD COLUMN IF NOT EXISTS weir_geometry VARCHAR(50);
ALTER TABLE design_book_exhibit_hydraulics ADD COLUMN IF NOT EXISTS weir_end_contractions INTEGER;
ALTER TABLE design_book_exhibit_hydraulics ADD COLUMN IF NOT EXISTS weir_discharge_condition VARCHAR(50);
ALTER TABLE design_book_exhibit_hydraulics ADD COLUMN IF NOT EXISTS weir_downstream_head_mm NUMERIC(8,2);
ALTER TABLE design_book_exhibit_hydraulics ADD COLUMN IF NOT EXISTS calculation_version VARCHAR(50);
ALTER TABLE design_book_exhibit_hydraulics ADD COLUMN IF NOT EXISTS last_calculated_at TIMESTAMPTZ;
ALTER TABLE design_book_exhibit_hydraulics ADD COLUMN IF NOT EXISTS calculation_inputs JSONB;
ALTER TABLE design_book_exhibit_hydraulics ADD COLUMN IF NOT EXISTS override_reason TEXT;

-- DESIGN BOOK: Exhibit Theming & Substrate
CREATE TABLE IF NOT EXISTS design_book_exhibit_substrate (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_book_id UUID NOT NULL REFERENCES design_books(id) ON DELETE CASCADE,
  exhibit_id UUID NOT NULL REFERENCES exhibits(id) ON DELETE CASCADE,
  substrate_type VARCHAR(100),
  substrate_volume_m3 NUMERIC(8,4),
  theming_type VARCHAR(100),
  theming_volume_m3 NUMERIC(8,4),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(design_book_id, exhibit_id)
);
CREATE INDEX IF NOT EXISTS idx_db_substrate_book ON design_book_exhibit_substrate(design_book_id);
DROP TRIGGER IF EXISTS guard_released_design_book_substrate ON design_book_exhibit_substrate;
CREATE TRIGGER guard_released_design_book_substrate
BEFORE INSERT OR UPDATE OR DELETE ON design_book_exhibit_substrate
FOR EACH ROW EXECUTE FUNCTION prevent_released_design_book_mutation();

-- DESIGN BOOK: Versions (point-in-time JSONB snapshots)
CREATE TABLE IF NOT EXISTS design_book_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_book_id UUID NOT NULL REFERENCES design_books(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  version_label VARCHAR(200),
  notes TEXT,
  snapshot JSONB NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(design_book_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_db_versions_book ON design_book_versions(design_book_id);
ALTER TABLE design_book_versions ADD COLUMN IF NOT EXISTS snapshot_schema_version INTEGER DEFAULT 1;
ALTER TABLE design_book_versions ADD COLUMN IF NOT EXISTS snapshot_checksum VARCHAR(64);
ALTER TABLE design_book_versions ADD COLUMN IF NOT EXISTS is_recovery_checkpoint BOOLEAN NOT NULL DEFAULT false;

-- Each successful restore points to both the source snapshot and the
-- automatically-created pre-restore recovery checkpoint.
CREATE TABLE IF NOT EXISTS design_book_version_restores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_book_id UUID NOT NULL REFERENCES design_books(id) ON DELETE CASCADE,
  source_version_id UUID NOT NULL REFERENCES design_book_versions(id) ON DELETE RESTRICT,
  recovery_checkpoint_id UUID NOT NULL REFERENCES design_book_versions(id) ON DELETE RESTRICT,
  actor_id UUID REFERENCES users(id),
  drift JSONB NOT NULL DEFAULT '{}',
  restored_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_db_version_restores_book
  ON design_book_version_restores(design_book_id, restored_at DESC);

-- SYSTEM EXHIBIT LINKS: many-to-many systems ↔ exhibits with ruleset
CREATE TABLE IF NOT EXISTS system_exhibit_links (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id           UUID NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  exhibit_id          UUID NOT NULL REFERENCES exhibits(id) ON DELETE CASCADE,
  link_type           VARCHAR(100) DEFAULT 'Primary',
  flow_allocation_m3h NUMERIC,
  notes               TEXT,
  sort_order          INTEGER DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(system_id, exhibit_id)
);
CREATE INDEX IF NOT EXISTS idx_sel_system  ON system_exhibit_links(system_id);
CREATE INDEX IF NOT EXISTS idx_sel_exhibit ON system_exhibit_links(exhibit_id);
ALTER TABLE system_exhibit_links ADD COLUMN IF NOT EXISTS allocation_source VARCHAR(30) DEFAULT 'calculated';
ALTER TABLE system_exhibit_links ADD COLUMN IF NOT EXISTS allocation_updated_at TIMESTAMPTZ;
INSERT INTO system_exhibit_links
  (system_id, exhibit_id, link_type, flow_allocation_m3h, notes, sort_order, allocation_source, allocation_updated_at)
SELECT s.id, s.exhibit_id, 'Primary', NULL, NULL, 0, 'calculated', NOW()
FROM systems s
WHERE s.exhibit_id IS NOT NULL
ON CONFLICT (system_id, exhibit_id) DO NOTHING;

-- SUBSTRATE: height-based volume calculation fields
ALTER TABLE design_book_exhibit_substrate ADD COLUMN IF NOT EXISTS substrate_height_mm NUMERIC;
ALTER TABLE design_book_exhibit_substrate ADD COLUMN IF NOT EXISTS theming_height_mm NUMERIC;
ALTER TABLE design_book_exhibit_substrate ADD COLUMN IF NOT EXISTS theming_volume_pct NUMERIC(6,2);

-- TANKS: additional design fields (added after initial schema)
ALTER TABLE tanks ADD COLUMN IF NOT EXISTS material_id UUID REFERENCES materials(id);
ALTER TABLE tanks ADD COLUMN IF NOT EXISTS wall_thickness_mm NUMERIC;
ALTER TABLE tanks ADD COLUMN IF NOT EXISTS inner_length_mm NUMERIC;
ALTER TABLE tanks ADD COLUMN IF NOT EXISTS inner_width_mm NUMERIC;
ALTER TABLE tanks ADD COLUMN IF NOT EXISTS inner_height_mm NUMERIC;

-- LSS COMPACT UNITS: master product catalog for compact LSS systems
CREATE TABLE IF NOT EXISTS lss_compact_units (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_code            VARCHAR(50) NOT NULL UNIQUE,
  unit_name            VARCHAR(255) NOT NULL,
  manufacturer         VARCHAR(100),
  water_type           VARCHAR(50),
  min_tank_volume_m3   NUMERIC,
  max_tank_volume_m3   NUMERIC,
  design_flow_m3h      NUMERIC,
  max_flow_m3h         NUMERIC,
  break_tank_volume_l  NUMERIC,
  includes_filtration  VARCHAR(255),
  uv_power_w           NUMERIC,
  footprint_l_mm       NUMERIC,
  footprint_w_mm       NUMERIC,
  height_mm            NUMERIC,
  dry_weight_kg        NUMERIC,
  power_kw             NUMERIC,
  inlet_connection     VARCHAR(50),
  outlet_connection    VARCHAR(50),
  notes                TEXT,
  product_master_id    UUID REFERENCES product_masters(id),
  status               VARCHAR(50) DEFAULT 'Active',
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- SYSTEMS: config type + compact unit link
ALTER TABLE systems ADD COLUMN IF NOT EXISTS system_config   VARCHAR(20);
ALTER TABLE systems ALTER COLUMN system_config DROP DEFAULT;
ALTER TABLE systems ADD COLUMN IF NOT EXISTS compact_unit_id UUID REFERENCES lss_compact_units(id);
ALTER TABLE systems ADD COLUMN IF NOT EXISTS calculation_version VARCHAR(50);
ALTER TABLE systems ADD COLUMN IF NOT EXISTS last_calculated_at TIMESTAMPTZ;
ALTER TABLE systems ADD COLUMN IF NOT EXISTS calculation_inputs JSONB;

-- SYSTEMS: flow route loop configuration
ALTER TABLE systems ADD COLUMN IF NOT EXISTS loop1_name           VARCHAR(255) NOT NULL DEFAULT 'Loop 1';
ALTER TABLE systems ADD COLUMN IF NOT EXISTS loop1_flow_source    VARCHAR(50);
ALTER TABLE systems ADD COLUMN IF NOT EXISTS loop1_filtration     VARCHAR(50);
ALTER TABLE systems ADD COLUMN IF NOT EXISTS loop1_flow_pct       NUMERIC;
ALTER TABLE systems ADD COLUMN IF NOT EXISTS loop1_bio_degas_pct  NUMERIC;
ALTER TABLE systems ADD COLUMN IF NOT EXISTS loop1_bio_degas_m3h  NUMERIC;
ALTER TABLE systems ADD COLUMN IF NOT EXISTS loop1_link_bio_degas BOOLEAN DEFAULT false;
ALTER TABLE systems ADD COLUMN IF NOT EXISTS loop2_name           VARCHAR(255) NOT NULL DEFAULT 'Loop 2';
ALTER TABLE systems ADD COLUMN IF NOT EXISTS loop2_flow_source    VARCHAR(50);
ALTER TABLE systems ADD COLUMN IF NOT EXISTS loop2_filtration     VARCHAR(50);
ALTER TABLE systems ADD COLUMN IF NOT EXISTS loop2_flow_pct       NUMERIC;
ALTER TABLE systems ADD COLUMN IF NOT EXISTS loop2_bio_degas_pct  NUMERIC;
ALTER TABLE systems ADD COLUMN IF NOT EXISTS loop2_bio_degas_m3h  NUMERIC;
ALTER TABLE systems ADD COLUMN IF NOT EXISTS loop2_link_bio_degas BOOLEAN DEFAULT false;
ALTER TABLE systems ADD COLUMN IF NOT EXISTS loop3_name           VARCHAR(255) NOT NULL DEFAULT 'Loop 3';
ALTER TABLE systems ADD COLUMN IF NOT EXISTS loop3_flow_source    VARCHAR(50);
ALTER TABLE systems ADD COLUMN IF NOT EXISTS loop3_filtration     VARCHAR(50);
ALTER TABLE systems ADD COLUMN IF NOT EXISTS loop3_flow_pct       NUMERIC;
ALTER TABLE systems ADD COLUMN IF NOT EXISTS loop3_bio_degas_pct  NUMERIC;
ALTER TABLE systems ADD COLUMN IF NOT EXISTS loop3_bio_degas_m3h  NUMERIC;
ALTER TABLE systems ADD COLUMN IF NOT EXISTS loop3_link_bio_degas BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS system_flow_side_streams (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id          UUID NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  parent_loop_number SMALLINT NOT NULL CHECK (parent_loop_number BETWEEN 1 AND 3),
  name               VARCHAR(255) NOT NULL CHECK (BTRIM(name) <> ''),
  preset             VARCHAR(30),
  flow_pct           NUMERIC(6,3) NOT NULL CHECK (flow_pct >= 0 AND flow_pct <= 100),
  notes              TEXT,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_system_flow_side_streams_parent
  ON system_flow_side_streams(system_id, parent_loop_number, sort_order, created_at);

CREATE TABLE IF NOT EXISTS system_flow_fractionator_allocations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id          UUID NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  parent_loop_number SMALLINT NOT NULL CHECK (parent_loop_number BETWEEN 1 AND 3),
  process_rate_ls_m2 NUMERIC(10,4),
  notes              TEXT,
  products           JSONB NOT NULL DEFAULT '[]'::jsonb,
  calculation_status VARCHAR(40) NOT NULL DEFAULT 'incomplete',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(system_id, parent_loop_number),
  CHECK (process_rate_ls_m2 IS NULL OR process_rate_ls_m2 > 0),
  CHECK (jsonb_typeof(products) = 'array')
);
CREATE INDEX IF NOT EXISTS idx_system_flow_fractionators_parent
  ON system_flow_fractionator_allocations(system_id, parent_loop_number);

-- BIOLOGICAL MEDIA FOUNDATION
-- Profiles are revision records: approved values are immutable and any later
-- change must be represented by a new revision.
CREATE TABLE IF NOT EXISTS lss_biological_media_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_code VARCHAR(80) NOT NULL,
  profile_name VARCHAR(255) NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  water_types TEXT[] NOT NULL DEFAULT '{}',
  reactor_types TEXT[] NOT NULL DEFAULT '{}',
  capacity_model VARCHAR(120),
  capacity_model_version VARCHAR(80),
  capacity_basis_unit VARCHAR(80),
  operating_min_temperature_c NUMERIC,
  operating_max_temperature_c NUMERIC,
  operating_min_salinity_ppt NUMERIC,
  operating_max_salinity_ppt NUMERIC,
  media_min_depth_mm NUMERIC,
  media_max_depth_mm NUMERIC,
  media_void_fraction NUMERIC,
  media_bulk_density_kg_m3 NUMERIC,
  overall_vtr_g_tan_n_m3_d NUMERIC,
  default_safety_factor NUMERIC,
  minimum_media_m3 NUMERIC,
  module_increment_m3 NUMERIC,
  media_fill_fraction NUMERIC,
  operating_min_ph NUMERIC,
  operating_max_ph NUMERIC,
  operating_min_tan_mg_n_l NUMERIC,
  operating_max_tan_mg_n_l NUMERIC,
  operating_min_do_mg_l NUMERIC,
  operating_max_do_mg_l NUMERIC,
  operating_min_flow_m3_h NUMERIC,
  operating_max_flow_m3_h NUMERIC,
  evidence_reference TEXT,
  is_provisional BOOLEAN NOT NULL DEFAULT false,
  provisional_label TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'Draft'
    CHECK (status IN ('Draft', 'In Review', 'Approved', 'Retired')),
  notes TEXT,
  supersedes_id UUID REFERENCES lss_biological_media_profiles(id),
  created_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(profile_code, revision),
  CHECK (operating_min_temperature_c IS NULL OR operating_max_temperature_c IS NULL
    OR operating_min_temperature_c <= operating_max_temperature_c),
  CHECK (operating_min_salinity_ppt IS NULL OR operating_max_salinity_ppt IS NULL
    OR operating_min_salinity_ppt <= operating_max_salinity_ppt),
  CHECK (media_min_depth_mm IS NULL OR media_max_depth_mm IS NULL
    OR media_min_depth_mm <= media_max_depth_mm),
  CHECK (media_void_fraction IS NULL OR (media_void_fraction >= 0 AND media_void_fraction <= 1))
);
CREATE INDEX IF NOT EXISTS idx_lss_bio_media_profiles_code
  ON lss_biological_media_profiles(profile_code, revision DESC);

CREATE TABLE IF NOT EXISTS lss_tan_generation_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_code VARCHAR(80) NOT NULL,
  profile_name VARCHAR(255) NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  coefficient NUMERIC NOT NULL,
  coefficient_unit VARCHAR(120) NOT NULL,
  scope_type VARCHAR(80) NOT NULL,
  scope_unit VARCHAR(80),
  scope_min NUMERIC,
  scope_max NUMERIC,
  evidence_reference TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'Draft'
    CHECK (status IN ('Draft', 'In Review', 'Approved', 'Retired')),
  notes TEXT,
  supersedes_id UUID REFERENCES lss_tan_generation_profiles(id),
  created_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(profile_code, revision),
  CHECK (coefficient > 0),
  CHECK (scope_min IS NULL OR scope_max IS NULL OR scope_min <= scope_max)
);
CREATE INDEX IF NOT EXISTS idx_lss_tan_profiles_code
  ON lss_tan_generation_profiles(profile_code, revision DESC);

CREATE TABLE IF NOT EXISTS lss_biological_media_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id UUID NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  design_book_id UUID NOT NULL REFERENCES design_books(id) ON DELETE CASCADE,
  reactor_type VARCHAR(120),
  media_profile_revision_id UUID REFERENCES lss_biological_media_profiles(id),
  tan_generation_profile_revision_id UUID REFERENCES lss_tan_generation_profiles(id),
  status VARCHAR(30) NOT NULL DEFAULT 'Draft'
    CHECK (status IN ('Draft', 'Incomplete', 'Blocked', 'Valid with Warnings', 'Valid')),
  biomass_method VARCHAR(30),
  water_volume_m3 NUMERIC,
  stocking_density_kg_m3 NUMERIC,
  feed_rate_pct_biomass_day NUMERIC,
  protein_pct NUMERIC,
  manual_daily_feed_kg_d NUMERIC,
  water_type VARCHAR(50),
  temperature_c NUMERIC,
  ph NUMERIC,
  salinity_ppt NUMERIC,
  max_tan_mg_n_l NUMERIC,
  do_in_mg_l NUMERIC,
  do_out_min_mg_l NUMERIC,
  alkalinity_mg_l_caco3 NUMERIC,
  actual_flow_m3_h NUMERIC,
  safety_factor NUMERIC,
  preview_result JSONB,
  preview_input_snapshot JSONB,
  previewed_at TIMESTAMPTZ,
  preview_stale BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(system_id, design_book_id)
);
CREATE INDEX IF NOT EXISTS idx_lss_bio_media_cases_system
  ON lss_biological_media_cases(system_id, design_book_id);

CREATE TABLE IF NOT EXISTS lss_biological_media_species (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES lss_biological_media_cases(id) ON DELETE CASCADE,
  species_profile_id UUID REFERENCES aquarium_species_catalog(id) ON DELETE SET NULL,
  common_name_snapshot VARCHAR(255) NOT NULL,
  scientific_name_snapshot VARCHAR(255),
  life_stage VARCHAR(120),
  quantity INTEGER,
  design_weight_kg NUMERIC,
  entered_weight_kg NUMERIC,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (quantity IS NULL OR quantity >= 0),
  CHECK (design_weight_kg IS NULL OR design_weight_kg > 0)
);
CREATE INDEX IF NOT EXISTS idx_lss_bio_media_species_case
  ON lss_biological_media_species(case_id, sort_order);

CREATE OR REPLACE FUNCTION prevent_approved_biological_media_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'Approved' THEN
    IF TG_OP = 'DELETE'
       OR NEW.status NOT IN ('Approved', 'Retired')
       OR (to_jsonb(OLD) - 'status' - 'updated_at' - 'retired_at'
           IS DISTINCT FROM to_jsonb(NEW) - 'status' - 'updated_at' - 'retired_at') THEN
      RAISE EXCEPTION 'Approved biological media profiles are immutable; create a new revision'
        USING ERRCODE = '55000';
    END IF;
  ELSIF OLD.status = 'Retired' AND TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Retired biological media profiles are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guard_approved_lss_biological_media_profiles
  ON lss_biological_media_profiles;
CREATE TRIGGER guard_approved_lss_biological_media_profiles
BEFORE UPDATE OR DELETE ON lss_biological_media_profiles
FOR EACH ROW EXECUTE FUNCTION prevent_approved_biological_media_mutation();

DROP TRIGGER IF EXISTS guard_approved_lss_tan_profiles
  ON lss_tan_generation_profiles;
CREATE TRIGGER guard_approved_lss_tan_profiles
BEFORE UPDATE OR DELETE ON lss_tan_generation_profiles
FOR EACH ROW EXECUTE FUNCTION prevent_approved_biological_media_mutation();

-- Additive Biological Media preview migration for existing databases.
ALTER TABLE lss_biological_media_profiles ADD COLUMN IF NOT EXISTS overall_vtr_g_tan_n_m3_d NUMERIC;
ALTER TABLE lss_biological_media_profiles ADD COLUMN IF NOT EXISTS default_safety_factor NUMERIC;
ALTER TABLE lss_biological_media_profiles ADD COLUMN IF NOT EXISTS minimum_media_m3 NUMERIC;
ALTER TABLE lss_biological_media_profiles ADD COLUMN IF NOT EXISTS module_increment_m3 NUMERIC;
ALTER TABLE lss_biological_media_profiles ADD COLUMN IF NOT EXISTS media_fill_fraction NUMERIC;
ALTER TABLE lss_biological_media_profiles ADD COLUMN IF NOT EXISTS operating_min_ph NUMERIC;
ALTER TABLE lss_biological_media_profiles ADD COLUMN IF NOT EXISTS operating_max_ph NUMERIC;
ALTER TABLE lss_biological_media_profiles ADD COLUMN IF NOT EXISTS operating_min_tan_mg_n_l NUMERIC;
ALTER TABLE lss_biological_media_profiles ADD COLUMN IF NOT EXISTS operating_max_tan_mg_n_l NUMERIC;
ALTER TABLE lss_biological_media_profiles ADD COLUMN IF NOT EXISTS operating_min_do_mg_l NUMERIC;
ALTER TABLE lss_biological_media_profiles ADD COLUMN IF NOT EXISTS operating_max_do_mg_l NUMERIC;
ALTER TABLE lss_biological_media_profiles ADD COLUMN IF NOT EXISTS operating_min_flow_m3_h NUMERIC;
ALTER TABLE lss_biological_media_profiles ADD COLUMN IF NOT EXISTS operating_max_flow_m3_h NUMERIC;

ALTER TABLE lss_biological_media_cases ADD COLUMN IF NOT EXISTS biomass_method VARCHAR(30);
ALTER TABLE lss_biological_media_cases ADD COLUMN IF NOT EXISTS water_volume_m3 NUMERIC;
ALTER TABLE lss_biological_media_cases ADD COLUMN IF NOT EXISTS stocking_density_kg_m3 NUMERIC;
ALTER TABLE lss_biological_media_cases ADD COLUMN IF NOT EXISTS feed_rate_pct_biomass_day NUMERIC;
ALTER TABLE lss_biological_media_cases ADD COLUMN IF NOT EXISTS protein_pct NUMERIC;
ALTER TABLE lss_biological_media_cases ADD COLUMN IF NOT EXISTS manual_daily_feed_kg_d NUMERIC;
ALTER TABLE lss_biological_media_cases ADD COLUMN IF NOT EXISTS water_type VARCHAR(50);
ALTER TABLE lss_biological_media_cases ADD COLUMN IF NOT EXISTS temperature_c NUMERIC;
ALTER TABLE lss_biological_media_cases ADD COLUMN IF NOT EXISTS ph NUMERIC;
ALTER TABLE lss_biological_media_cases ADD COLUMN IF NOT EXISTS salinity_ppt NUMERIC;
ALTER TABLE lss_biological_media_cases ADD COLUMN IF NOT EXISTS max_tan_mg_n_l NUMERIC;
ALTER TABLE lss_biological_media_cases ADD COLUMN IF NOT EXISTS do_in_mg_l NUMERIC;
ALTER TABLE lss_biological_media_cases ADD COLUMN IF NOT EXISTS do_out_min_mg_l NUMERIC;
ALTER TABLE lss_biological_media_cases ADD COLUMN IF NOT EXISTS alkalinity_mg_l_caco3 NUMERIC;
ALTER TABLE lss_biological_media_cases ADD COLUMN IF NOT EXISTS actual_flow_m3_h NUMERIC;
ALTER TABLE lss_biological_media_cases ADD COLUMN IF NOT EXISTS safety_factor NUMERIC;
ALTER TABLE lss_biological_media_cases ADD COLUMN IF NOT EXISTS preview_result JSONB;
ALTER TABLE lss_biological_media_cases ADD COLUMN IF NOT EXISTS preview_input_snapshot JSONB;
ALTER TABLE lss_biological_media_cases ADD COLUMN IF NOT EXISTS previewed_at TIMESTAMPTZ;
ALTER TABLE lss_biological_media_cases ADD COLUMN IF NOT EXISTS preview_stale BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE lss_biological_media_cases ALTER COLUMN status TYPE VARCHAR(30);
ALTER TABLE lss_biological_media_cases DROP CONSTRAINT IF EXISTS lss_biological_media_cases_status_check;
ALTER TABLE lss_biological_media_cases ADD CONSTRAINT lss_biological_media_cases_status_check
  CHECK (status IN ('Draft', 'Incomplete', 'Blocked', 'Valid with Warnings', 'Valid'));

-- PROCUREMENT FIELDS: vendor, delivery date, payment/shipping terms, priority, UOM
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS vendor_name VARCHAR(255);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS required_by_date DATE;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(100);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS shipping_terms VARCHAR(100);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal';
ALTER TABLE po_items ADD COLUMN IF NOT EXISTS uom VARCHAR(20) DEFAULT 'EA';

-- USERS: last login timestamp for audit awareness
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- PRODUCT HYDRAULICS: optional vendor-specified Venturi flow (m³/h)
ALTER TABLE product_hydraulic ADD COLUMN IF NOT EXISTS venturi_flow_m3h NUMERIC;
`;
async function migrate() {
    const client = await index_1.default.connect();
    try {
        console.log('Running migrations...');
        await client.query(schema);
        console.log('Migrations complete.');
    }
    catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
    finally {
        client.release();
        await index_1.default.end();
    }
}
migrate();
