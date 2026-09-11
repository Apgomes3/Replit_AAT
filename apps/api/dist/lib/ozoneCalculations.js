"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OZONE_SELECTION_VERSION = exports.OZONE_CALCULATION_VERSION = void 0;
exports.convertOzoneRate = convertOzoneRate;
exports.calculateOzoneRequirement = calculateOzoneRequirement;
exports.evaluateOzoneGeneratorSelection = evaluateOzoneGeneratorSelection;
exports.selectOzoneGenerator = selectOzoneGenerator;
exports.OZONE_CALCULATION_VERSION = 'OZONE_1_0';
exports.OZONE_SELECTION_VERSION = 'OZONE_SELECTION_1_0';
const positive = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
function convertOzoneRate(mgPerHour, unit) {
    if (unit === 'g/h')
        return mgPerHour / 1000;
    if (unit === 'lb/h')
        return mgPerHour / 453592.37;
    return mgPerHour;
}
function calculateOzoneRequirement(input) {
    const target = positive(input.target_concentration_mg_l);
    const selectedVenturiCircuits = new Set(input.ffvp_plenum_circuit_keys || []);
    const ffspLines = input.pump_lines.filter(line => line.pump_duty_tag === 'FFSP');
    const ffvpLines = input.pump_lines.filter(line => line.pump_duty_tag === 'FFVP' || line.pump_role === 'venturi');
    const ffspFlow = ffspLines.reduce((sum, line) => sum + (positive(line.flow_m3h) || 0), 0);
    const applicableFfvp = ffvpLines.filter(line => !!line.circuit_key && selectedVenturiCircuits.has(line.circuit_key));
    const ffvpFlow = applicableFfvp.reduce((sum, line) => sum + (positive(line.venturi_flow_m3h) || 0), 0);
    const reasons = [
        ...(target == null ? ['Target ozone concentration must be greater than zero.'] : []),
        ...(ffspFlow <= 0 ? ['A positive FFSP water flow is required before ozone can be calculated.'] : []),
        ...applicableFfvp
            .filter(line => positive(line.venturi_flow_m3h) == null)
            .map(line => `FFVP flow is missing for ${line.circuit_key}.`),
    ];
    const totalFlow = ffspFlow + ffvpFlow;
    const requiredMgH = reasons.length || target == null ? null : target * totalFlow * 1000;
    return {
        status: reasons.length ? 'blocked' : 'ready',
        reasons,
        calculation_version: exports.OZONE_CALCULATION_VERSION,
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
function evaluateOzoneGeneratorSelection(requiredGPerHour, product, quantityValue, context = {}) {
    const required = positive(requiredGPerHour);
    const capacity = positive(product.ozone_production_capacity_g_h);
    const quantity = Number(quantityValue);
    if (required == null || capacity == null || !Number.isInteger(quantity) || quantity < 1) {
        return { validation_status: 'FAIL', reason: 'A valid ozone generator and positive whole-number quantity are required.', calculation_selection_version: exports.OZONE_SELECTION_VERSION, ...context };
    }
    const total = capacity * quantity;
    const ratio = total / required;
    const oversize = (ratio - 1) * 100;
    return {
        product_id: product.id,
        product_code: product.product_code,
        product_name: product.product_name,
        model: product.model || null,
        per_unit_capacity_g_h: capacity,
        quantity,
        total_installed_capacity_g_h: total,
        required_capacity_g_h: required,
        capacity_ratio: ratio,
        oversize_percent: oversize,
        validation_status: total >= required ? 'PASS' : 'FAIL',
        advisory_note: oversize > 30
            ? `Selected ozone generator configuration provides ${oversize.toFixed(1)}% more capacity than the calculated requirement.`
            : null,
        reason: total < required ? 'Selected installed capacity is below the calculated ozone requirement.' : null,
        calculation_selection_version: exports.OZONE_SELECTION_VERSION,
        ...context,
    };
}
/** Select one PIM generator model repeated as necessary. Product capacity is authoritative. */
function selectOzoneGenerator(requiredGPerHour, products, context = {}) {
    const required = positive(requiredGPerHour);
    if (required == null) {
        return { validation_status: 'FAIL', reason: 'A positive required ozone capacity is required.', calculation_selection_version: exports.OZONE_SELECTION_VERSION, ...context };
    }
    const candidates = products
        .map(product => ({ ...product, capacity: positive(product.ozone_production_capacity_g_h) }))
        .filter((product) => product.capacity != null)
        .map(product => {
        const quantity = Math.ceil(required / product.capacity);
        return evaluateOzoneGeneratorSelection(required, product, quantity);
    })
        .sort((a, b) => a.total_installed_capacity_g_h - b.total_installed_capacity_g_h
        || a.quantity - b.quantity
        || a.product_code.localeCompare(b.product_code)
        || a.product_id.localeCompare(b.product_id));
    if (!candidates.length) {
        return { validation_status: 'FAIL', reason: 'No active PIM ozone generator has a positive ozone production capacity.', required_capacity_g_h: required, calculation_selection_version: exports.OZONE_SELECTION_VERSION, ...context };
    }
    const selected = candidates[0];
    return {
        ...selected,
        advisory_note: selected.oversize_percent > 30
            ? `Closest available ozone generator configuration provides ${selected.oversize_percent.toFixed(1)}% more capacity than the calculated requirement.`
            : null,
        calculation_selection_version: exports.OZONE_SELECTION_VERSION,
        selection_source: 'RECOMMENDED',
        ...context,
    };
}
