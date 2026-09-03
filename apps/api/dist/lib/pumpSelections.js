"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PUMP_DUTY_TYPES = exports.PUMP_ROLE_VENTURI = exports.PUMP_ROLE_PRIMARY = exports.SAND_FILTER_CIRCUIT_TYPE = exports.FOAM_FRACTIONATION_CIRCUIT_TYPE = exports.STANDARD_MOTOR_SIZES_KW = exports.GRAVITY_M_S2 = exports.WATER_DENSITY_KG_M3 = exports.PUMP_SELECTION_CALCULATION_VERSION = void 0;
exports.isFoamFractionatorCircuit = isFoamFractionatorCircuit;
exports.isSandFilterCircuit = isSandFilterCircuit;
exports.pumpDutyTag = pumpDutyTag;
exports.inferredPumpDutyTag = inferredPumpDutyTag;
exports.pumpFlowRouteRole = pumpFlowRouteRole;
exports.inferPumpDutyType = inferPumpDutyType;
exports.resolvePumpDutyType = resolvePumpDutyType;
exports.systemNumberToken = systemNumberToken;
exports.buildPumpTags = buildPumpTags;
exports.defaultPumpLineName = defaultPumpLineName;
exports.pumpSourceFingerprint = pumpSourceFingerprint;
exports.pumpSourcePayload = pumpSourcePayload;
exports.pumpCircuits = pumpCircuits;
exports.calculatePumpSelection = calculatePumpSelection;
exports.evaluateSelectedPumpSuitability = evaluateSelectedPumpSuitability;
exports.buildPumpLineItem = buildPumpLineItem;
exports.pumpLinesForCircuit = pumpLinesForCircuit;
const crypto_1 = __importDefault(require("crypto"));
const flowRoute_1 = require("./flowRoute");
/** Initial sizing uses fresh water at 20 °C (998.2 kg/m³), not a silent 1000 kg/m³ assumption. */
exports.PUMP_SELECTION_CALCULATION_VERSION = 'pump-selection-v1';
exports.WATER_DENSITY_KG_M3 = 998.2;
exports.GRAVITY_M_S2 = 9.80665;
exports.STANDARD_MOTOR_SIZES_KW = [
    0.09, 0.12, 0.18, 0.25, 0.37, 0.55, 0.75, 1.1, 1.5, 2.2, 3, 4, 5.5,
    7.5, 11, 15, 18.5, 22, 30, 37, 45, 55, 75, 90, 110, 132, 160, 200, 250, 315,
];
/** The exact circuit_type string used for Foam Fractionator loops in Flow Route. */
exports.FOAM_FRACTIONATION_CIRCUIT_TYPE = 'Foam Fractionation';
/** The exact circuit_type string used for Sand Filter main-loop circuits. */
exports.SAND_FILTER_CIRCUIT_TYPE = 'Sand Filter';
/** Stable role identifiers for pump lines within a single circuit. */
exports.PUMP_ROLE_PRIMARY = 'primary';
exports.PUMP_ROLE_VENTURI = 'venturi';
exports.DEFAULT_PUMP_DUTY_TYPES = [
    { tag: 'FFSP', pump_name: 'Foam Fractionator Supply Pump', flow_route_role: 'foam_fractionator_supply' },
    { tag: 'FFVP', pump_name: 'Foam Fractionator Venturi Pump', flow_route_role: 'foam_fractionator_venturi' },
    { tag: 'SFSP', pump_name: 'Sand Filter Supply Pump', flow_route_role: 'sand_filter_supply' },
    { tag: 'CIRCP', pump_name: 'Circulation Pump', flow_route_role: 'circulation' },
    { tag: 'VACP', pump_name: 'Vacuum Pump', flow_route_role: 'vacuum' },
];
/** True when the circuit belongs to a Foam Fractionator loop. */
function isFoamFractionatorCircuit(circuit) {
    return (circuit.circuit_kind === 'loop' &&
        circuit.circuit_type === exports.FOAM_FRACTIONATION_CIRCUIT_TYPE);
}
/** True when the circuit is a main-loop Sand Filter duty. */
function isSandFilterCircuit(circuit) {
    return ((circuit.circuit_kind === 'loop' || circuit.circuit_kind === 'main_loop') &&
        circuit.circuit_type === exports.SAND_FILTER_CIRCUIT_TYPE);
}
function pumpDutyTag(circuit, role) {
    if (role === exports.PUMP_ROLE_VENTURI && isFoamFractionatorCircuit(circuit))
        return 'FFVP';
    if (/break tank|plenum tank/.test(String(circuit.flow_source || '')) ||
        circuit.flow_mode === 'matched')
        return 'CIRCP';
    if (isFoamFractionatorCircuit(circuit))
        return 'FFSP';
    if (isSandFilterCircuit(circuit))
        return 'SFSP';
    const vacuumText = `${circuit.circuit_name || ''} ${circuit.circuit_type || ''}`.toLowerCase();
    if (vacuumText.includes('vacuum'))
        return 'VACP';
    return 'CIRCP';
}
function inferredPumpDutyTag(circuit, role) {
    if (role === exports.PUMP_ROLE_VENTURI) {
        return isFoamFractionatorCircuit(circuit) ? 'FFVP' : null;
    }
    if (/break tank|plenum tank/.test(String(circuit.flow_source || '')) ||
        circuit.flow_mode === 'matched')
        return 'CIRCP';
    if (isFoamFractionatorCircuit(circuit))
        return 'FFSP';
    if (isSandFilterCircuit(circuit))
        return 'SFSP';
    const originText = `${circuit.circuit_name || ''} ${circuit.circuit_type || ''} ${circuit.flow_source || ''}`.toLowerCase();
    if (originText.includes('vacuum'))
        return 'VACP';
    if (circuit.circuit_kind === 'side_stream' || originText.includes('circulation') ||
        circuit.flow_mode === 'matched' ||
        /break tank|plenum tank/.test(originText))
        return 'CIRCP';
    return null;
}
function pumpFlowRouteRole(circuit, role) {
    if (role === exports.PUMP_ROLE_VENTURI) {
        return isFoamFractionatorCircuit(circuit) ? 'foam_fractionator_venturi' : null;
    }
    if (/break tank|plenum tank/i.test(String(circuit.flow_source || '')) ||
        circuit.flow_mode === 'matched')
        return 'circulation';
    if (isFoamFractionatorCircuit(circuit))
        return 'foam_fractionator_supply';
    if (isSandFilterCircuit(circuit))
        return 'sand_filter_supply';
    const originText = `${circuit.circuit_name || ''} ${circuit.circuit_type || ''} ${circuit.flow_source || ''}`.toLowerCase();
    if (originText.includes('vacuum'))
        return 'vacuum';
    if (circuit.circuit_kind === 'side_stream' || originText.includes('circulation'))
        return 'circulation';
    return null;
}
function inferPumpDutyType(circuit, role, dutyTypes = exports.DEFAULT_PUMP_DUTY_TYPES) {
    const flowRouteRole = pumpFlowRouteRole(circuit, role);
    if (!flowRouteRole)
        return null;
    return dutyTypes.find(item => item.flow_route_role === flowRouteRole)
        || exports.DEFAULT_PUMP_DUTY_TYPES.find(item => item.flow_route_role === flowRouteRole)
        || null;
}
function resolvePumpDutyType(circuit, role, dutyTypes = exports.DEFAULT_PUMP_DUTY_TYPES) {
    const tag = pumpDutyTag(circuit, role);
    return dutyTypes.find(item => item.tag === tag)
        || exports.DEFAULT_PUMP_DUTY_TYPES.find(item => item.tag === tag);
}
function systemNumberToken(systemCode) {
    const code = String(systemCode || '').trim().toUpperCase();
    const trailingNumber = code.match(/(\d+)(?!.*\d)/)?.[1];
    if (trailingNumber)
        return trailingNumber.padStart(2, '0');
    return code.replace(/[^A-Z0-9]/g, '') || 'SYS';
}
function buildPumpTags(systemCode, dutyTag, quantity) {
    const count = Math.max(1, Math.min(99, Math.trunc(Number(quantity) || 1)));
    const systemNumber = systemNumberToken(systemCode);
    return Array.from({ length: count }, (_, index) => `${systemNumber}-${dutyTag}-${String(index + 1).padStart(2, '0')}`);
}
/**
 * Default display name for a pump role on a given circuit.
 * Sand Filter and Foam Fractionator main loops use their well-known project
 * designations; other circuits retain their existing generic label.
 */
function defaultPumpLineName(circuit, role, dutyTypes = exports.DEFAULT_PUMP_DUTY_TYPES) {
    const duty = resolvePumpDutyType(circuit, role, dutyTypes);
    return `${duty.tag} — ${duty.pump_name}`;
}
const positive = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
};
const nullableNumber = (value) => value === null || value === undefined || value === '' ? null :
    Number.isFinite(Number(value)) ? Number(value) : null;
const round = (value, places = 3) => value == null ? null : Number(value.toFixed(places));
function pumpSourceFingerprint(source) {
    const canonical = JSON.stringify(source, (_, value) => value && typeof value === 'object' && !Array.isArray(value)
        ? Object.keys(value).sort().reduce((out, key) => { out[key] = value[key]; return out; }, {})
        : value);
    return crypto_1.default.createHash('sha256').update(canonical).digest('hex');
}
/**
 * Build the persisted source used to decide whether pump sizing inputs are
 * still current. Circuit labels are intentionally not included: a rename is
 * a display-only change and must not invalidate saved sizing evidence.
 */
function pumpSourcePayload(circuit, role, effectiveFlow, inputs) {
    const quantity = positive(inputs.pump_quantity) || 1;
    return {
        circuit: {
            circuit_key: circuit.circuit_key, circuit_kind: circuit.circuit_kind,
            circuit_type: circuit.circuit_type,
            parent_loop_number: circuit.parent_loop_number, side_stream_id: circuit.side_stream_id,
            flow_m3h: circuit.flow_m3h,
            ...(circuit.flow_mode === 'matched'
                ? { flow_mode: 'matched', match_loop_number: circuit.match_loop_number ?? null }
                : {}),
        },
        pump_role: role,
        ...(role === exports.PUMP_ROLE_VENTURI ? { venturi_flow_m3h: effectiveFlow } : {}),
        design_head_m: inputs.design_head_m ?? null,
        pump_efficiency_pct: inputs.pump_efficiency_pct ?? null,
        motor_efficiency_pct: inputs.motor_efficiency_pct ?? null,
        ...(quantity > 1 ? { pump_quantity: quantity, flow_per_pump_m3h: effectiveFlow } : {}),
    };
}
/** Flow Route circuits use the Design Book's resolved system flow as input. */
function pumpCircuits(system, sideStreams) {
    const baseFlow = nullableNumber(system.design_flow_m3h);
    const resolvedLoops = (0, flowRoute_1.resolveLoopFlows)(system, baseFlow);
    const loopFlow = (number) => resolvedLoops[number - 1]?.flow_m3h ?? null;
    const flowMode = (number) => resolvedLoops[number - 1]?.flow_mode || 'allocated';
    const activeLoops = [1, 2, 3].filter(n => system[`loop${n}_flow_source`] || system[`loop${n}_filtration`] || system[`loop${n}_flow_pct`] != null ||
        (sideStreams || []).some(stream => Number(stream.parent_loop_number) === n));
    return [
        ...activeLoops.map(number => {
            const fractionatorAllocation = (system.fractionator_allocations || []).find((allocation) => Number(allocation.parent_loop_number) === number);
            const fractionatorProducts = fractionatorAllocation?.products || [];
            const venturiFlows = fractionatorProducts.map((product) => {
                const flow = positive(product.venturi_flow_m3h);
                const quantity = positive(product.quantity);
                return flow != null && quantity != null ? flow * quantity : null;
            });
            const venturiFlow = fractionatorProducts.length > 0 && venturiFlows.every((flow) => flow != null)
                ? venturiFlows.reduce((sum, flow) => sum + Number(flow), 0)
                : null;
            return {
                system_code: system.system_code,
                circuit_key: `loop:${number}`, circuit_kind: 'loop', circuit_name: system[`loop${number}_name`] || `Loop ${number}`,
                circuit_type: system[`loop${number}_filtration`] || system[`loop${number}_flow_source`] || null,
                flow_source: system[`loop${number}_flow_source`] || null,
                parent_loop_number: number, side_stream_id: null,
                flow_m3h: loopFlow(number),
                flow_mode: flowMode(number),
                match_loop_number: resolvedLoops[number - 1]?.match_loop_number ?? null,
                venturi_flow_m3h: venturiFlow,
            };
        }),
        ...(sideStreams || []).filter(stream => stream.has_dedicated_pump !== false).map(stream => {
            const branch = nullableNumber(stream.flow_pct);
            return {
                system_code: system.system_code,
                circuit_key: `side_stream:${stream.id}`, circuit_kind: 'side_stream', circuit_name: stream.name,
                circuit_type: stream.preset || 'Custom', parent_loop_number: stream.parent_loop_number, side_stream_id: stream.id,
                flow_m3h: loopFlow(Number(stream.parent_loop_number)) != null && branch != null
                    ? Number(loopFlow(Number(stream.parent_loop_number))) * branch / 100 : null,
            };
        }),
    ];
}
/** Pure, versioned pump sizing calculation. Missing required values are incomplete, never zero. */
function calculatePumpSelection(input) {
    const flow = positive(input.flow_m3h);
    const head = positive(input.design_head_m);
    const pumpEfficiency = positive(input.pump_efficiency_pct);
    const motorEfficiency = positive(input.motor_efficiency_pct);
    const reasons = [];
    if (flow == null)
        reasons.push('Circuit flow is missing or must be greater than zero.');
    if (head == null)
        reasons.push('Design head must be greater than zero.');
    if (pumpEfficiency == null || pumpEfficiency > 100)
        reasons.push('Pump efficiency must be greater than 0% and no more than 100%.');
    if (motorEfficiency == null || motorEfficiency > 100)
        reasons.push('Motor efficiency must be greater than 0% and no more than 100%.');
    const hydraulic = flow == null || head == null ? null :
        exports.WATER_DENSITY_KG_M3 * exports.GRAVITY_M_S2 * (flow / 3600) * head / 1000;
    const shaft = hydraulic == null || pumpEfficiency == null || pumpEfficiency > 100 ? null : hydraulic / (pumpEfficiency / 100);
    const motor = shaft == null || motorEfficiency == null || motorEfficiency > 100 ? null : shaft / (motorEfficiency / 100);
    const recommended = motor == null ? null : exports.STANDARD_MOTOR_SIZES_KW.find(size => size >= motor) || null;
    if (motor != null && recommended == null) {
        reasons.push(`Calculated motor input ${round(motor)} kW exceeds the largest configured standard motor size of ${exports.STANDARD_MOTOR_SIZES_KW[exports.STANDARD_MOTOR_SIZES_KW.length - 1]} kW.`);
    }
    return {
        calculation_version: exports.PUMP_SELECTION_CALCULATION_VERSION,
        calculated_at: input.calculated_at || new Date().toISOString(),
        status: reasons.length ? 'incomplete' : 'ready',
        reasons,
        constants: { water_density_kg_m3: exports.WATER_DENSITY_KG_M3, gravity_m_s2: exports.GRAVITY_M_S2, motor_sizes_kw: exports.STANDARD_MOTOR_SIZES_KW },
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
function evaluateSelectedPumpSuitability(input) {
    const selected = input.selectedPump;
    if (!selected)
        return { status: 'incomplete', reasons: [] };
    const requiredPower = nullableNumber(input.calculation?.results?.recommended_motor_kw) ??
        nullableNumber(input.calculation?.results?.motor_input_kw);
    const requiredFlow = nullableNumber(input.circuitFlowM3h);
    const requiredHead = nullableNumber(input.designHeadM);
    const availablePower = nullableNumber(selected.power_kw);
    const availableFlow = nullableNumber(selected.design_flow_m3h);
    const availableHead = nullableNumber(selected.design_head_m);
    const reasons = [];
    let incompatible = false;
    if (requiredPower != null && availablePower == null) {
        reasons.push(`Selected pump has no catalog power rating; at least ${requiredPower} kW is required.`);
    }
    else if (requiredPower != null && availablePower != null && availablePower < requiredPower) {
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
    return { status: incompatible ? 'incompatible' : reasons.length ? 'incomplete' : 'ready', reasons };
}
/**
 * Build a single pump-line item from a circuit descriptor and an optional
 * saved database row.  `role` is 'primary' or 'venturi'.
 *
 * For FFVP lines the effective sizing flow comes from `row.venturi_flow_m3h`,
 * initially seeded when the line is created from governed product hydraulics
 * or, when those are unavailable, the authoritative circuit demand.
 */
function buildPumpLineItem(circuit, row, role, dutyTypes = exports.DEFAULT_PUMP_DUTY_TYPES) {
    const isVenturi = role === exports.PUMP_ROLE_VENTURI;
    const isFF = isFoamFractionatorCircuit(circuit);
    const pumpQuantity = positive(row?.pump_quantity) || 1;
    const currentDuty = inferPumpDutyType(circuit, role, dutyTypes);
    // Saved rows from before governed duty snapshots existed used CIRCP for
    // otherwise unclassified duties. Preserve that historical interpretation,
    // while requiring an explicit origin for new unsaved unknown loops.
    const legacySavedDuty = row && !row.pump_duty_snapshot && !currentDuty
        ? resolvePumpDutyType(circuit, role, dutyTypes)
        : null;
    const duty = row?.pump_duty_snapshot?.tag ? row.pump_duty_snapshot : (currentDuty || legacySavedDuty);
    // A saved venturi duty is explicit evidence. The governed product duty is
    // available for an unsaved/legacy line; creation persists the authoritative
    // circuit-flow fallback before the line is returned to the UI.
    const totalFlow = isVenturi
        ? (row?.venturi_flow_m3h != null
            ? Number(row.venturi_flow_m3h)
            : circuit.venturi_flow_m3h ?? null)
        : circuit.flow_m3h;
    const effectiveFlow = totalFlow == null ? null : totalFlow / pumpQuantity;
    const sourcePayload = pumpSourcePayload(circuit, role, effectiveFlow, {
        design_head_m: row?.design_head_m != null ? Number(row.design_head_m) : null,
        pump_efficiency_pct: row?.pump_efficiency_pct != null ? Number(row.pump_efficiency_pct) : null,
        motor_efficiency_pct: row?.motor_efficiency_pct != null ? Number(row.motor_efficiency_pct) : null,
        pump_quantity: pumpQuantity,
    });
    const fingerprint = pumpSourceFingerprint(sourcePayload);
    // Rows saved before labels were removed from the source payload included the
    // circuit name. Continue recognizing those rows when the name is unchanged.
    const legacyNamedFingerprint = pumpSourceFingerprint({
        ...sourcePayload,
        circuit: { ...sourcePayload.circuit, circuit_name: circuit.circuit_name },
    });
    // Rows saved before multi-role support used this payload shape. Preserve
    // their freshness until they are next explicitly recalculated.
    const legacyFingerprint = pumpSourceFingerprint({
        circuit: { ...sourcePayload.circuit, circuit_name: circuit.circuit_name },
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
    const versionStale = !!row && row.calculation_version !== exports.PUMP_SELECTION_CALCULATION_VERSION;
    // Real persisted rows always have a fingerprint (the column is NOT NULL).
    // Treat fingerprint-less legacy/test rows as incomplete rather than stale so
    // the actionable missing-duty message remains visible.
    const sourceMatches = row?.source_fingerprint === fingerprint
        || row?.source_fingerprint === legacyNamedFingerprint
        || (role === exports.PUMP_ROLE_PRIMARY && row?.source_fingerprint === legacyFingerprint);
    const stale = !!row && !!row.source_fingerprint && (!sourceMatches || versionStale);
    const venturiFlowMissing = isVenturi && effectiveFlow == null;
    const reasons = orphaned
        ? ['This saved selection references a Flow Route circuit that no longer exists.']
        : [
            ...(venturiFlowMissing ? ['Venturi duty flow is required and must be greater than zero. Enter the venturi pump flow before saving.'] : []),
            ...(row && row.source_fingerprint && !sourceMatches ? ['Flow Route or sizing inputs changed after this pump calculation was saved. Save and calculate again.'] : []),
            ...(versionStale ? [`Pump sizing calculation version ${row.calculation_version} is outdated; recalculate using ${exports.PUMP_SELECTION_CALCULATION_VERSION}.`] : []),
            ...(!duty ? ['No active Platform Admin pump duty relationship matches this Flow Route circuit.'] : []),
            ...(row?.project_equipment_item_id && row?.pump_snapshot ? [] : ['Save and calculate to create the governed system pump.']),
            ...calculation.reasons.filter(r => !venturiFlowMissing || !r.includes('Circuit flow')),
            ...suitability.reasons,
        ];
    return {
        ...circuit,
        pump_role: role,
        pump_role_name: duty ? `${duty.tag} — ${duty.pump_name}` : 'Pump origin required',
        pump_duty_type_id: row?.pump_duty_type_id || currentDuty?.id || null,
        pump_duty_tag: duty?.tag || null,
        pump_duty_name: duty?.pump_name || null,
        pump_tags: duty ? buildPumpTags(circuit.system_code, duty.tag, pumpQuantity) : [],
        requires_pump_origin: !duty,
        is_foam_fractionator: isFF,
        ...(isVenturi ? { venturi_flow_m3h: row?.venturi_flow_m3h != null ? Number(row.venturi_flow_m3h) : null } : {}),
        pump_quantity: pumpQuantity,
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
        calculation_version: row?.calculation_version || exports.PUMP_SELECTION_CALCULATION_VERSION,
        results: row ? (row.result_snapshot?.results || row.result_snapshot || calculation.results) : calculation.results,
    };
}
/**
 * Returns the pump-line items for a single circuit.
 * Non-FF circuits: exactly one line (role='primary').
 * Foam Fractionator circuits: always one FFSP line; add FFVP line only when
 * a venturi row is already saved — the UI manages the Yes/No question.
 */
function pumpLinesForCircuit(circuit, savedRows, dutyTypes = exports.DEFAULT_PUMP_DUTY_TYPES) {
    const circuitRows = savedRows.filter(row => row.circuit_key === circuit.circuit_key);
    const isFF = isFoamFractionatorCircuit(circuit);
    if (!isFF) {
        const row = circuitRows.find(r => (r.pump_role || exports.PUMP_ROLE_PRIMARY) === exports.PUMP_ROLE_PRIMARY) || null;
        return [buildPumpLineItem(circuit, row, exports.PUMP_ROLE_PRIMARY, dutyTypes)];
    }
    // Foam Fractionator: FFSP is always present; FFVP only if a venturi row was saved.
    const primaryRow = circuitRows.find(r => (r.pump_role || exports.PUMP_ROLE_PRIMARY) === exports.PUMP_ROLE_PRIMARY) || null;
    const venturiRow = circuitRows.find(r => r.pump_role === exports.PUMP_ROLE_VENTURI) || null;
    const lines = [buildPumpLineItem(circuit, primaryRow, exports.PUMP_ROLE_PRIMARY, dutyTypes)];
    if (venturiRow)
        lines.push(buildPumpLineItem(circuit, venturiRow, exports.PUMP_ROLE_VENTURI, dutyTypes));
    return lines;
}
