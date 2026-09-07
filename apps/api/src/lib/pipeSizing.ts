export type PipeService = 'pressure' | 'gravity';

export interface PipeSizingStandard {
  dn: number;
  internal_diameter_mm: number;
  is_active?: boolean;
}

export interface PipeSizingResult {
  flow_m3h: number | null;
  velocity_m_s: number | null;
  within_band: boolean;
  standard: PipeSizingStandard | null;
}

/** Q/A, with Q converted from m³/h to m³/s and diameter in metres. */
export function pipeVelocity(flowM3h: unknown, internalDiameterMm: unknown): number | null {
  const flow = Number(flowM3h);
  const diameter = Number(internalDiameterMm);
  if (!Number.isFinite(flow) || flow < 0 || !Number.isFinite(diameter) || diameter <= 0) return null;
  const area = Math.PI * Math.pow(diameter / 1000, 2) / 4;
  const velocity = flow / 3600 / area;
  return Number.isFinite(velocity) ? velocity : null;
}

export function recommendPipeSize(
  flowM3h: unknown,
  standards: PipeSizingStandard[],
  minimumVelocity: number,
  maximumVelocity: number,
): PipeSizingResult {
  const active = standards
    .filter(item => item.is_active !== false && Number(item.dn) > 0 && Number(item.internal_diameter_mm) > 0)
    .sort((a, b) => Number(a.dn) - Number(b.dn) || Number(a.internal_diameter_mm) - Number(b.internal_diameter_mm));
  const standard = active.find(item => {
    const velocity = pipeVelocity(flowM3h, item.internal_diameter_mm);
    return velocity != null && velocity >= minimumVelocity && velocity <= maximumVelocity;
  }) || null;
  const velocity = standard ? pipeVelocity(flowM3h, standard.internal_diameter_mm) : null;
  return { flow_m3h: Number.isFinite(Number(flowM3h)) ? Number(flowM3h) : null, velocity_m_s: velocity,
    within_band: velocity != null && velocity >= minimumVelocity && velocity <= maximumVelocity, standard };
}

export function nextPipeSize(selectedDn: unknown, standards: PipeSizingStandard[]): PipeSizingStandard | null {
  const dn = Number(selectedDn);
  if (!Number.isFinite(dn)) return null;
  return standards.filter(item => item.is_active !== false && Number(item.dn) > dn)
    .sort((a, b) => Number(a.dn) - Number(b.dn) || Number(a.internal_diameter_mm) - Number(b.internal_diameter_mm))[0] || null;
}