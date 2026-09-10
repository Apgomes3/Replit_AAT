import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  BIO_CRATE_MEDIA_CAPACITY_M3,
  BioDegasPlenumPanel,
  calculateBioCrateCount,
  calculateBioCrateSpatialBasis,
} from './DesignBookLSSDetail';

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

    render(<BioDegasPlenumPanel data={{
      preview: { media: { installed_media_l: 477 } },
    }} />);

    expect(screen.getByText('Media volume from Biological Media').parentElement).toHaveTextContent('0.477 m³');
    expect(screen.getByText('Bio-crates required').parentElement).toHaveTextContent('3');
    expect(screen.getByText('0.714 m³')).toBeInTheDocument();
    expect(screen.getByText('1.040 × 0.740 × 0.530 m')).toBeInTheDocument();
    expect(screen.getByText('Stack positions required').parentElement).toHaveTextContent('1');
    expect(screen.getByText('Tallest crate stack').parentElement).toHaveTextContent('1.590 m');
    expect(screen.getByText('Minimum crate-only footprint').parentElement).toHaveTextContent('0.770 m²');
  });

  it('waits for a Biological Media calculation result', () => {
    render(<BioDegasPlenumPanel data={{ preview: null }} />);
    expect(screen.getByText('Calculate Biological Media first')).toBeInTheDocument();
  });
});