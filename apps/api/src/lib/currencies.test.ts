// @vitest-environment node
import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { excelCurrencyFormat, isSupportedCurrency, SUPPORTED_CURRENCIES } from './currencies';

const listIn = (file: string, pattern: RegExp) => {
  const m = readFileSync(file, 'utf8').match(pattern);
  expect(m).not.toBeNull();
  return m![1]!.split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
};

describe('one currency list for the whole app', () => {
  it('API, web and the database CHECK list the same currencies', () => {
    const root = path.join(__dirname, '..', '..', '..');
    expect(listIn(path.join(root, 'web', 'src', 'lib', 'currencies.ts'), /SUPPORTED_CURRENCIES = \[([^\]]*)\]/)).toEqual([...SUPPORTED_CURRENCIES]);
    expect(listIn(path.join(__dirname, '..', 'db', 'migrate.ts'), /platform_exchange_rates_currency_code_check\s+CHECK \(currency_code IN \(([^)]*)\)\)/)).toEqual([...SUPPORTED_CURRENCIES]);
  });

  it('validates codes and formats Excel amounts without defaulting to dollars', () => {
    expect(isSupportedCurrency('ZAR')).toBe(true);
    expect(isSupportedCurrency('XYZ')).toBe(false);
    expect(excelCurrencyFormat('USD')).toBe('$#,##0.00');
    expect(excelCurrencyFormat('GBP')).toBe('£#,##0.00');
    expect(excelCurrencyFormat('AUD')).toBe('"A$"#,##0.00');
    expect(excelCurrencyFormat('JPY')).toBe('¥#,##0');
    expect(excelCurrencyFormat('XYZ')).toBe('"XYZ "#,##0.00');
  });
});
