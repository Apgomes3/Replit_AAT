import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  BIO_CRATE_MEDIA_CAPACITY_M3,
  BioDegasPlenumPanel,
  calculateBioCrateCount,
  calculateBioCrateSpatialBasis,
} from './DesignBookLSSDetail';
import { assessPlenumLayout, createRecommendedPlenumLayout } from './BioDegasPlenumDesigner';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn(), put: vi.fn() } }));

function renderPanel(data: any) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <BioDegasPlenumPanel data={data} />
  </QueryClientProvider>);
}

describe('BioDegasPlenumPanel', () => {
  it('rounds the Biological Media volume up to whole AAT bio-crates', () => {
    expect(BIO_CRATE_MEDIA_CAPACITY_M3).toBe(0.238);
    expect(calculateBioCrateCount(0.476)).toBe(2);
    expect(calculateBioCrateCount(0.477)).toBe(3);
    expect(calculateBioCrateSpatialBasis(4)?.stack_positions).toBe(1);
    expect(calculateBioCrateSpatialBasis(5)).toEqual({
      stack_positions: 2,
      crate_only_footprint_m2: 1.5392,
      tallest_stack_crates: 4,
      tallest_stack_height_m: 2.12,
    });

    renderPanel({
      preview: { media: { installed_media_l: 477 } },
    });

    expect(screen.getByText(/3 crates required/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /dynamic top view/i })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /dynamic section view/i })).toBeInTheDocument();
  });

  it('waits for a Biological Media calculation result', () => {
    renderPanel({ preview: null });
    expect(screen.getByText('Calculate Biological Media first')).toBeInTheDocument();
  });

  it('fits the ALIBAG 58-crate case in the governed transport envelope', () => {
    const layout = createRecommendedPlenumLayout(58);
    const assessment = assessPlenumLayout(layout, 58);
    expect(layout).toMatchObject({
      external_length_mm: 8360,
      external_width_mm: 2240,
      external_height_mm: 2390,
      wall_thickness_mm: 80,
      rows: 2,
      stack_height: 3,
    });
    expect(assessment.capacity).toBe(60);
    expect(assessment.verticalCapacity).toBe(3);
    expect(assessment.errors).toEqual([]);
  });

  it('blocks a fourth layer and inadequate wall thickness', () => {
    const layout = { ...createRecommendedPlenumLayout(58), stack_height: 4, wall_thickness_mm: 60 };
    expect(assessPlenumLayout(layout, 58).errors).toEqual(expect.arrayContaining([
      'Wall thickness must be at least 80 mm.',
      'Only 3 crate layers fit below the tray with 100 mm clearance.',
    ]));
  });

  it.each([30, 31, 32, 33])('finds a compact valid two-row layout for %i crates', count => {
    const layout = createRecommendedPlenumLayout(count);
    expect(layout.rows).toBe(2);
    expect(assessPlenumLayout(layout, count).errors).toEqual([]);
  });
});