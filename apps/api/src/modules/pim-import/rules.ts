// Pure rules for importing the ASW price list into PIM (no I/O; unit-tested).

export type FamilyDef = { code: string; name: string; categoryCode: string };

export type CategoryRule =
  | { kind: 'product'; family: string }
  | { kind: 'component'; componentType: string; componentCategory: string }
  | { kind: 'skip'; reason: string };

/** Families created by the import when first used (existing families are reused by code). */
export const NEW_FAMILIES: Record<string, FamilyDef> = {
  'PFM-BAG': { code: 'PFM-BAG', name: 'Bag Filters', categoryCode: 'FILTRATION' },
  'PFM-HP': { code: 'PFM-HP', name: 'Heat Pumps & Chillers', categoryCode: 'THERMAL' },
  'PFM-SUMP': { code: 'PFM-SUMP', name: 'Sumps & Break Tanks', categoryCode: 'TANK' },
  'PFM-PANEL': { code: 'PFM-PANEL', name: 'Electrical Control Panels', categoryCode: 'ELECTRICAL' },
};

/**
 * "EQUIPMENT" column of the LSS Equipment sheet → what it becomes in Shark OS.
 * Decided with the user (2026-11-12): consumables, media and skid parts are components;
 * skid fabrication labour is not imported.
 */
export const CATEGORY_RULES: Record<string, CategoryRule> = {
  'Air Dryer (only)': { kind: 'product', family: 'PFM-AIR' },
  'Bag Filter': { kind: 'product', family: 'PFM-BAG' },
  'Pump (SW)': { kind: 'product', family: 'PFM-PUMP' },
  'Pump (SW) FFVP': { kind: 'product', family: 'PFM-PUMP' },
  'UV (LPUV)': { kind: 'product', family: 'PFM-UV' },
  'UV (MPUV)': { kind: 'product', family: 'PFM-UV' },
  'Ozone Generator': { kind: 'product', family: 'PFM-OZ' },
  'Sand Filter': { kind: 'product', family: 'PFM-SF' },
  'Others - Instrumentation': { kind: 'product', family: 'PFM-INST' },
  'Heat Exchanger': { kind: 'product', family: 'PFM-HX' },
  'Heat Pump': { kind: 'product', family: 'PFM-HP' },
  'Sump / Break tank': { kind: 'product', family: 'PFM-SUMP' },
  'D-Tank': { kind: 'product', family: 'PFM-SUMP' },
  'Electrical Panel GPO': { kind: 'product', family: 'PFM-PANEL' },
  'Electrical Panel PLC': { kind: 'product', family: 'PFM-PANEL' },
  'Foam Fractionators': { kind: 'product', family: 'PFM-FF' },
  'Drum Filter': { kind: 'product', family: 'PFM-DRUM' },
  'Bag Filter Sock': { kind: 'component', componentType: 'Filter Sock', componentCategory: 'Filtration' },
  'Sand Filter Media': { kind: 'component', componentType: 'Filter Media', componentCategory: 'Media' },
  'Bio-media': { kind: 'component', componentType: 'Bio Media', componentCategory: 'Media' },
  'Pump Strainner': { kind: 'component', componentType: 'Strainer', componentCategory: 'Pumping' },
  'Skid Break tank': { kind: 'component', componentType: 'Break Tank', componentCategory: 'Skid' },
  'Skid BIO tank': { kind: 'component', componentType: 'Bio Tank', componentCategory: 'Skid' },
  'Skid Plumbing GF': { kind: 'component', componentType: 'Plumbing', componentCategory: 'Skid' },
  'Skid Plumbing HC': { kind: 'component', componentType: 'Plumbing', componentCategory: 'Skid' },
  'Skid Frame': { kind: 'component', componentType: 'Frame', componentCategory: 'Skid' },
  'Skid Plinth': { kind: 'component', componentType: 'Plinth', componentCategory: 'Skid' },
  'Skid Fab Labour': { kind: 'skip', reason: 'Labour is not imported (not a product or component).' },
};

/** Price-list currency names → ISO codes used by platform_exchange_rates. */
const CURRENCY_ALIASES: Record<string, string> = { RMB: 'CNY', CNY: 'CNY', USD: 'USD', GBP: 'GBP', AUD: 'AUD', ZAR: 'ZAR', EUR: 'EUR', NZD: 'NZD' };

export function normalizeCurrency(raw: unknown): string | null {
  const key = String(raw ?? '').trim().toUpperCase();
  return key ? CURRENCY_ALIASES[key] ?? key : null;
}

/** Convert a supplier price to USD with the app's rates (rate = units of currency per 1 USD). */
export function toUsd(amount: number | null, currency: string | null, ratesPerUsd: Record<string, number>): number | null {
  if (amount == null || !Number.isFinite(amount) || !currency) return null;
  const rate = ratesPerUsd[currency];
  if (!rate || rate <= 0) return null;
  return Math.round((amount / rate) * 100) / 100;
}

/**
 * Excel turned some sizes (e.g. a "3" µm filter sock) into dates like 1900-01-02.
 * exceljs converts a serial number n to the date 30 Dec 1899 + n days, so the original
 * number is the day count from that base (verified against the price list:
 * T2-3µm → 1900-01-02, T2-50µm → 1900-02-18, T2-75µm → 1900-03-15).
 */
export function excelDateToSerial(date: Date): number {
  const base = Date.UTC(1899, 11, 30);
  return Math.round((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - base) / 86_400_000);
}

/** Clean a Size cell: dates that are really numbers are restored; text is trimmed. */
export function cleanSize(raw: unknown): { value: string | null; restoredFromDate: boolean } {
  if (raw instanceof Date) {
    // Real dates after 1901 are not sizes; keep them as ISO text but flag nothing.
    if (raw.getUTCFullYear() > 1901) return { value: raw.toISOString().slice(0, 10), restoredFromDate: false };
    return { value: String(excelDateToSerial(raw)), restoredFromDate: true };
  }
  const text = raw == null ? '' : String(raw).replace(/\s+/g, ' ').trim();
  return { value: text || null, restoredFromDate: false };
}

/** Parse power values like 0.5, "0.64 Kw", "1.5kW" → kW number. */
export function parseKw(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  const m = String(raw ?? '').replace(',', '.').match(/(\d+(?:\.\d+)?)\s*k?w?/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const text = String(raw ?? '').replace(/,/g, '').trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Ozone output in g/h from the size or description ("2g/h", "5g/hr OG", 8). */
export function parseOzoneGh(size: string | null, description: string | null): number | null {
  const fromSize = parseNumber(size);
  if (fromSize && fromSize > 0) return fromSize;
  const m = String(description ?? '').match(/(\d+(?:\.\d+)?)\s*g\s*\/\s*h/i);
  return m ? Number(m[1]) : null;
}

/** Normalised comparison key: lower-case letters and digits only. */
export const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

/** Product/component codes are VARCHAR(50) in the database. */
export const MAX_CODE_LENGTH = 50;

/** Code-safe slug: upper-case, words joined by '-', at most `max` chars. */
export function codeSlug(s: string, max = 32): string {
  return s.replace(/[µμ]/g, 'u').normalize('NFKD').replace(/[^\w\s.-]/g, ' ').replace(/[\s_.]+/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '').toUpperCase().slice(0, max).replace(/-$/, '');
}
