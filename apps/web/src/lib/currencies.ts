// The single list of currencies Shark OS works in (mirror of apps/api/src/lib/currencies.ts).
// Conversions use the app's rates (Admin › Exchange Rates, units per 1 USD).
export const SUPPORTED_CURRENCIES = ['USD', 'CNY', 'AUD', 'NZD', 'EUR', 'GBP', 'ZAR', 'AED', 'SAR', 'SGD', 'CAD', 'JPY', 'TWD'] as const;

/** Display labels: CNY is shown as RMB throughout the app. */
export const CURRENCY_LABELS: Record<string, string> = {
  USD: 'USD', CNY: 'RMB', AUD: 'AUD', NZD: 'NZD', EUR: 'EUR', GBP: 'GBP', ZAR: 'ZAR',
  AED: 'AED', SAR: 'SAR', SGD: 'SGD', CAD: 'CAD', JPY: 'JPY', TWD: 'TWD',
};

export const CURRENCY_OPTIONS = SUPPORTED_CURRENCIES.map(value => ({ value, label: CURRENCY_LABELS[value]! }));

/**
 * Convert between currencies with rates expressed as units per 1 USD.
 * Returns null when a rate is missing — never guesses (a missing rate used to fall back to 1).
 */
export function convertCurrency(amount: number | null, from: string, to: string, ratesPerUsd: Record<string, number | null | undefined>): number | null {
  if (amount == null) return null;
  if (from === to) return amount;
  const fromRate = from === 'USD' ? 1 : ratesPerUsd[from];
  const toRate = to === 'USD' ? 1 : ratesPerUsd[to];
  if (!fromRate || !toRate) return null;
  return (amount / fromRate) * toRate;
}
