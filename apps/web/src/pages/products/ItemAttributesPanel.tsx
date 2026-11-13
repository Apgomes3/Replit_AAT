import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { apiError, ItemAttribute, pimKeys, useCanManagePim, useItemAttributes, useUnits } from '../pim/attributes/pimAttributesApi';

type Draft = Record<string, { value: string | boolean; unit: string | null }>;

const draftOf = (attrs: ItemAttribute[]): Draft => Object.fromEntries(attrs.filter(a => a.storage === 'value').map(a => [a.id, {
  value: a.data_type === 'boolean' ? a.value === true : a.value == null ? '' : String(a.value),
  unit: a.unit,
}]));

/** Product page "Attributes" tab: the family template's attributes, values and completeness (warn-only). */
export default function ItemAttributesPanel({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const canManage = useCanManagePim();
  const { data, isLoading, isError } = useItemAttributes(productId);
  const { data: measures = [] } = useUnits();
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (data) setDraft(draftOf(data.attributes)); }, [data]);
  const original = useMemo(() => (data ? draftOf(data.attributes) : {}), [data]);
  const changed = Object.keys(draft).filter(id => JSON.stringify(draft[id]) !== JSON.stringify(original[id]));

  if (isLoading) return <p className="p-6 text-sm text-slate-500">Loading attributes…</p>;
  if (isError || !data) return <p className="p-6 text-sm text-red-600">Could not load attributes.</p>;

  const { attributes, completeness, item } = data;
  if (!item.product_family_id) return <p className="p-6 text-sm text-slate-500">Assign this product to a family to see its attributes.</p>;
  if (!attributes.length) return (
    <p className="p-6 text-sm text-slate-500">The {item.product_family_name} family has no attributes yet. <Link className="text-blue-600 hover:underline" to="/products/attributes?tab=families">Set up its template</Link>.</p>
  );

  async function save() {
    setSaving(true);
    try {
      const values = Object.fromEntries(changed.map(id => {
        const d = draft[id]!;
        return [id, d.value === '' ? null : { value: d.value, unit: d.unit }];
      }));
      const res = await api.put(`/pim/items/${productId}/attributes`, { values });
      qc.setQueryData(pimKeys.item(productId), res.data);
      toast.success('Attributes saved');
    } catch (e) { toast.error(apiError(e, 'Could not save attributes')); } finally { setSaving(false); }
  }

  const unitsFor = (a: ItemAttribute) => measures.find(m => m.code === a.measure_code)?.units ?? [];
  const groups = [...new Set(attributes.map(a => a.group_name))];

  return (
    <div className="p-4">
      <div className={`mb-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${completeness.missing.length ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
        {completeness.missing.length ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
        <div className="flex-1">
          <div className="font-semibold">{completeness.required
            ? `Completeness ${completeness.percent}% · ${completeness.filled} of ${completeness.required} required attributes`
            : 'No required attributes set for this family yet'}</div>
          {completeness.missing.length > 0 && <div className="mt-0.5">Missing: {completeness.missing.join(', ')}. This is a warning only — the product can still be released.</div>}
        </div>
        {canManage && <button disabled={!changed.length || saving} onClick={() => void save()}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">{saving ? 'Saving…' : `Save${changed.length ? ` (${changed.length})` : ''}`}</button>}
      </div>

      {groups.map(g => (
        <section key={g} className="mb-4">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</h4>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {attributes.filter(a => a.group_name === g).map(a => {
              const d = draft[a.id];
              const empty = a.value === null || a.value === '';
              return (
                <div key={a.id} className="grid items-center gap-3 px-4 py-2 sm:grid-cols-[240px_1fr]">
                  <div className="text-sm text-slate-700">
                    {a.is_system && <Lock className="mr-1.5 inline h-3 w-3 text-slate-400" />}{a.label}
                    {a.required && <span className={`ml-1 ${empty ? 'text-amber-600' : 'text-slate-400'}`} title="Required for completeness">*</span>}
                    {a.variant_axis && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">variant axis</span>}
                  </div>
                  {a.storage === 'typed' || !canManage || !d ? (
                    <div className="text-sm">{empty ? <span className="text-slate-400">—</span> : <>{String(a.value === true ? 'Yes' : a.value === false ? 'No' : a.value)} {a.unit_symbol}</>}
                      {a.storage === 'typed' && <span className="ml-2 text-xs text-slate-400">from technical data</span>}</div>
                  ) : a.data_type === 'boolean' ? (
                    <label className="text-sm"><input type="checkbox" checked={d.value === true} onChange={e => setDraft({ ...draft, [a.id]: { ...d, value: e.target.checked } })} /> Yes</label>
                  ) : a.data_type === 'list' ? (
                    <select aria-label={a.label} className="w-64 rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={String(d.value)}
                      onChange={e => setDraft({ ...draft, [a.id]: { ...d, value: e.target.value } })}>
                      <option value="">—</option>{a.options.map(o => <option key={o}>{o}</option>)}
                    </select>
                  ) : (
                    <div className="flex gap-2">
                      <input aria-label={a.label} className="w-64 rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={String(d.value)}
                        inputMode={a.data_type === 'number' ? 'decimal' : undefined}
                        onChange={e => setDraft({ ...draft, [a.id]: { ...d, value: e.target.value } })} />
                      {a.default_unit && <select aria-label={`${a.label} unit`} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={d.unit ?? a.default_unit}
                        onChange={e => setDraft({ ...draft, [a.id]: { ...d, unit: e.target.value } })}>
                        {unitsFor(a).map(u => <option key={u.code} value={u.code}>{u.symbol}</option>)}
                      </select>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
