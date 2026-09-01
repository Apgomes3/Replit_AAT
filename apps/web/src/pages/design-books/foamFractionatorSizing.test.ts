import { describe, expect, it } from 'vitest';
import {
  calculateFoamFractionatorSizingRecommendation,
  calculateSandFilterSizingRecommendation,
} from './foamFractionatorSizing';

const product = (id: string, diameterMm: number | null, quantity: number) => ({
  product_master_id: id,
  product_code: id,
  diameter_mm: diameterMm,
  quantity,
});

describe('Foam Fractionator sizing guidance', () => {
  it('rounds standalone model quantities up at the recommended rate', () => {
    const result = calculateFoamFractionatorSizingRecommendation(
      40,
      [product('FF-500', 500, 1)],
      19,
    );

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.recommendedRateLsM2).toBe(20);
    expect(result.parentFlowLs).toBeCloseTo(11.111, 3);
    expect(result.requiredAreaM2).toBeCloseTo(0.5556, 4);
    expect(result.products[0].suggestedQuantity).toBe(3);
    expect(result.selectedCapacityLs).toBeCloseTo(3.731, 3);
    expect(result.coverageStatus).toBe('below');
  });

  it('combines current area across multiple selected models', () => {
    const result = calculateFoamFractionatorSizingRecommendation(
      36,
      [product('FF-1000', 1000, 1), product('FF-500', 500, 2)],
      22,
    );

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.selectedAreaM2).toBeCloseTo(1.1781, 4);
    expect(result.selectedCapacityLs).toBeCloseTo(25.918, 3);
    expect(result.products.map(item => item.suggestedQuantity)).toEqual([1, 3]);
  });

  it.each([
    { flow: null, products: [product('FF-500', 500, 1)], reason: 'parent loop' },
    { flow: 40, products: [], reason: 'Select a Foam Fractionator' },
    { flow: 40, products: [product('FF-500', null, 1)], reason: 'saved diameter' },
  ])('explains incomplete sizing inputs', ({ flow, products, reason }) => {
    const result = calculateFoamFractionatorSizingRecommendation(flow, products, 20);
    expect(result.status).toBe('incomplete');
    expect(result.reason).toContain(reason);
  });
});

describe('Sand Filter sizing guidance', () => {
  it('uses 6 L/s/m² and rounds suggested quantities up', () => {
    const result = calculateSandFilterSizingRecommendation(
      36,
      [product('SF-1000', 1000, 1)],
      5,
    );
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.recommendedRateLsM2).toBe(6);
    expect(result.products[0].suggestedQuantity).toBe(3);
  });

  it('explains incomplete saved diameter evidence', () => {
    const result = calculateSandFilterSizingRecommendation(
      36,
      [product('SF-1000', null, 1)],
      6,
    );
    expect(result.status).toBe('incomplete');
    expect(result.reason).toContain('Sand Filter');
  });
});