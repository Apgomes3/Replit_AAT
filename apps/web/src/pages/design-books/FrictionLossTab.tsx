import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Calculator, ChevronDown, ChevronUp, Plus, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import EntityCode from '../../components/ui/EntityCode';

type Side = 'suction' | 'discharge';

const fieldClass = 'w-full rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40 disabled:bg-stone-50 disabled:text-stone-500';

function numberText(value: unknown, digits = 3) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '—';
}

function statusClass(status?: string) {
  if (status === 'ready') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'stale') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-red-200 bg-red-50 text-red-800';
}

function blankComponent(side: Side, kind: 'pipe' | 'fitting') {
  return {
    key: `${side}-${kind}-${Date.now()}-${Math.random()}`,
    side,
    component_kind: kind,
    project_piping_item_id: '',
    internal_diameter_mm: '',
    straight_length_m: '',
    material: '',
    absolute_roughness_mm: '',
    fitting_k_value: '',
    quantity: kind === 'fitting' ? '1' : '',
  };
}

function SideSchedule({
  side,
  rows,
  candidates,
  readOnly,
  onChange,
}: {
  side: Side;
  rows: any[];
  candidates: any[];
  readOnly: boolean;
  onChange: (rows: any[]) => void;
}) {
  const update = (index: number, key: string, value: any) =>
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  return (
    <section className="rounded-xl border border-stone-200 bg-stone-50/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-semibold text-stone-900">{side === 'suction' ? 'Suction side' : 'Discharge side'}</h4>
          <p className="text-xs text-stone-500">{side === 'suction' ? 'Components before the selected pump.' : 'Components after the selected pump.'}</p>
        </div>
        {!readOnly && (
          <div className="flex gap-2">
            <button type="button" onClick={() => onChange([...rows, blankComponent(side, 'pipe')])} className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700"><Plus className="mr-1 inline h-3.5 w-3.5" />Pipe</button>
            <button type="button" onClick={() => onChange([...rows, blankComponent(side, 'fitting')])} className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700"><Plus className="mr-1 inline h-3.5 w-3.5" />Fitting</button>
          </div>
        )}
      </div>
      <div className="mt-3 space-y-3">
        {!rows.length && <div className="rounded-lg border border-dashed border-stone-300 bg-white px-3 py-5 text-center text-sm text-stone-500">No {side}-side components assigned.</div>}
        {rows.map((row, index) => {
          const result = row.total_head_loss_m != null ? row : null;
          return (
            <div key={row.key || `${side}-${index}`} className="rounded-lg border border-stone-200 bg-white p-3">
              <div className="grid gap-2 lg:grid-cols-12">
                <label className="lg:col-span-4"><span className="mb-1 block text-xs font-medium text-stone-600">Project pipe / fitting</span>
                  <select value={row.project_piping_item_id || ''} onChange={event => update(index, 'project_piping_item_id', event.target.value)} disabled={readOnly} className={fieldClass}>
                    <option value="">Select assigned item</option>
                    {candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.piping_code} · {candidate.product_name || candidate.description || 'Piping item'}</option>)}
                  </select>
                </label>
                <label className="lg:col-span-2"><span className="mb-1 block text-xs font-medium text-stone-600">Type</span>
                  <select value={row.component_kind} onChange={event => update(index, 'component_kind', event.target.value)} disabled={readOnly} className={fieldClass}><option value="pipe">Straight pipe</option><option value="fitting">Fitting</option></select>
                </label>
                <label className="lg:col-span-2"><span className="mb-1 block text-xs font-medium text-stone-600">Internal Ø (mm)</span>
                  <input type="number" min="0" step="any" value={row.internal_diameter_mm ?? ''} onChange={event => update(index, 'internal_diameter_mm', event.target.value)} disabled={readOnly} className={fieldClass} />
                </label>
                {row.component_kind === 'pipe' ? (
                  <>
                    <label className="lg:col-span-2"><span className="mb-1 block text-xs font-medium text-stone-600">Length (m)</span><input type="number" min="0" step="any" value={row.straight_length_m ?? ''} onChange={event => update(index, 'straight_length_m', event.target.value)} disabled={readOnly} className={fieldClass} /></label>
                    <label className="lg:col-span-2"><span className="mb-1 block text-xs font-medium text-stone-600">Roughness (mm)</span><input type="number" min="0" step="any" value={row.absolute_roughness_mm ?? ''} onChange={event => update(index, 'absolute_roughness_mm', event.target.value)} disabled={readOnly} className={fieldClass} /></label>
                    <label className="lg:col-span-4"><span className="mb-1 block text-xs font-medium text-stone-600">Material</span><input value={row.material || ''} onChange={event => update(index, 'material', event.target.value)} disabled={readOnly} className={fieldClass} placeholder="e.g. PVC-U" /></label>
                  </>
                ) : (
                  <>
                    <label className="lg:col-span-2"><span className="mb-1 block text-xs font-medium text-stone-600">K-value</span><input type="number" min="0" step="any" value={row.fitting_k_value ?? ''} onChange={event => update(index, 'fitting_k_value', event.target.value)} disabled={readOnly} className={fieldClass} /></label>
                    <label className="lg:col-span-2"><span className="mb-1 block text-xs font-medium text-stone-600">Quantity</span><input type="number" min="0" step="1" value={row.quantity ?? ''} onChange={event => update(index, 'quantity', event.target.value)} disabled={readOnly} className={fieldClass} /></label>
                  </>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
                <span>Velocity <strong className="font-mono text-stone-700">{numberText(result?.velocity_m_s)} m/s</strong></span>
                <span>Re <strong className="font-mono text-stone-700">{numberText(result?.reynolds_number, 0)}</strong></span>
                {row.component_kind === 'pipe' && <span>f <strong className="font-mono text-stone-700">{numberText(result?.friction_factor, 5)}</strong></span>}
                <span>Loss <strong className="font-mono text-stone-700">{numberText(result?.total_head_loss_m)} m</strong></span>
                {!readOnly && <button type="button" onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))} className="ml-auto text-red-600"><Trash2 className="h-4 w-4" /></button>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SystemEditor({ bookId, systemId, readOnly, onClose, onSaved }: any) {
  const { data, isLoading } = useQuery({
    queryKey: ['friction-loss-system', bookId, systemId],
    queryFn: () => api.get(`/design-books/${bookId}/friction-loss/${systemId}`).then(response => response.data),
  });
  const [circuitKey, setCircuitKey] = useState('');
  const [pumpId, setPumpId] = useState('');
  const [components, setComponents] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const item = data?.items?.find((entry: any) => entry.circuit_key === circuitKey);

  useEffect(() => {
    if (!data?.items?.length) return;
    setCircuitKey(current => current || data.items[0].circuit_key);
  }, [data]);
  useEffect(() => {
    if (!item) return;
    setPumpId(item.project_equipment_item_id || '');
    setComponents((item.components || []).map((component: any, index: number) => ({
      ...component,
      key: component.id || `${item.circuit_key}-${index}`,
    })));
  }, [item?.circuit_key, item?.source_fingerprint]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/design-books/${bookId}/friction-loss/${systemId}`, {
        circuit_key: circuitKey,
        project_equipment_item_id: pumpId,
        components: components.map(({ key, piping_snapshot, reasons, ...component }) => component),
      });
      toast.success('Friction Loss calculated and saved');
      onSaved();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Unable to save Friction Loss calculation');
    } finally {
      setSaving(false);
    }
  };
  if (isLoading) return <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-stone-500">Loading circuits…</div>;
  const result = item?.result;
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Friction Loss</p><h3 className="text-lg font-semibold">{data?.system?.system_name}</h3><EntityCode code={data?.system?.system_code} /></div>
        <button onClick={onClose} className="text-sm text-stone-500">Close</button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label><span className="mb-1 block text-xs font-medium text-stone-600">Flow Route circuit</span>
          <select value={circuitKey} onChange={event => setCircuitKey(event.target.value)} className={fieldClass}>
            {(data?.items || []).map((entry: any) => <option key={entry.circuit_key} value={entry.circuit_key}>{entry.circuit_name} · {numberText(entry.flow_m3h)} m³/h</option>)}
          </select>
        </label>
        <label><span className="mb-1 block text-xs font-medium text-stone-600">Selected LSS pump</span>
          {readOnly ? <div className={`${fieldClass} bg-stone-50`}>{item?.selected_pump ? `${item.selected_pump.equip_code} · ${item.selected_pump.product_name || item.selected_pump.description}` : 'No valid pump selected'}</div> :
            <select value={pumpId} onChange={event => setPumpId(event.target.value)} className={fieldClass}><option value="">Select assigned pump</option>{(data?.pump_candidates || []).map((pump: any) => <option key={pump.id} value={pump.id}>{pump.equip_code} · {pump.product_code || pump.product_name}</option>)}</select>}
        </label>
      </div>
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        Authoritative circuit flow: <strong>{numberText(item?.flow_m3h)} m³/h</strong>. Darcy–Weisbach is used for straight pipe and K-values for fittings.
      </div>
      <SideSchedule side="suction" rows={components.filter(row => row.side === 'suction')} candidates={data?.piping_candidates || []} readOnly={readOnly} onChange={rows => setComponents([...rows, ...components.filter(row => row.side === 'discharge')])} />
      <SideSchedule side="discharge" rows={components.filter(row => row.side === 'discharge')} candidates={data?.piping_candidates || []} readOnly={readOnly} onChange={rows => setComponents([...components.filter(row => row.side === 'suction'), ...rows])} />
      {!!item?.reasons?.length && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle className="h-4 w-4" />Action required</div><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">{item.reasons.map((reason: string) => <li key={reason}>{reason}</li>)}</ul></div>}
      {result?.side_totals && <div className="grid gap-3 sm:grid-cols-3">{(['suction', 'discharge'] as Side[]).map(side => <div key={side} className="rounded-xl border border-stone-200 px-4 py-3"><div className="text-xs capitalize text-stone-500">{side} subtotal</div><div className="font-mono text-lg font-bold">{numberText(result.side_totals[side]?.total_head_loss_m)} m</div><div className="text-xs text-stone-500">{numberText(result.side_totals[side]?.pressure_drop_kpa)} kPa</div></div>)}<div className="rounded-xl bg-stone-900 px-4 py-3 text-white"><div className="text-xs text-stone-300">Combined friction loss</div><div className="font-mono text-lg font-bold">{numberText(result.results?.combined_head_loss_m)} m</div><div className="text-xs text-stone-300">{numberText(result.results?.combined_pressure_drop_kpa)} kPa</div></div></div>}
      <div className="flex items-center justify-between border-t border-stone-100 pt-4"><p className="text-xs text-stone-500">{item?.calculation_version || 'friction-loss-v1'} · inputs and item identities are captured for audit.</p>{!readOnly && <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save className="mr-1.5 inline h-4 w-4" />{saving ? 'Calculating…' : 'Save & recalculate'}</button>}</div>
    </div>
  );
}

export default function FrictionLossTab({ book, readOnly, onRefresh }: any) {
  const queryClient = useQueryClient();
  const [selectedSystem, setSelectedSystem] = useState<string | null>(null);
  const packages = book.friction_loss_calculations || [];
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['friction-loss-system', book.id, selectedSystem] });
    onRefresh();
  };
  if (!packages.length) return <div className="rounded-2xl border border-stone-200 bg-white py-16 text-center"><Calculator className="mx-auto mb-3 h-10 w-10 text-stone-300" /><p className="font-semibold text-stone-700">No LSS systems to calculate</p><p className="mt-1 text-sm text-stone-500">Create and configure a Life Support system first.</p></div>;
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-4 py-3">LSS system</th><th className="px-4 py-3">Flow Route circuits</th><th className="px-4 py-3">Readiness</th><th className="px-4 py-3"></th></tr></thead>
          <tbody className="divide-y divide-stone-100">{packages.map((entry: any) => {
            const ready = entry.items.filter((item: any) => item.status === 'ready').length;
            const stale = entry.items.some((item: any) => item.status === 'stale');
            return <tr key={entry.system_id}><td className="px-4 py-3"><div className="font-semibold">{entry.system?.system_name}</div><EntityCode code={entry.system?.system_code} /></td><td className="px-4 py-3">{entry.items.map((item: any) => <div key={item.circuit_key}>{item.circuit_name} · <span className="font-mono">{numberText(item.flow_m3h)} m³/h</span></div>)}</td><td className="px-4 py-3"><span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClass(stale ? 'stale' : ready === entry.items.length && ready > 0 ? 'ready' : 'incomplete')}`}>{stale ? 'Stale' : `${ready}/${entry.items.length} Ready`}</span></td><td className="px-4 py-3 text-right"><button onClick={() => setSelectedSystem(selectedSystem === entry.system_id ? null : entry.system_id)} className="font-medium text-blue-700">Open system {selectedSystem === entry.system_id ? <ChevronUp className="inline h-4 w-4" /> : <ChevronDown className="inline h-4 w-4" />}</button></td></tr>;
          })}</tbody>
        </table>
      </div>
      {selectedSystem && <SystemEditor bookId={book.id} systemId={selectedSystem} readOnly={readOnly} onClose={() => setSelectedSystem(null)} onSaved={refresh} />}
    </div>
  );
}