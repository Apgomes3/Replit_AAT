// Measures and units for the PIM attribute library (pure; the database seed is generated from this list).
// A value is stored in the measure's base unit:  base = value × factor + offset.

export type UnitDef = { code: string; symbol: string; factor: number; offset?: number };
export type MeasureDef = { code: string; name: string; base: string; units: UnitDef[] };

export const MEASURES: MeasureDef[] = [
  { code: 'flow', name: 'Flow rate', base: 'm3_h', units: [
    { code: 'm3_h', symbol: 'm³/h', factor: 1 },
    { code: 'l_s', symbol: 'l/s', factor: 3.6 },
    { code: 'l_min', symbol: 'l/min', factor: 0.06 },
    { code: 'm3_d', symbol: 'm³/d', factor: 1 / 24 },
    { code: 'gpm_us', symbol: 'US gpm', factor: 0.227124707 },
  ] },
  { code: 'power', name: 'Power', base: 'kw', units: [
    { code: 'kw', symbol: 'kW', factor: 1 },
    { code: 'w', symbol: 'W', factor: 0.001 },
    { code: 'hp', symbol: 'HP', factor: 0.745699872 },
  ] },
  { code: 'pressure', name: 'Pressure', base: 'bar', units: [
    { code: 'bar', symbol: 'bar', factor: 1 },
    { code: 'mbar', symbol: 'mbar', factor: 0.001 },
    { code: 'kpa', symbol: 'kPa', factor: 0.01 },
    { code: 'psi', symbol: 'psi', factor: 0.0689475729 },
    { code: 'mh2o', symbol: 'mH₂O', factor: 0.0980665 },
  ] },
  { code: 'length', name: 'Length', base: 'mm', units: [
    { code: 'mm', symbol: 'mm', factor: 1 },
    { code: 'cm', symbol: 'cm', factor: 10 },
    { code: 'm', symbol: 'm', factor: 1000 },
    { code: 'in', symbol: 'in', factor: 25.4 },
    { code: 'ft', symbol: 'ft', factor: 304.8 },
  ] },
  { code: 'mass', name: 'Mass', base: 'kg', units: [
    { code: 'kg', symbol: 'kg', factor: 1 },
    { code: 'g', symbol: 'g', factor: 0.001 },
    { code: 't', symbol: 't', factor: 1000 },
    { code: 'lb', symbol: 'lb', factor: 0.45359237 },
  ] },
  { code: 'volume', name: 'Volume', base: 'l', units: [
    { code: 'l', symbol: 'L', factor: 1 },
    { code: 'm3', symbol: 'm³', factor: 1000 },
    { code: 'gal_us', symbol: 'US gal', factor: 3.785411784 },
  ] },
  { code: 'temperature', name: 'Temperature', base: 'c', units: [
    { code: 'c', symbol: '°C', factor: 1 },
    { code: 'f', symbol: '°F', factor: 5 / 9, offset: -160 / 9 },
    { code: 'k', symbol: 'K', factor: 1, offset: -273.15 },
  ] },
  { code: 'mass_rate', name: 'Mass rate', base: 'g_h', units: [
    { code: 'g_h', symbol: 'g/h', factor: 1 },
    { code: 'kg_h', symbol: 'kg/h', factor: 1000 },
    { code: 'g_d', symbol: 'g/d', factor: 1 / 24 },
  ] },
  { code: 'voltage', name: 'Voltage', base: 'v', units: [{ code: 'v', symbol: 'V', factor: 1 }] },
  { code: 'current', name: 'Current', base: 'a', units: [{ code: 'a', symbol: 'A', factor: 1 }] },
  { code: 'frequency', name: 'Frequency', base: 'hz', units: [{ code: 'hz', symbol: 'Hz', factor: 1 }] },
  { code: 'speed', name: 'Rotational speed', base: 'rpm', units: [{ code: 'rpm', symbol: 'rpm', factor: 1 }] },
  { code: 'uv_dose', name: 'UV dose', base: 'mj_cm2', units: [{ code: 'mj_cm2', symbol: 'mJ/cm²', factor: 1 }] },
  { code: 'ratio', name: 'Ratio', base: 'pct', units: [{ code: 'pct', symbol: '%', factor: 1 }] },
];

const byUnit = new Map(MEASURES.flatMap(m => m.units.map(u => [u.code, { measure: m.code, unit: u }] as const)));

export const measureOf = (unit: string) => byUnit.get(unit)?.measure ?? null;
export const unitSymbol = (unit: string) => byUnit.get(unit)?.unit.symbol ?? unit;

/** Rounds away floating-point noise (e.g. 3.6 × 10 = 36.00000000000001). */
const clean = (n: number) => Number(n.toPrecision(12));

export function toBase(value: number, unit: string): number {
  const u = byUnit.get(unit);
  if (!u) throw new Error(`Unknown unit "${unit}".`);
  return clean(value * u.unit.factor + (u.unit.offset ?? 0));
}

export function fromBase(value: number, unit: string): number {
  const u = byUnit.get(unit);
  if (!u) throw new Error(`Unknown unit "${unit}".`);
  return clean((value - (u.unit.offset ?? 0)) / u.unit.factor);
}

/** Converts between two units of the same measure (e.g. 10 l/s → 36 m³/h). */
export function convert(value: number, from: string, to: string): number {
  if (measureOf(from) !== measureOf(to) || !measureOf(from)) throw new Error(`Cannot convert ${from} to ${to}.`);
  return fromBase(toBase(value, from), to);
}
