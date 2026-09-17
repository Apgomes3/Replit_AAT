import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
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
    expect(screen.getByRole('img', { name: /dynamic section view.*column 1/i })).toBeInTheDocument();
    expect(screen.getAllByTestId('section-crate')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Column 1' })).toBeInTheDocument();
    expect(screen.getAllByText('S01').length).toBeGreaterThanOrEqual(3);
  });

  it('edits tank length, width, and height directly from drawing dimensions', () => {
    renderPanel({ preview: { media: { installed_media_l: 477 } } });
    fireEvent.click(screen.getByRole('button', { name: /edit length/i }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Length (mm)' }), { target: { value: '4000' } });
    expect(screen.getByRole('spinbutton', { name: 'External length (mm)' })).toHaveValue(4000);

    fireEvent.click(screen.getByRole('button', { name: /edit width/i }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Width (mm)' }), { target: { value: '2200' } });
    expect(screen.getByRole('spinbutton', { name: 'External width (mm)' })).toHaveValue(2200);

    fireEvent.click(screen.getByRole('button', { name: /edit height/i }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Height (mm)' }), { target: { value: '2400' } });
    expect(screen.getByRole('spinbutton', { name: 'External height (mm)' })).toHaveValue(2400);

    fireEvent.click(screen.getByRole('button', { name: /edit water level/i }));
    fireEvent.change(screen.getAllByRole('spinbutton', { name: 'Water level (mm)' })[1], { target: { value: '1200' } });
    expect(screen.getAllByRole('spinbutton', { name: 'Water level (mm)' })[0]).toHaveValue(1200);
  });

  it('changes tray-to-crate gap without changing external tank height', () => {
    renderPanel({ preview: { media: { installed_media_l: 477 } } });
    const height = screen.getByRole('spinbutton', { name: 'External height (mm)' });
    expect(height).toHaveValue(2390);

    fireEvent.click(screen.getByRole('button', { name: /edit tray-to-crate gap/i }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Tray-to-crate gap (mm)' }), { target: { value: '110' } });

    expect(height).toHaveValue(2390);
  });

  it('removes crates from the top while lower crates remain in place', () => {
    renderPanel({ preview: { media: { installed_media_l: 714 } } });
    const before = screen.getAllByTestId('section-crate')
      .slice(0, 3)
      .map(crate => crate.getAttribute('y'));

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Crates for stack 1' }), { target: { value: '2' } });

    const after = screen.getAllByTestId('section-crate')
      .slice(0, 2)
      .map(crate => crate.getAttribute('y'));
    expect(after).toEqual(before.slice(0, 2));
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
      tray_count: 2,
      tray_gap_mm: 100,
    });
    expect(assessment.capacity).toBe(60);
    expect(assessment.verticalCapacity).toBe(3);
    expect(assessment.errors).toEqual([]);
  });

  it('blocks a fourth layer and inadequate wall thickness', () => {
    const layout = { ...createRecommendedPlenumLayout(58), stack_height: 4, wall_thickness_mm: 60 };
    expect(assessPlenumLayout(layout, 58).errors).toEqual(expect.arrayContaining([
      'Wall thickness must be at least 80 mm.',
      'Only 3 crate layers fit with the selected tray-to-crate gap.',
    ]));
  });

  it('uses a second side-by-side tray only when the usable internal envelope fits it', () => {
    const twoTrayLayout = createRecommendedPlenumLayout(58);
    expect(twoTrayLayout.tray_count).toBe(2);
    expect(assessPlenumLayout(twoTrayLayout, 58).errors).toEqual([]);
    const tooShort = { ...twoTrayLayout, external_length_mm: 7400 };
    expect(assessPlenumLayout(tooShort, 58).errors).toContain('Two dispersion trays do not fit inside the usable internal tank envelope.');
  });

  it.each([30, 31, 32, 33])('finds a compact valid two-row layout for %i crates', count => {
    const layout = createRecommendedPlenumLayout(count);
    expect(layout.rows).toBe(2);
    expect(assessPlenumLayout(layout, count).errors).toEqual([]);
  });
});