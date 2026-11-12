// Currencies Shark OS prices in (mirror of apps/api/src/lib/currencies.ts).
export const SUPPORTED_CURRENCIES = ['USD', 'CNY', 'AUD', 'NZD', 'EUR', 'GBP', 'ZAR'] as const;

/** Display labels: CNY is shown as RMB throughout the app. */
export const CURRENCY_LABELS: Record<string, string> = {
  USD: 'USD', CNY: 'RMB', AUD: 'AUD', NZD: 'NZD', EUR: 'EUR', GBP: 'GBP', ZAR: 'ZAR',
};

export const CURRENCY_OPTIONS = SUPPORTED_CURRENCIES.map(value => ({ value, label: CURRENCY_LABELS[value]! }));
