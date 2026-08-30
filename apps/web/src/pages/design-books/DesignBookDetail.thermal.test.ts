import { describe, expect, it } from 'vitest';
import { DESIGN_BOOK_TAB_ORDER, isDesignBookTab } from './DesignBookDetail';

describe('Design Book Thermal navigation', () => {
  it('places Thermal immediately after Life Support Systems', () => {
    expect(DESIGN_BOOK_TAB_ORDER).toEqual([
      'exhibits',
      'lss',
      'thermal',
      'piping',
      'review',
      'versions',
    ]);
  });

  it('accepts the URL-addressable Thermal tab without conflating LSS detail tabs', () => {
    expect(isDesignBookTab('thermal')).toBe(true);
    expect(isDesignBookTab('thermal-selection')).toBe(false);
  });
});