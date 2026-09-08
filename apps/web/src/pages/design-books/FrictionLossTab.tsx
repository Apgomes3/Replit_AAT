import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Calculator, ChevronDown, ChevronUp, Plus, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import EntityCode from '../../components/ui/EntityCode';

type Side = 'suction' | 'discharge';

const fieldClass = 'w-full rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40 disabled:bg-stone-50 disabled:text-stone-500';

const PIPE_MATERIALS = [
  { value: 'PVC-U', roughness_mm: 0.0015 },
  { value: 'HDPE', roughness_mm: 0.0015 },
  { value: 'FRP-VE', roughness_mm: 0.01 },
  { value: 'Stainless steel', roughness_mm: 0.045 },
  { value: 'Carbon steel', roughness_mm: 0.045 },
  { value: 'Concrete', roughness_mm: 0.3 },
  { value: 'Glass', roughness_mm: 0.0015 },
  { value: 'Custom / other', roughness_mm: null },
] as const;

function pipeMaterial(value: unknown) {
  return PIPE_MATERIALS.find(material => material.value === value);
}

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
  const defaultMaterial = PIPE_MATERIALS[0];
  return {
    key: `${side}-${kind}-${Date.now()}-${Math.random()}`,
    side,
    component_kind: kind,
    project_piping_item_id: '',
    internal_diameter_mm: '',
    straight_length_m: '',
    material: kind === 'pipe' ? defaultMaterial.value : '',
    absolute_roughness_mm: kind === 'pipe' ? defaultMaterial.roughness_mm : '',
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
  const updateMaterial = (index: number, value: string) => {
    const material = pipeMaterial(value);
    onChange(rows.map((row, rowIndex) => rowIndex === index
      ? {
          ...row,
          material: value,
          absolute_roughness_mm: material?.roughness_mm ?? '',
        }
      : row));
  };
  const updateKind = (index: number, value: 'pipe' | 'fitting') => {
    const defaultMaterial = PIPE_MATERIALS[0];
    onChange(rows.map((row, rowIndex) => rowIndex === index
      ? {
          ...row,
          component_kind: value,
          ...(value === 'pipe' && !row.material
            ? {
                material: defaultMaterial.value,
                absolute_roughness_mm: defaultMaterial.roughness_mm,
              }
            : {}),
        }
      : row));
  };
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
        {!!rows.length && (
          <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full min-w-[980px] text-xs">
              <thead className="bg-stone-50 text-left text-[10px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-2.5 py-2">Project pipe / fitting</th>
                  <th className="px-2.5 py-2">Type</th>
                  <th className="px-2.5 py-2">Internal Ø (mm)</th>
                  <th className="px-2.5 py-2">Length / K-value</th>
                  <th className="px-2.5 py-2">Material / Qty</th>
                  <th className="px-2.5 py-2">Roughness (mm)</th>
                  <th className="px-2.5 py-2 text-right">Result</th>
                  {!readOnly && <th className="w-8 px-2.5 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((row, index) => {
                  const result = row.total_head_loss_m != null ? row : null;
                  const material = pipeMaterial(row.material);
                  const isPipe = row.component_kind === 'pipe';
                  return (
                    <tr key={row.key || `${side}-${index}`} className="align-top">
                      <td className="p-2">
                        <select aria-label={`Project pipe or fitting ${index + 1}`} value={row.project_piping_item_id || ''} onChange={event => update(index, 'project_piping_item_id', event.target.value)} disabled={readOnly} className={fieldClass}>
                          <option value="">Select assigned item</option>
                          {candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.piping_code} · {candidate.product_name || candidate.description || 'Piping item'}</option>)}
                        </select>
                      </td>
                      <td className="p-2">
                        <select aria-label={`Component type ${index + 1}`} value={row.component_kind} onChange={event => updateKind(index, event.target.value as 'pipe' | 'fitting')} disabled={readOnly} className={fieldClass}>
                          <option value="pipe">Straight pipe</option><option value="fitting">Fitting</option>
                        </select>
                      </td>
                      <td className="p-2">
                        <input aria-label={`Internal diameter ${index + 1}`} type="number" min="0" step="any" value={row.internal_diameter_mm ?? ''} onChange={event => update(index, 'internal_diameter_mm', event.target.value)} disabled={readOnly} className={fieldClass} />
                      </td>
                      <td className="p-2">
                        {isPipe
                          ? <input aria-label={`Length ${index + 1}`} type="number" min="0" step="any" value={row.straight_length_m ?? ''} onChange={event => update(index, 'straight_length_m', event.target.value)} disabled={readOnly} className={fieldClass} />
                          : <input aria-label={`K-value ${index + 1}`} type="number" min="0" step="any" value={row.fitting_k_value ?? ''} onChange={event => update(index, 'fitting_k_value', event.target.value)} disabled={readOnly} className={fieldClass} />}
                      </td>
                      <td className="p-2">
                        {isPipe
                          ? <select aria-label={`Material ${index + 1}`} value={row.material || ''} onChange={event => updateMaterial(index, event.target.value)} disabled={readOnly} className={fieldClass}>
                            {!material && row.material && <option value={row.material}>{row.material}</option>}
                            {!row.material && <option value="">Select material</option>}
                            {PIPE_MATERIALS.map(option => <option key={option.value} value={option.value}>{option.value}</option>)}
                          </select>
                          : <input aria-label={`Quantity ${index + 1}`} type="number" min="0" step="1" value={row.quantity ?? ''} onChange={event => update(index, 'quantity', event.target.value)} disabled={readOnly} className={fieldClass} />}
                      </td>
                      <td className="p-2">
                        {isPipe
                          ? <input aria-label={`Roughness ${index + 1}`} type="number" min="0" step="any" value={row.absolute_roughness_mm ?? material?.roughness_mm ?? ''} onChange={event => update(index, 'absolute_roughness_mm', event.target.value)} disabled={readOnly || material?.roughness_mm != null} className={fieldClass} />
                          : <span className="block px-2.5 py-2 text-stone-400">—</span>}
                      </td>
                      <td className="whitespace-nowrap p-2 text-right text-stone-600">
                        <div>{numberText(result?.velocity_m_s)} m/s</div>
                        <div className="font-mono font-semibold text-stone-800">{numberText(result?.total_head_loss_m)} m</div>
                      </td>
                      {!readOnly && <td className="p-2 text-right"><button type="button" aria-label={`Remove ${side} component ${index + 1}`} onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))} className="text-red-600"><Trash2 className="h-4 w-4" /></button></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
  const [components, setComponents] = useState<any[]>([]);
  const [tankBoundaries, setTankBoundaries] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const item = data?.items?.find((entry: any) => entry.circuit_key === circuitKey);

  useEffect(() => {
    if (!data?.items?.length) return;
    setCircuitKey(current => current || data.items[0].circuit_key);
  }, [data]);
  useEffect(() => {
    if (!item) return;
    setComponents((item.components || []).map((component: any, index: number) => ({
      ...component,
      key: component.id || `${item.circuit_key}-${index}`,
    })));
    setTankBoundaries(item.tank_boundaries || item.result?.inputs?.tank_boundaries || {
      start: { tank_id: '', base_elevation_fl0_m: '0', water_depth_m: '', pump_draw_height_m: '', open_to_atmosphere: true, gauge_pressure_kpa: '0' },
      end: { tank_id: '', base_elevation_fl0_m: '', water_depth_m: '', open_to_atmosphere: true, gauge_pressure_kpa: '0' },
    });
  }, [item?.circuit_key, item?.source_fingerprint]);

  const pumpSelectionReady = item?.pump_selection_ready ?? (
    item?.project_equipment_item_id &&
    item?.selected_pump &&
    (item?.pump_selection_freshness || item?.freshness) === 'fresh' &&
    (item?.pump_selection_status || 'ready') === 'ready'
  );
  const pumpSelectionReasons = item?.pump_selection_reasons?.length
    ? item.pump_selection_reasons
    : item?.reasons?.filter((reason: string) =>
      /pump|selection/i.test(reason));

  const save = async () => {
    if (!pumpSelectionReady) {
      toast.error('Complete Pump Selection for this Flow Route circuit before calculating friction loss.');
      return;
    }
    setSaving(true);
    try {
      await api.put(`/design-books/${bookId}/friction-loss/${systemId}`, {
        circuit_key: circuitKey,
        project_equipment_item_id: item.project_equipment_item_id,
        components: components.map(({ key, piping_snapshot, reasons, ...component }) => component),
        tank_boundaries: tankBoundaries,
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
        <div>
          <span className="mb-1 block text-xs font-medium text-stone-600">Inherited LSS pump</span>
          <div className={`${fieldClass} bg-stone-50`}>
            {item?.selected_pump
              ? `${item.selected_pump.equip_code || 'Untagged'} · ${item.selected_pump.product_name || item.selected_pump.description || item.selected_pump.product_code || 'Assigned pump'}`
              : 'No current pump selection'}
          </div>
          <p className="mt-1 text-xs text-stone-500">
            {item?.pump_selection_status || (item?.selected_pump ? 'ready' : 'incomplete')} · read-only from Pump Selection
          </p>
        </div>
      </div>
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        Authoritative circuit flow: <strong>{numberText(item?.flow_m3h)} m³/h</strong>. Darcy–Weisbach is used for straight pipe and K-values for fittings.
      </div>
      {tankBoundaries && <section className="rounded-xl border border-stone-200 bg-stone-50/50 p-4">
        <h4 className="font-semibold text-stone-900">Tank boundaries and static head</h4>
        <p className="text-xs text-stone-500">Levels are metres relative to FL0. Static head uses the free surfaces; pump draw height is retained for suction/NPSH review.</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {(['start', 'end'] as const).map(side => {
            const boundary = tankBoundaries[side] || {};
            const title = side === 'start' ? 'Start tank' : 'Receiving tank';
            const updateBoundary = (key: string, value: any) => setTankBoundaries((current: any) => ({
              ...current,
              [side]: { ...current[side], [key]: value },
            }));
            return <div key={side} className="rounded-xl border border-stone-200 bg-white p-4">
              <h5 className="font-semibold text-stone-800">{title}</h5>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="sm:col-span-2">
                  <span className="mb-1 block text-xs font-medium text-stone-600">Tank</span>
                  <select aria-label={title} value={boundary.tank_id || ''} onChange={event => updateBoundary('tank_id', event.target.value)} disabled={readOnly} className={fieldClass}>
                    <option value="">Select tank</option>
                    {boundary.tank_id && !(data?.tank_candidates || []).some((tank: any) => tank.id === boundary.tank_id) && <option value={boundary.tank_id}>{boundary.tank_snapshot?.tank_code || 'Saved tank'} · {boundary.tank_snapshot?.tank_name || 'Frozen evidence'}</option>}
                    {(data?.tank_candidates || []).map((tank: any) => <option key={tank.id} value={tank.id}>{tank.tank_code} · {tank.tank_name}</option>)}
                  </select>
                </label>
                <label><span className="mb-1 block text-xs font-medium text-stone-600">Tank base (m FL0)</span><input aria-label={`${title} base elevation`} type="number" step="any" value={boundary.base_elevation_fl0_m ?? ''} onChange={event => updateBoundary('base_elevation_fl0_m', event.target.value)} disabled={readOnly} className={fieldClass} /></label>
                <label><span className="mb-1 block text-xs font-medium text-stone-600">Water depth (m)</span><input aria-label={`${title} water depth`} type="number" min="0" step="any" value={boundary.water_depth_m ?? ''} onChange={event => updateBoundary('water_depth_m', event.target.value)} disabled={readOnly} className={fieldClass} /></label>
                {side === 'start' && <label><span className="mb-1 block text-xs font-medium text-stone-600">Pump draw above tank base (m)</span><input aria-label="Pump draw height" type="number" min="0" step="any" value={boundary.pump_draw_height_m ?? ''} onChange={event => updateBoundary('pump_draw_height_m', event.target.value)} disabled={readOnly} className={fieldClass} /></label>}
                <label className="flex items-center gap-2 self-end pb-2 text-sm text-stone-700"><input aria-label={`${title} open to atmosphere`} type="checkbox" checked={boundary.open_to_atmosphere !== false} onChange={event => updateBoundary('open_to_atmosphere', event.target.checked)} disabled={readOnly} />Open to atmosphere</label>
                {boundary.open_to_atmosphere === false && <label><span className="mb-1 block text-xs font-medium text-stone-600">Gauge pressure (kPa)</span><input aria-label={`${title} gauge pressure`} type="number" step="any" value={boundary.gauge_pressure_kpa ?? ''} onChange={event => updateBoundary('gauge_pressure_kpa', event.target.value)} disabled={readOnly} className={fieldClass} /></label>}
              </div>
            </div>;
          })}
        </div>
      </section>}
      {!readOnly && !pumpSelectionReady && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <div className="font-semibold">Pump Selection is required before friction loss can be calculated.</div>
          {!!pumpSelectionReasons?.length && <ul className="mt-2 list-disc space-y-1 pl-5 text-red-800">{pumpSelectionReasons.map((reason: string) => <li key={reason}>{reason}</li>)}</ul>}
          <a
            href={`/design-books/${bookId}/lss/${systemId}?tab=pump#pump-selection`}
            className="mt-3 inline-flex font-semibold text-blue-700 underline"
          >
            Open LSS Pump Selection
          </a>
        </div>
      )}
      <SideSchedule side="suction" rows={components.filter(row => row.side === 'suction')} candidates={data?.piping_candidates || []} readOnly={readOnly} onChange={rows => setComponents([...rows, ...components.filter(row => row.side === 'discharge')])} />
      <SideSchedule side="discharge" rows={components.filter(row => row.side === 'discharge')} candidates={data?.piping_candidates || []} readOnly={readOnly} onChange={rows => setComponents([...components.filter(row => row.side === 'suction'), ...rows])} />
      {!!item?.reasons?.length && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle className="h-4 w-4" />Action required</div><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">{item.reasons.map((reason: string) => <li key={reason}>{reason}</li>)}</ul></div>}
      {result?.side_totals && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{(['suction', 'discharge'] as Side[]).map(side => <div key={side} className="rounded-xl border border-stone-200 px-4 py-3"><div className="text-xs capitalize text-stone-500">{side} friction</div><div className="font-mono text-lg font-bold">{numberText(result.side_totals[side]?.total_head_loss_m)} m</div><div className="text-xs text-stone-500">{numberText(result.side_totals[side]?.pressure_drop_kpa)} kPa</div></div>)}<div className="rounded-xl border border-stone-200 px-4 py-3"><div className="text-xs text-stone-500">Combined friction</div><div className="font-mono text-lg font-bold">{numberText(result.results?.combined_head_loss_m)} m</div></div><div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3"><div className="text-xs text-blue-700">Static head</div><div className="font-mono text-lg font-bold text-blue-950">{numberText(result.results?.static_head_m)} m</div></div><div className="rounded-xl bg-stone-900 px-4 py-3 text-white"><div className="text-xs text-stone-300">Total dynamic head</div><div className="font-mono text-lg font-bold">{numberText(result.results?.total_dynamic_head_m)} m</div></div></div>}
       <div className="flex items-center justify-between border-t border-stone-100 pt-4"><p className="text-xs text-stone-500">{item?.calculation_version || 'friction-loss-v2'} · inputs and item identities are captured for audit.</p>{!readOnly && <button type="button" onClick={save} disabled={saving || !pumpSelectionReady} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save className="mr-1.5 inline h-4 w-4" />{saving ? 'Calculating…' : 'Save & recalculate'}</button>}</div>
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