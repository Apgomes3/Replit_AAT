import { VendorOption } from '../../types';

export type ExchangeRate = {
  currency_code: string;
  rate_per_usd: number | string;
};

export function calculateVendorComparison(vendors: VendorOption[], exchangeRates: ExchangeRate[]) {
  const rates = new Map<string, number>();
  for (const row of exchangeRates) {
    const rate = Number(row.rate_per_usd);
    if (Number.isFinite(rate) && rate > 0) rates.set(row.currency_code, rate);
  }
  rates.set('USD', 1);

  const groups = new Map<string, VendorOption[]>();
  for (const vendor of vendors) {
    const itemCode = String(vendor.vendor_item_code || '').trim().toUpperCase();
    if (!itemCode || vendor.unit_price == null || vendor.approved_status !== 'Approved') continue;
    groups.set(itemCode, [...(groups.get(itemCode) || []), vendor]);
  }

  const competitiveIds = new Set<string>();
  const incomparableCodes = new Set<string>();
  for (const [itemCode, offers] of groups) {
    if (offers.length < 2) continue;
    const currencies = new Set(offers.map(offer => offer.currency || 'USD'));
    const sameCurrency = currencies.size === 1;
    if (!sameCurrency && offers.some(offer => !rates.has(offer.currency || 'USD'))) {
      incomparableCodes.add(itemCode);
      continue;
    }
    const values = offers.map(offer => ({
      id: offer.id,
      value: sameCurrency
        ? Number(offer.unit_price)
        : Number(offer.unit_price) / rates.get(offer.currency || 'USD')!,
    }));
    const lowest = Math.min(...values.map(entry => entry.value));
    values
      .filter(entry => Math.abs(entry.value - lowest) < 1e-9)
      .forEach(entry => competitiveIds.add(entry.id));
  }

  return { competitiveIds, incomparableCodes };
}

export function VendorComparisonNotice({ itemCodes }: { itemCodes: Set<string> }) {
  if (itemCodes.size === 0) return null;
  return (
    <span>
      Some item codes cannot be compared because an exchange rate is missing: {[...itemCodes].join(', ')}.
    </span>
  );
}

export function MostCompetitiveBadge() {
  return (
    <span className="mt-1 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 font-sans text-[10px] font-semibold text-emerald-800">
      Most competitive
    </span>
  );
}