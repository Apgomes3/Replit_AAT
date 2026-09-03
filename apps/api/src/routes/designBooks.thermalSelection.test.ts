import { describe, expect, it } from 'vitest';
import { thermalSelectionTestUtils } from './designBooks';

describe('Thermal selection helpers', () => {
  it('uses the active steady-state duty and excludes recovery heating', () => {
    expect(thermalSelectionTestUtils.thermalSelectionDuty({
      calculation: {
        results: {
          net_total_load_kw: -12,
          margin_adjusted_steady_state_heating_kw: 15,
          margin_adjusted_heating_kw: 44,
        },
      },
    })).toEqual({
      duty: 'Heating',
      required_capacity_kw: 15,
      net_total_load_kw: -12,
    });
  });

  it('resolves Thermal side-stream flow from its parent loop', () => {
    const result = thermalSelectionTestUtils.thermalSelectionStream({
      design_flow_m3h: 100,
      loop1_flow_source: 'Bottom Drain',
      loop1_flow_pct: 80,
    }, {
      id: 'stream-1',
      parent_loop_number: 1,
      name: 'Thermal',
      preset: 'Thermal',
      flow_pct: 25,
    });
    expect(result.flow_m3h).toBe(20);
  });
});