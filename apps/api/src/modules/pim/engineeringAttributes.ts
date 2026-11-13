// The engineering facts the calculators, design books and TDS read. They stay as typed columns
// (proposal §4.4, the "Pimcore rule") and are registered in the attribute library so they look and
// behave like any other attribute. This list is also the allow-list for reading those columns —
// table and column names are never taken from the database or the request.

export type EngineeringAttribute = {
  code: string;
  label: string;
  group: string;
  measure: string | null;
  /** Unit the typed column is stored in. */
  unit: string | null;
  table: 'product_masters' | 'product_hydraulic' | 'product_electrical' | 'product_dimensions' | 'product_thermal';
  column: string;
  dataType?: 'number' | 'text';
};

const h = (code: string, label: string, measure: string, unit: string, column: string): EngineeringAttribute =>
  ({ code, label, group: 'hydraulic', measure, unit, table: 'product_hydraulic', column });
const e = (code: string, label: string, measure: string | null, unit: string | null, column: string): EngineeringAttribute =>
  ({ code, label, group: 'electrical', measure, unit, table: 'product_electrical', column });
const d = (code: string, label: string, measure: string, unit: string, column: string): EngineeringAttribute =>
  ({ code, label, group: 'dimensions', measure, unit, table: 'product_dimensions', column });

export const ENGINEERING_ATTRIBUTES: EngineeringAttribute[] = [
  h('design_flow', 'Design flow', 'flow', 'm3_h', 'design_flow_m3h'),
  h('min_flow', 'Minimum flow', 'flow', 'm3_h', 'min_flow_m3h'),
  h('max_flow', 'Maximum flow', 'flow', 'm3_h', 'max_flow_m3h'),
  h('venturi_flow', 'Venturi flow', 'flow', 'm3_h', 'venturi_flow_m3h'),
  h('design_head', 'Design head', 'length', 'm', 'design_head_m'),
  h('design_pressure', 'Design pressure', 'pressure', 'bar', 'design_pressure_bar'),
  h('max_pressure', 'Maximum pressure', 'pressure', 'bar', 'max_pressure_bar'),
  h('friction_loss', 'Friction loss', 'pressure', 'mh2o', 'friction_loss_mh2o'),
  h('npsh_required', 'NPSH required', 'length', 'm', 'npsh_required_m'),
  h('suction_dn', 'Suction size (DN)', 'length', 'mm', 'suction_dn_mm'),
  h('discharge_dn', 'Discharge size (DN)', 'length', 'mm', 'discharge_dn_mm'),
  h('min_temperature', 'Minimum temperature', 'temperature', 'c', 'min_temperature_c'),
  h('max_temperature', 'Maximum temperature', 'temperature', 'c', 'max_temperature_c'),
  e('rated_power', 'Rated power', 'power', 'kw', 'rated_power_kw'),
  e('lamp_power', 'Lamp power', 'power', 'w', 'lamp_power_w'),
  e('voltage', 'Voltage', 'voltage', 'v', 'voltage_v'),
  e('phases', 'Phases', null, null, 'phases'),
  e('frequency', 'Frequency', 'frequency', 'hz', 'frequency_hz'),
  e('full_load_current', 'Full load current', 'current', 'a', 'full_load_current_a'),
  e('rated_speed', 'Rated speed', 'speed', 'rpm', 'rated_speed_rpm'),
  d('length', 'Length', 'length', 'mm', 'length_mm'),
  d('width', 'Width', 'length', 'mm', 'width_mm'),
  d('height', 'Height', 'length', 'mm', 'height_mm'),
  d('diameter', 'Diameter', 'length', 'mm', 'diameter_mm'),
  d('weight', 'Weight', 'mass', 'kg', 'weight_kg'),
  d('inlet_dn', 'Inlet size (DN)', 'length', 'mm', 'inlet_dn_mm'),
  d('outlet_dn', 'Outlet size (DN)', 'length', 'mm', 'outlet_dn_mm'),
  d('sand_media_mass', 'Sand media per filter', 'mass', 'kg', 'sand_media_per_filter_kg'),
  { code: 'uv_lamp_count', label: 'UV lamp count', group: 'electrical', measure: null, unit: null, table: 'product_masters', column: 'lamp_count' },
  { code: 'ozone_output', label: 'Ozone output', group: 'water_quality', measure: 'mass_rate', unit: 'g_h', table: 'product_masters', column: 'ozone_production_capacity_g_h' },
  { code: 'operating_volume', label: 'Operating volume', group: 'dimensions', measure: 'volume', unit: 'm3', table: 'product_masters', column: 'operating_volume_m3' },
  { code: 'gross_volume', label: 'Gross volume', group: 'dimensions', measure: 'volume', unit: 'm3', table: 'product_masters', column: 'gross_volume_m3' },
  { code: 'operating_temperature_min', label: 'Operating temperature (min)', group: 'thermal', measure: 'temperature', unit: 'c', table: 'product_thermal', column: 'operating_temperature_min_c' },
  { code: 'operating_temperature_max', label: 'Operating temperature (max)', group: 'thermal', measure: 'temperature', unit: 'c', table: 'product_thermal', column: 'operating_temperature_max_c' },
];

export const ENGINEERING_BY_CODE = new Map(ENGINEERING_ATTRIBUTES.map(a => [a.code, a]));

export const ATTRIBUTE_GROUPS: Array<[code: string, name: string]> = [
  ['general', 'General'],
  ['hydraulic', 'Hydraulic'],
  ['electrical', 'Electrical'],
  ['dimensions', 'Dimensions'],
  ['thermal', 'Thermal'],
  ['pneumatic', 'Pneumatic'],
  ['water_quality', 'Water quality'],
  ['materials', 'Materials'],
  ['commercial', 'Commercial'],
];
