"use strict";
/**
 * Canonical geometry for a Custom project tank.
 *
 * Coordinates are always model-space millimetres.  Viewport dimensions,
 * pointer coordinates, and editor state intentionally do not belong here.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomFootprintValidationError = exports.MAX_FREEHAND_SAMPLES_PER_SEGMENT = exports.MAX_ABS_COORDINATE_MM = exports.MAX_FOOTPRINT_SAMPLED_POINTS = exports.MAX_FOOTPRINT_SOURCE_POINTS = exports.MAX_FOOTPRINT_SEGMENTS = exports.POINT_TOLERANCE_MM = exports.MIN_FOOTPRINT_AREA_M2 = exports.DEFAULT_FREEHAND_STEP_MM = exports.DEFAULT_QUADRATIC_SAMPLES = exports.CUSTOM_FOOTPRINT_UNITS = exports.CUSTOM_FOOTPRINT_SCHEMA_VERSION = void 0;
exports.normalizeCustomFootprint = normalizeCustomFootprint;
exports.sampleCustomFootprint = sampleCustomFootprint;
exports.validateCustomFootprint = validateCustomFootprint;
exports.summarizeCustomFootprint = summarizeCustomFootprint;
exports.CUSTOM_FOOTPRINT_SCHEMA_VERSION = 1;
exports.CUSTOM_FOOTPRINT_UNITS = 'mm';
exports.DEFAULT_QUADRATIC_SAMPLES = 24;
exports.DEFAULT_FREEHAND_STEP_MM = 25;
exports.MIN_FOOTPRINT_AREA_M2 = 0.000001;
exports.POINT_TOLERANCE_MM = 0.01;
exports.MAX_FOOTPRINT_SEGMENTS = 128;
exports.MAX_FOOTPRINT_SOURCE_POINTS = 4096;
exports.MAX_FOOTPRINT_SAMPLED_POINTS = 4096;
exports.MAX_ABS_COORDINATE_MM = 10000000;
exports.MAX_FREEHAND_SAMPLES_PER_SEGMENT = 512;
class CustomFootprintValidationError extends Error {
    constructor(validation) {
        super(validation.message);
        this.name = 'CustomFootprintValidationError';
        this.validation = validation;
    }
}
exports.CustomFootprintValidationError = CustomFootprintValidationError;
function point(value) {
    const x = Number(value?.x);
    const y = Number(value?.y);
    return Number.isFinite(x) && Number.isFinite(y)
        && Math.abs(x) <= exports.MAX_ABS_COORDINATE_MM
        && Math.abs(y) <= exports.MAX_ABS_COORDINATE_MM
        ? { x, y }
        : null;
}
function samePoint(a, b, tolerance = exports.POINT_TOLERANCE_MM) {
    return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}
function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
}
function lerp(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
function quadratic(a, control, b, t) {
    const ab = lerp(a, control, t);
    const bc = lerp(control, b, t);
    return lerp(ab, bc, t);
}
function sampleFreehand(points, stepMm) {
    if (points.length < 2 || !(stepMm > 0))
        return points;
    const totalLength = points.slice(1).reduce((sum, current, index) => sum + distance(points[index], current), 0);
    const effectiveStep = Math.max(stepMm, totalLength / Math.max(1, exports.MAX_FREEHAND_SAMPLES_PER_SEGMENT - 1));
    const result = [points[0]];
    let carry = 0;
    for (let i = 1; i < points.length; i += 1) {
        const from = points[i - 1];
        const to = points[i];
        const length = distance(from, to);
        if (!length)
            continue;
        let travelled = effectiveStep - carry;
        while (travelled < length) {
            result.push(lerp(from, to, travelled / length));
            travelled += effectiveStep;
        }
        carry = length - (travelled - effectiveStep);
    }
    const last = points[points.length - 1];
    if (!samePoint(result[result.length - 1], last))
        result.push(last);
    return result;
}
function invalid(code, message, segmentCount = 0, approximate = false) {
    return {
        valid: false,
        code,
        message,
        perimeter_mm: null,
        area_m2: null,
        segment_count: segmentCount,
        approximate,
        sampled_points: [],
    };
}
function normalizeCustomFootprint(input) {
    if (!input || typeof input !== 'object') {
        throw new CustomFootprintValidationError(invalid('INVALID_DOCUMENT', 'A footprint document is required.'));
    }
    const rawSegments = Array.isArray(input.segments) ? input.segments : [];
    if (rawSegments.length > exports.MAX_FOOTPRINT_SEGMENTS) {
        throw new CustomFootprintValidationError(invalid('RESOURCE_LIMIT', `A footprint can contain at most ${exports.MAX_FOOTPRINT_SEGMENTS} segments.`, rawSegments.length));
    }
    const segments = [];
    let sourcePointCount = 0;
    for (const raw of rawSegments) {
        if (raw?.type === 'line') {
            const start = point(raw.start);
            const end = point(raw.end);
            if (!start || !end)
                throw new CustomFootprintValidationError(invalid('INVALID_DOCUMENT', 'Line segments need numeric start and end points.', rawSegments.length));
            segments.push({ type: 'line', start, end });
            sourcePointCount += 2;
        }
        else if (raw?.type === 'quadratic') {
            const start = point(raw.start);
            const control = point(raw.control);
            const end = point(raw.end);
            if (!start || !control || !end)
                throw new CustomFootprintValidationError(invalid('INVALID_DOCUMENT', 'Quadratic segments need numeric start, control, and end points.', rawSegments.length, true));
            segments.push({ type: 'quadratic', start, control, end });
            sourcePointCount += 3;
        }
        else if (raw?.type === 'freehand') {
            if (!Array.isArray(raw.points)) {
                throw new CustomFootprintValidationError(invalid('INVALID_DOCUMENT', 'Freehand segments need an array of points.', rawSegments.length, true));
            }
            if (raw.points.length > exports.MAX_FOOTPRINT_SOURCE_POINTS - sourcePointCount) {
                throw new CustomFootprintValidationError(invalid('RESOURCE_LIMIT', `A footprint can contain at most ${exports.MAX_FOOTPRINT_SOURCE_POINTS} source points.`, rawSegments.length, true));
            }
            const points = Array.isArray(raw.points) ? raw.points.map(point) : [];
            if (points.some(item => !item) || points.length < 2) {
                throw new CustomFootprintValidationError(invalid('INVALID_DOCUMENT', 'Freehand segments need at least two numeric points.', rawSegments.length, true));
            }
            segments.push({ type: 'freehand', points: points });
            sourcePointCount += points.length;
        }
        else {
            throw new CustomFootprintValidationError(invalid('INVALID_DOCUMENT', 'Every footprint segment must be a line, quadratic curve, or freehand sample.', rawSegments.length));
        }
        if (sourcePointCount > exports.MAX_FOOTPRINT_SOURCE_POINTS) {
            throw new CustomFootprintValidationError(invalid('RESOURCE_LIMIT', `A footprint can contain at most ${exports.MAX_FOOTPRINT_SOURCE_POINTS} source points.`, rawSegments.length, true));
        }
    }
    const quadraticSteps = Math.max(8, Math.min(64, Math.round(Number(input.sampling?.quadratic_steps) || exports.DEFAULT_QUADRATIC_SAMPLES)));
    const freehandStep = Math.max(1, Math.min(1000, Number(input.sampling?.freehand_step_mm) || exports.DEFAULT_FREEHAND_STEP_MM));
    return {
        schema_version: exports.CUSTOM_FOOTPRINT_SCHEMA_VERSION,
        units: exports.CUSTOM_FOOTPRINT_UNITS,
        calibration: { model_unit: exports.CUSTOM_FOOTPRINT_UNITS, mm_per_unit: 1 },
        closed: input.closed === true,
        segments,
        sampling: { quadratic_steps: quadraticSteps, freehand_step_mm: freehandStep },
    };
}
function sampleCustomFootprint(document) {
    const points = [];
    for (const segment of document.segments) {
        if (segment.type === 'line') {
            if (!points.length)
                points.push(segment.start);
            points.push(segment.end);
        }
        else if (segment.type === 'quadratic') {
            if (!points.length)
                points.push(segment.start);
            for (let i = 1; i <= document.sampling.quadratic_steps; i += 1) {
                points.push(quadratic(segment.start, segment.control, segment.end, i / document.sampling.quadratic_steps));
            }
        }
        else {
            const sampled = sampleFreehand(segment.points, document.sampling.freehand_step_mm);
            if (!points.length)
                points.push(...sampled);
            else
                points.push(...sampled.slice(1));
        }
        if (points.length > exports.MAX_FOOTPRINT_SAMPLED_POINTS)
            return points.slice(0, exports.MAX_FOOTPRINT_SAMPLED_POINTS + 1);
    }
    return points;
}
function orientation(a, b, c) {
    const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(value) <= exports.POINT_TOLERANCE_MM * exports.POINT_TOLERANCE_MM)
        return 0;
    return value > 0 ? 1 : -1;
}
function onSegment(a, b, c) {
    return Math.min(a.x, c.x) - exports.POINT_TOLERANCE_MM <= b.x
        && b.x <= Math.max(a.x, c.x) + exports.POINT_TOLERANCE_MM
        && Math.min(a.y, c.y) - exports.POINT_TOLERANCE_MM <= b.y
        && b.y <= Math.max(a.y, c.y) + exports.POINT_TOLERANCE_MM;
}
function edgesIntersect(a, b, c, d) {
    const abC = orientation(a, b, c);
    const abD = orientation(a, b, d);
    const cdA = orientation(c, d, a);
    const cdB = orientation(c, d, b);
    if (abC !== abD && cdA !== cdB)
        return true;
    return (abC === 0 && onSegment(a, c, b))
        || (abD === 0 && onSegment(a, d, b))
        || (cdA === 0 && onSegment(c, a, d))
        || (cdB === 0 && onSegment(c, b, d));
}
function validateCustomFootprint(input) {
    let document;
    try {
        document = normalizeCustomFootprint(input);
    }
    catch (error) {
        return error instanceof CustomFootprintValidationError
            ? error.validation
            : invalid('INVALID_DOCUMENT', 'The footprint document is not valid.');
    }
    const approximate = document.segments.some(segment => segment.type !== 'line');
    if (!document.closed)
        return invalid('OPEN', 'Close the footprint before saving.', document.segments.length, approximate);
    if (document.segments.length < 3)
        return invalid('TOO_SMALL', 'A footprint needs at least three connected segments.', document.segments.length, approximate);
    for (const segment of document.segments) {
        const points = segment.type === 'freehand'
            ? segment.points
            : [segment.start, segment.end];
        if (points.some((item, index) => index > 0 && distance(points[index - 1], item) <= exports.POINT_TOLERANCE_MM)) {
            return invalid('ZERO_LENGTH', 'The footprint contains a zero-length segment.', document.segments.length, approximate);
        }
    }
    for (let i = 1; i < document.segments.length; i += 1) {
        const previous = document.segments[i - 1];
        const current = document.segments[i];
        const previousEnd = previous.type === 'freehand' ? previous.points[previous.points.length - 1] : previous.end;
        const currentStart = current.type === 'freehand' ? current.points[0] : current.start;
        if (!samePoint(previousEnd, currentStart)) {
            return invalid('DISCONNECTED', 'Each footprint segment must connect to the next.', document.segments.length, approximate);
        }
    }
    const first = document.segments[0];
    const last = document.segments[document.segments.length - 1];
    const firstStart = first.type === 'freehand' ? first.points[0] : first.start;
    const lastEnd = last.type === 'freehand' ? last.points[last.points.length - 1] : last.end;
    if (!samePoint(firstStart, lastEnd))
        return invalid('OPEN', 'Close the footprint back to its starting point.', document.segments.length, approximate);
    const sampled = sampleCustomFootprint(document);
    if (sampled.length > exports.MAX_FOOTPRINT_SAMPLED_POINTS) {
        return invalid('RESOURCE_LIMIT', `The sampled footprint can contain at most ${exports.MAX_FOOTPRINT_SAMPLED_POINTS} points.`, document.segments.length, approximate);
    }
    const polygon = sampled.length > 1 && samePoint(sampled[0], sampled[sampled.length - 1])
        ? sampled.slice(0, -1)
        : sampled;
    if (polygon.length < 3)
        return invalid('DEGENERATE', 'The footprint does not enclose an area.', document.segments.length, approximate);
    let signedAreaMm2 = 0;
    let perimeterMm = 0;
    for (let i = 0; i < polygon.length; i += 1) {
        const next = polygon[(i + 1) % polygon.length];
        signedAreaMm2 += polygon[i].x * next.y - next.x * polygon[i].y;
        perimeterMm += distance(polygon[i], next);
    }
    for (let i = 0; i < polygon.length; i += 1) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        for (let j = i + 1; j < polygon.length; j += 1) {
            if (j === i || j === i + 1 || (i === 0 && j === polygon.length - 1))
                continue;
            const c = polygon[j];
            const d = polygon[(j + 1) % polygon.length];
            if (edgesIntersect(a, b, c, d)) {
                return { ...invalid('SELF_INTERSECTING', 'The footprint edges cross. Edit the outline before saving.', document.segments.length, approximate), sampled_points: sampled };
            }
        }
    }
    const areaM2 = Math.abs(signedAreaMm2) / 2 / 1e6;
    if (!(areaM2 >= exports.MIN_FOOTPRINT_AREA_M2)) {
        return { ...invalid('DEGENERATE', 'The footprint does not enclose a measurable area.', document.segments.length, approximate), sampled_points: sampled };
    }
    return {
        valid: true,
        code: 'VALID',
        message: 'Valid closed footprint.',
        perimeter_mm: perimeterMm,
        area_m2: areaM2,
        segment_count: document.segments.length,
        approximate,
        sampled_points: sampled,
    };
}
function summarizeCustomFootprint(input) {
    const validation = validateCustomFootprint(input);
    return {
        valid: validation.valid,
        code: validation.code,
        message: validation.message,
        perimeter_mm: validation.perimeter_mm == null ? null : Math.round(validation.perimeter_mm * 100) / 100,
        area_m2: validation.area_m2 == null ? null : Math.round(validation.area_m2 * 1e6) / 1e6,
        segment_count: validation.segment_count,
        approximate: validation.approximate,
    };
}
