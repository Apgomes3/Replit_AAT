import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Gauge, RefreshCw, Save, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';

type PumpCandidate = {
  id: string;
  equip_code?: string | null;
  description?: string | null;
  product_code?: string | null;
  product_name?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  power_kw?: number | string | null;
};

type PumpSelectionItem = {
  circuit_key: string;
  circuit_kind: string;
  circuit_name: string;
  circuit_type?: string | null;
  parent_loop_number?: number | null;
  flow_m3h?: number | string | null;
  project_equipment_item_id?: string | null;
  selected_pump?: PumpCandidate | null;
  design_head_m?: number | string | null;
  pump_efficiency_pct?: number | string | null;
  motor_efficiency_pct?: number | string | null;
  freshness?: string | null;
  status?: string | null;
  reasons?: string[];
  calculation_version?: string | null;
  results?: {
    hydraulic_power_kw?: number | null;
    shaft_power_kw?: number | null;
    motor_input_kw?: number | null;
    recommended_motor_kw?: number | null;
  } | null;
};

type PumpSelectionResponse = {
  items: PumpSelectionItem[];
  pump_candidates: PumpCandidate[];
  frozen?: boolean;
};

const inputClass = 'w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40 disabled:bg-stone-50 disabled:text-stone-500';

function numberText(value: unknown, digits = 2) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '—';
}

function statusStyle(status?: string | null) {
  if (status === 'ready' || status === 'valid') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'warning' || status === 'stale') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-stone-200 bg-stone-50 text-stone-700';
}

function PumpCircuitCard({
  item,
  candidates,
  readOnly,
  systemId,
  bookId,
}: {
  item: PumpSelectionItem;
  candidates: PumpCandidate[];
  readOnly: boolean;
  systemId: string;
  bookId: string;
}) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    project_equipment_item_id: item.project_equipment_item_id || '',
    design_head_m: item.design_head_m ?? '',
    pump_efficiency_pct: item.pump_efficiency_pct ?? '',
    motor_efficiency_pct: item.motor_efficiency_pct ?? '',
  });

  useEffect(() => {
    setForm({
      project_equipment_item_id: item.project_equipment_item_id || '',
      design_head_m: item.design_head_m ?? '',
      pump_efficiency_pct: item.pump_efficiency_pct ?? '',
      motor_efficiency_pct: item.motor_efficiency_pct ?? '',
    });
  }, [
    item.circuit_key,
    item.project_equipment_item_id,
    item.design_head_m,
    item.pump_efficiency_pct,
    item.motor_efficiency_pct,
  ]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/systems/${systemId}/pump-selections`, {
        design_book_id: bookId,
        circuit_key: item.circuit_key,
        project_equipment_item_id: form.project_equipment_item_id || null,
        design_head_m: form.design_head_m === '' ? null : Number(form.design_head_m),
        pump_efficiency_pct: form.pump_efficiency_pct === '' ? null : Number(form.pump_efficiency_pct),
        motor_efficiency_pct: form.motor_efficiency_pct === '' ? null : Number(form.motor_efficiency_pct),
      });
      await queryClient.invalidateQueries({ queryKey: ['pump-selections', systemId, bookId] });
      await queryClient.invalidateQueries({ queryKey: ['design-book', bookId] });
      toast.success(`${item.circuit_name} pump sizing saved`);
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Unable to save pump sizing');
    } finally {
      setSaving(false);
    }
  };

  const results = item.results || {};
  const selected = item.selected_pump || candidates.find(candidate => candidate.id === form.project_equipment_item_id);
  const stale = item.freshness === 'stale';
  const status = stale ? 'stale' : item.status;

  return (
    <article className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 bg-stone-50/60 px-5 py-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-stone-900">{item.circuit_name}</h3>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
              {item.circuit_type || item.circuit_kind}
            </span>
          </div>
          <p className="mt-1 text-xs text-stone-500">
            Stable circuit reference <span className="font-mono text-stone-700">{item.circuit_key}</span>
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-stone-500">Authoritative Flow Route flow</div>
          <div className="font-mono text-lg font-bold text-cyan-700">{numberText(item.flow_m3h, 2)} m³/h</div>
        </div>
      </header>

      <div className="space-y-5 p-5">
        <div className="grid gap-4 lg:grid-cols-4">
          <label className="lg:col-span-2">
            <span className="mb-1 block text-xs font-medium text-stone-600">Selected system pump</span>
            <select
              aria-label={`Selected pump for ${item.circuit_name}`}
              value={form.project_equipment_item_id}
              onChange={event => setForm(current => ({ ...current, project_equipment_item_id: event.target.value }))}
              disabled={readOnly}
              className={inputClass}
            >
              <option value="">— Select assigned pump —</option>
              {candidates.map(candidate => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.equip_code || 'Untagged'} — {candidate.product_code || candidate.product_name || candidate.description || 'Pump'}
                </option>
              ))}
            </select>
            {selected && (
              <p className="mt-1 text-xs text-stone-500">
                {selected.product_code || selected.equip_code} · {selected.product_name || selected.description}
                {selected.power_kw != null ? ` · ${selected.power_kw} kW catalog rating` : ''}
              </p>
            )}
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-stone-600">Initial design head (m)</span>
            <input
              aria-label={`Initial design head for ${item.circuit_name}`}
              type="number"
              min="0"
              step="0.1"
              value={form.design_head_m}
              onChange={event => setForm(current => ({ ...current, design_head_m: event.target.value }))}
              disabled={readOnly}
              className={inputClass}
            />
          </label>
          <div className={`rounded-xl border px-3 py-2 ${statusStyle(status)}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wide">Sizing status</div>
            <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold capitalize">
              {status === 'ready' || status === 'valid'
                ? <CheckCircle2 className="h-4 w-4" />
                : stale
                  ? <RefreshCw className="h-4 w-4" />
                  : <AlertCircle className="h-4 w-4" />}
              {status || 'Incomplete'}
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="mb-1 block text-xs font-medium text-stone-600">Pump hydraulic efficiency (%)</span>
            <input
              aria-label={`Pump efficiency for ${item.circuit_name}`}
              type="number"
              min="0.1"
              max="100"
              step="0.1"
              value={form.pump_efficiency_pct}
              onChange={event => setForm(current => ({ ...current, pump_efficiency_pct: event.target.value }))}
              disabled={readOnly}
              className={inputClass}
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-stone-600">Motor efficiency (%)</span>
            <input
              aria-label={`Motor efficiency for ${item.circuit_name}`}
              type="number"
              min="0.1"
              max="100"
              step="0.1"
              value={form.motor_efficiency_pct}
              onChange={event => setForm(current => ({ ...current, motor_efficiency_pct: event.target.value }))}
              disabled={readOnly}
              className={inputClass}
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Hydraulic power', results.hydraulic_power_kw],
            ['Pump shaft power', results.shaft_power_kw],
            ['Motor input', results.motor_input_kw],
            ['Initial motor size', results.recommended_motor_kw],
          ].map(([label, value], index) => (
            <div key={String(label)} className={index === 3 ? 'rounded-xl bg-stone-900 px-4 py-3 text-white' : 'rounded-xl border border-stone-200 bg-stone-50 px-4 py-3'}>
              <div className={index === 3 ? 'text-xs text-stone-300' : 'text-xs text-stone-500'}>{label}</div>
              <div className="mt-1 font-mono text-lg font-bold">{numberText(value)} kW</div>
            </div>
          ))}
        </div>

        {!!item.reasons?.length && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-800">
              <AlertCircle className="h-4 w-4" /> Action required
            </div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
              {item.reasons.map(reason => <li key={reason}>{reason}</li>)}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4">
          <p className="max-w-2xl text-xs text-stone-500">
            Initial sizing uses Q × head with separate pump and motor efficiencies. It is an assumption point, not a manufacturer curve or NPSH check.
            {item.calculation_version ? ` Calculation ${item.calculation_version}.` : ''}
          </p>
          {!readOnly && (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save & calculate'}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export default function LSSPumpSelectionPanel({
  systemId,
  bookId,
  readOnly,
  sourcePackage,
}: {
  systemId: string;
  bookId: string;
  readOnly: boolean;
  sourcePackage?: { items?: PumpSelectionItem[] } | null;
}) {
  const { data, isLoading, isError, error } = useQuery<PumpSelectionResponse>({
    queryKey: ['pump-selections', systemId, bookId],
    queryFn: () => api.get(`/systems/${systemId}/pump-selections`, {
      params: { design_book_id: bookId },
    }).then(response => response.data),
    enabled: !!systemId && !!bookId,
  });

  if (isLoading) {
    return <div className="rounded-2xl border border-stone-200 bg-white py-16 text-center text-sm text-stone-500">Loading pump circuits…</div>;
  }
  if (isError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
        {(error as any)?.response?.data?.error?.message || 'Unable to load pump selection.'}
      </div>
    );
  }

  // The Design Book package is assembled with the calculated current system
  // flow, so prefer it over the raw-system endpoint for displayed circuit flow.
  const items = sourcePackage?.items || data?.items || [];
  const candidates = data?.pump_candidates || [];
  if (!items.length) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white px-5 py-16 text-center">
        <Gauge className="mx-auto h-9 w-9 text-stone-300" />
        <h2 className="mt-3 font-semibold text-stone-800">No Flow Route circuits available</h2>
        <p className="mx-auto mt-1 max-w-lg text-sm text-stone-500">
          Define and save a main loop or dedicated side stream in Flow Route before selecting a pump.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <div className="flex items-start gap-2">
          <Zap className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Circuit flow is read-only and stays linked to Flow Route. Enter the initial head and separate pump/motor efficiencies to estimate motor power, then select a pump assigned to this LSS.
          </p>
        </div>
      </div>
      {!candidates.length && !readOnly && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No eligible pump equipment is assigned to this LSS system yet. Assign a project pump before completing selection.
        </div>
      )}
      {data?.frozen && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          This pump-selection package is frozen with the Design Book revision.
        </div>
      )}
      {items.map(item => (
        <PumpCircuitCard
          key={item.circuit_key}
          item={item}
          candidates={candidates}
          readOnly={readOnly || !!data?.frozen}
          systemId={systemId}
          bookId={bookId}
        />
      ))}
    </div>
  );
}