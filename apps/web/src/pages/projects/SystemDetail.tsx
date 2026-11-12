import { SUPPORTED_CURRENCIES } from '../../lib/currencies';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useParams, useNavigate, Link } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import MetadataPanel from '../../components/ui/MetadataPanel';
import ActivityLog from '../../components/ui/ActivityLog';
import Button from '../../components/ui/Button';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import toast from 'react-hot-toast';
import { Network, Pencil, Plus, Trash2, Check, X, Search, Droplets, Container, Zap, FlaskConical, ExternalLink, ShoppingCart, MousePointerClick } from 'lucide-react';
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
  const location = useLocation();
  const qc = useQueryClient();
  const [showTransition, setShowTransition] = useState(false);
  const [newState, setNewState] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [flowUnit, setFlowUnit] = useState<FlowUnit>('m3h');

  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineForm, setInlineForm] = useState<any>(null);
  const [inlineType, setInlineType] = useState<'product' | 'component'>('product');
  const [inlineProductSearch, setInlineProductSearch] = useState('');
  const [inlineSelectedProduct, setInlineSelectedProduct] = useState<any>(null);
  const [inlineComponentSearch, setInlineComponentSearch] = useState('');
  const [inlineSelectedComponent, setInlineSelectedComponent] = useState<any>(null);
  const [inlineSaving, setInlineSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedTankIds, setSelectedTankIds] = useState<Set<string>>(new Set());
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [showQuickPO, setShowQuickPO] = useState(false);
  const [quickPOCurrency, setQuickPOCurrency] = useState('USD');
  const [quickPONotes, setQuickPONotes] = useState('');
  const [quickPOSaving, setQuickPOSaving] = useState(false);

  const [showAssignTank, setShowAssignTank] = useState(false);
  const [assigningTankId, setAssigningTankId] = useState<string | null>(null);
  const [unassigningTankId, setUnassigningTankId] = useState<string | null>(null);
  const [assignSearch, setAssignSearch] = useState('');

  const { data: system, isLoading, refetch } = useQuery({
    queryKey: ['system', id],
    queryFn: () => api.get(`/systems/${id}`).then(r => r.data),
  });
  useRecordTitle(system?.system_name);
  useEffect(() => {
    const equipmentId = new URLSearchParams(location.search).get('equipment');
    if (!equipmentId || !system?.equipment?.some((item: any) => item.id === equipmentId)) return;
    requestAnimationFrame(() => document.getElementById(`equipment-${equipmentId}`)?.scrollIntoView({ block: 'center' }));
  }, [location.search, system?.equipment]);

  const openPurchaseOrder = (poId: string) => navigate(`/purchase-orders/${poId}`, {
    state: {
      from: 'system',
      returnTo: `${location.pathname}${location.search}`,
      returnLabel: system?.system_code || 'System',
      systemId: system?.id,
      systemName: system?.system_name,
      systemCode: system?.system_code,
      projectId: system?.project_id,
      projectCode: system?.project_code,
      projectName: system?.project_name,
    },
  });

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

  const { data: componentSearchResults } = useQuery({
    queryKey: ['component-search-inline', inlineComponentSearch],
    queryFn: () => api.get(`/components?search=${inlineComponentSearch}&page_size=8`).then(r => r.data),
    enabled: inlineComponentSearch.length >= 2 && !inlineSelectedComponent,
  });

  const { data: allProjectTanks, refetch: refetchAllTanks } = useQuery({
    queryKey: ['project-tanks-all', system?.project_id],
    queryFn: () => api.get(`/tanks?project_id=${system!.project_id}&page_size=500`).then(r => r.data),
    enabled: showAssignTank && !!system?.project_id,
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

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', onKey); };
  }, [ctxMenu]);

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
    const type = eq.component_id ? 'component' : 'product';
    setInlineType(type);
    setInlineSelectedProduct(eq.product_master_id ? { id: eq.product_master_id, product_code: eq.product_code, product_name: eq.product_name } : null);
    setInlineSelectedComponent(eq.component_id ? { id: eq.component_id, component_code: eq.component_code, component_name: eq.component_name } : null);
    setInlineProductSearch('');
    setInlineComponentSearch('');
  };

  const startNewRow = () => {
    setInlineEditId(NEW_ROW_ID);
    setInlineForm({ equip_code: '', quantity: 1, unit: 'EA', status: 'Design' });
    setInlineType('product');
    setInlineSelectedProduct(null);
    setInlineSelectedComponent(null);
    setInlineProductSearch('');
    setInlineComponentSearch('');
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const cancelInline = () => {
    setInlineEditId(null);
    setInlineForm(null);
    setInlineType('product');
    setInlineSelectedProduct(null);
    setInlineSelectedComponent(null);
    setInlineProductSearch('');
    setInlineComponentSearch('');
  };

  const saveInlineRow = async () => {
    if (!inlineForm.equip_code.trim()) { toast.error('Tag / equipment code is required'); return; }
    setInlineSaving(true);
    try {
      const payload = {
        equip_code: inlineForm.equip_code.trim().toUpperCase(),
        project_id: system.project_id,
        system_id: system.id,
        product_master_id: inlineType === 'product' ? (inlineSelectedProduct?.id || null) : null,
        component_id: inlineType === 'component' ? (inlineSelectedComponent?.id || null) : null,
        description: inlineType === 'product' && !inlineSelectedProduct ? (inlineProductSearch || null) : null,
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

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleTank = (id: string) => {
    setSelectedTankIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleContextMenu = (e: React.MouseEvent, item: any, type: 'equipment' | 'tank') => {
    e.preventDefault();
    e.stopPropagation();
    if (type === 'equipment') {
      if (item.product_master_id && !item.released_po_id && !selectedIds.has(item.id)) {
        setSelectedIds(prev => new Set([...prev, item.id]));
      }
    } else {
      if (!item.released_po_id && !selectedTankIds.has(item.id)) {
        setSelectedTankIds(prev => new Set([...prev, item.id]));
      }
    }
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const handleQuickPO = async () => {
    const allTanks: any[] = system.tanks ?? [];
    const eligibleEquip = equipment.filter((eq: any) => selectedIds.has(eq.id) && eq.product_master_id && !eq.released_po_id);
    const eligibleTanks = allTanks.filter((t: any) => selectedTankIds.has(t.id) && !t.released_po_id);
    const total = eligibleEquip.length + eligibleTanks.length;
    if (total === 0) { toast.error('No eligible items selected'); return; }
    setQuickPOSaving(true);
    try {
      const poRes = await api.post('/purchase-orders', { project_id: system.project_id, notes: quickPONotes || null });
      const poId = poRes.data.id;
      await Promise.all([
        ...eligibleEquip.map((item: any, idx: number) =>
          api.post(`/purchase-orders/${poId}/items`, {
            product_master_id: item.product_master_id,
            quantity: item.quantity ?? 1,
            currency: quickPOCurrency,
            notes: item.equip_code || null,
            system_id: system.id,
            sort_order: idx,
            project_equipment_item_id: item.id,
          })
        ),
        ...eligibleTanks.map((t: any, idx: number) =>
          api.post(`/purchase-orders/${poId}/items`, {
            product_master_id: t.product_master_id,
            quantity: t.quantity ?? 1,
            currency: quickPOCurrency,
            notes: t.tank_code || null,
            system_id: system.id,
            sort_order: eligibleEquip.length + idx,
            tank_id: t.id,
          })
        ),
      ]);
      toast.success(`${poRes.data.po_code} created with ${total} item${total !== 1 ? 's' : ''}`);
      openPurchaseOrder(poId);
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || 'Failed to create PO');
      setQuickPOSaving(false);
    }
  };

  const handleDeleteRow = async (eqId: string) => {
    try {
      await api.delete(`/equipment-items/${eqId}`);
      toast.success('Row removed');
      refetch();
      setDeleteConfirmId(null);
    } catch { toast.error('Delete failed'); }
  };

  const assignTank = async (tank: any) => {
    setAssigningTankId(tank.id);
    try {
      await api.put(`/tanks/${tank.id}`, {
        tank_name: tank.tank_name || '',
        tank_code: tank.tank_code || '',
        tank_type: tank.tank_type || '',
        shape_type: tank.shape_type || '',
        length_mm: tank.length_mm ?? '',
        width_mm: tank.width_mm ?? '',
        height_mm: tank.height_mm ?? '',
        design_water_level_mm: tank.design_water_level_mm ?? '',
        primary_material: tank.primary_material || '',
        status: tank.status || 'Active',
        quantity: tank.quantity ?? 1,
        notes: tank.notes || '',
        system_id: system.id,
      });
      refetch();
      refetchAllTanks();
      toast.success(`${tank.tank_code} assigned to ${system.system_code}`);
    } catch { toast.error('Failed to assign tank'); }
    finally { setAssigningTankId(null); }
  };

  const unassignTank = async (tank: any) => {
    setUnassigningTankId(tank.id);
    try {
      await api.put(`/tanks/${tank.id}`, {
        tank_name: tank.tank_name || '',
        tank_code: tank.tank_code || '',
        tank_type: tank.tank_type || '',
        shape_type: tank.shape_type || '',
        length_mm: tank.length_mm ?? '',
        width_mm: tank.width_mm ?? '',
        height_mm: tank.height_mm ?? '',
        design_water_level_mm: tank.design_water_level_mm ?? '',
        primary_material: tank.primary_material || '',
        status: tank.status || 'Active',
        quantity: tank.quantity ?? 1,
        notes: tank.notes || '',
        system_id: null,
      });
      refetch();
      refetchAllTanks();
      toast.success(`${tank.tank_code} removed from ${system.system_code}`);
    } catch { toast.error('Failed to remove tank'); }
    finally { setUnassigningTankId(null); }
  };

  const transitions = ['Draft', 'Internal Review', 'Approved', 'Released', 'Superseded', 'Obsolete'];

  const inlineItemCell = () => (
    <td className={cellCls + ' relative'}>
      <div className="flex gap-1 mb-1.5" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => { setInlineType('product'); setInlineSelectedComponent(null); setInlineComponentSearch(''); }}
          className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${inlineType === 'product' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
        >Product</button>
        <button
          onClick={() => { setInlineType('component'); setInlineSelectedProduct(null); setInlineProductSearch(''); }}
          className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${inlineType === 'component' ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
        >Component</button>
      </div>
      {inlineType === 'product' ? (
        inlineSelectedProduct ? (
          <div className="flex items-center gap-1.5 border border-blue-600 bg-blue-50 rounded px-2 py-1 text-sm">
            <span className="flex-1 truncate font-medium text-slate-800">{inlineSelectedProduct.product_name}</span>
            <button aria-label="Clear selected product" title="Clear selected product" onClick={e => { e.stopPropagation(); setInlineSelectedProduct(null); setInlineProductSearch(''); }} className="text-slate-400 hover:text-red-500 flex-shrink-0"><X className="w-3 h-3" /></button>
          </div>
        ) : (
          <div className="relative" onClick={e => e.stopPropagation()}>
            <Search className="absolute left-2 top-1.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input
              ref={searchRef}
              value={inlineProductSearch}
              onChange={e => setInlineProductSearch(e.target.value)}
              placeholder="Search products…"
              className={inputCls + ' pl-7'}
              onKeyDown={e => { if (e.key === 'Escape') cancelInline(); }}
            />
            {productSearchResults?.items?.length > 0 && (
              <div className="absolute top-full left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-xl mt-0.5 z-20 max-h-52 overflow-auto">
                {productSearchResults.items.map((p: any) => (
                  <button key={p.id} onMouseDown={e => e.preventDefault()} onClick={() => { setInlineSelectedProduct(p); setInlineProductSearch(''); }}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-left border-b border-slate-50 last:border-0">
                    <EntityCode code={p.product_code} />
                    <span className="text-sm text-slate-800 truncate">{p.product_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      ) : (
        inlineSelectedComponent ? (
          <div className="flex items-center gap-1.5 border border-violet-600 bg-violet-50 rounded px-2 py-1 text-sm">
            <span className="flex-1 truncate font-medium text-slate-800">{inlineSelectedComponent.component_name}</span>
            <button aria-label="Clear selected component" title="Clear selected component" onClick={e => { e.stopPropagation(); setInlineSelectedComponent(null); setInlineComponentSearch(''); }} className="text-slate-400 hover:text-red-500 flex-shrink-0"><X className="w-3 h-3" /></button>
          </div>
        ) : (
          <div className="relative" onClick={e => e.stopPropagation()}>
            <Search className="absolute left-2 top-1.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input
              value={inlineComponentSearch}
              onChange={e => setInlineComponentSearch(e.target.value)}
              placeholder="Search components…"
              className={inputCls + ' pl-7'}
              onKeyDown={e => { if (e.key === 'Escape') cancelInline(); }}
            />
            {componentSearchResults?.items?.length > 0 && (
              <div className="absolute top-full left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-xl mt-0.5 z-20 max-h-52 overflow-auto">
                {componentSearchResults.items.map((c: any) => (
                  <button key={c.id} onMouseDown={e => e.preventDefault()} onClick={() => { setInlineSelectedComponent(c); setInlineComponentSearch(''); }}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-left border-b border-slate-50 last:border-0">
                    <EntityCode code={c.component_code} />
                    <span className="text-sm text-slate-800 truncate">{c.component_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      )}
    </td>
  );

  const inlineCodeCell = () => (
    <td className={cellCls}>
      {inlineType === 'product' && inlineSelectedProduct
        ? <EntityCode code={inlineSelectedProduct.product_code} />
        : inlineType === 'component' && inlineSelectedComponent
        ? <EntityCode code={inlineSelectedComponent.component_code} />
        : <span className="text-slate-300 text-xs">—</span>}
    </td>
  );

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
            <ActivityLog entityType="system" entityId={system?.id} />
          </div>
        </div>

        {/* Tank volume summary strip — above Products */}
        {(() => {
          const tanks: any[] = system.tanks ?? [];
          if (tanks.length === 0) return null;
          const totalGross = tanks.reduce((s: number, t: any) => s + (parseFloat(t.gross_volume_m3 ?? 0) * (parseInt(t.quantity ?? 1))), 0);
          const totalOp = tanks.reduce((s: number, t: any) => s + (parseFloat(t.operating_volume_m3 ?? 0) * (parseInt(t.quantity ?? 1))), 0);
          const totalQty = tanks.reduce((s: number, t: any) => s + parseInt(t.quantity ?? 1), 0);
          const calcTurnover = system.design_flow_m3h && totalOp > 0
            ? (parseFloat(system.design_flow_m3h) / totalOp).toFixed(2)
            : null;
          return (
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
              {/* Calc Turnover Rate */}
              <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0 mt-0.5">
                  <Zap className="w-4 h-4 text-blue-600" />
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
          );
        })()}

        {/* Products inline grid */}
        {(() => {
          const selectableEq = equipment.filter((eq: any) => eq.product_master_id && !eq.released_po_id);
          const eligibleSelected = equipment.filter((eq: any) => selectedIds.has(eq.id) && eq.product_master_id && !eq.released_po_id);
          const allChecked = selectableEq.length > 0 && selectableEq.every((eq: any) => selectedIds.has(eq.id));
          const someChecked = selectableEq.some((eq: any) => selectedIds.has(eq.id));
          return (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Products</h3>
              {eligibleSelected.length > 0 ? (
                <p className="text-xs text-blue-600 mt-0.5 font-medium">{eligibleSelected.length} item{eligibleSelected.length !== 1 ? 's' : ''} selected — right-click or use button to add to PO</p>
              ) : (
                <p className="text-xs text-slate-400 mt-0.5">Right-click any row to add to PO · Click to edit</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {eligibleSelected.length > 0 && (
                <button
                  onClick={() => setShowQuickPO(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                >
                  <ShoppingCart className="w-3.5 h-3.5" />
                  Add {eligibleSelected.length} to PO
                </button>
              )}
              {selectedIds.size > 0 && (
                <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1.5">Clear</button>
              )}
              <Button size="sm" variant="primary" onClick={startNewRow} disabled={inlineEditId === NEW_ROW_ID}>
                <Plus className="w-3.5 h-3.5" />Add Row
              </Button>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="w-10 px-3 py-2.5">
                  {selectableEq.length > 0 && (
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={el => { if (el) el.indeterminate = someChecked && !allChecked; }}
                      onChange={e => {
                        if (e.target.checked) setSelectedIds(new Set(selectableEq.map((eq: any) => eq.id)));
                        else setSelectedIds(new Set());
                      }}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600"
                    />
                  )}
                </th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[130px]">Tag</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Item</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[110px]">Code</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[80px]">Qty</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[80px]">Unit</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[140px]">Status</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[120px]">PO</th>
                <th className="w-[80px]" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {equipment.length === 0 && inlineEditId !== NEW_ROW_ID && (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-sm text-slate-400">
                    No items yet — click <strong>Add Row</strong> to assign products or components to this system.
                  </td>
                </tr>
              )}

              {equipment.map((eq: any) => {
                const isEditing = inlineEditId === eq.id;
                const isSelectable = !!(eq.product_master_id && !eq.released_po_id);
                const isSelected = selectedIds.has(eq.id);
                return (
                  <tr
                    key={eq.id}
                    id={`equipment-${eq.id}`}
                    className={`group ${isEditing ? 'bg-blue-50/40' : isSelected ? 'bg-blue-50 hover:bg-blue-50/80' : 'hover:bg-slate-50'} ${!isEditing ? 'cursor-pointer' : ''}`}
                    onClick={() => { if (!isEditing) startInlineEdit(eq); }}
                    onContextMenu={e => handleContextMenu(e, eq, 'equipment')}
                  >
                    {isEditing ? (
                      <>
                        <td className={cellCls} />
                        <td className={cellCls}>
                          <input
                            value={inlineForm.equip_code}
                            onChange={e => setInlineForm((f: any) => ({ ...f, equip_code: e.target.value.toUpperCase() }))}
                            className={inputCls + ' font-mono uppercase'}
                            placeholder="TAG-101"
                            onKeyDown={e => { if (e.key === 'Escape') cancelInline(); if (e.key === 'Enter') saveInlineRow(); }}
                          />
                        </td>
                        {inlineItemCell()}
                        {inlineCodeCell()}
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
                        <td className={cellCls} />
                        <td className={cellCls} onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            <button aria-label="Save system row" title="Save system row" onClick={saveInlineRow} disabled={inlineSaving} className="p-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button aria-label="Cancel editing system row" title="Cancel editing system row" onClick={cancelInline} className="p-1.5 rounded text-slate-400 hover:bg-slate-100">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="w-10 px-3 py-2.5" onClick={e => e.stopPropagation()}>
                          {isSelectable ? (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(eq.id)}
                              className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600"
                            />
                          ) : (
                            eq.released_po_id
                              ? <span title="Already in a PO" className="block w-3.5 h-3.5 rounded bg-slate-100 border border-slate-200" />
                              : null
                          )}
                        </td>
                        <td className={cellCls}><EntityCode code={eq.equip_code} /></td>
                        <td className={cellCls + ' font-medium text-slate-800'}>
                          <div className="flex items-center gap-1.5 min-w-0">
                            {eq.component_id && <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700 uppercase tracking-wide">Comp</span>}
                            <span className="flex-1 truncate">{eq.component_name || eq.product_name || eq.description || <span className="text-slate-300 font-normal">—</span>}</span>
                            {eq.product_master_id && (
                              <button
                                onClick={e => { e.stopPropagation(); navigate(`/products/masters/${eq.product_master_id}`); }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 flex-shrink-0"
                                title="Open product sheet"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            )}
                            {eq.component_id && (
                              <button
                                onClick={e => { e.stopPropagation(); navigate(`/products/components/${eq.component_id}`); }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-slate-400 hover:text-violet-600 hover:bg-violet-50 flex-shrink-0"
                                title="Open component"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className={cellCls}>
                          {eq.component_code ? <EntityCode code={eq.component_code} /> : eq.product_code ? <EntityCode code={eq.product_code} /> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className={cellCls + ' text-slate-600'}>{eq.quantity ?? 1}</td>
                        <td className={cellCls + ' text-slate-500'}>{eq.unit || 'EA'}</td>
                        <td className={cellCls}><StatusBadge status={eq.status || 'Design'} /></td>
                        <td className={cellCls} onClick={e => e.stopPropagation()}>
                          {eq.released_po_id ? (
                            <button
                               onClick={e => { e.stopPropagation(); openPurchaseOrder(eq.released_po_id); }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors"
                              title={`Released in ${eq.released_po_code}`}
                            >
                              <ShoppingCart className="w-2.5 h-2.5" />
                              {eq.released_po_code}
                            </button>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>
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
                  <td className={cellCls} />
                  <td className={cellCls}>
                    <input
                      value={inlineForm.equip_code}
                      onChange={e => setInlineForm((f: any) => ({ ...f, equip_code: e.target.value.toUpperCase() }))}
                      className={inputCls + ' font-mono uppercase'}
                      placeholder="TAG-101"
                      onKeyDown={e => { if (e.key === 'Escape') cancelInline(); if (e.key === 'Enter') saveInlineRow(); }}
                    />
                  </td>
                  {inlineItemCell()}
                  {inlineCodeCell()}
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
                  <td className={cellCls} />
                  <td className={cellCls}>
                    <div className="flex items-center gap-1">
                      <button aria-label="Save system row" title="Save system row" onClick={saveInlineRow} disabled={inlineSaving} className="p-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button aria-label="Cancel editing system row" title="Cancel editing system row" onClick={cancelInline} className="p-1.5 rounded text-slate-400 hover:bg-slate-100">
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
          );
        })()}

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
              {/* Tanks table */}
              {(() => {
                const selectableTanks = tanks.filter((t: any) => !t.released_po_id);
                const eligibleTankSelected = tanks.filter((t: any) => selectedTankIds.has(t.id) && !t.released_po_id);
                const allTanksChecked = selectableTanks.length > 0 && selectableTanks.every((t: any) => selectedTankIds.has(t.id));
                const someTanksChecked = selectableTanks.some((t: any) => selectedTankIds.has(t.id));
                const eligibleEquipSelected = equipment.filter((eq: any) => selectedIds.has(eq.id) && eq.product_master_id && !eq.released_po_id);
                const combinedCount = eligibleTankSelected.length + eligibleEquipSelected.length;
                return (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Tanks</h3>
                    {eligibleTankSelected.length > 0 ? (
                      <p className="text-xs text-blue-600 mt-0.5 font-medium">
                        {eligibleTankSelected.length} tank{eligibleTankSelected.length !== 1 ? 's' : ''} selected{combinedCount > eligibleTankSelected.length ? ` · ${combinedCount} total with equipment` : ''} — right-click or use button to add to PO
                      </p>
                    ) : (
                      <p className="text-xs text-slate-400 mt-0.5">
                        {tanks.length === 0
                          ? 'No tanks linked to this system yet.'
                          : `${tanks.length} tank type${tanks.length !== 1 ? 's' : ''} · ${totalQty} unit${totalQty !== 1 ? 's' : ''} total · right-click to add to PO`}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {combinedCount > 0 && (
                      <button
                        onClick={() => setShowQuickPO(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                      >
                        <ShoppingCart className="w-3.5 h-3.5" />
                        Add {combinedCount} to PO
                      </button>
                    )}
                    {selectedTankIds.size > 0 && (
                      <button onClick={() => setSelectedTankIds(new Set())} className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1.5">Clear</button>
                    )}
                    <button
                      onClick={() => { setShowAssignTank(v => !v); setAssignSearch(''); }}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${showAssignTank ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50'}`}
                    >
                      <Plus className="w-3.5 h-3.5" />Assign Tank
                    </button>
                    <Link
                      to={`/projects/${system.project_id}?tab=tanks`}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                    >
                      Manage →
                    </Link>
                  </div>
                </div>

                {/* Unallocated tank picker */}
                {showAssignTank && (() => {
                  const unallocated = (allProjectTanks?.items || [])
                    .filter((t: any) => !t.system_id)
                    .filter((t: any) => !assignSearch ||
                      t.tank_code?.toLowerCase().includes(assignSearch.toLowerCase()) ||
                      t.tank_name?.toLowerCase().includes(assignSearch.toLowerCase()));
                  return (
                    <div className="border-b border-blue-100 bg-blue-50/60 px-4 py-3">
                      <div className="flex items-center gap-2 mb-2.5">
                        <div className="relative flex-1 max-w-xs">
                          <Search className="absolute left-2 top-1.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                          <input
                            autoFocus
                            value={assignSearch}
                            onChange={e => setAssignSearch(e.target.value)}
                            placeholder="Filter unassigned tanks…"
                            className="w-full pl-7 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-blue-400"
                          />
                        </div>
                        <span className="text-xs text-slate-400">
                          {!allProjectTanks ? 'Loading…' : `${(allProjectTanks?.items || []).filter((t: any) => !t.system_id).length} unassigned`}
                        </span>
                      </div>
                      {!allProjectTanks ? null : unallocated.length === 0 ? (
                        <p className="text-xs text-slate-400 py-1">
                          {assignSearch ? 'No tanks match your search.' : 'All tanks in this project are already assigned to a system.'}
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {unallocated.map((t: any) => (
                            <button
                              key={t.id}
                              disabled={assigningTankId === t.id}
                              onClick={() => assignTank(t)}
                              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:border-blue-500 hover:bg-blue-50 transition-colors text-sm disabled:opacity-50 group"
                            >
                              <EntityCode code={t.tank_code} />
                              <span className="text-slate-700 font-medium">{t.tank_name}</span>
                              {t.gross_volume_m3 && (
                                <span className="text-xs text-slate-400 font-mono">{parseFloat(t.gross_volume_m3).toFixed(2)} m³</span>
                              )}
                              {assigningTankId === t.id
                                ? <span className="text-xs text-slate-400">…</span>
                                : <Plus className="w-3 h-3 text-slate-300 group-hover:text-blue-500" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {tanks.length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-slate-400">
                    No tanks linked yet — click <strong>Assign Tank</strong> above to add one from this project.
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/50">
                        <th className="w-10 px-3 py-2.5">
                          {selectableTanks.length > 0 && (
                            <input
                              type="checkbox"
                              checked={allTanksChecked}
                              ref={el => { if (el) el.indeterminate = someTanksChecked && !allTanksChecked; }}
                              onChange={e => {
                                if (e.target.checked) setSelectedTankIds(new Set(selectableTanks.map((t: any) => t.id)));
                                else setSelectedTankIds(new Set());
                              }}
                              className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600"
                            />
                          )}
                        </th>
                        <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[120px]">Code</th>
                        <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Tank</th>
                        <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[110px]">Product</th>
                        <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[60px]">Qty</th>
                        <th className="text-right px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[100px]">Gross Vol.</th>
                        <th className="text-right px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[100px]">Op. Vol.</th>
                        <th className="text-right px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[100px]">Total Op.</th>
                        <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[100px]">Status</th>
                        <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-[110px]">PO</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {tanks.map((t: any) => {
                        const qty = parseInt(t.quantity ?? 1);
                        const opVol = parseFloat(t.operating_volume_m3 ?? 0);
                        const totalOpVol = opVol * qty;
                        const isTankSelectable = !t.released_po_id;
                        const isTankSelected = selectedTankIds.has(t.id);
                        return (
                          <tr
                            key={t.id}
                            className={`group cursor-pointer ${isTankSelected ? 'bg-blue-50 hover:bg-blue-50/80' : 'hover:bg-slate-50'}`}
                            onContextMenu={e => handleContextMenu(e, t, 'tank')}
                            onClick={() => { if (isTankSelectable) toggleTank(t.id); }}
                          >
                            <td className="w-10 px-3 py-2.5" onClick={e => e.stopPropagation()}>
                              {isTankSelectable ? (
                                <input
                                  type="checkbox"
                                  checked={isTankSelected}
                                  onChange={() => toggleTank(t.id)}
                                  className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600"
                                />
                              ) : (
                                t.released_po_id
                                  ? <span title="Already in a PO" className="block w-3.5 h-3.5 rounded bg-slate-100 border border-slate-200" />
                                  : null
                              )}
                            </td>
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
                            <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center gap-2">
                                {t.released_po_id ? (
                                  <button
                                     onClick={() => openPurchaseOrder(t.released_po_id)}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors"
                                    title={`Released in ${t.released_po_code}`}
                                  >
                                    <ShoppingCart className="w-2.5 h-2.5" />
                                    {t.released_po_code}
                                  </button>
                                ) : (
                                  <span className="text-slate-300 text-xs">—</span>
                                )}
                                <button
                                  onClick={() => unassignTank(t)}
                                  disabled={unassigningTankId === t.id}
                                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-300 hover:text-red-400 hover:bg-red-50 transition-opacity disabled:opacity-50"
                                  title="Remove from this system"
                                >
                                  {unassigningTankId === t.id ? <span className="text-xs">…</span> : <X className="w-3 h-3" />}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {tanks.length > 1 && (
                      <tfoot>
                        <tr className="border-t-2 border-slate-200 bg-slate-50/70">
                          <td colSpan={4} className="px-3 py-2 text-xs font-semibold text-slate-500">Totals</td>
                          <td className="px-3 py-2 text-center text-xs font-semibold text-slate-700">{totalQty}</td>
                          <td className="px-3 py-2 text-right text-xs font-semibold text-slate-700 font-mono">{totalGross > 0 ? `${totalGross.toFixed(2)} m³` : '—'}</td>
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2 text-right text-xs font-semibold text-slate-700 font-mono">{totalOp > 0 ? `${totalOp.toFixed(2)} m³` : '—'}</td>
                          <td /><td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                )}
              </div>
                );
              })()}
            </>
          );
        })()}
      </div>

      {/* Right-click context menu */}
      {ctxMenu && (
        <div
          className="fixed z-[100] bg-white border border-slate-200 rounded-xl shadow-2xl py-1 min-w-[210px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          {(() => {
            const allTanks: any[] = system.tanks ?? [];
            const eligibleEquip = equipment.filter((eq: any) => selectedIds.has(eq.id) && eq.product_master_id && !eq.released_po_id);
            const eligibleTanks = allTanks.filter((t: any) => selectedTankIds.has(t.id) && !t.released_po_id);
            const total = eligibleEquip.length + eligibleTanks.length;
            const totalSelected = selectedIds.size + selectedTankIds.size;
            return (
              <>
                <div className="px-3 py-2 border-b border-slate-100">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {totalSelected} selected · {total} eligible for PO
                  </p>
                </div>
                <button
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors ${total > 0 ? 'hover:bg-blue-50 text-slate-700 hover:text-blue-700' : 'text-slate-300 cursor-not-allowed'}`}
                  disabled={total === 0}
                  onClick={() => { if (total > 0) { setCtxMenu(null); setShowQuickPO(true); } }}
                >
                  <ShoppingCart className="w-4 h-4" />
                  <span>Add to PO <span className="text-xs text-slate-400">({total} item{total !== 1 ? 's' : ''})</span></span>
                </button>
                <div className="border-t border-slate-100 mt-1 pt-1">
                  <button
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
                    onClick={() => { setSelectedIds(new Set()); setSelectedTankIds(new Set()); setCtxMenu(null); }}
                  >
                    <X className="w-4 h-4" />
                    Clear all selection
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Quick Add to PO modal */}
      {showQuickPO && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-[460px] p-6">
            <h3 className="font-semibold text-slate-800 mb-1">Create Purchase Order</h3>
            {(() => {
              const allTanks: any[] = system.tanks ?? [];
              const eligibleEquip = equipment.filter((eq: any) => selectedIds.has(eq.id) && eq.product_master_id && !eq.released_po_id);
              const eligibleTanks = allTanks.filter((t: any) => selectedTankIds.has(t.id) && !t.released_po_id);
              const total = eligibleEquip.length + eligibleTanks.length;
              return (
                <>
                  <p className="text-sm text-slate-500 mb-4">
                    {total} item{total !== 1 ? 's' : ''} from <span className="font-medium text-slate-700">{system.system_name}</span>
                  </p>
                  <div className="bg-slate-50 rounded-lg border border-slate-200 mb-4 overflow-hidden max-h-52 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-100">
                        <tr className="border-b border-slate-200">
                          <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">Tag / Code</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">Product</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-slate-500">Qty</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {eligibleEquip.map((eq: any) => (
                          <tr key={eq.id}>
                            <td className="px-3 py-2"><EntityCode code={eq.equip_code} /></td>
                            <td className="px-3 py-2 text-slate-700 truncate max-w-[200px]">{eq.product_name}</td>
                            <td className="px-3 py-2 text-right text-slate-500">{eq.quantity ?? 1} {eq.unit || 'EA'}</td>
                          </tr>
                        ))}
                        {eligibleTanks.length > 0 && eligibleEquip.length > 0 && (
                          <tr className="bg-slate-100/50">
                            <td colSpan={3} className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Tanks</td>
                          </tr>
                        )}
                        {eligibleTanks.map((t: any) => (
                          <tr key={t.id}>
                            <td className="px-3 py-2"><EntityCode code={t.tank_code} /></td>
                            <td className="px-3 py-2 text-slate-700 truncate max-w-[200px]">{t.product_name || t.tank_name}</td>
                            <td className="px-3 py-2 text-right text-slate-500">{t.quantity ?? 1} EA</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex gap-3 mb-4">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Currency</label>
                      <select
                        value={quickPOCurrency}
                        onChange={e => setQuickPOCurrency(e.target.value)}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-blue-600"
                      >
                        {SUPPORTED_CURRENCIES.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="mb-5">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Notes (optional)</label>
                    <textarea
                      value={quickPONotes}
                      onChange={e => setQuickPONotes(e.target.value)}
                      rows={2}
                      placeholder="Add notes to the purchase order…"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-600 resize-none"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button onClick={() => { setShowQuickPO(false); setQuickPONotes(''); }} disabled={quickPOSaving}>Cancel</Button>
                    <Button variant="primary" onClick={handleQuickPO} disabled={quickPOSaving || total === 0}>
                      <ShoppingCart className="w-3.5 h-3.5" />
                      {quickPOSaving ? 'Creating…' : `Create PO (${total} item${total !== 1 ? 's' : ''})`}
                    </Button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

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
