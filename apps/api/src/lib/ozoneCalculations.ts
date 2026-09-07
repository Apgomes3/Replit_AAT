export const OZONE_CALCULATION_VERSION = 'OZONE_1_0';

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