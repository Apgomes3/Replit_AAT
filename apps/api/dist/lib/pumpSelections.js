"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.STANDARD_MOTOR_SIZES_KW = exports.GRAVITY_M_S2 = exports.WATER_DENSITY_KG_M3 = exports.PUMP_SELECTION_CALCULATION_VERSION = void 0;
exports.pumpSourceFingerprint = pumpSourceFingerprint;
exports.pumpCircuits = pumpCircuits;
exports.calculatePumpSelection = calculatePumpSelection;
exports.evaluateSelectedPumpSuitability = evaluateSelectedPumpSuitability;
const crypto_1 = __importDefault(require("crypto"));
/** Initial sizing uses fresh water at 20 °C (998.2 kg/m³), not a silent 1000 kg/m³ assumption. */
exports.PUMP_SELECTION_CALCULATION_VERSION = 'pump-selection-v1';
exports.WATER_DENSITY_KG_M3 = 998.2;
exports.GRAVITY_M_S2 = 9.80665;
exports.STANDARD_MOTOR_SIZES_KW = [
    0.09, 0.12, 0.18, 0.25, 0.37, 0.55, 0.75, 1.1, 1.5, 2.2, 3, 4, 5.5,
    7.5, 11, 15, 18.5, 22, 30, 37, 45, 55, 75, 90, 110, 132, 160, 200, 250, 315,
];
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
/** Flow Route circuits use the Design Book's resolved system flow as input. */
function pumpCircuits(system, sideStreams) {
    const baseFlow = nullableNumber(system.design_flow_m3h);
    const activeLoops = [1, 2, 3].filter(n => system[`loop${n}_flow_source`] || system[`loop${n}_filtration`] || system[`loop${n}_flow_pct`] != null ||
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
