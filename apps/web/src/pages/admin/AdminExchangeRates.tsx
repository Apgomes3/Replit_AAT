import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { DollarSign, Info } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import { CURRENCY_LABELS } from '../../lib/currencies';

type Rate = { currency_code: string; rate_per_usd: number | null; updated_at: string };
const labels = CURRENCY_LABELS;

export default function AdminExchangeRates() {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['platform-exchange-rates'],
    queryFn: () => api.get('/admin/exchange-rates').then(response => response.data),
  });
  const rates: Rate[] = data?.items || [];
  const save = async (rate: Rate) => {
    const value = drafts[rate.currency_code] ?? String(rate.rate_per_usd ?? '');
    if (!value || !(Number(value) > 0)) return toast.error('Enter an exchange rate greater than zero');
    setSaving(rate.currency_code);
    try {
      await api.put(`/admin/exchange-rates/${rate.currency_code}`, { rate_per_usd: Number(value) });
      setDrafts(current => { const next = { ...current }; delete next[rate.currency_code]; return next; });
      await qc.invalidateQueries({ queryKey: ['platform-exchange-rates'] });
      toast.success(`${labels[rate.currency_code]} exchange rate saved`);
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Could not save exchange rate');
    } finally { setSaving(null); }
  };
  return <div className="space-y-6 p-6">
    <PageHeader title="Exchange Rates" subtitle="The one set of currency rates used across Shark OS: product and component pricing, purchase orders, equipment breakdowns and price-list imports." />
    <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <span>Enter how many units of each currency equal <strong>1 USD</strong>. USD is fixed at 1. Changing a line currency converts its Unit Cost and recalculates Selling Price and Total Price.</span>
    </div>
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <table className="w-full text-sm"><thead className="border-b border-slate-200 bg-slate-50"><tr>
        <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Currency</th>
        <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Units per 1 USD</th>
        <th className="px-4 py-3" />
      </tr></thead><tbody className="divide-y divide-slate-100">
        {isLoading ? <tr><td colSpan={3} className="p-6 text-slate-400">Loading…</td></tr> : rates.map(rate => {
          const value = drafts[rate.currency_code] ?? String(rate.rate_per_usd ?? '');
          return <tr key={rate.currency_code}>
            <td className="px-4 py-3 font-medium text-slate-800"><span className="inline-flex items-center gap-2"><DollarSign className="h-4 w-4 text-blue-600" />{labels[rate.currency_code]}</span></td>
            <td className="px-4 py-3"><input type="number" min="0.00000001" step="0.0001" value={value}
              disabled={rate.currency_code === 'USD'} onChange={event => setDrafts(current => ({ ...current, [rate.currency_code]: event.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 disabled:bg-slate-100" /></td>
            <td className="px-4 py-3 text-right"><Button onClick={() => save(rate)} disabled={rate.currency_code === 'USD' || saving === rate.currency_code || !Object.prototype.hasOwnProperty.call(drafts, rate.currency_code)}>
              {saving === rate.currency_code ? 'Saving…' : 'Save'}
            </Button></td>
          </tr>;
        })}
      </tbody></table>
    </div>
  </div>;
}