export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'engineer' | 'viewer';
}

export interface Project {
  id: string;
  project_code: string;
  project_name: string;
  client_name?: string;
  site_name?: string;
  country?: string;
  city?: string;
  project_status: string;
  start_date?: string;
  target_completion_date?: string;
  project_manager?: string;
  engineering_manager?: string;
  created_at: string;
}

export interface Area {
  id: string;
  area_code: string;
  project_id: string;
  project_code?: string;
  area_name: string;
  discipline_scope?: string;
  status: string;
}

export interface Exhibit {
  id: string;
  exhibit_code: string;
  project_id: string;
  area_id: string;
  area_name?: string;
  exhibit_name: string;
  water_type?: string;
  design_temperature_min?: number;
  design_temperature_max?: number;
  design_salinity?: number;
  status: string;
}

export interface Tank {
  id: string;
  tank_code: string;
  project_id: string;
  exhibit_id?: string;
  exhibit_name?: string;
  tank_name: string;
  tank_type?: string;
  shape_type?: string;
  gross_volume_m3?: number;
  operating_volume_m3?: number;
  primary_material?: string;
  status: string;
}

export interface System {
  id: string;
  system_code: string;
  project_id: string;
  project_code?: string;
  area_id?: string;
  exhibit_id?: string;
  area_name?: string;
  exhibit_name?: string;
  system_name: string;
  system_type?: string;
  design_flow_m3h?: number;
  turnover_rate_hr?: number;
  water_type?: string;
  status: string;
  equipment?: EquipmentInstance[];
}

export interface EquipmentInstance {
  id: string;
  equipment_code: string;
  project_id: string;
  project_code?: string;
  system_id?: string;
  system_code?: string;
  system_name?: string;
  equipment_type?: string;
  equipment_name: string;
  product_code?: string;
  product_name?: string;
  design_flow_m3h?: number;
  power_kw?: number;
  material_code?: string;
  material_name?: string;
  status: string;
}

export interface ProductFamily {
  id: string;
  product_family_code: string;
  product_family_name: string;
  category_code?: string;
  status: string;
  product_count?: number;
  products?: ProductMaster[];
}

export interface ProductMaster {
  id: string;
  product_code: string;
  product_family_id?: string;
  product_family_name?: string;
  product_name: string;
  product_category?: string;
  application_type?: string;
  design_flow_m3h?: number;
  design_pressure_bar?: number;
  design_head_m?: number;
  power_kw?: number;
  primary_material_code?: string;
  material_name?: string;
  standard_status: string;
  notes?: string;
  variants?: ProductVariant[];
  boms?: StandardBOM[];
  vendors?: VendorOption[];
  projects?: { project_code: string; project_name: string; project_status: string }[];
}

export interface ProductVariant {
  id: string;
  variant_code: string;
  product_master_id: string;
  product_code?: string;
  variant_name: string;
  variant_reason?: string;
  override_material_code?: string;
  override_power_kw?: number;
  status: string;
}

export interface StandardBOM {
  id: string;
  bom_code: string;
  product_master_id: string;
  product_code?: string;
  revision_code: string;
  status: string;
  effective_from: string;
  lines?: BOMLine[];
}

export interface BOMLine {
  id: string;
  line_number: number;
  component_type?: string;
  component_reference_code?: string;
  component_name?: string;
  quantity: number;
  unit?: string;
  is_optional: boolean;
  remarks?: string;
}

export interface VendorOption {
  id: string;
  vendor_option_code: string;
  product_master_id: string;
  vendor_name?: string;
  manufacturer_name?: string;
  vendor_item_code?: string;
  approved_status: string;
  lead_time_days?: number;
  region_scope?: string;
  status: string;
}

export interface Material {
  id: string;
  material_code: string;
  material_name: string;
  material_category?: string;
  density?: number;
  chemical_resistance?: string;
  temperature_limit?: number;
  status: string;
  products?: { product_code: string; product_name: string }[];
}

export interface Specification {
  id: string;
  spec_code: string;
  spec_name: string;
  spec_type?: string;
  standard_reference?: string;
  discipline?: string;
  status: string;
  description?: string;
}

export interface DesignRule {
  id: string;
  rule_code: string;
  rule_name: string;
  discipline?: string;
  applies_to?: string;
  rule_description?: string;
  reference_spec?: string;
  status: string;
}

export interface CalculationTemplate {
  id: string;
  template_code: string;
  template_name: string;
  discipline?: string;
  applies_to?: string;
  description?: string;
  formula_notes?: string;
  status: string;
}

export interface Component {
  id: string;
  component_code: string;
  component_name: string;
  component_type?: string;
  component_category?: string;
  description?: string;
  primary_material_code?: string;
  material_name?: string;
  standard_size?: string;
  weight_kg?: number;
  unit?: string;
  status: string;
  notes?: string;
  created_at: string;
}

export interface Document {
  id: string;
  document_code: string;
  document_title: string;
  document_type?: string;
  discipline?: string;
  project_id?: string;
  project_code?: string;
  project_name?: string;
  current_revision: string;
  status: string;
  owner?: string;
  revisions?: DocumentRevision[];
  approvals?: Approval[];
}

export interface DocumentRevision {
  id: string;
  document_id: string;
  revision_code: string;
  revision_purpose?: string;
  status: string;
  issued_by?: string;
  issued_by_name?: string;
  issued_at?: string;
  file_path?: string;
  file_name?: string;
  file_size?: number;
  created_at: string;
}

export interface Approval {
  id: string;
  document_id: string;
  approver_id: string;
  approver_name?: string;
  role?: string;
  action: string;
  comment?: string;
  acted_at: string;
}

export interface ChangeRequest {
  id: string;
  change_code: string;
  project_id?: string;
  title: string;
  change_reason?: string;
  risk_level: string;
  status: string;
  affected_entities: string[];
  requested_by_name?: string;
  created_at: string;
}

export interface LifecycleTransition {
  id: string;
  entity_type: string;
  entity_id: string;
  from_state?: string;
  to_state: string;
  actor_name?: string;
  comment?: string;
  transitioned_at: string;
}

export interface SearchResult {
  type: string;
  id: string;
  code: string;
  name: string;
  status?: string;
  project_code?: string;
}

export interface GraphNode {
  id: string;
  type: string;
  code: string;
  name: string;
  domain: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

export interface Pagination {
  page: number;
  page_size: number;
  total: number;
}

export type LifecycleStatus = 'Draft' | 'Internal Review' | 'Review Commented' | 'Resubmitted' | 'Approved' | 'Released' | 'As-Built' | 'Superseded' | 'Obsolete' | 'Active' | 'Concept' | 'Completed' | 'Archived';
