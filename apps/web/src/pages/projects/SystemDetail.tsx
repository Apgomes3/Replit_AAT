import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import MetadataPanel from '../../components/ui/MetadataPanel';
import LifecycleHistory from '../../components/ui/LifecycleHistory';
import Button from '../../components/ui/Button';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import toast from 'react-hot-toast';
import { Network, Pencil, Plus, Trash2, Check, X, Search, Droplets, Container, Zap, FlaskConical } from 'lucide-react';
import { useRecordTitle } from '../../hooks/usePageTitle';

const UNITS = ['EA', 'SET', 'M', 'M2', 'M3', 'KG', 'L', 'LOT'];
const STATUSES = ['Design', 'Procurement', 'Installed', 'Commissioned', 'Active', 'Decommissioned'];
const NEW_ROW_ID = '__new__';

const FLOW_UNITS = [
  { value: 'm3h', label: 'm³/h' },
  { value: 'ls',  label: 'L/s'  },
  { value: 'gpm', label: 'GPM'  },
] as const;
type FlowUnit = typeof FLOW_UNITS[number]['value'];

function toFlowUnit(m3h: number, unit: FlowUnit): string {
  if (unit === 'ls')  return (m3h / 3.6).toFixed(3);
  if (unit === 'gpm') return (m3h * 4.40287).toFixed(2);
  return String(m3h);
}
function fromFlowUnit(val: number, unit: FlowUnit): number {
  if (unit === 'ls')  return +(val * 3.6).toFixed(6);
  if (unit === 'gpm') return +(val / 4.40287).toFixed(6);
  return val;
}

export default function SystemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showTransition, setShowTransition] = useState(false);
  const [newState, setNewState] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [flowUnit, setFlowUnit] = useState<FlowUnit>('m3h');

  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineForm, setInlineForm] = useState<any>(null);
  const [inlineProductSearch, setInlineProductSearch] = useState('');
  const [inlineSelectedProduct, setInlineSelectedProduct] = useState<any>(null);
  const [inlineSaving, setInlineSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const { data: system, isLoading, refetch } = useQuery({
    queryKey: ['system', id],
    queryFn: () => api.get(`/systems/${id}`).then(r => r.data),
  });
  useRecordTitle(system?.system_name);

  const { data: history } = useQuery({
    queryKey: ['lifecycle', 'system', id],
    queryFn: () => api.get(`/lifecycle/system/${id}`).then(r => r.data),
  });

  const { data: systemTypesData } = useQuery({
    queryKey: ['system-types'],
    queryFn: () => api.get('/admin/system-types').then(r => r.data),
  });
  const systemTypeOptions: string[] = (systemTypesData?.items || []).map((t: any) => t.name);

  const { data: productSearchResults } = useQuery({
    queryKey: ['product-search-inline', inlineProductSearch],
    queryFn: () => api.get(`/product-masters?q=${inlineProductSearch}&page_size=8`).then(r => r.data),
    enabled: inlineProductSearch.length >= 2 && !inlineSelectedProduct,
  });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (deleteConfirmId && !(e.target as Element).closest('[data-delete-row]')) {
        setDeleteConfirmId(null);
      }
    };
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [deleteConfirmId]);

  if (isLoading) return <div className="p-8 text-slate-400">Loading...</div>;
  if (!system) return <div className="p-8 text-slate-400">System not found</div>;

  const equipment: any[] = system.equipment || [];

  const startEdit = () => {
    setForm({
      system_name: system.system_name || '',
      system_type: system.system_type || '',
      water_type: system.water_type || '',
      design_flow_m3h: system.design_flow_m3h ?? '',
      turnover_rate_hr: system.turnover_rate_hr ?? '',
      status: system.status || 'Draft',
      duty_description: system.duty_description || '',
      redundancy_strategy: system.redundancy_strategy || '',
    });
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/systems/${system.id}`, form);
      toast.success('System saved');
      refetch();
      qc.invalidateQueries({ queryKey: ['project-systems'] });
      setEditing(false);
    } catch { toast.error('Save failed'); }
    finally { setSaving(false); }
  };

  const startInlineEdit = (eq: any) => {
    if (inlineEditId === eq.id) return;
    setInlineEditId(eq.id);
    setInlineForm({
      equip_code: eq.equip_code || '',
      quantity: eq.quantity ?? 1,
      unit: eq.unit || 'EA',
      status: eq.status || 'Design',
    });
    setInlineSelectedProduct(eq.product_master_id ? { id: eq.product_master_id, product_code: eq.product_code, product_name: eq.product_name } : null);
    setInlineProductSearch('');
  };

  const startNewRow = () => {
    setInlineEditId(NEW_ROW_ID);
    setInlineForm({ equip_code: '', quantity: 1, unit: 'EA', status: 'Design' });
    setInlineSelectedProduct(null);
    setInlineProductSearch('');
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const cancelInline = () => {
    setInlineEditId(null);
    setInlineForm(null);
    setInlineSelectedProduct(null);
    setInlineProductSearch('');
  };

  const saveInlineRow = async () => {
    if (!inlineForm.equip_code.trim()) { toast.error('Tag / equipment code is required'); return; }
    setInlineSaving(true);
    try {
      const payload = {
        equip_code: inlineForm.equip_code.trim().toUpperCase(),
        project_id: system.project_id,
        system_id: system.id,
        product_master_id: inlineSelectedProduct?.id || null,
        description: !inlineSelectedProduct ? (inlineProductSearch || null) : null,
        quantity: parseFloat(inlineForm.quantity) || 1,
        unit: inlineForm.unit,
        status: inlineForm.status,
      };
      if (inlineEditId === NEW_ROW_ID) {
        await api.post('/equipment-items', payload);
        toast.success('Row added');
      } else {
        await api.put(`/equipment-items/${inlineEditId}`, payload);
        toast.success('Saved');
      }
      refetch();
      cancelInline();
    } catch { toast.error('Save failed'); }
    finally { setInlineSaving(false); }
  };

  const handleDeleteRow = async (eqId: string) => {
    try {
      await api.delete(`/equipment-items/${eqId}`);
      toast.success('Row removed');
      refetch();
      setDeleteConfirmId(null);
    } catch { toast.error('Delete failed'); }
  };

  const transitions = ['Draft', 'Internal Review', 'Approved', 'Released', 'Superseded', 'Obsolete'];

  const inputCls = 'w-full border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-600 bg-white';
  const cellCls = 'px-3 py-2.5';

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        code={system.system_code} title={system.system_name} status={system.status}
        subtitle={`${system.system_type || ''} ${system.water_type ? '· ' + system.water_type : ''}`}
        crumbs={[
          { label: 'Projects', href: '/projects' },
          { label: system.project_code, href: `/projects/${system.project_id}` },
          { label: system.system_code },
        ]}
        actions={
          <div className="flex gap-2">
            <Button size="sm" onClick={() => navigate(`/graph?start=${system.id}&type=system`)}>
              <Network className="w-3.5 h-3.5" />Graph
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setShowTransition(true)}>Transition State</Button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            {!editing ? (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">System Details</span>
                  <Button size="sm" variant="primary" onClick={startEdit}>
                    <Pencil className="w-3.5 h-3.5" />Edit
                  </Button>
                </div>
                <MetadataPanel fields={[
                  { label: 'System Type', value: system.system_type },
                  { label: 'Water Type', value: system.water_type },
                  { label: 'Design Flow', value: system.design_flow_m3h ? (
                    <span>
                      <span className="font-semibold">{system.design_flow_m3h} m³/h</span>
                      <span className="text-slate-400 text-xs ml-2">
                        {(system.design_flow_m3h / 3.6).toFixed(2)} L/s · {(system.design_flow_m3h * 4.40287).toFixed(1)} GPM
                      </span>
                    </span>
                  ) : null },
                  { label: 'Turnover Rate', value: system.turnover_rate_hr ? `${system.turnover_rate_hr} /hr` : null },
                  { label: 'Area', value: system.area_name },
                  { label: 'Exhibit', value: system.exhibit_name },
                  { label: 'Duty', value: system.duty_description },
                  { label: 'Redundancy', value: system.redundancy_strategy },
                ]} />
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Edit System Details</span>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => setEditing(false)}>Cancel</Button>
                    <Button size="sm" variant="primary" onClick={handleSave} disabled={saving}>
                      {saving ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </div>
                </div>
                <div className="p-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">System Name</label>
                    <input value={form.system_name} onChange={e => setForm((f: any) => ({ ...f, system_name: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">System Type</label>
                    <select value={form.system_type} onChange={e => setForm((f: any) => ({ ...f, system_type: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30">
                      <option value="">— select —</option>
                      {systemTypeOptions.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Water Type</label>
                    <select value={form.water_type} onChange={e => setForm((f: any) => ({ ...f, water_type: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30">
                      <option value="">— select —</option>
                      {['Fresh Water', 'Salt Water', 'Brackish', 'N/A'].map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Design Flow</label>
                    <div className="flex gap-1">
                      <input
                        type="number"
                        value={form.design_flow_m3h !== '' ? toFlowUnit(parseFloat(form.design_flow_m3h) || 0, flowUnit) : ''}
                        onChange={e => {
                          const raw = parseFloat(e.target.value);
                          setForm((f: any) => ({ ...f, design_flow_m3h: isNaN(raw) ? '' : String(fromFlowUnit(raw, flowUnit)) }));
                        }}
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30"
                        placeholder="0"
                      />
                      <select
                        value={flowUnit}
                        onChange={e => setFlowUnit(e.target.value as FlowUnit)}
                        className="border border-slate-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30 bg-white text-slate-600 font-medium"
                      >
                        {FLOW_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                      </select>
                    </div>
                    {form.design_flow_m3h !== '' && flowUnit !== 'm3h' && (
                      <p className="text-[10px] text-slate-400 mt-0.5">= {parseFloat(form.design_flow_m3h).toFixed(3)} m³/h stored</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                    <select value={form.status} onChange={e => setForm((f: any) => ({ ...f, status: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30">
                      {transitions.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Redundancy Strategy</label>
                    <input value={form.redundancy_strategy} onChange={e => setForm((f: any) => ({ ...f, redundancy_strategy: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Duty Description</label>
                    <textarea value={form.duty_description} onChange={e => setForm((f: any) => ({ ...f, duty_description: e.target.value }))}
                      rows={3} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30" />
                  </div>
                </div>
                </div>
              </div>
            )}
          </div>
          <div className="space-y-3">
            <LifecycleHistory items={history?.items || []} />
          </div>
        </div>

        {/* Products inline grid */}
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Products</h3>
              <p className="text-xs text-slate-400 mt-0.5">Equipment items assigned to this system — click any row to edit</p>
            </div>
            <Button size="sm" variant="primary" onClick={startNewRow} disabled={inlineEditId === NEW_ROW_ID}>
              <Plus className="w-3.5 h-3.5" />Add Row
            </Button>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[130px]">Tag</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Product</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[110px]">Code</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[80px]">Qty</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[80px]">Unit</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[140px]">Status</th>
                <th className="w-[80px]" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {equipment.length === 0 && inlineEditId !== NEW_ROW_ID && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-400">
                    No products yet — click <strong>Add Row</strong> to assign equipment to this system.
                  </td>
                </tr>
              )}

              {equipment.map((eq: any) => {
                const isEditing = inlineEditId === eq.id;
                return (
                  <tr
                    key={eq.id}
                    className={`group ${isEditing ? 'bg-blue-50/40' : 'hover:bg-slate-50 cursor-pointer'}`}
                    onClick={() => { if (!isEditing) startInlineEdit(eq); }}
                  >
                    {isEditing ? (
                      <>
                        <td className={cellCls}>
                          <input
                            value={inlineForm.equip_code}
                            onChange={e => setInlineForm((f: any) => ({ ...f, equip_code: e.target.value.toUpperCase() }))}
                            className={inputCls + ' font-mono uppercase'}
                            placeholder="TAG-101"
                            onKeyDown={e => { if (e.key === 'Escape') cancelInline(); if (e.key === 'Enter') saveInlineRow(); }}
                          />
                        </td>
                        <td className={cellCls + ' relative'}>
                          {inlineSelectedProduct ? (
                            <div className="flex items-center gap-1.5 border border-blue-600 bg-blue-50 rounded px-2 py-1 text-sm">
                              <span className="flex-1 truncate font-medium text-slate-800">{inlineSelectedProduct.product_name}</span>
                              <button onClick={e => { e.stopPropagation(); setInlineSelectedProduct(null); setInlineProductSearch(''); }} className="text-slate-400 hover:text-red-500 flex-shrink-0">
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <div className="relative" onClick={e => e.stopPropagation()}>
                              <Search className="absolute left-2 top-1.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                              <input
                                ref={searchRef}
                                value={inlineProductSearch}
                                onChange={e => setInlineProductSearch(e.target.value)}
                                placeholder="Search or type description…"
                                className={inputCls + ' pl-7'}
                                onKeyDown={e => { if (e.key === 'Escape') cancelInline(); }}
                              />
                              {productSearchResults?.items?.length > 0 && (
                                <div className="absolute top-full left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-xl mt-0.5 z-20 max-h-52 overflow-auto">
                                  {productSearchResults.items.map((p: any) => (
                                    <button
                                      key={p.id}
                                      onMouseDown={e => e.preventDefault()}
                                      onClick={() => { setInlineSelectedProduct(p); setInlineProductSearch(''); }}
                                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-left border-b border-slate-50 last:border-0"
                                    >
                                      <EntityCode code={p.product_code} />
                                      <span className="text-sm text-slate-800 truncate">{p.product_name}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className={cellCls}>
                          {inlineSelectedProduct
                            ? <EntityCode code={inlineSelectedProduct.product_code} />
                            : <span className="text-slate-300 text-xs">—</span>}
                        </td>
                        <td className={cellCls}>
                          <input type="number" min="0.001" step="any"
                            value={inlineForm.quantity}
                            onChange={e => setInlineForm((f: any) => ({ ...f, quantity: e.target.value }))}
                            className={inputCls}
                          />
                        </td>
                        <td className={cellCls}>
                          <select value={inlineForm.unit} onChange={e => setInlineForm((f: any) => ({ ...f, unit: e.target.value }))} className={inputCls}>
                            {UNITS.map(u => <option key={u}>{u}</option>)}
                          </select>
                        </td>
                        <td className={cellCls}>
                          <select value={inlineForm.status} onChange={e => setInlineForm((f: any) => ({ ...f, status: e.target.value }))} className={inputCls}>
                            {STATUSES.map(s => <option key={s}>{s}</option>)}
                          </select>
                        </td>
                        <td className={cellCls} onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            <button onClick={saveInlineRow} disabled={inlineSaving} className="p-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={cancelInline} className="p-1.5 rounded text-slate-400 hover:bg-slate-100">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className={cellCls}><EntityCode code={eq.equip_code} /></td>
                        <td className={cellCls + ' font-medium text-slate-800'}>{eq.product_name || eq.description || <span className="text-slate-300">—</span>}</td>
                        <td className={cellCls}>
                          {eq.product_code ? <EntityCode code={eq.product_code} /> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className={cellCls + ' text-slate-600'}>{eq.quantity ?? 1}</td>
                        <td className={cellCls + ' text-slate-500'}>{eq.unit || 'EA'}</td>
                        <td className={cellCls}><StatusBadge status={eq.status || 'Design'} /></td>
                        <td className={cellCls} onClick={e => e.stopPropagation()}>
                          {deleteConfirmId === eq.id ? (
                            <div className="flex items-center gap-1" data-delete-row>
                              <button onClick={() => handleDeleteRow(eq.id)} className="px-2 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700">Delete</button>
                              <button onClick={() => setDeleteConfirmId(null)} className="px-2 py-1 text-xs rounded text-slate-500 hover:bg-slate-100">Cancel</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirmId(eq.id)}
                              className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-opacity"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}

              {/* New row being added */}
              {inlineEditId === NEW_ROW_ID && (
                <tr className="bg-blue-50/40 border-t-2 border-blue-600/20">
                  <td className={cellCls}>
                    <input
                      value={inlineForm.equip_code}
                      onChange={e => setInlineForm((f: any) => ({ ...f, equip_code: e.target.value.toUpperCase() }))}
                      className={inputCls + ' font-mono uppercase'}
                      placeholder="TAG-101"
                      onKeyDown={e => { if (e.key === 'Escape') cancelInline(); if (e.key === 'Enter') saveInlineRow(); }}
                    />
                  </td>
                  <td className={cellCls + ' relative'}>
                    {inlineSelectedProduct ? (
                      <div className="flex items-center gap-1.5 border border-blue-600 bg-blue-50 rounded px-2 py-1 text-sm">
                        <span className="flex-1 truncate font-medium text-slate-800">{inlineSelectedProduct.product_name}</span>
                        <button onClick={() => { setInlineSelectedProduct(null); setInlineProductSearch(''); }} className="text-slate-400 hover:text-red-500 flex-shrink-0">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="relative">
                        <Search className="absolute left-2 top-1.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                        <input
                          ref={searchRef}
                          value={inlineProductSearch}
                          onChange={e => setInlineProductSearch(e.target.value)}
                          placeholder="Search or type description…"
                          className={inputCls + ' pl-7'}
                          onKeyDown={e => { if (e.key === 'Escape') cancelInline(); }}
                        />
                        {productSearchResults?.items?.length > 0 && (
                          <div className="absolute top-full left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-xl mt-0.5 z-20 max-h-52 overflow-auto">
                            {productSearchResults.items.map((p: any) => (
                              <button
                                key={p.id}
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => { setInlineSelectedProduct(p); setInlineProductSearch(''); }}
                                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-left border-b border-slate-50 last:border-0"
                              >
                                <EntityCode code={p.product_code} />
                                <span className="text-sm text-slate-800 truncate">{p.product_name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className={cellCls}>
                    {inlineSelectedProduct
                      ? <EntityCode code={inlineSelectedProduct.product_code} />
                      : <span className="text-slate-300 text-xs">—</span>}
                  </td>
                  <td className={cellCls}>
                    <input type="number" min="0.001" step="any"
                      value={inlineForm.quantity}
                      onChange={e => setInlineForm((f: any) => ({ ...f, quantity: e.target.value }))}
                      className={inputCls}
                    />
                  </td>
                  <td className={cellCls}>
                    <select value={inlineForm.unit} onChange={e => setInlineForm((f: any) => ({ ...f, unit: e.target.value }))} className={inputCls}>
                      {UNITS.map(u => <option key={u}>{u}</option>)}
                    </select>
                  </td>
                  <td className={cellCls}>
                    <select value={inlineForm.status} onChange={e => setInlineForm((f: any) => ({ ...f, status: e.target.value }))} className={inputCls}>
                      {STATUSES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className={cellCls}>
                    <div className="flex items-center gap-1">
                      <button onClick={saveInlineRow} disabled={inlineSaving} className="p-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={cancelInline} className="p-1.5 rounded text-slate-400 hover:bg-slate-100">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Footer add row shortcut */}
          <div className="border-t border-slate-100 px-3 py-2">
            <button
              onClick={startNewRow}
              disabled={inlineEditId === NEW_ROW_ID}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-blue-600 disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />Add row
            </button>
          </div>
        </div>

        {/* Tanks section */}
        {(() => {
          const tanks: any[] = system.tanks ?? [];
          const totalGross = tanks.reduce((s: number, t: any) => s + (parseFloat(t.gross_volume_m3 ?? 0) * (parseInt(t.quantity ?? 1))), 0);
          const totalOp = tanks.reduce((s: number, t: any) => s + (parseFloat(t.operating_volume_m3 ?? 0) * (parseInt(t.quantity ?? 1))), 0);
          const totalQty = tanks.reduce((s: number, t: any) => s + parseInt(t.quantity ?? 1), 0);
          const calcTurnover = system.design_flow_m3h && totalOp > 0
            ? (parseFloat(system.design_flow_m3h) / totalOp).toFixed(2)
            : null;

          return (
            <>
              {/* Volume summary strip */}
              {tanks.length > 0 && (
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { icon: Container, label: 'Tanks', value: `${tanks.length} type${tanks.length !== 1 ? 's' : ''}`, sub: `${totalQty} unit${totalQty !== 1 ? 's' : ''}`, color: 'text-blue-600', bg: 'bg-blue-50' },
                    { icon: Droplets, label: 'Total Gross Volume', value: totalGross > 0 ? `${totalGross.toFixed(2)} m³` : '—', sub: 'sum of all tanks × qty', color: 'text-cyan-600', bg: 'bg-cyan-50' },
                    { icon: FlaskConical, label: 'Total Operating Volume', value: totalOp > 0 ? `${totalOp.toFixed(2)} m³` : '—', sub: 'sum of all tanks × qty', color: 'text-indigo-600', bg: 'bg-indigo-50' },
                  ].map(({ icon: Icon, label, value, sub, color, bg }) => (
                    <div key={label} className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center shrink-0 mt-0.5`}>
                        <Icon className={`w-4 h-4 ${color}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">{label}</div>
                        <div className="text-base font-bold text-slate-800 leading-tight">{value}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate">{sub}</div>
                      </div>
                    </div>
                  ))}
                  {/* Calc Turnover Rate — rendered separately for the Apply button */}
                  <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0 mt-0.5">
                      <Zap className="w-4 h-4 text-amber-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">Calc. Turnover Rate</div>
                      <div className="text-base font-bold text-slate-800 leading-tight">{calcTurnover ? `${calcTurnover} /hr` : '—'}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                        {system.design_flow_m3h ? `flow ${system.design_flow_m3h} m³/h ÷ op. vol.` : 'set design flow to calculate'}
                      </div>
                      {calcTurnover && (
                        <button
                          onClick={() => {
                            if (!editing) startEdit();
                            setForm((f: any) => ({ ...(f ?? {}), system_name: system.system_name || '', system_type: system.system_type || '', water_type: system.water_type || '', design_flow_m3h: system.design_flow_m3h ?? '', turnover_rate_hr: calcTurnover, status: system.status || 'Draft', duty_description: system.duty_description || '', redundancy_strategy: system.redundancy_strategy || '' }));
                            setEditing(true);
                          }}
                          className="mt-1 text-[10px] text-blue-600 hover:underline font-medium"
                        >
                          ← Apply to system
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Tanks table */}
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Tanks</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {tanks.length === 0
                        ? 'No tanks linked to this system yet — assign a system on the Tanks tab in the project.'
                        : `${tanks.length} tank type${tanks.length !== 1 ? 's' : ''} · ${totalQty} unit${totalQty !== 1 ? 's' : ''} total`}
                    </p>
                  </div>
                  <Link
                    to={`/projects/${system.project_id}?tab=tanks`}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                  >
                    Manage in Project →
                  </Link>
                </div>

                {tanks.length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-slate-400">
                    No tanks linked — go to the project and assign this system to a tank.
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/50">
                        <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[120px]">Code</th>
                        <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Tank</th>
                        <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[110px]">Product</th>
                        <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[60px]">Qty</th>
                        <th className="text-right px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[110px]">Gross Vol.</th>
                        <th className="text-right px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[110px]">Op. Vol.</th>
                        <th className="text-right px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[110px]">Total Op.</th>
                        <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[120px]">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {tanks.map((t: any) => {
                        const qty = parseInt(t.quantity ?? 1);
                        const opVol = parseFloat(t.operating_volume_m3 ?? 0);
                        const totalOpVol = opVol * qty;
                        return (
                          <tr key={t.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2.5"><EntityCode code={t.tank_code} /></td>
                            <td className="px-3 py-2.5">
                              <div className="font-medium text-slate-800">{t.tank_name}</div>
                              {t.tank_type && <div className="text-xs text-slate-400">{t.tank_type}{t.primary_material ? ` · ${t.primary_material}` : ''}</div>}
                            </td>
                            <td className="px-3 py-2.5">
                              {t.product_code
                                ? <EntityCode code={t.product_code} />
                                : <span className="text-slate-300 text-xs">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-slate-600 text-center">{qty}</td>
                            <td className="px-3 py-2.5 text-right text-slate-600 font-mono text-xs">
                              {t.gross_volume_m3 ? `${parseFloat(t.gross_volume_m3).toFixed(2)} m³` : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right text-slate-600 font-mono text-xs">
                              {t.operating_volume_m3 ? `${opVol.toFixed(2)} m³` : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right font-semibold text-slate-800 font-mono text-xs">
                              {totalOpVol > 0 ? `${totalOpVol.toFixed(2)} m³` : <span className="text-slate-300 font-normal">—</span>}
                            </td>
                            <td className="px-3 py-2.5"><StatusBadge status={t.status || 'Active'} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {tanks.length > 1 && (
                      <tfoot>
                        <tr className="border-t-2 border-slate-200 bg-slate-50/70">
                          <td colSpan={3} className="px-3 py-2 text-xs font-semibold text-slate-500">Totals</td>
                          <td className="px-3 py-2 text-center text-xs font-semibold text-slate-700">{totalQty}</td>
                          <td className="px-3 py-2 text-right text-xs font-semibold text-slate-700 font-mono">{totalGross > 0 ? `${totalGross.toFixed(2)} m³` : '—'}</td>
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2 text-right text-xs font-semibold text-slate-700 font-mono">{totalOp > 0 ? `${totalOp.toFixed(2)} m³` : '—'}</td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                )}
              </div>
            </>
          );
        })()}
      </div>

      {/* Transition State Modal */}
      {showTransition && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-80 p-5">
            <h3 className="font-semibold mb-3">Transition State</h3>
            <select value={newState} onChange={e => setNewState(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm mb-4 bg-white focus:outline-none focus:border-blue-600">
              <option value="">— select state —</option>
              {transitions.map(t => <option key={t}>{t}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setShowTransition(false)}>Cancel</Button>
              <Button variant="primary" disabled={!newState} onClick={async () => {
                await api.put(`/systems/${system.id}`, { ...system, status: newState });
                toast.success(`State → ${newState}`);
                refetch();
                setShowTransition(false);
              }}>Apply</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
