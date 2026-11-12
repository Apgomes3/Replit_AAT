// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cleanSize, codeSlug, excelDateToSerial, normalizeCurrency, parseKw, parseOzoneGh, toUsd } from './rules';

describe('price list clean-up rules', () => {
  it('restores sizes that Excel turned into 1900 dates', () => {
    // Dates exceljs returns for the T2-3µm, T2-50µm and T2-75µm filter socks in the real price list.
    expect(excelDateToSerial(new Date(Date.UTC(1900, 0, 2)))).toBe(3);
    expect(excelDateToSerial(new Date(Date.UTC(1900, 1, 18)))).toBe(50);
    expect(excelDateToSerial(new Date(Date.UTC(1900, 2, 15)))).toBe(75);
    expect(cleanSize(new Date(Date.UTC(1900, 0, 24)))).toEqual({ value: '25', restoredFromDate: true });
    expect(cleanSize('  SF-1200 ')).toEqual({ value: 'SF-1200', restoredFromDate: false });
    expect(cleanSize(null)).toEqual({ value: null, restoredFromDate: false });
  });

  it('parses power and ozone output', () => {
    expect(parseKw('0.64 Kw')).toBe(0.64);
    expect(parseKw(0.5)).toBe(0.5);
    expect(parseKw('')).toBeNull();
    expect(parseOzoneGh('5', null)).toBe(5);
    expect(parseOzoneGh(null, '5g/hr OG + Air Dryer')).toBe(5);
  });

  it('converts supplier prices to USD with the app rates, refusing unknown currencies', () => {
    const rates = { USD: 1, CNY: 6.71, AUD: 1.41 };
    expect(normalizeCurrency('rmb')).toBe('CNY');
    expect(toUsd(6800, 'CNY', rates)).toBe(1013.41);
    expect(toUsd(289.86, 'USD', rates)).toBe(289.86);
    expect(toUsd(1735, 'GBP', rates)).toBeNull();
    expect(toUsd(null, 'USD', rates)).toBeNull();
  });

  it('builds short, code-safe slugs', () => {
    expect(codeSlug('AAT-LPUV-PVC-80- GPO SKID')).toBe('AAT-LPUV-PVC-80-GPO-SKID');
    expect(codeSlug('triogen® O3 S2 [2g/h]')).toBe('TRIOGEN-O3-S2-2G-H');
    expect(codeSlug('x'.repeat(100)).length).toBeLessThanOrEqual(32);
  });
});
