import { describe, expect, it } from 'vitest';
import { convertCurrency } from './currencies';

describe('convertCurrency', () => {
  it('converts with app rates and refuses to guess a missing rate', () => {
    const rates = { CNY: 6.71, GBP: 0.7519, SGD: null };
    expect(convertCurrency(671, 'CNY', 'USD', rates)).toBeCloseTo(100, 6);
    expect(convertCurrency(100, 'USD', 'GBP', rates)).toBeCloseTo(75.19, 6);
    expect(convertCurrency(100, 'CNY', 'SGD', rates)).toBeNull();
    expect(convertCurrency(100, 'EUR', 'EUR', rates)).toBe(100);
    expect(convertCurrency(null, 'USD', 'GBP', rates)).toBeNull();
  });
});
