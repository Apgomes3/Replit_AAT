import crypto from 'crypto';

/** Initial sizing uses fresh water at 20 °C (998.2 kg/m³), not a silent 1000 kg/m³ assumption. */
export const PUMP_SELECTION_CALCULATION_VERSION = 'pump-selection-v1';
export const WATER_DENSITY_KG_M3 = 998.2;
export const GRAVITY_M_S2 = 9.80665;
export const STANDARD_MOTOR_SIZES_KW = [
  0.09, 0.12, 0.18, 0.25, 0.37, 0.55, 0.75, 1.1, 1.5, 2.2, 3, 4, 5.5,
  7.5, 11, 15, 18.5, 22, 30, 37, 45, 55, 75, 90, 110, 132, 160, 200, 250, 315,
] as const;

/** The exact circuit_type string used for Foam Fractionator loops in Flow Route. */
export const FOAM_FRACTIONATION_CIRCUIT_TYPE = 'Foam Fractionation';

/** Stable role identifiers for pump lines within a single circuit. */
export const PUMP_ROLE_PRIMARY = 'primary';
export const PUMP_ROLE_VENTURI = 'venturi';

/** True when the circuit belongs to a Foam Fractionator loop. */
export function isFoamFractionatorCircuit(circuit: {
  circuit_kind?: string | null;
  circuit_type?: string | null;
}) {
  return (
    circuit.circuit_kind === 'loop' &&
    circuit.circuit_type === FOAM_FRACTIONATION_CIRCUIT_TYPE
  );
}

/**
 * Default display name for a pump role on a given circuit.
 * Non-FF circuits always use a generic label; FF circuits use the
 * well-known FFSP / FFVP designations.
 */
export function defaultPumpLineName(
  circuit: { circuit_name?: string | null; circuit_type?: string | null; circuit_kind?: string | null },
  role: string,
): string {
  if (isFoamFractionatorCircuit(circuit)) {
    if (role === PUMP_ROLE_VENTURI) return 'FFVP — Foam Fractionator Venturi Pump';
    return 'FFSP — Foam Fractionator Supply Pump';
  }
  return circuit.circuit_name || 'Circuit Pump';
}

const positive = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};
const nullableNumber = (value: unknown) =>
  value === null || value === undefined || value === '' ? null :
    Number.isFinite(Number(value)) ? Number(value) : null;
const round = (value: number | null, places = 3) =>
  value == null ? null : Number(value.toFixed(places));

export function pumpSourceFingerprint(source: unknown) {
  const canonical = JSON.stringify(source, (_, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.keys(value).sort().reduce((out: any, key) => { out[key] = value[key]; return out; }, {})
      : value);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/** Flow Route circuits use the Design Book's resolved system flow as input. */
export function pumpCircuits(system: any, sideStreams: any[]) {
  const baseFlow = nullableNumber(system.design_flow_m3h);
  const activeLoops = [1, 2, 3].filter(n =>
    system[`loop${n}_flow_source`] || system[`loop${n}_filtration`] || system[`loop${n}_flow_pct`] != null ||
    (sideStreams || []).some(stream => Number(stream.parent_loop_number) === n));
  return [
    ...activeLoops.map(number => {
      const pct = nullableNumber(system[`loop${number}_flow_pct`]);
      return {
        circuit_key: `loop:${number}`, circuit_kind: 'loop', circuit_name: system[`loop${number}_name`] || `Loop ${number}`,
        circuit_type: system[`loop${number}_filtration`] || system[`loop${number}_flow_source`] || null,
        parent_loop_number: number, side_stream_id: null,
        flow_m3h: baseFlow != null && pct != null ? baseFlow * pct / 100 : null,
      };
    }),
    ...(sideStreams || []).map(stream => {
      const pct = nullableNumber(system[`loop${stream.parent_loop_number}_flow_pct`]);
      const branch = nullableNumber(stream.flow_pct);
      return {
        circuit_key: `side_stream:${stream.id}`, circuit_kind: 'side_stream', circuit_name: stream.name,
        circuit_type: stream.preset || 'Custom', parent_loop_number: stream.parent_loop_number, side_stream_id: stream.id,
        flow_m3h: baseFlow != null && pct != null && branch != null ? baseFlow * pct / 100 * branch / 100 : null,
      };
    }),
  ];
}

/** Pure, versioned pump sizing calculation. Missing required values are incomplete, never zero. */
export function calculatePumpSelection(input: {
  flow_m3h?: unknown; design_head_m?: unknown; pump_efficiency_pct?: unknown; motor_efficiency_pct?: unknown;
  calculated_at?: string;
}) {
  const flow = positive(input.flow_m3h);
  const head = positive(input.design_head_m);
  const pumpEfficiency = positive(input.pump_efficiency_pct);
  const motorEfficiency = positive(input.motor_efficiency_pct);
  const reasons: string[] = [];
  if (flow == null) reasons.push('Circuit flow is missing or must be greater than zero.');
  if (head == null) reasons.push('Design head must be greater than zero.');
  if (pumpEfficiency == null || pumpEfficiency > 100) reasons.push('Pump efficiency must be greater than 0% and no more than 100%.');
  if (motorEfficiency == null || motorEfficiency > 100) reasons.push('Motor efficiency must be greater than 0% and no more than 100%.');
  const hydraulic = flow == null || head == null ? null :
    WATER_DENSITY_KG_M3 * GRAVITY_M_S2 * (flow / 3600) * head / 1000;
  const shaft = hydraulic == null || pumpEfficiency == null || pumpEfficiency > 100 ? null : hydraulic / (pumpEfficiency / 100);
  const motor = shaft == null || motorEfficiency == null || motorEfficiency > 100 ? null : shaft / (motorEfficiency / 100);
  const recommended = motor == null ? null : STANDARD_MOTOR_SIZES_KW.find(size => size >= motor) || null;
  if (motor != null && recommended == null) {
    reasons.push(
      `Calculated motor input ${round(motor)} kW exceeds the largest configured standard motor size of ${STANDARD_MOTOR_SIZES_KW[STANDARD_MOTOR_SIZES_KW.length - 1]} kW.`,
    );
  }
  return {
    calculation_version: PUMP_SELECTION_CALCULATION_VERSION,
    calculated_at: input.calculated_at || new Date().toISOString(),
    status: reasons.length ? 'incomplete' : 'ready',
    reasons,
    constants: { water_density_kg_m3: WATER_DENSITY_KG_M3, gravity_m_s2: GRAVITY_M_S2, motor_sizes_kw: STANDARD_MOTOR_SIZES_KW },
    inputs: { flow_m3h: flow, design_head_m: head, pump_efficiency_pct: pumpEfficiency, motor_efficiency_pct: motorEfficiency },
    formula: 'hydraulic kW = 998.2 kg/m³ × 9.80665 m/s² × Q(m³/s) × head(m) ÷ 1000; shaft = hydraulic ÷ pump efficiency; motor input = shaft ÷ motor efficiency',
    results: {
      hydraulic_power_kw: round(hydraulic), shaft_power_kw: round(shaft), motor_input_kw: round(motor),
      recommended_motor_kw: recommended,
    },
  };
}

/**
 * Checks catalog evidence against the requested duty.  A missing catalog
 * rating is deliberately not treated as proof of capacity.
 */
export function evaluateSelectedPumpSuitability(input: {
  selectedPump?: any | null; circuitFlowM3h?: unknown; designHeadM?: unknown; calculation?: any;
}) {
  const selected = input.selectedPump;
  if (!selected) return { status: 'incomplete' as const, reasons: [] as string[] };
  const requiredPower = nullableNumber(input.calculation?.results?.recommended_motor_kw) ??
    nullableNumber(input.calculation?.results?.motor_input_kw);
  const requiredFlow = nullableNumber(input.circuitFlowM3h);
  const requiredHead = nullableNumber(input.designHeadM);
  const availablePower = nullableNumber(selected.power_kw);
  const availableFlow = nullableNumber(selected.design_flow_m3h);
  const availableHead = nullableNumber(selected.design_head_m);
  const reasons: string[] = [];
  let incompatible = false;
  if (requiredPower != null && availablePower == null) {
    reasons.push(`Selected pump has no catalog power rating; at least ${requiredPower} kW is required.`);
  } else if (requiredPower != null && availablePower != null && availablePower < requiredPower) {
    incompatible = true;
    reasons.push(`Selected pump catalog power is ${availablePower} kW; at least ${requiredPower} kW is required.`);
  }
  if (requiredFlow != null && availableFlow != null && availableFlow < requiredFlow) {
    incompatible = true;
    reasons.push(`Selected pump catalog design flow is ${availableFlow} m³/h; circuit requires ${requiredFlow} m³/h.`);
  }
  if (requiredHead != null && availableHead != null && availableHead < requiredHead) {
    incompatible = true;
    reasons.push(`Selected pump catalog design head is ${availableHead} m; circuit requires ${requiredHead} m.`);
  }
  return { status: incompatible ? 'incompatible' as const : reasons.length ? 'incomplete' as const : 'ready' as const, reasons };
}

/**
 * Build a single pump-line item from a circuit descriptor and an optional
 * saved database row.  `role` is 'primary' or 'venturi'.
 *
 * For FFVP lines the effective sizing flow comes from `row.venturi_flow_m3h`
 * rather than the circuit's authoritative flow, because the venturi duty is
 * independently specified and must not silently fall back to the supply-pump
 * circuit flow.
 */
export function buildPumpLineItem(
  circuit: {
    circuit_key: string; circuit_kind: string; circuit_name: string;
    circuit_type?: string | null; parent_loop_number?: number | null;
    side_stream_id?: string | null; flow_m3h?: number | null;
  },
  row: any | null,
  role: string,
) {
  const isVenturi = role === PUMP_ROLE_VENTURI;
  const isFF = isFoamFractionatorCircuit(circuit);

  // The venturi line uses its own independently supplied flow; never fall back
  // to the circuit supply flow when that would misrepresent the duty.
  const effectiveFlow = isVenturi
    ? (row?.venturi_flow_m3h != null ? Number(row.venturi_flow_m3h) : null)
    : circuit.flow_m3h;

  const sourcePayload = {
    circuit: {
      circuit_key: circuit.circuit_key, circuit_kind: circuit.circuit_kind,
      circuit_name: circuit.circuit_name, circuit_type: circuit.circuit_type,
      parent_loop_number: circuit.parent_loop_number, side_stream_id: circuit.side_stream_id,
      flow_m3h: circuit.flow_m3h,
    },
    pump_role: role,
    ...(isVenturi ? { venturi_flow_m3h: effectiveFlow } : {}),
    design_head_m: row?.design_head_m != null ? Number(row.design_head_m) : null,
    pump_efficiency_pct: row?.pump_efficiency_pct != null ? Number(row.pump_efficiency_pct) : null,
    motor_efficiency_pct: row?.motor_efficiency_pct != null ? Number(row.motor_efficiency_pct) : null,
  };

  const fingerprint = pumpSourceFingerprint(sourcePayload);
  // Rows saved before multi-role support used this payload shape. Preserve
  // their freshness until they are next explicitly recalculated.
  const legacyFingerprint = pumpSourceFingerprint({
    circuit: sourcePayload.circuit,
    design_head_m: sourcePayload.design_head_m,
    pump_efficiency_pct: sourcePayload.pump_efficiency_pct,
    motor_efficiency_pct: sourcePayload.motor_efficiency_pct,
  });
  const calculation = calculatePumpSelection({
    flow_m3h: effectiveFlow,
    design_head_m: row?.design_head_m,
    pump_efficiency_pct: row?.pump_efficiency_pct,
    motor_efficiency_pct: row?.motor_efficiency_pct,
  });
  const suitability = evaluateSelectedPumpSuitability({
    selectedPump: row?.pump_snapshot,
    circuitFlowM3h: effectiveFlow,
    designHeadM: row?.design_head_m,
    calculation,
  });

  const orphaned = circuit.circuit_kind === 'orphaned';
  const versionStale = !!row && row.calculation_version !== PUMP_SELECTION_CALCULATION_VERSION;
  // Real persisted rows always have a fingerprint (the column is NOT NULL).
  // Treat fingerprint-less legacy/test rows as incomplete rather than stale so
  // the actionable missing-duty message remains visible.
  const sourceMatches = row?.source_fingerprint === fingerprint ||
    (role === PUMP_ROLE_PRIMARY && row?.source_fingerprint === legacyFingerprint);
  const stale = !!row && !!row.source_fingerprint && (!sourceMatches || versionStale);

  const venturiFlowMissing = isVenturi && effectiveFlow == null;
  const reasons = orphaned
    ? ['This saved selection references a Flow Route circuit that no longer exists.']
    : [
        ...(venturiFlowMissing ? ['Venturi duty flow is required and must be greater than zero. Enter the venturi pump flow before saving.'] : []),
        ...(row && row.source_fingerprint && !sourceMatches ? ['Flow Route or sizing inputs changed after this pump calculation was saved. Save and calculate again.'] : []),
        ...(versionStale ? [`Pump sizing calculation version ${row.calculation_version} is outdated; recalculate using ${PUMP_SELECTION_CALCULATION_VERSION}.`] : []),
        ...(row?.project_equipment_item_id && row?.pump_snapshot ? [] : ['Select a pump assigned to this LSS system.']),
        ...calculation.reasons.filter(r => !venturiFlowMissing || !r.includes('Circuit flow')),
        ...suitability.reasons,
      ];

  return {
    ...circuit,
    pump_role: role,
    pump_role_name: defaultPumpLineName(circuit, role),
    is_foam_fractionator: isFF,
    ...(isVenturi ? { venturi_flow_m3h: row?.venturi_flow_m3h != null ? Number(row.venturi_flow_m3h) : null } : {}),
    effective_flow_m3h: effectiveFlow,
    project_equipment_item_id: row?.project_equipment_item_id || null,
    selected_pump: row?.pump_snapshot || null,
    design_head_m: row?.design_head_m == null ? null : Number(row.design_head_m),
    pump_efficiency_pct: row?.pump_efficiency_pct == null ? null : Number(row.pump_efficiency_pct),
    motor_efficiency_pct: row?.motor_efficiency_pct == null ? null : Number(row.motor_efficiency_pct),
    source_fingerprint: row?.source_fingerprint || null,
    current_source_fingerprint: fingerprint,
    freshness: row ? (stale ? 'stale' : 'fresh') : 'unsaved',
    status: orphaned ? 'stale'
      : suitability.status === 'incompatible' ? 'incompatible'
      : stale ? 'stale'
      : reasons.length ? 'incomplete'
      : calculation.status,
    reasons,
    calculation_version: row?.calculation_version || PUMP_SELECTION_CALCULATION_VERSION,
    results: row ? (row.result_snapshot?.results || row.result_snapshot || calculation.results) : calculation.results,
  };
}

/**
 * Returns the pump-line items for a single circuit.
 * Non-FF circuits: exactly one line (role='primary').
 * Foam Fractionator circuits: always one FFSP line; add FFVP line only when
 * a venturi row is already saved — the UI manages the Yes/No question.
 */
export function pumpLinesForCircuit(circuit: any, savedRows: any[]): any[] {
  const circuitRows = savedRows.filter(
    row => row.circuit_key === circuit.circuit_key,
  );
  const isFF = isFoamFractionatorCircuit(circuit);

  if (!isFF) {
    const row = circuitRows.find(r => (r.pump_role || PUMP_ROLE_PRIMARY) === PUMP_ROLE_PRIMARY) || null;
    return [buildPumpLineItem(circuit, row, PUMP_ROLE_PRIMARY)];
  }

  // Foam Fractionator: FFSP is always present; FFVP only if a venturi row was saved.
  const primaryRow = circuitRows.find(r => (r.pump_role || PUMP_ROLE_PRIMARY) === PUMP_ROLE_PRIMARY) || null;
  const venturiRow = circuitRows.find(r => r.pump_role === PUMP_ROLE_VENTURI) || null;
  const lines = [buildPumpLineItem(circuit, primaryRow, PUMP_ROLE_PRIMARY)];
  if (venturiRow) lines.push(buildPumpLineItem(circuit, venturiRow, PUMP_ROLE_VENTURI));
  return lines;
}
