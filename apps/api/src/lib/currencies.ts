// Currencies Shark OS prices in. Rates live in platform_exchange_rates (units per 1 USD).
// Keep in sync with apps/web/src/lib/currencies.ts and the CHECK in db/migrate.ts.
export const SUPPORTED_CURRENCIES = ['USD', 'CNY', 'AUD', 'NZD', 'EUR', 'GBP', 'ZAR'] as const;
export type CurrencyCode = typeof SUPPORTED_CURRENCIES[number];

export function isSupportedCurrency(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

/** Human list for error messages (CNY is shown as RMB, as in the rest of the app). */
export const SUPPORTED_CURRENCY_TEXT = 'USD, RMB, AUD, NZD, EUR, GBP or ZAR';
