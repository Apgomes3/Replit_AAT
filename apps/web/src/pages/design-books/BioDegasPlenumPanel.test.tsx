import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  BIO_CRATE_MEDIA_CAPACITY_M3,
  BioDegasPlenumPanel,
  calculateBioCrateCount,
} from './DesignBookLSSDetail';

describe('BioDegasPlenumPanel', () => {
  it('rounds the Biological Media volume up to whole AAT bio-crates', () => {
    expect(BIO_CRATE_MEDIA_CAPACITY_M3).toBe(0.238);
    expect(calculateBioCrateCount(0.476)).toBe(2);
    expect(calculateBioCrateCount(0.477)).toBe(3);

    render(<BioDegasPlenumPanel data={{
      preview: { media: { installed_media_l: 477 } },
    }} />);

    expect(screen.getByText('Media volume from Biological Media').parentElement).toHaveTextContent('0.477 m³');
    expect(screen.getByText('Bio-crates required').parentElement).toHaveTextContent('3');
    expect(screen.getByText('0.714 m³')).toBeInTheDocument();
    expect(screen.getByText('Deferred to the next sizing phase')).toBeInTheDocument();
  });

  it('waits for a Biological Media calculation result', () => {
    render(<BioDegasPlenumPanel data={{ preview: null }} />);
    expect(screen.getByText('Calculate Biological Media first')).toBeInTheDocument();
  });
});