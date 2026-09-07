export const OZONE_CALCULATION_VERSION = 'OZONE_1_0';
export const OZONE_SELECTION_VERSION = 'OZONE_SELECTION_1_0';

export type OzonePumpLine = {
  circuit_key?: string | null;
  pump_duty_tag?: string | null;
  pump_role?: string | null;
  flow_m3h?: number | string | null;
  venturi_flow_m3h?: number | string | null;
};

const positive = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export function convertOzoneRate(mgPerHour: number, unit: string) {
  if (unit === 'g/h') return mgPerHour / 1_000;
  if (unit === 'lb/h') return mgPerHour / 453_592.37;
  return mgPerHour;
}

export function calculateOzoneRequirement(input: {
  target_concentration_mg_l: unknown;
  pump_lines: OzonePumpLine[];
  ffvp_plenum_circuit_keys?: string[];
}) {
  const target = positive(input.target_concentration_mg_l);
  const selectedVenturiCircuits = new Set(input.ffvp_plenum_circuit_keys || []);
  const ffspLines = input.pump_lines.filter(line => line.pump_duty_tag === 'FFSP');
  const ffvpLines = input.pump_lines.filter(line =>
    line.pump_duty_tag === 'FFVP' || line.pump_role === 'venturi');
  const ffspFlow = ffspLines.reduce((sum, line) => sum + (positive(line.flow_m3h) || 0), 0);
  const applicableFfvp = ffvpLines.filter(line =>
    !!line.circuit_key && selectedVenturiCircuits.has(line.circuit_key));
  const ffvpFlow = applicableFfvp.reduce((sum, line) => sum + (positive(line.venturi_flow_m3h) || 0), 0);
  const reasons = [
    ...(target == null ? ['Target ozone concentration must be greater than zero.'] : []),
    ...(ffspFlow <= 0 ? ['A positive FFSP water flow is required before ozone can be calculated.'] : []),
    ...applicableFfvp
      .filter(line => positive(line.venturi_flow_m3h) == null)
      .map(line => `FFVP flow is missing for ${line.circuit_key}.`),
  ];
  const totalFlow = ffspFlow + ffvpFlow;
  const requiredMgH = reasons.length || target == null ? null : target * totalFlow * 1_000;
  return {
    status: reasons.length ? 'blocked' : 'ready',
    reasons,
    calculation_version: OZONE_CALCULATION_VERSION,
    target_concentration_mg_l: target,
    ffsp_flow_m3h: ffspFlow,
    applicable_ffvp_flow_m3h: ffvpFlow,
    total_treatment_flow_m3h: totalFlow,
    ozone_required_mg_h: requiredMgH,
    ozone_required_g_h: requiredMgH == null ? null : convertOzoneRate(requiredMgH, 'g/h'),
    ozone_required_lb_h: requiredMgH == null ? null : convertOzoneRate(requiredMgH, 'lb/h'),
    ffsp_lines: ffspLines,
    ffvp_lines: ffvpLines,
    applicable_ffvp_lines: applicableFfvp,
  };
}

export type OzoneGeneratorProduct = {
  id: string;
  product_code: string;
  product_name: string;
  model?: string | null;
  ozone_production_capacity_g_h: number | string | null;
};

/** Select one PIM generator model repeated as necessary. Product capacity is authoritative. */
export function selectOzoneGenerator(requiredGPerHour: unknown, products: OzoneGeneratorProduct[], context: Record<string, unknown> = {}) {
  const required = positive(requiredGPerHour);
  if (required == null) {
    return { validation_status: 'FAIL', reason: 'A positive required ozone capacity is required.', calculation_selection_version: OZONE_SELECTION_VERSION, ...context };
  }
  const candidates = products
    .map(product => ({ ...product, capacity: positive(product.ozone_production_capacity_g_h) }))
    .filter((product): product is OzoneGeneratorProduct & { capacity: number } => product.capacity != null)
    .map(product => {
      const quantity = Math.ceil(required / product.capacity);
      const total = product.capacity * quantity;
      const ratio = total / required;
      const oversize = (ratio - 1) * 100;
      return {
        product_id: product.id, product_code: product.product_code, product_name: product.product_name,
        model: product.model || null, per_unit_capacity_g_h: product.capacity, quantity,
        total_installed_capacity_g_h: total, required_capacity_g_h: required, capacity_ratio: ratio,
        oversize_percent: oversize, validation_status: 'PASS',
        advisory_note: oversize > 30
          ? `Closest available ozone generator configuration provides ${oversize.toFixed(1)}% more capacity than the calculated requirement.`
          : null,
      };
    })
    .sort((a, b) =>
      a.total_installed_capacity_g_h - b.total_installed_capacity_g_h
      || a.quantity - b.quantity
      || a.product_code.localeCompare(b.product_code)
      || a.product_id.localeCompare(b.product_id));
  if (!candidates.length) {
    return { validation_status: 'FAIL', reason: 'No active PIM ozone generator has a positive ozone production capacity.', required_capacity_g_h: required, calculation_selection_version: OZONE_SELECTION_VERSION, ...context };
  }
  return { ...candidates[0], calculation_selection_version: OZONE_SELECTION_VERSION, ...context };
}