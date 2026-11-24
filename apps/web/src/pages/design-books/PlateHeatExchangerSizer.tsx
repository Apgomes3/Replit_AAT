// Plate heat exchanger sizer: inputs on the left, live results on the right, a saved sizing can be linked
// to a project, and "Print selection sheet" prints the A4 data sheet on AAT letterhead.
// The calculation is lib/plateHeatExchanger.ts, a tested port of the PHE sizer artifact.
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FileText, Printer, Save, Trash2, X } from 'lucide-react';
import ModalDialog from '../../components/ui/ModalDialog';
import { buildSheetModel } from '../../lib/plateHeatExchangerSheet';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import { useAuthStore } from '../../store/authStore';
import {
  applyPreset, approachHint, BETA_NAME, computePhe, connectionRows, DEFAULT_INPUTS, FRAMES, fluidName, fmt, kPa,
  materialGuidance, modelName, PheInputs, PheResult, resolveInputs, resultSummary, Side, Source, statusOf,
  velocityMeetsTarget, VCH_MAX,
} from '../../lib/plateHeatExchanger';
import { ProfileChart } from './PlateHeatExchangerChart';
import PlateHeatExchangerSheet, { SheetHeader } from './PlateHeatExchangerSheet';

const EDITOR_ROLES = ['admin', 'engineer', 'manager', 'user'];
const PASS_OPTIONS = ['1/1', 'auto', ...[1, 2, 3, 4].flatMap(a => [1, 2, 3, 4].map(c => `${a}/${c}`)).filter(k => k !== '1/1')];

const inputCls = 'w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-stone-100 disabled:text-stone-500';
const cardCls = 'rounded-xl border border-stone-200 bg-white';
const tableCls = 'w-full text-sm [&_td]:border-b [&_td]:border-stone-100 [&_td]:px-2 [&_td]:py-1.5 [&_th]:border-b [&_th]:border-stone-300 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-stone-500 [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap';

function Field({ label, unit, children }: { label: string; unit?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-stone-600">
      <span>{label}{unit && <span className="text-stone-400"> ({unit})</span>}</span>
      {children}
    </label>
  );
}

function Num({ value, onChange, disabled, step = 'any', min }: { value: number; onChange: (v: number) => void; disabled?: boolean; step?: string; min?: number }) {
  return <input type="number" className={inputCls} value={Number.isFinite(value) ? value : ''} step={step} min={min} disabled={disabled}
    onChange={e => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />;
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap overflow-hidden rounded-lg border border-stone-300">
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={`flex-1 whitespace-nowrap border-r border-stone-300 px-2 py-1.5 text-xs font-medium last:border-r-0 ${value === v ? 'bg-blue-600 text-white' : 'bg-white text-stone-600 hover:bg-stone-50'}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Section({ title, children, dot }: { title: string; children: ReactNode; dot?: string }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 border-b border-stone-200 px-4 py-4 last:border-b-0">
      <legend className="float-left mb-1 flex w-full items-center gap-2 text-sm font-semibold text-stone-900">
        {dot && <span className="h-2.5 w-2.5 rounded-full" style={{ background: dot }} />}{title}
      </legend>
      {children}
    </fieldset>
  );
}

const HOT = '#c4512b', COLD = '#2370b3';
const NOTE_CLS = { bad: 'border-red-500 bg-red-50', warn: 'border-amber-500 bg-amber-50', info: 'border-blue-500 bg-blue-50', ok: 'border-emerald-500 bg-emerald-50' };
const STATUS_CHIP = {
  feasible: ['Feasible', 'bg-emerald-50 text-emerald-700'],
  warnings: ['Feasible, check warnings', 'bg-amber-50 text-amber-700'],
  not_feasible: ['Not feasible as entered', 'bg-red-50 text-red-700'],
} as const;

type ProjectOptions = {
  client_id: string | null; client_name: string | null;
  design_books: { id: string; book_code: string; book_title: string; status: string | null }[];
  systems: { id: string; system_code: string; system_name: string; system_type: string | null; next_tag: string }[];
};
type Saved = { id: string; title: string; project_id: string | null; client_id: string | null; design_book_id: string | null; system_id: string | null; inputs: PheInputs; sheet: SheetHeader; project_code?: string; project_name?: string; client_name?: string };

export default function PlateHeatExchangerSizer() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore(state => state.user);
  const access = (user as any)?.moduleAccess?.design_books;
  const canEdit = !!user && EDITOR_ROLES.includes(user.role) && access !== 'view' && access !== 'hidden';

  const [inputs, setInputs] = useState<PheInputs>(DEFAULT_INPUTS);
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState<string>('');
  const [clientId, setClientId] = useState<string>('');
  const [bookId, setBookId] = useState<string>('');
  const [systemId, setSystemId] = useState<string>('');
  const [sheet, setSheet] = useState<SheetHeader>({ rev: 'A' });
  const [saving, setSaving] = useState(false);

  const savedQ = useQuery<Saved>({
    queryKey: ['plate-heat-exchangers', id],
    queryFn: () => api.get(`/plate-heat-exchangers/${id}`).then(r => r.data),
    enabled: !isNew,
  });
  useEffect(() => {
    const s = savedQ.data;
    if (!s) return;
    setInputs({ ...DEFAULT_INPUTS, ...s.inputs });
    setTitle(s.title);
    setProjectId(s.project_id || '');
    setClientId(s.client_id || '');
    setBookId(s.design_book_id || '');
    setSystemId(s.system_id || '');
    setSheet({ rev: 'A', ...s.sheet });
  }, [savedQ.data]);

  const projectsQ = useQuery({
    queryKey: ['projects', 'phe-picker'],
    queryFn: () => api.get('/projects', { params: { page_size: 500, sort: 'project_code' } }).then(r => r.data.items as any[]),
  });
  const project = projectsQ.data?.find(p => p.id === projectId);
  // A project brings its client, design books and LSS systems; without one the client comes from the client list.
  const projectOptsQ = useQuery<ProjectOptions>({
    queryKey: ['plate-heat-exchangers', 'project-options', projectId],
    queryFn: () => api.get(`/plate-heat-exchangers/options/projects/${projectId}`).then(r => r.data),
    enabled: !!projectId,
  });
  const clientsQ = useQuery<{ id: string; client_code: string; name: string }[]>({
    queryKey: ['plate-heat-exchangers', 'client-options'],
    queryFn: () => api.get('/plate-heat-exchangers/options/clients').then(r => r.data),
    enabled: !projectId,
  });
  const opts = projectId ? projectOptsQ.data : undefined;
  // Only one design book on the project: pick it.
  useEffect(() => {
    if (opts && !bookId && opts.design_books.length === 1 && canEdit) setBookId(opts.design_books[0].id);
  }, [opts]); // eslint-disable-line react-hooks/exhaustive-deps

  function chooseProject(next: string) {
    setProjectId(next);
    setBookId('');
    setSystemId('');
    setClientId('');
    setSheet(prev => ({ ...prev, client: '', service: '' }));
  }
  function chooseSystem(next: string) {
    setSystemId(next);
    const sys = opts?.systems.find(x => x.id === next);
    // Suggest the next HX number on that system, unless a tag was typed by hand.
    const suggested = new Set((opts?.systems || []).map(x => x.next_tag));
    setSheet(prev => ({
      ...prev, service: sys ? sys.system_name : '',
      tag: !prev.tag || suggested.has(prev.tag) ? (sys?.next_tag || '') : prev.tag,
    }));
  }
  function chooseClient(next: string) {
    setClientId(next);
    setSheet(prev => ({ ...prev, client: clientsQ.data?.find(c => c.id === next)?.name || '' }));
  }
  const clientName = projectId ? (opts?.client_name || '') : (clientsQ.data?.find(c => c.id === clientId)?.name || sheet.client || '');

  const resolved = useMemo(() => resolveInputs(inputs), [inputs]);
  const result = useMemo(() => { try { return computePhe(resolved); } catch (e: any) { return { fatal: `Calculation error: ${e.message}` }; } }, [resolved]);
  // Flows derived from the duty, shown in the fixed-flow boxes until a flow is fixed (as the artifact does).
  const derived = useMemo(() => {
    const r = computePhe({ ...resolved, pFlowMode: 'auto', sFlowMode: 'auto' });
    return 'fatal' in r && r.fatal ? null : r as PheResult;
  }, [resolved]);

  const set = (patch: Partial<PheInputs>) => setInputs(prev => ({ ...prev, ...patch }));
  const setSheetField = (k: keyof SheetHeader, v: string) => setSheet(prev => ({ ...prev, [k]: v }));
  const disabled = !canEdit;

  const header: SheetHeader = { ...sheet, project: project ? `${project.project_code} ${project.project_name}` : sheet.project, client: clientName };
  const r0 = 'fatal' in result && result.fatal ? null : result as PheResult;
  const sheetModel = useMemo(() => (r0?.R ? buildSheetModel(r0, header) : null), [r0, JSON.stringify(header)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Printing a sheet on a project offers to store it in that project's documents as well.
  const docsAccess = (user as any)?.moduleAccess?.documents;
  const canStore = canEdit && !!projectId && docsAccess !== 'view' && docsAccess !== 'hidden';
  const [askStore, setAskStore] = useState(false);
  const [storing, setStoring] = useState(false);
  const printNow = () => setTimeout(() => window.print(), 50);
  function onPrint() { if (canStore) setAskStore(true); else printNow(); }
  async function storeAndPrint() {
    if (!sheetModel) return;
    setStoring(true);
    try {
      const savedId = await save();
      if (!savedId) return;
      const res = await api.post(`/plate-heat-exchangers/${savedId}/documents`, { sheet: sheetModel });
      toast.success(`Stored in project documents as ${res.data.document_code} rev ${res.data.revision_code}`);
      setAskStore(false);
      printNow();
    } catch { /* the API error is shown by the request handler */ } finally { setStoring(false); }
  }

  /** Saves the sizing and returns its id (null when it could not be saved). */
  async function save(): Promise<string | null> {
    const t = title.trim() || sheet.tag?.trim() || '';
    if (!t) { toast.error('Give the sizing a title or an item tag first.'); return null; }
    setSaving(true);
    try {
      const body = {
        title: t, project_id: projectId || null, client_id: projectId ? null : (clientId || null),
        design_book_id: projectId ? (bookId || null) : null, system_id: projectId ? (systemId || null) : null,
        inputs, sheet: { ...sheet, client: clientName }, result_summary: resultSummary(result) };
      const res = isNew ? await api.post('/plate-heat-exchangers', body) : await api.put(`/plate-heat-exchangers/${id}`, body);
      queryClient.invalidateQueries({ queryKey: ['plate-heat-exchangers'] });
      toast.success('Sizing saved');
      setTitle(t);
      if (isNew) navigate(`/plate-heat-exchangers/${res.data.id}`, { replace: true });
      return res.data.id as string;
    } catch { return null; } finally { setSaving(false); }
  }

  async function remove() {
    if (isNew || !window.confirm('Delete this sizing? This cannot be undone.')) return;
    await api.delete(`/plate-heat-exchangers/${id}`);
    queryClient.invalidateQueries({ queryKey: ['plate-heat-exchangers'] });
    toast.success('Sizing deleted');
    navigate('/plate-heat-exchangers');
  }

  const r = 'fatal' in result && result.fatal ? null : result as PheResult;
  const canPrint = !!r?.R;
  const pRole = r ? r.P.role : null, sRole = r ? r.S.role : null;
  const dot = (role: string | null) => (role === 'hot' ? HOT : role === 'cold' ? COLD : '#a8a29e');

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        crumbs={[{ label: 'Plate Heat Exchangers', href: '/plate-heat-exchangers' }, { label: isNew ? 'New sizing' : (savedQ.data?.title || '…') }]}
        title={isNew ? 'New plate heat exchanger sizing' : (savedQ.data?.title || 'Plate heat exchanger sizing')}
        subtitle="Gasketed plate heat exchanger on PHEWORLD (FL-HTEP) plates: single pass, counter-current. Results update as you type; confirm the final selection with PHEWORLD."
        actions={<div className="flex flex-wrap gap-2">
          {!isNew && canEdit && <Button variant="ghost" onClick={remove}><Trash2 className="h-4 w-4" />Delete</Button>}
          <Button onClick={onPrint} disabled={!canPrint} title={canPrint ? 'Print or save as PDF' : 'Fix the inputs first'}><Printer className="h-4 w-4" />Print selection sheet</Button>
          {canEdit && <Button variant="primary" onClick={save} disabled={saving}><Save className="h-4 w-4" />{saving ? 'Saving…' : 'Save'}</Button>}
        </div>}
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
          <form className={`${cardCls} flex flex-col`} autoComplete="off" onSubmit={e => e.preventDefault()}>
            <Section title="Selection sheet">
              <Field label="Title"><input className={inputCls} value={title} disabled={disabled} placeholder="e.g. HX-01 main exhibit heating" onChange={e => setTitle(e.target.value)} /></Field>
              <Field label="Project">
                <select className={inputCls} value={projectId} disabled={disabled} onChange={e => chooseProject(e.target.value)}>
                  <option value="">Not linked to a project</option>
                  {projectsQ.data?.map(p => <option key={p.id} value={p.id}>{p.project_code} · {p.project_name}</option>)}
                </select>
              </Field>
              <Field label="Client">
                {projectId
                  ? <input className={inputCls} value={opts ? (opts.client_name || 'No client on this project') : 'Loading…'} disabled readOnly title="From the project" />
                  : <select className={inputCls} value={clientId} disabled={disabled} onChange={e => chooseClient(e.target.value)}>
                    <option value="">No client</option>
                    {clientsQ.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>}
              </Field>
              {projectId && <>
                <Field label="Design book">
                  <select className={inputCls} value={bookId} disabled={disabled} onChange={e => setBookId(e.target.value)}>
                    <option value="">{opts && !opts.design_books.length ? 'No design book on this project' : 'Not linked to a design book'}</option>
                    {opts?.design_books.map(b => <option key={b.id} value={b.id}>{b.book_code} · {b.book_title}{b.status ? ` (${b.status})` : ''}</option>)}
                  </select>
                </Field>
                <Field label="LSS system this exchanger serves">
                  <select className={inputCls} value={systemId} disabled={disabled} onChange={e => chooseSystem(e.target.value)}>
                    <option value="">{opts && !opts.systems.length ? 'No systems on this project' : 'Not linked to a system'}</option>
                    {opts?.systems.map(x => <option key={x.id} value={x.id}>{x.system_code} · {x.system_name}</option>)}
                  </select>
                </Field>
              </>}
              <Field label="Item / tag"><input className={inputCls} value={sheet.tag || ''} disabled={disabled} placeholder={opts?.systems.find(x => x.id === systemId)?.next_tag || 'HX-01'} onChange={e => setSheetField('tag', e.target.value)} /></Field>
              <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
                <Field label="Doc. no."><input className={inputCls} value={sheet.doc_no || ''} disabled={disabled} placeholder="AAT-DS-" onChange={e => setSheetField('doc_no', e.target.value)} /></Field>
                <Field label="Rev"><input className={inputCls} value={sheet.rev || ''} disabled={disabled} onChange={e => setSheetField('rev', e.target.value)} /></Field>
              </div>
              <Field label={systemId ? 'Service (from the LSS system)' : 'Service'}><input className={inputCls} value={sheet.service || ''} disabled={disabled} placeholder="e.g. Main exhibit seawater heating" onChange={e => setSheetField('service', e.target.value)} /></Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Prepared"><input className={inputCls} value={sheet.prepared || ''} disabled={disabled} onChange={e => setSheetField('prepared', e.target.value)} /></Field>
                <Field label="Checked"><input className={inputCls} value={sheet.checked || ''} disabled={disabled} onChange={e => setSheetField('checked', e.target.value)} /></Field>
                <Field label="Approved"><input className={inputCls} value={sheet.approved || ''} disabled={disabled} onChange={e => setSheetField('approved', e.target.value)} /></Field>
              </div>
            </Section>

            <Section title="Duty">
              <Field label="Heat duty" unit="kW"><Num value={inputs.duty} min={0} disabled={disabled} onChange={v => set({ duty: v })} /></Field>
              <Field label="Primary source">
                <Seg<Source> label="Primary source" value={inputs.src} onChange={v => !disabled && setInputs(prev => applyPreset(prev, v))}
                  options={[['heatpump', 'Heat pump'], ['boiler', 'Boiler'], ['chiller', 'Chiller']]} />
              </Field>
              <p className="text-xs text-stone-500">Changing the source loads typical temperatures for both sides.</p>
            </Section>

            <Section title="Primary side" dot={dot(pRole)}>
              <Field label="Fluid">
                <Seg label="Primary fluid" value={inputs.pFl.kind as 'water' | 'pg' | 'eg'}
                  onChange={v => !disabled && set({ pRf: 0.01, pFl: v === 'water' ? { kind: 'water' } : { kind: v, c: inputs.pFl.c ?? 30 } })}
                  options={[['water', 'Water'], ['pg', 'Propylene glycol'], ['eg', 'Ethylene glycol']]} />
              </Field>
              {inputs.pFl.kind !== 'water' && <Field label="Glycol concentration (by mass)" unit="% wt">
                <Num value={inputs.pFl.c ?? 30} min={0} disabled={disabled} onChange={v => set({ pFl: { ...inputs.pFl, c: Math.max(0, Math.min(50, v || 0)) } })} />
              </Field>}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Inlet temperature" unit="°C"><Num value={resolved.pTin} disabled={disabled || inputs.pOutMode === 'both'} onChange={v => set({ pTin: v })} /></Field>
                <Field label="Outlet temperature" unit="°C"><Num value={resolved.pTout} disabled={disabled || inputs.pOutMode !== 'manual'} onChange={v => set({ pTout: v })} /></Field>
              </div>
              <Field label="Primary temperatures set by">
                <select className={inputCls} value={inputs.pOutMode} disabled={disabled}
                  onChange={e => setInputs(prev => ({ ...resolveInputs(prev), pOutMode: e.target.value as PheInputs['pOutMode'] }))}>
                  <option value="both">Approach and machine ΔT (sets inlet and outlet)</option>
                  <option value="approach">Approach (sets outlet only, inlet typed)</option>
                  <option value="manual">Typed values</option>
                </select>
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Approach" unit="K"><Num value={inputs.appK} min={0.5} disabled={disabled || inputs.pOutMode === 'manual'} onChange={v => set({ appK: v })} /></Field>
                <Field label="Measured to">
                  <select className={inputCls} value={inputs.appRef} disabled={disabled || inputs.pOutMode === 'manual'} onChange={e => set({ appRef: e.target.value as 'out' | 'in' })}>
                    <option value="out">Sec. outlet</option><option value="in">Sec. inlet</option>
                  </select>
                </Field>
                <Field label="Machine ΔT" unit="K"><Num value={inputs.pDT} min={1} disabled={disabled || inputs.pOutMode !== 'both'} onChange={v => set({ pDT: v })} /></Field>
              </div>
              <p className="text-xs text-stone-500">{approachHint(inputs)}</p>
              <FlowFields side="p" inputs={inputs} derived={derived?.P} disabled={disabled} set={set} />
              <Field label="Allowable pressure drop" unit="kPa"><Num value={inputs.pDp} min={1} disabled={disabled} onChange={v => set({ pDp: v })} /></Field>
            </Section>

            <Section title="Secondary side" dot={dot(sRole)}>
              <Field label="Water type">
                <Seg label="Secondary water type" value={inputs.sFl.kind as 'sea' | 'fresh'}
                  onChange={v => !disabled && set({ sRf: v === 'sea' ? 0.04 : 0.03, sFl: v === 'sea' ? { kind: 'sea', S: inputs.sFl.S ?? 35 } : { kind: 'fresh', S: inputs.sFl.S } })}
                  options={[['sea', 'Seawater'], ['fresh', 'Fresh water']]} />
              </Field>
              {inputs.sFl.kind === 'sea' && <Field label="Salinity" unit="g/kg">
                <Num value={inputs.sFl.S ?? 35} min={0} disabled={disabled} onChange={v => set({ sFl: { kind: 'sea', S: Math.max(0, Math.min(45, v || 0)) } })} />
              </Field>}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Inlet temperature" unit="°C"><Num value={inputs.sTin} disabled={disabled} onChange={v => set({ sTin: v })} /></Field>
                <Field label="Outlet temperature" unit="°C"><Num value={inputs.sTout} disabled={disabled} onChange={v => set({ sTout: v })} /></Field>
              </div>
              <FlowFields side="s" inputs={inputs} derived={derived?.S} disabled={disabled} set={set} />
              <Field label="Allowable pressure drop" unit="kPa"><Num value={inputs.sDp} min={1} disabled={disabled} onChange={v => set({ sDp: v })} /></Field>
            </Section>

            <Section title="Connections">
              <Field label="Connection size">
                <select className={inputCls} value={inputs.conn} disabled={disabled} onChange={e => set({ conn: e.target.value as PheInputs['conn'] })}>
                  <option value="pref50">Prefer DN50, go bigger only if needed</option>
                  <option value="any">Any size</option>
                  <option value="DN40">DN40 (1½") only</option>
                  <option value="DN50">DN50 only</option>
                  <option value="DN100">DN100 only</option>
                  <option value="DN150">DN150 only</option>
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Allowable port loss" unit="kPa"><Num value={inputs.portDp} min={1} disabled={disabled} onChange={v => set({ portDp: Math.max(0.5, v || 10) })} /></Field>
                <Field label="Max units in parallel"><Num value={inputs.maxUnits} min={1} step="1" disabled={disabled} onChange={v => set({ maxUnits: Math.max(1, Math.round(v || 1)) })} /></Field>
              </div>
              <p className="text-xs text-stone-500">Port loss is the inlet plus outlet header loss on each side, part of that side's allowable pressure drop. It sets how much flow one connection can take; above that, the duty is split over identical units in parallel.</p>
            </Section>

            <Section title="Velocity and margin">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Target channel velocity" unit="m/s"><Num value={inputs.vTarget} min={0.05} disabled={disabled} onChange={v => set({ vTarget: v || 0.3 })} /></Field>
                <Field label="Area margin" unit="%"><Num value={inputs.margin} min={0} disabled={disabled} onChange={v => set({ margin: Math.max(0, v || 0) })} /></Field>
              </div>
              <p className="text-xs text-stone-500">The target is the minimum velocity you want between the plates on both sides. Below about 0.3 m/s, seawater and biofilm fouling build up faster. The upper limit is fixed at about {VCH_MAX} m/s, from PHEWORLD's rated flows.</p>
            </Section>

            <Section title="Plate and fouling settings">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Plate model">
                  <select className={inputCls} value={inputs.frame} disabled={disabled} onChange={e => set({ frame: e.target.value })}>
                    <option value="auto">Auto</option>
                    {FRAMES.map((f, i) => <option key={f.name} value={String(i)}>{f.name} · {fmt(f.Ap, 2)} m²</option>)}
                  </select>
                </Field>
                <Field label="Passes per side">
                  <select className={inputCls} value={inputs.passes} disabled={disabled} onChange={e => set({ passes: e.target.value })}>
                    {PASS_OPTIONS.map(k => <option key={k} value={k}>{k === '1/1' ? '1 / 1 (standard)' : k === 'auto' ? 'Auto, allow multi-pass' : `${k.split('/')[0]} pass primary / ${k.split('/')[1]} secondary`}</option>)}
                  </select>
                </Field>
                <Field label="Plate pattern">
                  <select className={inputCls} value={inputs.beta} disabled={disabled} onChange={e => set({ beta: e.target.value })}>
                    <option value="45">Mixed (matches PHEWORLD data)</option><option value="30">Hard, high-theta</option><option value="60">Soft, low-theta</option><option value="auto">Auto, fewest plates</option>
                  </select>
                </Field>
                <Field label="Plate material">
                  <select className={inputCls} value={inputs.mat} disabled={disabled} onChange={e => set({ mat: e.target.value as PheInputs['mat'] })}>
                    <option value="auto">Auto</option><option value="ti">Titanium Gr 1</option><option value="ss316">SS 316L</option><option value="smo">254 SMO</option>
                  </select>
                </Field>
                <Field label="Plate thickness" unit="mm"><Num value={inputs.thk} min={0.3} disabled={disabled} onChange={v => set({ thk: v || 0.5 })} /></Field>
                <div />
                <Field label="Fouling, primary" unit="m²K/kW"><Num value={inputs.pRf} min={0} disabled={disabled} onChange={v => set({ pRf: v || 0 })} /></Field>
                <Field label="Fouling, secondary" unit="m²K/kW"><Num value={inputs.sRf} min={0} disabled={disabled} onChange={v => set({ sRf: v || 0 })} /></Field>
              </div>
              <p className="text-xs text-stone-500">Fouling defaults fill in when you change a fluid. Plate models are PHEWORLD (FL-HTEP) titanium plates, with channel geometry back-calculated from their data sheets.</p>
            </Section>
          </form>

          <main className="flex min-w-0 flex-col gap-4" aria-live="polite">
            {r ? <Results r={r} set={disabled ? undefined : set} /> : (
              <section className={`${cardCls} border-l-4 border-l-red-500 p-4`}>
                <h2 className="text-base font-semibold text-stone-900">Cannot size with these inputs</h2>
                <p className="mt-1 text-sm text-stone-700">{(result as { fatal: string }).fatal}</p>
              </section>
            )}
          </main>
        </div>
      </div>
      {r?.R && sheetModel && <PlateHeatExchangerSheet r={r} model={sheetModel} />}
      {askStore && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <ModalDialog onClose={() => setAskStore(false)} labelledBy="phe-store-title" className="w-full max-w-md rounded-xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
            <h2 id="phe-store-title" className="text-base font-semibold text-stone-900">Store in project documents?</h2>
            <button aria-label="Close" onClick={() => setAskStore(false)} className="text-stone-400 hover:text-stone-600"><X className="h-5 w-5" /></button>
          </div>
          <div className="space-y-2 px-5 py-4 text-sm text-stone-700">
            <p>Also save this selection sheet as a PDF in the documents of <b>{project ? `${project.project_code} ${project.project_name}` : 'the project'}</b>?</p>
            <p className="text-xs text-stone-500">
              It is filed as document <b>{sheet.doc_no?.trim() || `${project?.project_code ?? ''}-PHE-${sheet.tag?.trim() || 'HX'}`}</b>, revision <b>{sheet.rev?.trim() || 'A'}</b> (Data Sheet, Design), linked to the project. The sizing is saved first.
            </p>
          </div>
          <div className="flex justify-end gap-2 border-t border-stone-200 px-5 py-3">
            <Button onClick={() => { setAskStore(false); printNow(); }}><Printer className="h-4 w-4" />Print only</Button>
            <Button variant="primary" onClick={storeAndPrint} disabled={storing}><FileText className="h-4 w-4" />{storing ? 'Storing…' : 'Store and print'}</Button>
          </div>
        </ModalDialog>
      </div>)}
    </div>
  );
}

function FlowFields({ side, inputs, derived, disabled, set }: { side: 'p' | 's'; inputs: PheInputs; derived?: Side; disabled: boolean; set: (p: Partial<PheInputs>) => void }) {
  const mode = side === 'p' ? inputs.pFlowMode : inputs.sFlowMode;
  const value = side === 'p' ? inputs.pFlow : inputs.sFlow;
  const derivedFlow = derived ? Math.round(derived.V * 3600 * 10) / 10 : value;
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Flow">
        <select className={inputCls} value={mode} disabled={disabled} onChange={e => {
          const m = e.target.value as 'auto' | 'fixed';
          set(side === 'p' ? { pFlowMode: m, ...(m === 'fixed' ? { pFlow: derivedFlow } : {}) } : { sFlowMode: m, ...(m === 'fixed' ? { sFlow: derivedFlow } : {}) });
        }}>
          <option value="auto">From duty and ΔT</option><option value="fixed">Fixed flow</option>
        </select>
      </Field>
      <Field label="Fixed flow" unit="m³/h">
        <Num value={mode === 'fixed' ? value : derivedFlow} min={0} disabled={disabled || mode !== 'fixed'} onChange={v => set(side === 'p' ? { pFlow: v } : { sFlow: v })} />
      </Field>
    </div>
  );
}

function Tile({ k, v, unit, n }: { k: string; v: ReactNode; unit?: string; n?: ReactNode }) {
  return (
    <div className="min-w-0 bg-white px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wider text-stone-500">{k}</div>
      <div className="text-xl font-medium tabular-nums text-stone-900">{v}{unit && <small className="ml-1 text-xs font-normal text-stone-500">{unit}</small>}</div>
      {n && <div className="text-xs text-stone-500">{n}</div>}
    </div>
  );
}

function Card({ title, children, hint }: { title: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <section className={`${cardCls} min-w-0 p-4`}>
      <h3 className="mb-2 text-sm font-semibold text-stone-900">{title}</h3>
      {hint && <p className="mb-2 text-xs text-stone-500">{hint}</p>}
      {children}
    </section>
  );
}

function Results({ r, set }: { r: PheResult; set?: (p: Partial<PheInputs>) => void }) {
  const { P, S, H, R, FR, I } = r, nu = FR.nu;
  const status = statusOf(r);
  const [chipText, chipCls] = STATUS_CHIP[status];
  const mode = H === P ? (I.src === 'chiller' ? 'Primary rejects heat' : 'Heating the secondary') : 'Cooling the secondary';
  const sideCls = (sd: Side) => (sd.role === 'hot' ? 'text-[#c4512b]' : 'text-[#2370b3]');
  const low = (v: number) => (v < I.vTarget * 0.95 ? 'font-medium text-amber-700' : '');
  const over = (cond: boolean) => (cond ? 'font-medium text-red-700' : '');
  const order = { bad: 0, warn: 1, info: 2, ok: 3 };
  const notes = r.notes.slice().sort((a, b) => order[a.lvl] - order[b.lvl]);
  const twoCol = (rows: [string, ReactNode, ReactNode, string?, string?][]) => (
    <div className="overflow-x-auto"><table className={tableCls}>
      <thead><tr><th className="text-left"></th><th className={`text-right ${sideCls(P)}`}>Primary</th><th className={`text-right ${sideCls(S)}`}>Secondary</th></tr></thead>
      <tbody>{rows.map(([l, a, b, ca, cb]) => <tr key={l}><td className="text-stone-500">{l}</td><td className={`text-right tabular-nums ${ca || ''}`}>{a}</td><td className={`text-right tabular-nums ${cb || ''}`}>{b}</td></tr>)}</tbody>
    </table></div>
  );

  const okOpts = FR.opts.filter(o => !o.fail).sort((a, b) => a.plates! - b.plates! || (a.pp + a.ps) - (b.pp + b.ps));
  const shown = okOpts.slice(0, 8);
  const one = okOpts.find(x => x.key === '1/1'); if (one && !shown.includes(one)) shown.push(one);
  if (R && !shown.includes(R)) shown.push(R);
  const nFail = FR.opts.filter(o => o.fail).length;
  const clickRow = (fn?: () => void) => (fn ? { onClick: fn, onKeyDown: (e: any) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } }, tabIndex: 0, className: 'cursor-pointer hover:bg-stone-50' } : {});

  return (<>
    <section className={`${cardCls} p-4`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-stone-900">Selection</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${chipCls}`}>{chipText}</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-px overflow-hidden rounded-lg border border-stone-200 bg-stone-200">
        <Tile k="Duty" v={fmt(r.Q / 1000, 0)} unit="kW" n={mode} />
        <Tile k="LMTD" v={fmt(r.lmtd, 2)} unit="K" n="Counterflow" />
        {R && <>
          <Tile k="U, in service" v={fmt(R.Us!, 0)} unit="W/m²K" n={`Clean ${fmt(R.Uc!, 0)}`} />
          <Tile k={`Area required${nu > 1 ? ', total' : ''}`} v={fmt(R.Areq! * nu, 1)} unit="m²" n={`+${fmt(I.margin, 0)} % margin = ${fmt(R.Adesign! * nu, 1)}`} />
          <Tile k={`Area installed${nu > 1 ? ', total' : ''}`} v={fmt(nu * R.plates! * FR.fr.Ap, 1)} unit="m²" n={`As PHEWORLD counts it; ${fmt(nu * R.Aact!, 1)} active, ${fmt(R.over! * 100, 0)} % over`} />
          <Tile k={nu > 1 ? 'Units × plates' : 'Plates'} v={`${nu > 1 ? `${nu} × ` : ''}${R.plates}`} n={`${modelName(r)}, ${FR.fr.conn}, ${R.pp}/${R.ps} pass`} />
        </>}
      </div>
    </section>

    <Card title="Temperature profile along the pack"><ProfileChart r={r} /></Card>

    <Card title="Checks">
      <ul className="flex flex-col gap-1.5">
        {notes.map((n, i) => <li key={i} className={`rounded border-l-[3px] px-3 py-2 text-sm text-stone-800 ${NOTE_CLS[n.lvl]}`}>
          {n.title && <b className="font-semibold">{n.title} </b>}{n.text}
        </li>)}
      </ul>
    </Card>

    <div className="grid gap-4 2xl:grid-cols-2">
      <Card title="Flows and fluid properties">{twoCol([
        ['Fluid', fluidName(P.fl), fluidName(S.fl)],
        ['Role', P.role === 'hot' ? 'Gives heat' : 'Takes heat', S.role === 'hot' ? 'Gives heat' : 'Takes heat'],
        ['Inlet → outlet, °C', `${fmt(P.Tin, 1)} → ${fmt(P.Tout, 1)}`, `${fmt(S.Tin, 1)} → ${fmt(S.Tout, 1)}`],
        ['ΔT, K', fmt(P.dT, 2), fmt(S.dT, 2)],
        ['Mass flow, kg/s', fmt(P.m, 2), fmt(S.m, 2)],
        ['Volume flow, m³/h', fmt(P.V * 3600, 2), fmt(S.V * 3600, 2)],
        ['Volume flow, L/s', fmt(P.V * 1000, 2), fmt(S.V * 1000, 2)],
        ['Flow basis', P.mode === 'fixed' ? 'Fixed by you' : 'From duty', S.mode === 'fixed' ? 'Fixed by you' : 'From duty'],
        ['Heat carried, kW', fmt(P.Qside / 1000, 1), fmt(S.Qside / 1000, 1)],
        ['Thermal length θ (ΔT/LMTD)', fmt(P.theta, 2), fmt(S.theta, 2)],
        ['Properties at mean, °C', fmt(P.Tm, 1), fmt(S.Tm, 1)],
        ['Density, kg/m³', fmt(P.pr.rho, 1), fmt(S.pr.rho, 1)],
        ['Specific heat, kJ/kg·K', fmt(P.pr.cp / 1000, 3), fmt(S.pr.cp / 1000, 3)],
        ['Conductivity, W/m·K', fmt(P.pr.k, 3), fmt(S.pr.k, 3)],
        ['Viscosity, mPa·s', fmt(P.pr.mu * 1000, 3), fmt(S.pr.mu * 1000, 3)],
        ['Freezing point, °C', fmt(P.pr.frz, 1), fmt(S.pr.frz, 1)],
      ])}</Card>
      <Card title={`Hydraulics${nu > 1 ? `, per unit (${nu} in parallel)` : ''}`}>{R ? twoCol([
        ['Passes', R.pp, R.ps],
        ['Channels per pass', R.np, R.ns],
        ['Channel velocity, m/s', fmt(R.hp!.v, 2), fmt(R.hs!.v, 2), low(R.hp!.v), low(R.hs!.v)],
        ['Target velocity, m/s', fmt(I.vTarget, 2), fmt(I.vTarget, 2)],
        ['Reynolds number', fmt(R.hp!.Re, 0), fmt(R.hs!.Re, 0)],
        ['Prandtl number', fmt(R.hp!.Pr, 2), fmt(R.hs!.Pr, 2)],
        ['Film coefficient, W/m²K', fmt(R.hp!.h, 0), fmt(R.hs!.h, 0)],
        ['Fouling, m²K/kW', fmt(P.Rf * 1000, 3), fmt(S.Rf * 1000, 3)],
        ['ΔP channels, kPa', kPa(R.hp!.dPc), kPa(R.hs!.dPc)],
        ['ΔP ports, kPa', kPa(R.hp!.dPp), kPa(R.hs!.dPp), over(R.hp!.dPp > I.portDp * 1000 * 1.001), over(R.hs!.dPp > I.portDp * 1000 * 1.001)],
        ['Allowable port loss, kPa', fmt(I.portDp, 0), fmt(I.portDp, 0)],
        ['ΔP total, kPa', kPa(R.hp!.dP), kPa(R.hs!.dP), over(R.hp!.dP > P.dPmax), over(R.hs!.dP > S.dPmax)],
        ['ΔP allowable, kPa', fmt(I.pDp, 0), fmt(I.sDp, 0)],
        ['Port velocity, m/s', fmt(FR.vpP, 2), fmt(FR.vpS, 2)],
        ['Connection', FR.fr.conn, FR.fr.conn],
        ['Flow per unit, m³/h', fmt(P.V * 3600 / nu, 2), fmt(S.V * 3600 / nu, 2)],
        ['Rated max flow, m³/h', fmt(FR.fr.maxFlow, 1), fmt(FR.fr.maxFlow, 1), over(P.V * 3600 / nu > FR.fr.maxFlow), over(S.V * 3600 / nu > FR.fr.maxFlow)],
      ]) : <p className="text-xs text-stone-500">No valid arrangement.</p>}</Card>
    </div>

    <Card title="Connection sizes at full flow" hint={`Port velocity and inlet-plus-outlet header loss (1.4 velocity heads) if all the flow went through one unit, against your ${fmt(I.portDp, 0)} kPa port allowance. Port size does not change the velocity between the plates; it changes header loss and how evenly the plates are fed.`}>
      <div className="overflow-x-auto"><table className={tableCls}>
        <thead><tr><th className="text-left">Connection</th><th className="text-right">v pri m/s</th><th className="text-right">Port ΔP pri</th><th className="text-right">v sec m/s</th><th className="text-right">Port ΔP sec</th><th className="text-right">Max m³/h per unit</th><th className="text-right">Units needed</th></tr></thead>
        <tbody>{connectionRows(r).map(c => <tr key={c.dn} className={c.current ? 'bg-blue-50' : ''}>
          <td>{c.label}{c.current ? ' ✓' : ''}</td><td className="text-right tabular-nums">{fmt(c.vP, 2)}</td><td className={`text-right tabular-nums ${over(c.dpP > I.portDp * 1000)}`}>{kPa(c.dpP)}</td>
          <td className="text-right tabular-nums">{fmt(c.vS, 2)}</td><td className={`text-right tabular-nums ${over(c.dpS > I.portDp * 1000)}`}>{kPa(c.dpS)}</td>
          <td className="text-right tabular-nums">{fmt(c.maxPerUnit, 1)}</td><td className="text-right tabular-nums">{c.unitsNeeded}</td>
        </tr>)}</tbody>
      </table></div>
    </Card>

    <Card title={`PHEWORLD plates compared, ${I.passes === 'auto' ? 'best pass arrangement' : 'single pass'}`}
      hint={`Every plate size sized for this duty. Area is plates × area per plate, the way PHEWORLD quotes it (the "-1.0-X" in the model name is design pressure 1.0 MPa and X m²).${set ? ' Select a row to use that plate.' : ''}`}>
      <div className="overflow-x-auto"><table className={tableCls}>
        <thead><tr><th className="text-left">Plate</th><th className="text-left">Conn.</th><th className="text-right">Units</th><th className="text-right">Plates each</th><th className="text-right">Total m²</th><th className="text-right">Over</th><th className="text-right">v pri</th><th className="text-right">v sec</th><th className="text-right">ΔP pri / sec kPa</th><th className="text-left">Status</th></tr></thead>
        <tbody>{r.ALL.map(x => {
          const o = x.rec, sel = x === FR;
          if (!o) return <tr key={x.fr.name}><td>{x.fr.name}</td><td>{x.fr.conn}</td><td className="text-right">{x.nu}</td><td colSpan={7} className="text-stone-500">No arrangement within ΔP and velocity limits</td></tr>;
          const st = !x.flowOK ? <span className="font-medium text-red-700">Needs {x.nu} units</span> : o.plates! > x.fr.max ? <span className="font-medium text-red-700">Too many plates</span> : !velocityMeetsTarget(o, I) ? <span className="font-medium text-amber-700">Low velocity</span> : 'OK';
          const row = clickRow(set ? () => set({ frame: String(x.fi) }) : undefined);
          return <tr key={x.fr.name} {...row} className={`${row.className || ''} ${sel ? 'bg-blue-50' : ''}`} title={set ? `Use ${x.fr.name}` : undefined}>
            <td>{x.fr.name}{sel ? ' ✓' : ''}</td><td>{x.fr.conn}</td><td className="text-right tabular-nums">{x.nu}</td><td className="text-right tabular-nums">{o.plates}</td>
            <td className="text-right tabular-nums">{fmt(x.nu * o.plates! * x.fr.Ap, 1)}</td><td className="text-right tabular-nums">{fmt(o.over! * 100, 0)} %</td>
            <td className={`text-right tabular-nums ${low(o.hp!.v)}`}>{fmt(o.hp!.v, 2)}</td><td className={`text-right tabular-nums ${low(o.hs!.v)}`}>{fmt(o.hs!.v, 2)}</td>
            <td className="text-right tabular-nums">{kPa(o.hp!.dP)} / {kPa(o.hs!.dP)}</td><td>{st}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <p className="mt-2 text-xs text-stone-500">{FR.fr.name}: {fmt(FR.fr.Ap, 2)} m² per plate, {FR.fr.conn} connections, rated to {fmt(FR.fr.maxFlow, 1)} m³/h. Channel {fmt(FR.fr.w * 1000, 0)} mm wide × {fmt(FR.fr.b * 1000, 1)} mm gap, about {fmt(FR.fr.L * 1000, 0)} mm port to port ({FR.fr.src === 'sheet' ? 'back-calculated from AAT data sheets' : 'estimated from the frame drawing; no data sheet yet'}).</p>
    </Card>

    {I.passes === 'auto' && <Card title={`Pass arrangements, ${FR.fr.name}`} hint={`Arrangements with the fewest plates.${set ? ' Select a row to use it.' : ''}`}>
      <div className="overflow-x-auto"><table className={tableCls}>
        <thead><tr><th className="text-left">Passes pri / sec</th><th className="text-right">Plates</th><th className="text-right">Area m²</th><th className="text-right">Over</th><th className="text-right">v pri</th><th className="text-right">v sec</th><th className="text-right">ΔP pri</th><th className="text-right">ΔP sec</th><th className="text-left">Governed by</th></tr></thead>
        <tbody>{shown.map(o => {
          const sel = R === o, row = clickRow(set ? () => set({ passes: o.key }) : undefined);
          return <tr key={o.key} {...row} className={`${row.className || ''} ${sel ? 'bg-blue-50' : ''}`}>
            <td>{o.pp} / {o.ps}{sel ? ' ✓' : ''}</td><td className="text-right tabular-nums">{o.plates}</td><td className="text-right tabular-nums">{fmt(o.Aact!, 1)}</td><td className="text-right tabular-nums">{fmt(o.over! * 100, 0)} %</td>
            <td className={`text-right tabular-nums ${low(o.hp!.v)}`}>{fmt(o.hp!.v, 2)}</td><td className={`text-right tabular-nums ${low(o.hs!.v)}`}>{fmt(o.hs!.v, 2)}</td>
            <td className="text-right tabular-nums">{kPa(o.hp!.dP)}</td><td className="text-right tabular-nums">{kPa(o.hs!.dP)}</td><td>{o.gov}</td>
          </tr>;
        })}</tbody>
      </table></div>
      {nFail > 0 && <p className="mt-2 text-xs text-stone-500">{nFail} of 16 pass combinations cannot meet the pressure drop limits and are not shown.</p>}
    </Card>}

    <Card title="Materials">
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        {materialGuidance(r).map(([k, v]) => <div key={k} className="contents">
          <dt className="pt-0.5 text-xs uppercase tracking-wide text-stone-500">{k}</dt><dd className={k === 'Warning' ? 'font-medium text-red-700' : 'text-stone-800'}>{v}</dd>
        </div>)}
      </dl>
    </Card>

    <Card title="Method and assumptions">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-stone-600">
        <li><b className="font-medium text-stone-900">Gasketed plate unit, counterflow.</b> LMTD with no correction for 1/1 pass. Approximate correction factors: equal multi-pass F = {r.cross ? '0.90' : '0.95'}, unequal passes F = {r.cross ? '0.85' : '0.93'}{r.cross ? ' (reduced for the temperature cross)' : ''}.</li>
        <li><b className="font-medium text-stone-900">Properties at the mean temperature of each side.</b> Water and seawater from Sharqawy, Lienhard and Zubair (2010). Glycol from tabulated ASHRAE-style data, accurate to roughly ±10–15 %.</li>
        <li><b className="font-medium text-stone-900">Film coefficients and channel friction</b> from the Kumar chevron-plate correlation (Kakaç and Liu), viscosity correction at an assumed wall temperature of {fmt(r.Tw, 1)} °C. Port loss is 1.4 velocity heads per pass.</li>
        <li><b className="font-medium text-stone-900">PHEWORLD plate geometry:</b> channel size for BR006K, BR007M and BR015M back-calculated from AAT's data sheets; BR03M and BR06MB are scaled from the frame drawing. {R ? BETA_NAME[R.beta] : ''}{I.beta === '45' ? ', which reproduces the vendor U of the BR006K 30 kW sheet within 1 %' : ''}. {fmt(I.thk, 1)} mm {r.mat.name}. Expect ±20 % against the vendor's own software.</li>
        <li><b className="font-medium text-stone-900">Plate count:</b> common port headers feeding all channels in parallel. Total plates = 2 × channels per side + 1. The two end plates are not counted as heat transfer area, so this is slightly more conservative than PHEWORLD, who count every plate.</li>
        <li><b className="font-medium text-stone-900">Area sizing:</b> required area uses the in-service U (with fouling), then adds the {fmt(I.margin, 0)} % margin. Plates are added further if needed to meet the allowable pressure drop and channel velocity limit.</li>
        <li><b className="font-medium text-stone-900">Not included:</b> nozzle and pipework losses, frame pressure rating, asymmetric (wide/narrow) channels and mixed-plate packs.</li>
      </ol>
    </Card>
  </>);
}
