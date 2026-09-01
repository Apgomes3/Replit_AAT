import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Gauge, Plus, RefreshCw, Save, Trash2, Zap } from 'lucide-react';
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

type PumpLine = {
  circuit_key: string;
  circuit_kind: string;
  circuit_name: string;
  circuit_type?: string | null;
  parent_loop_number?: number | null;
  flow_m3h?: number | string | null;
  pump_role: string;
  pump_role_name?: string | null;
  is_foam_fractionator?: boolean;
  venturi_flow_m3h?: number | string | null;
  effective_flow_m3h?: number | string | null;
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
  items: PumpLine[];
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
  if (status === 'stale') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (status === 'incompatible') return 'border-red-200 bg-red-50 text-red-800';
  return 'border-stone-200 bg-stone-50 text-stone-700';
}

// ---------------------------------------------------------------------------
// Add-Pump inline form
// ---------------------------------------------------------------------------
function AddPumpForm({
  systemId,
  bookId,
  circuitKey,
  pumpRole,
  defaultEquipCode,
  defaultDescription,
  onCreated,
  onCancel,
}: {
  systemId: string;
  bookId: string;
  circuitKey: string;
  pumpRole: string;
  defaultEquipCode: string;
  defaultDescription: string;
  onCreated: (pei: any) => void;
  onCancel: () => void;
}) {
  const [equipCode, setEquipCode] = useState(defaultEquipCode);
  const [description, setDescription] = useState(defaultDescription);
  const [saving, setSaving] = useState(false);

  const create = async () => {
    setSaving(true);
    try {
      const resp = await api.post(`/systems/${systemId}/pump-lines`, {
        design_book_id: bookId,
        circuit_key: circuitKey,
        pump_role: pumpRole,
        equip_code: equipCode.trim(),
        description: description.trim(),
      });
      onCreated(resp.data.project_equipment_item);
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Unable to create pump equipment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-blue-800">
        Create project equipment pump
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="mb-1 block text-xs font-medium text-stone-600">Equipment code</span>
          <input
            aria-label="New pump equipment code"
            type="text"
            value={equipCode}
            onChange={e => setEquipCode(e.target.value)}
            className={inputClass}
            placeholder="e.g. FFSP-001"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-stone-600">Description</span>
          <input
            aria-label="New pump description"
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={create}
          disabled={saving || !equipCode.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          <Plus className="h-3.5 w-3.5" /> {saving ? 'Creating…' : 'Create pump'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single pump-line card (sizing form)
// ---------------------------------------------------------------------------
function PumpLineCard({
  line,
  candidates,
  readOnly,
  systemId,
  bookId,
  onRemoveVenturi,
}: {
  line: PumpLine;
  candidates: PumpCandidate[];
  readOnly: boolean;
  systemId: string;
  bookId: string;
  onRemoveVenturi?: () => void;
}) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const pumpRole = line.pump_role || 'primary';
  const isVenturi = pumpRole === 'venturi';

  const [form, setForm] = useState({
    project_equipment_item_id: line.project_equipment_item_id || '',
    design_head_m: line.design_head_m ?? '',
    pump_efficiency_pct: line.pump_efficiency_pct ?? '',
    motor_efficiency_pct: line.motor_efficiency_pct ?? '',
    venturi_flow_m3h: line.venturi_flow_m3h ?? '',
  });

  useEffect(() => {
    setForm({
      project_equipment_item_id: line.project_equipment_item_id || '',
      design_head_m: line.design_head_m ?? '',
      pump_efficiency_pct: line.pump_efficiency_pct ?? '',
      motor_efficiency_pct: line.motor_efficiency_pct ?? '',
      venturi_flow_m3h: line.venturi_flow_m3h ?? '',
    });
  }, [
    line.circuit_key, line.pump_role,
    line.project_equipment_item_id,
    line.design_head_m, line.pump_efficiency_pct, line.motor_efficiency_pct,
    line.venturi_flow_m3h,
  ]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/systems/${systemId}/pump-selections`, {
        design_book_id: bookId,
        circuit_key: line.circuit_key,
        pump_role: pumpRole,
        project_equipment_item_id: form.project_equipment_item_id || null,
        design_head_m: form.design_head_m === '' ? null : Number(form.design_head_m),
        pump_efficiency_pct: form.pump_efficiency_pct === '' ? null : Number(form.pump_efficiency_pct),
        motor_efficiency_pct: form.motor_efficiency_pct === '' ? null : Number(form.motor_efficiency_pct),
        ...(isVenturi ? { venturi_flow_m3h: form.venturi_flow_m3h === '' ? null : Number(form.venturi_flow_m3h) } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ['pump-selections', systemId, bookId] });
      await queryClient.invalidateQueries({ queryKey: ['design-book', bookId] });
      toast.success(`${line.pump_role_name || line.circuit_name} sizing saved`);
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Unable to save pump sizing');
    } finally {
      setSaving(false);
    }
  };

  const results = line.results || {};
  const selected = line.selected_pump || candidates.find(c => c.id === form.project_equipment_item_id);
  const stale = line.freshness === 'stale';
  const status = stale ? 'stale' : line.status;

  // The effective flow shown to the user.
  const displayFlow = isVenturi ? form.venturi_flow_m3h : line.flow_m3h;

  return (
    <div className="space-y-4 p-5">
      {/* Flow display — read-only for FFSP; editable for FFVP */}
      <div className="grid gap-4 lg:grid-cols-4">
        {isVenturi ? (
          <label className="lg:col-span-2">
            <span className="mb-1 block text-xs font-medium text-stone-600">
              Venturi pump duty flow (m³/h) <span className="text-red-600">*</span>
            </span>
            <input
              aria-label={`Venturi flow for ${line.pump_role_name || line.circuit_name}`}
              type="number"
              min="0.01"
              step="0.01"
              value={form.venturi_flow_m3h}
              onChange={e => setForm(current => ({ ...current, venturi_flow_m3h: e.target.value }))}
              disabled={readOnly}
              className={inputClass}
              placeholder="Enter venturi pump flow"
            />
            <p className="mt-1 text-xs text-stone-500">
              Venturi duty flow is independent of the supply-pump circuit flow. Enter the actual venturi pump flow.
            </p>
          </label>
        ) : (
          <div className="lg:col-span-2">
            <span className="mb-1 block text-xs font-medium text-stone-600">Authoritative Flow Route flow</span>
            <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
              <span className="font-mono text-lg font-bold text-cyan-700">{numberText(line.flow_m3h, 2)} m³/h</span>
              <span className="text-xs text-stone-400">(read-only from Flow Route)</span>
            </div>
          </div>
        )}
        <label>
          <span className="mb-1 block text-xs font-medium text-stone-600">Initial design head (m)</span>
          <input
            aria-label={`Initial design head for ${line.pump_role_name || line.circuit_name}`}
            type="number"
            min="0"
            step="0.1"
            value={form.design_head_m}
            onChange={e => setForm(current => ({ ...current, design_head_m: e.target.value }))}
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

      <div className="grid gap-4 lg:grid-cols-4">
        <label className="lg:col-span-2">
          <span className="mb-1 block text-xs font-medium text-stone-600">Selected system pump</span>
          <select
            aria-label={`Selected pump for ${line.pump_role_name || line.circuit_name}`}
            value={form.project_equipment_item_id}
            onChange={e => setForm(current => ({ ...current, project_equipment_item_id: e.target.value }))}
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
          <span className="mb-1 block text-xs font-medium text-stone-600">Pump hydraulic efficiency (%)</span>
          <input
            aria-label={`Pump efficiency for ${line.pump_role_name || line.circuit_name}`}
            type="number"
            min="0.1"
            max="100"
            step="0.1"
            value={form.pump_efficiency_pct}
            onChange={e => setForm(current => ({ ...current, pump_efficiency_pct: e.target.value }))}
            disabled={readOnly}
            className={inputClass}
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-stone-600">Motor efficiency (%)</span>
          <input
            aria-label={`Motor efficiency for ${line.pump_role_name || line.circuit_name}`}
            type="number"
            min="0.1"
            max="100"
            step="0.1"
            value={form.motor_efficiency_pct}
            onChange={e => setForm(current => ({ ...current, motor_efficiency_pct: e.target.value }))}
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

      {!!line.reasons?.length && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-800">
            <AlertCircle className="h-4 w-4" /> Action required
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
            {line.reasons.map(reason => <li key={reason}>{reason}</li>)}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4">
        <p className="max-w-2xl text-xs text-stone-500">
          Initial sizing uses Q × head with separate pump and motor efficiencies. It is an assumption point, not a manufacturer curve or NPSH check.
          {line.calculation_version ? ` Calculation ${line.calculation_version}.` : ''}
        </p>
        <div className="flex items-center gap-2">
          {isVenturi && !readOnly && onRemoveVenturi && (
            <button
              type="button"
              onClick={onRemoveVenturi}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove FFVP
            </button>
          )}
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Circuit group — wraps all pump lines for a single circuit_key
// ---------------------------------------------------------------------------
function CircuitGroup({
  circuitKey,
  lines,
  candidates,
  readOnly,
  systemId,
  bookId,
}: {
  circuitKey: string;
  lines: PumpLine[];
  candidates: PumpCandidate[];
  readOnly: boolean;
  systemId: string;
  bookId: string;
}) {
  const queryClient = useQueryClient();
  const primaryLine = lines.find(l => l.pump_role === 'primary') || lines[0];
  const venturiLine = lines.find(l => l.pump_role === 'venturi');
  const isFF = primaryLine?.is_foam_fractionator;

  // Venturi question state — 'asking' until the user answers or a FFVP row exists.
  const [venturiChoice, setVenturiChoice] = useState<'asking' | 'yes' | 'no'>(
    venturiLine ? 'yes' : 'asking',
  );
  const [showAddPump, setShowAddPump] = useState<string | null>(null); // pump_role being created
  const [expanded, setExpanded] = useState(true);
  const [removingVenturi, setRemovingVenturi] = useState(false);

  // Sync venturiChoice if the FFVP row appears or disappears from a re-fetch.
  useEffect(() => {
    if (venturiLine && venturiChoice !== 'yes') setVenturiChoice('yes');
  }, [!!venturiLine]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeVenturi = async () => {
    setRemovingVenturi(true);
    try {
      await api.delete(`/systems/${systemId}/pump-lines`, {
        params: { design_book_id: bookId, circuit_key: circuitKey, pump_role: 'venturi' },
      });
      await queryClient.invalidateQueries({ queryKey: ['pump-selections', systemId, bookId] });
      setVenturiChoice('no');
      toast.success('Venturi pump line removed');
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Unable to remove venturi pump line');
    } finally {
      setRemovingVenturi(false);
    }
  };

  const overallStatus = lines.every(l => l.status === 'ready') ? 'ready'
    : lines.some(l => l.status === 'incompatible') ? 'incompatible'
    : lines.some(l => l.status === 'stale' || l.freshness === 'stale') ? 'stale'
    : 'incomplete';

  return (
    <article className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
      {/* Circuit header */}
      <header
        className="flex cursor-pointer flex-wrap items-start justify-between gap-3 border-b border-stone-100 bg-stone-50/60 px-5 py-4"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-stone-900">{primaryLine?.circuit_name || circuitKey}</h3>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
              {primaryLine?.circuit_type || primaryLine?.circuit_kind}
            </span>
            {isFF && (
              <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                Foam Fractionator
              </span>
            )}
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusStyle(overallStatus)}`}>
              {overallStatus}
            </span>
          </div>
          <p className="mt-1 text-xs text-stone-500">
            Circuit <span className="font-mono text-stone-700">{circuitKey}</span>
            {lines.length > 1 && <> · {lines.length} pump lines</>}
          </p>
        </div>
        <div className="flex items-center gap-2 text-stone-400">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </header>

      {expanded && (
        <div className="divide-y divide-stone-100">
          {/* Primary (FFSP) line */}
          {primaryLine && (
            <div>
              {isFF && (
                <div className="flex items-center gap-2 border-b border-stone-100 bg-violet-50/60 px-5 py-2.5">
                  <span className="text-xs font-bold text-violet-800">FFSP — Foam Fractionator Supply Pump</span>
                  <span className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusStyle(primaryLine.status)}`}>
                    {primaryLine.status || 'unsaved'}
                  </span>
                </div>
              )}
              {showAddPump === 'primary' && !readOnly ? (
                <div className="p-5">
                  <AddPumpForm
                    systemId={systemId}
                    bookId={bookId}
                    circuitKey={circuitKey}
                    pumpRole="primary"
                    defaultEquipCode={isFF ? 'FFSP-001' : 'PUMP-001'}
                    defaultDescription={primaryLine.pump_role_name || 'Supply Pump'}
                    onCreated={async () => {
                      setShowAddPump(null);
                      await queryClient.invalidateQueries({ queryKey: ['pump-selections', systemId, bookId] });
                      await queryClient.invalidateQueries({ queryKey: ['design-book', bookId] });
                      toast.success('Pump created and added to candidates');
                    }}
                    onCancel={() => setShowAddPump(null)}
                  />
                </div>
              ) : (
                <>
                  {!readOnly && !primaryLine.project_equipment_item_id && (
                    <div className="flex items-center justify-between border-b border-stone-100 bg-amber-50 px-5 py-3">
                      <span className="text-sm text-amber-800">No pump is allocated to this circuit.</span>
                      <button
                        type="button"
                        onClick={() => setShowAddPump('primary')}
                        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                      >
                        <Plus className="h-4 w-4" /> Add pump
                      </button>
                    </div>
                  )}
                  <PumpLineCard
                    line={primaryLine}
                    candidates={candidates}
                    readOnly={readOnly}
                    systemId={systemId}
                    bookId={bookId}
                  />
                </>
              )}
            </div>
          )}

          {/* Foam Fractionator venturi question */}
          {isFF && !readOnly && !venturiLine && venturiChoice !== 'yes' && (
            <div className="px-5 py-4">
              <p className="mb-3 text-sm font-medium text-stone-700">
                Do you need a separate venturi pump?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setVenturiChoice('yes'); setShowAddPump('venturi'); }}
                  className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
                >
                  Yes — add FFVP
                </button>
                <button
                  type="button"
                  onClick={() => setVenturiChoice('no')}
                  className="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-600 hover:bg-stone-50"
                >
                  No
                </button>
              </div>
            </div>
          )}

          {/* Venturi pump not needed — allow re-opening the question */}
          {isFF && !readOnly && !venturiLine && venturiChoice === 'no' && (
            <div className="flex items-center gap-3 px-5 py-3 text-sm text-stone-500">
              <span>No separate venturi pump.</span>
              <button
                type="button"
                onClick={() => setVenturiChoice('asking')}
                className="text-xs text-blue-600 underline hover:no-underline"
              >
                Change
              </button>
            </div>
          )}

          {/* Add FFVP pump form (when Yes chosen but no pump created yet) */}
          {isFF && !readOnly && venturiChoice === 'yes' && showAddPump === 'venturi' && !venturiLine && (
            <div className="p-5">
              <AddPumpForm
                systemId={systemId}
                bookId={bookId}
                circuitKey={circuitKey}
                pumpRole="venturi"
                defaultEquipCode="FFVP-001"
                defaultDescription="FFVP — Foam Fractionator Venturi Pump"
                onCreated={async () => {
                  setShowAddPump(null);
                  await queryClient.invalidateQueries({ queryKey: ['pump-selections', systemId, bookId] });
                  await queryClient.invalidateQueries({ queryKey: ['design-book', bookId] });
                  toast.success('Venturi pump created and added to candidates');
                }}
                onCancel={() => { setVenturiChoice('asking'); setShowAddPump(null); }}
              />
            </div>
          )}

          {/* FFVP line (when saved) */}
          {venturiLine && (
            <div>
              <div className="flex items-center gap-2 border-b border-stone-100 bg-violet-50/60 px-5 py-2.5">
                <span className="text-xs font-bold text-violet-800">FFVP — Foam Fractionator Venturi Pump</span>
                <span className="ml-auto text-xs text-stone-500">Separate independent duty</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusStyle(venturiLine.status)}`}>
                  {venturiLine.status || 'unsaved'}
                </span>
              </div>
              <PumpLineCard
                line={venturiLine}
                candidates={candidates}
                readOnly={readOnly}
                systemId={systemId}
                bookId={bookId}
                onRemoveVenturi={!readOnly ? removeVenturi : undefined}
              />
            </div>
          )}
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------
export default function LSSPumpSelectionPanel({
  systemId,
  bookId,
  readOnly,
  sourcePackage,
}: {
  systemId: string;
  bookId: string;
  readOnly: boolean;
  sourcePackage?: { items?: PumpLine[] } | null;
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
  const items: PumpLine[] = data?.frozen
    ? (sourcePackage?.items || data.items || [])
    : (data?.items || sourcePackage?.items || []);
  const candidates: PumpCandidate[] = data?.pump_candidates || [];

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

  // Group lines by circuit_key to render each circuit as a unit.
  const circuitKeys = [...new Set(items.map(item => item.circuit_key))];
  const groupedByCircuit = circuitKeys.map(key => ({
    circuitKey: key,
    lines: items.filter(item => item.circuit_key === key),
  }));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <div className="flex items-start gap-2">
          <Zap className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Circuit flow is read-only and stays linked to Flow Route. Enter the initial head and separate pump/motor efficiencies to estimate motor power, then select a pump assigned to this LSS.
            Foam Fractionator loops can have a separate venturi pump (FFVP) with its own independently specified flow and duty.
          </p>
        </div>
      </div>
      {!candidates.length && !readOnly && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No eligible pump equipment is assigned to this LSS system yet. Use "Create project equipment pump" within a circuit, or assign a pump from the project equipment list.
        </div>
      )}
      {data?.frozen && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          This pump-selection package is frozen with the Design Book revision.
        </div>
      )}
      <div className="space-y-4">
        {groupedByCircuit.map(({ circuitKey, lines }) => (
          <CircuitGroup
            key={circuitKey}
            circuitKey={circuitKey}
            lines={lines}
            candidates={candidates}
            readOnly={readOnly || !!data?.frozen}
            systemId={systemId}
            bookId={bookId}
          />
        ))}
      </div>
    </div>
  );
}
