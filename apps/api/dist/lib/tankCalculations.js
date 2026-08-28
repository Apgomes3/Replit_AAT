"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateWaterSurfaceAreaM2 = calculateWaterSurfaceAreaM2;
function calculateWaterSurfaceAreaM2(shapeType, lengthMm, widthMm) {
    const shape = String(shapeType || '').toLowerCase();
    const length = Number(lengthMm);
    const width = Number(widthMm);
    if (!(width > 0))
        return null;
    const area = shape === 'cylindrical'
        ? Math.PI * (width / 2) ** 2 / 1e6
        : length > 0
            ? length * width / 1e6
            : null;
    return area == null ? null : Math.round(area * 1e4) / 1e4;
}
