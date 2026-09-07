import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Save, Wind } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';

const units = ['mg/h', 'g/h', 'lb/h'];

function number(value: unknown, digits = 2) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—';
}

function displayRate(result: any, unit: string) {
  if (unit === 'mg/h') return result?.ozone_required_mg_h;
  if (unit === 'lb/h') return result?.ozone_required_lb_h;
  return result?.ozone_required_g_h;
}

export default function LSSOzoneCalculationPanel({ bookId, systemId, readOnly }: {
  bookId: string;
  systemId: string;
  readOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState('0.05');
  const [unit, setUnit] = useState('g/h');
  const [plenumKeys, setPlenumKeys] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['ozone-calculation', systemId, bookId],
    queryFn: () => api.get(`/systems/${systemId}/ozone-calculation?design_book_id=${bookId}`).then(response => response.data),
  });

  useEffect(() => {
    if (!data) return;
    setTarget(String(data.target_concentration_mg_l ?? data.input_snapshot?.target_concentration_mg_l ?? 0.05));
    setUnit(data.display_unit || data.input_snapshot?.display_unit || 'g/h');
    setPlenumKeys(data.ffvp_plenum_circuit_keys || data.input_snapshot?.ffvp_plenum_circuit_keys || []);
  }, [data]);

  const ffspLines = useMemo(() => (data?.pump_lines || data?.input_snapshot?.ffsp_lines || [])
    .filter((line: any) => line.pump_duty_tag === 'FFSP'), [data]);
  const ffvpLines = useMemo(() => (data?.pump_lines || [])
    .filter((line: any) => line.pump_duty_tag === 'FFVP'), [data]);
  const liveFfspFlow = ffspLines.reduce((sum: number, line: any) => sum + Number(line.flow_m3h || 0), 0);
  const liveFfvpFlow = ffvpLines
    .filter((line: any) => plenumKeys.includes(line.circuit_key))
    .reduce((sum: number, line: any) => sum + Number(line.venturi_flow_m3h || 0), 0);
  const frozenResult = data?.result_snapshot;
  const ffspFlow = data?.frozen ? Number(frozenResult?.ffsp_flow_m3h || 0) : liveFfspFlow;
  const ffvpFlow = data?.frozen ? Number(frozenResult?.applicable_ffvp_flow_m3h || 0) : liveFfvpFlow;
  const totalFlow = ffspFlow + ffvpFlow;
  const numericTarget = Number(target);
  const targetIsValid = Number.isFinite(numericTarget) && numericTarget >= 0.01 && numericTarget <= 0.2;
  const previewMgH = (targetIsValid ? numericTarget : 0) * totalFlow * 1_000;
  const preview = {
    ozone_required_mg_h: previewMgH,
    ozone_required_g_h: previewMgH / 1_000,
    ozone_required_lb_h: previewMgH / 453_592.37,
  };
  const result = data?.frozen ? frozenResult : preview;
  // Allocation and validation always originate from the server-side selection.
  const allocation = data?.allocation_snapshot || data?.allocation;

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/systems/${systemId}/ozone-calculation`, {
        design_book_id: bookId,
        target_concentration_mg_l: numericTarget,
        display_unit: unit,
        ffvp_plenum_circuit_keys: plenumKeys,
      });
      await queryClient.invalidateQueries({ queryKey: ['ozone-calculation', systemId, bookId] });
      await queryClient.invalidateQueries({ queryKey: ['design-book', bookId] });
      toast.success('Ozone calculation saved');
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Unable to save ozone calculation');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <div className="rounded-xl border border-stone-200 bg-white p-5 text-sm text-stone-500">Loading ozone calculation…</div>;
  if (isError) return <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">Unable to load the ozone calculation.</div>;

  return (
    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <header className="border-b border-stone-100 bg-stone-50/60 px-5 py-4">
        <div className="flex items-center gap-2"><Wind className="h-5 w-5 text-indigo-600" /><h2 className="font-semibold text-stone-900">Ozone dose calculation</h2></div>
        <p className="mt-1 text-xs text-stone-500">FFSP flow plus only the FFVP flows configured to draw directly from the plenum.</p>
      </header>
      <div className="space-y-5 p-5">
        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <label htmlFor="ozone-target" className="font-medium text-stone-700">Target ozone concentration</label>
            <span className="flex items-center gap-1 font-mono font-semibold text-indigo-700">
              <input
                aria-label="Target ozone concentration value"
                type="number"
                min="0.01"
                max="0.2"
                step="0.005"
                value={target}
                disabled={readOnly || data?.frozen}
                onChange={event => setTarget(event.target.value)}
                className="w-24 rounded-md border border-indigo-200 bg-white px-2 py-1 text-right font-mono text-sm font-semibold text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400/40 disabled:bg-stone-50"
              />
              mg/L
            </span>
          </div>
          <input id="ozone-target" aria-label="Target ozone concentration" type="range" min="0.01" max="0.2" step="0.005"
            value={targetIsValid ? numericTarget : 0.01} disabled={readOnly || data?.frozen} onChange={event => setTarget(event.target.value)}
            className="w-full accent-indigo-600" />
          <div className="flex justify-between text-[10px] text-stone-400"><span>0.010</span><span>Default 0.050</span><span>0.200 mg/L</span></div>
        </div>

        {!!ffvpLines.length && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-stone-800">FFVP water source</h3>
            {ffvpLines.map((line: any) => (
              <label key={line.circuit_key} className="flex items-start gap-3 rounded-lg border border-stone-200 p-3">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-indigo-600" checked={plenumKeys.includes(line.circuit_key)}
                  disabled={readOnly || data?.frozen}
                  onChange={event => setPlenumKeys(current => event.target.checked
                    ? [...current, line.circuit_key]
                    : current.filter(key => key !== line.circuit_key))} />
                <span><span className="block text-sm font-medium text-stone-800">{line.circuit_name || line.circuit_key}</span>
                  <span className="text-xs text-stone-500">FFVP draws directly from the plenum · {number(line.venturi_flow_m3h)} m³/h</span></span>
              </label>
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-3"><div className="text-xs text-stone-500">FFSP flow</div><div className="mt-1 font-mono text-lg font-bold">{number(ffspFlow)} m³/h</div></div>
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-3"><div className="text-xs text-stone-500">Applicable FFVP flow</div><div className="mt-1 font-mono text-lg font-bold">{number(ffvpFlow)} m³/h</div></div>
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3"><div className="text-xs text-indigo-600">Total treatment flow</div><div className="mt-1 font-mono text-lg font-bold text-indigo-800">{number(totalFlow)} m³/h</div></div>
        </div>

        {totalFlow > 0 ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700"><CheckCircle2 className="h-4 w-4" />Ozone required</div>
                <div className="mt-1 font-mono text-3xl font-bold text-emerald-900">{number(displayRate(result, unit), unit === 'lb/h' ? 4 : 2)} {unit}</div></div>
              <div role="group" aria-label="Ozone requirement unit" className="inline-flex rounded-lg border border-emerald-200 bg-white p-1">
                {units.map(option => <button type="button" key={option} onClick={() => setUnit(option)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold ${unit === option ? 'bg-emerald-700 text-white' : 'text-stone-600 hover:bg-stone-50'}`}>{option}</button>)}
              </div>
            </div>
            <p className="mt-3 text-xs text-emerald-800">{targetIsValid ? numericTarget.toFixed(3) : '—'} mg/L × {number(totalFlow)} m³/h × 1,000 L/m³</p>
          </div>
        ) : (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><AlertCircle className="h-5 w-5 shrink-0" />Save a positive FFSP flow in Pump Selection before calculating ozone demand.</div>
        )}
        {allocation && (
          <div className={`rounded-xl border p-4 ${allocation.validation_status === 'PASS' ? 'border-emerald-200 bg-emerald-50' : allocation.validation_status === 'WARNING' ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-stone-600">Automatic ozone generator selection</div>
                {allocation.product_id
                  ? <div className="mt-1 text-sm font-semibold text-stone-900">{allocation.quantity} × {allocation.product_code}{allocation.model ? ` · ${allocation.model}` : ''} — {allocation.product_name}</div>
                  : <div className="mt-1 text-sm font-semibold text-red-800">{allocation.reason || 'No suitable ozone generator is available.'}</div>}
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-stone-800 ring-1 ring-black/5">{allocation.validation_status}</span>
            </div>
            {allocation.product_id && <div className="mt-3 grid gap-2 text-xs text-stone-700 sm:grid-cols-4">
              <span>Unit: <b>{number(allocation.per_unit_capacity_g_h)} g/h</b></span>
              <span>Installed: <b>{number(allocation.total_installed_capacity_g_h)} g/h</b></span>
              <span>Required: <b>{number(allocation.required_capacity_g_h)} g/h</b></span>
              <span>Oversize: <b>{number(allocation.oversize_percent)}%</b></span>
            </div>}
            <p className="mt-3 text-xs text-stone-600">PASS: installed capacity meets demand within 30%. WARNING: engineering review required for oversizing above 30%. FAIL: no compliant capacity is available.</p>
          </div>
        )}
        {!readOnly && !data?.frozen && <div className="flex justify-end"><button type="button" onClick={save} disabled={saving || totalFlow <= 0 || !targetIsValid}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Saving…' : 'Save ozone calculation'}</button></div>}
      </div>
    </section>
  );
}