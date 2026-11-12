// The single list of currencies Shark OS works in (decided 2026-11-12: one list, app rates everywhere).
// Rates live in platform_exchange_rates as "units per 1 USD" and are set in Admin › Exchange Rates.
// Keep in sync with apps/web/src/lib/currencies.ts and the CHECK in db/migrate.ts.
export const SUPPORTED_CURRENCIES = ['USD', 'CNY', 'AUD', 'NZD', 'EUR', 'GBP', 'ZAR', 'AED', 'SAR', 'SGD', 'CAD', 'JPY', 'TWD'] as const;
export type CurrencyCode = typeof SUPPORTED_CURRENCIES[number];

export function isSupportedCurrency(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

/** Human list for error messages (CNY is shown as RMB, as in the rest of the app). */
export const SUPPORTED_CURRENCY_TEXT = 'USD, RMB, AUD, NZD, EUR, GBP, ZAR, AED, SAR, SGD, CAD, JPY or TWD';

const SYMBOLS: Record<CurrencyCode, string> = {
  USD: '$', CNY: '¥', AUD: 'A$', NZD: 'NZ$', EUR: '€', GBP: '£', ZAR: 'R', AED: 'AED ', SAR: 'SAR ',
  SGD: 'S$', CAD: 'C$', JPY: '¥', TWD: 'NT$',
};

/** Excel number format for an amount in the given currency (unknown codes show the code, never "$"). */
export function excelCurrencyFormat(code: string): string {
  const symbol = SYMBOLS[code as CurrencyCode] ?? `${code} `;
  const decimals = code === 'JPY' ? '#,##0' : '#,##0.00';
  // Single-character symbols stay unquoted (as exports always were); longer ones must be quoted for Excel.
  return symbol.length === 1 ? `${symbol}${decimals}` : `"${symbol}"${decimals}`;
}
