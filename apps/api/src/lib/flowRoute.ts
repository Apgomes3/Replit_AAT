export type ResolvedLoopFlow = {
  loop_number: number;
  flow_mode: 'allocated' | 'matched';
  match_loop_number: number | null;
  flow_m3h: number | null;
  unavailable_reason: string | null;
  unavailable_kind: 'invalid_source' | 'invalid_target' | 'circular_match' | 'allocation_unavailable' | null;
};

const finite = (value: unknown) =>
  value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;

const loopIsConfigured = (system: any, n: number) =>
  system?.[`loop${n}_flow_source`] != null ||
  system?.[`loop${n}_filtration`] != null ||
  system?.[`loop${n}_flow_pct`] != null ||
  system?.[`loop${n}_bio_degas_pct`] != null ||
  system?.[`loop${n}_bio_degas_m3h`] != null ||
  Boolean(system?.[`loop${n}_link_bio_degas`]);

/** Resolves Flow Route loop duties without treating matched circuits as allocation. */
export function resolveLoopFlows(
  system: any,
  designFlow = system?.design_flow_m3h,
): ResolvedLoopFlow[] {
  const baseFlow = finite(designFlow);
  const mode = (n: number): 'allocated' | 'matched' =>
    system?.[`loop${n}_flow_mode`] === 'matched' ? 'matched' : 'allocated';
  const resolve = (n: number, path: number[] = []): ResolvedLoopFlow => {
    const flowMode = mode(n);
    if (path.includes(n)) return {
      loop_number: n, flow_mode: flowMode, match_loop_number: null, flow_m3h: null,
      unavailable_reason: `Loop ${n} match target creates a circular flow match.`,
      unavailable_kind: 'circular_match',
    };
    if (flowMode === 'matched') {
      if (!['Break Tank', 'Plenum Tank'].includes(String(system?.[`loop${n}_flow_source`] || ''))) return {
        loop_number: n, flow_mode: flowMode, match_loop_number: null,
        flow_m3h: null, unavailable_reason: `Loop ${n} matched flow requires Break Tank or Plenum Tank as its flow source.`,
        unavailable_kind: 'invalid_source',
      };
      const target = finite(system?.[`loop${n}_match_loop_number`]);
      if (!Number.isInteger(target) || target! < 1 || target! > 3 || target === n) return {
        loop_number: n, flow_mode: flowMode, match_loop_number: target,
        flow_m3h: null, unavailable_reason: `Loop ${n} must match a different loop (1–3).`,
        unavailable_kind: 'invalid_target',
      };
      if (!loopIsConfigured(system, target!)) return {
        loop_number: n, flow_mode: flowMode, match_loop_number: target,
        flow_m3h: null, unavailable_reason: `Loop ${n} match target Loop ${target} is not configured.`,
        unavailable_kind: 'invalid_target',
      };
      const targetResult = resolve(target!, [...path, n]);
      return {
        loop_number: n, flow_mode: flowMode, match_loop_number: target,
        flow_m3h: targetResult.flow_m3h,
        unavailable_reason: targetResult.unavailable_reason,
        unavailable_kind: targetResult.unavailable_kind,
      };
    }
    const pct = finite(system?.[`loop${n}_flow_pct`]);
    return {
      loop_number: n, flow_mode: flowMode, match_loop_number: null,
      flow_m3h: baseFlow != null && baseFlow > 0 && pct != null
        ? Number((baseFlow * pct / 100).toFixed(3)) : null,
      unavailable_reason: baseFlow == null || baseFlow <= 0 || pct == null
        ? 'Loop allocation is unavailable.' : null,
      unavailable_kind: baseFlow == null || baseFlow <= 0 || pct == null
        ? 'allocation_unavailable' : null,
    };
  };
  return [1, 2, 3].map(number => resolve(number));
}