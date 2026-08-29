import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import {
  ChevronLeft, Plus, Pencil, Trash2, X, Save, Check,
  Waves, ExternalLink, Layers, AlertCircle, Package,
} from 'lucide-react';
import toast from 'react-hot-toast';

const WATER_TYPES = ['Marine', 'Freshwater', 'Brackish', 'Universal'];
const STATUSES    = ['Active', 'Discontinued', 'Coming Soon'];

const EMPTY_FORM = {
  unit_code: '', unit_name: '', manufacturer: '', water_type: '',
  min_tank_volume_m3: '', max_tank_volume_m3: '',
  design_flow_m3h: '', max_flow_m3h: '',
  break_tank_volume_l: '', includes_filtration: '', uv_power_w: '',
  footprint_l_mm: '', footprint_w_mm: '', height_mm: '',
  dry_weight_kg: '', power_kw: '',
  inlet_connection: '', outlet_connection: '',
  notes: '', product_master_id: '', status: 'Active',
};

type ProductSpecifications = {
  dimensions?: Record<string, any>;
  hydraulic?: Record<string, any>;
  electrical?: Record<string, any>;
};

const hasSourceValue = (value: unknown) =>
  value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === '');

const firstSourceValue = (...values: unknown[]) => values.find(hasSourceValue);

const formatConnection = (value: unknown) => {
  if (!hasSourceValue(value)) return undefined;
  const text = String(value).trim();
  return /^\d+(?:\.\d+)?$/.test(text) ? `DN${text}` : text;
};

/**
 * Product Master values are copied into the compact-unit catalog once. They
 * are deliberately not a live link: LSS-specific fields have no compatible
 * PIM source and remain outside this mapping.
 */
export function mapProductMasterToCompactUnit(
  product: Record<string, any> = {},
  specifications: ProductSpecifications = {},
) {
  const { dimensions = {}, hydraulic = {}, electrical = {} } = specifications;
  const mapped: Record<string, any> = {};
  const copy = (field: string, value: unknown) => {
    if (hasSourceValue(value)) mapped[field] = value;
  };

  copy('unit_code', product.product_code);
  copy('unit_name', product.product_name);
  copy('manufacturer', product.manufacturer);
  copy('design_flow_m3h', firstSourceValue(hydraulic.design_flow_m3h, product.design_flow_m3h));
  copy('max_flow_m3h', firstSourceValue(hydraulic.max_flow_m3h, product.max_flow_m3h));
  copy('power_kw', firstSourceValue(electrical.rated_power_kw, product.power_kw));
  copy('footprint_l_mm', firstSourceValue(dimensions.length_mm, product.length_mm));
  copy('footprint_w_mm', firstSourceValue(dimensions.width_mm, product.width_mm));
  copy('height_mm', firstSourceValue(dimensions.height_mm, product.height_mm));
  copy('dry_weight_kg', firstSourceValue(dimensions.weight_kg, product.weight_kg));
  copy('inlet_connection', formatConnection(dimensions.inlet_dn_mm));
  copy('outlet_connection', formatConnection(dimensions.outlet_dn_mm));

  return mapped;
}

export function normalizeCompactUnitPayload(form: Record<string, any>) {
  const numberOrNull = (value: unknown) =>
    value !== '' && value !== null && value !== undefined ? Number(value) : null;

  return {
    unit_code: form.unit_code,
    unit_name: form.unit_name,
    manufacturer: form.manufacturer,
    water_type: form.water_type,
    min_tank_volume_m3: numberOrNull(form.min_tank_volume_m3),
    max_tank_volume_m3: numberOrNull(form.max_tank_volume_m3),
    design_flow_m3h: numberOrNull(form.design_flow_m3h),
    max_flow_m3h: numberOrNull(form.max_flow_m3h),
    break_tank_volume_l: numberOrNull(form.break_tank_volume_l),
    includes_filtration: form.includes_filtration,
    uv_power_w: numberOrNull(form.uv_power_w),
    footprint_l_mm: numberOrNull(form.footprint_l_mm),
    footprint_w_mm: numberOrNull(form.footprint_w_mm),
    height_mm: numberOrNull(form.height_mm),
    dry_weight_kg: numberOrNull(form.dry_weight_kg),
    power_kw: numberOrNull(form.power_kw),
    inlet_connection: form.inlet_connection,
    outlet_connection: form.outlet_connection,
    notes: form.notes,
    product_master_id: form.product_master_id || null,
    status: form.status,
  };
}

function WaterBadge({ type }: { type?: string }) {
  if (!type) return <span className="text-stone-300 text-xs">—</span>;
  const styles: Record<string, string> = {
    Marine:     'bg-blue-100 text-blue-700 border-blue-200',
    Freshwater: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    Brackish:   'bg-teal-100 text-teal-700 border-teal-200',
    Universal:  'bg-violet-100 text-violet-700 border-violet-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${styles[type] ?? 'bg-stone-100 text-stone-600 border-stone-200'}`}>
      <Waves className="w-3 h-3" /> {type}
    </span>
  );
}

function StatusBadge({ status }: { status?: string }) {
  const styles: Record<string, string> = {
    Active:        'bg-emerald-100 text-emerald-700',
    Discontinued:  'bg-stone-100 text-stone-500',
    'Coming Soon': 'bg-blue-100 text-blue-700',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles[status ?? ''] ?? 'bg-stone-100 text-stone-600'}`}>
      {status || '—'}
    </span>
  );
}

function UnitModal({
  unit, products, onClose, onSaved,
}: {
  unit: any | null;
  products: any[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<any>(unit ? {
    unit_code: unit.unit_code || '',
    unit_name: unit.unit_name || '',
    manufacturer: unit.manufacturer || '',
    water_type: unit.water_type || '',
    min_tank_volume_m3: unit.min_tank_volume_m3 ?? '',
    max_tank_volume_m3: unit.max_tank_volume_m3 ?? '',
    design_flow_m3h: unit.design_flow_m3h ?? '',
    max_flow_m3h: unit.max_flow_m3h ?? '',
    break_tank_volume_l: unit.break_tank_volume_l ?? '',
    includes_filtration: unit.includes_filtration || '',
    uv_power_w: unit.uv_power_w ?? '',
    footprint_l_mm: unit.footprint_l_mm ?? '',
    footprint_w_mm: unit.footprint_w_mm ?? '',
    height_mm: unit.height_mm ?? '',
    dry_weight_kg: unit.dry_weight_kg ?? '',
    power_kw: unit.power_kw ?? '',
    inlet_connection: unit.inlet_connection || '',
    outlet_connection: unit.outlet_connection || '',
    notes: unit.notes || '',
    product_master_id: unit.product_master_id || '',
    status: unit.status || 'Active',
  } : { ...EMPTY_FORM });

  const [saving, setSaving] = useState(false);
  const [pimLoading, setPimLoading] = useState(false);
  const [pimError, setPimError] = useState('');
  const [pimValues, setPimValues] = useState<Record<string, any> | null>(null);
  const pimRequest = useRef(0);
  const set = (k: string, v: string) => setForm((f: any) => ({ ...f, [k]: v }));

  const selectedProduct = (productMasterId: string) =>
    products.find((product: any) => String(product.id) === String(productMasterId)) ?? {};

  const applyPimValues = (values: Record<string, any>, onlyEmpty: boolean) => {
    setForm((current: any) => {
      const next = { ...current };
      Object.entries(values).forEach(([field, value]) => {
        if (!onlyEmpty || !hasSourceValue(next[field])) next[field] = value;
      });
      return next;
    });
  };

  const loadPimValues = async (productMasterId: string, applyValues: boolean) => {
    if (!productMasterId) return;
    const request = ++pimRequest.current;
    setPimLoading(true);
    setPimError('');
    try {
      const [dimensions, hydraulic, electrical] = await Promise.all([
        api.get(`/product-masters/${productMasterId}/dimensions`),
        api.get(`/product-masters/${productMasterId}/hydraulic`),
        api.get(`/product-masters/${productMasterId}/electrical`),
      ]);
      if (request !== pimRequest.current) return;
      const values = mapProductMasterToCompactUnit(selectedProduct(productMasterId), {
        dimensions: dimensions.data || {},
        hydraulic: hydraulic.data || {},
        electrical: electrical.data || {},
      });
      setPimValues(values);
      if (applyValues) applyPimValues(values, !unit);
    } catch {
      if (request === pimRequest.current) {
        setPimValues(null);
        setPimError('Product Master specifications could not be loaded. You can continue entering values manually.');
      }
    } finally {
      if (request === pimRequest.current) setPimLoading(false);
    }
  };

  const handleProductMasterChange = (productMasterId: string) => {
    set('product_master_id', productMasterId);
    setPimValues(null);
    setPimError('');
    if (productMasterId) {
      // Editing a saved unit must never replace its overrides as a side
      // effect of changing the link. New units get a convenient first pass.
      void loadPimValues(productMasterId, !unit);
    } else {
      pimRequest.current += 1;
    }
  };

  const handleApplyPimValues = () => {
    if (!form.product_master_id) return;
    if (pimValues) {
      applyPimValues(pimValues, false);
    } else {
      void loadPimValues(form.product_master_id, true);
    }
  };

  const handleSave = async () => {
    if (!form.unit_code.trim() || !form.unit_name.trim())
      return toast.error('Code and name are required');
    setSaving(true);
    try {
      const payload = normalizeCompactUnitPayload(form);
      if (unit) {
        await api.put(`/lss-compact-units/${unit.id}`, payload);
        toast.success('Unit updated');
      } else {
        await api.post('/lss-compact-units', payload);
        toast.success('Unit created');
      }
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40 bg-white';
  const numCls   = `${inputCls} font-mono`;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-violet-600" />
            <span className="font-semibold text-stone-800">{unit ? 'Edit' : 'New'} LSS Compact Unit</span>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 p-1 rounded-lg"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Identity */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="compact-unit-code" className="block text-xs font-medium text-stone-500 mb-1">Unit Code *</label>
              <input id="compact-unit-code" value={form.unit_code} onChange={e => set('unit_code', e.target.value.toUpperCase())}
                className={inputCls} placeholder="e.g. LSS-C-100" />
            </div>
            <div className="col-span-2">
              <label htmlFor="compact-unit-name" className="block text-xs font-medium text-stone-500 mb-1">Unit Name *</label>
              <input id="compact-unit-name" value={form.unit_name} onChange={e => set('unit_name', e.target.value)}
                className={inputCls} placeholder="e.g. AquaCompact 100 Marine" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="compact-unit-manufacturer" className="block text-xs font-medium text-stone-500 mb-1">Manufacturer</label>
              <input id="compact-unit-manufacturer" value={form.manufacturer} onChange={e => set('manufacturer', e.target.value)}
                className={inputCls} />
            </div>
            <div>
              <label htmlFor="compact-unit-water-type" className="block text-xs font-medium text-stone-500 mb-1">Water Type</label>
              <select id="compact-unit-water-type" value={form.water_type} onChange={e => set('water_type', e.target.value)} className={`${inputCls}`}>
                <option value="">— Any —</option>
                {WATER_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="compact-unit-status" className="block text-xs font-medium text-stone-500 mb-1">Status</label>
              <select id="compact-unit-status" value={form.status} onChange={e => set('status', e.target.value)} className={inputCls}>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Volume & Flow */}
          <div>
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">Tank Volume & Flow</p>
            <div className="grid grid-cols-4 gap-3">
              {[
                { k: 'min_tank_volume_m3', label: 'Min Volume m³' },
                { k: 'max_tank_volume_m3', label: 'Max Volume m³' },
                { k: 'design_flow_m3h',   label: 'Design Flow m³/h' },
                { k: 'max_flow_m3h',      label: 'Max Flow m³/h' },
              ].map(f => (
                <div key={f.k}>
                  <label htmlFor={`compact-unit-${f.k}`} className="block text-xs font-medium text-stone-500 mb-1">{f.label}</label>
                  <input id={`compact-unit-${f.k}`} type="number" step="0.1" min="0" value={form[f.k]}
                    onChange={e => set(f.k, e.target.value)} className={numCls} />
                </div>
              ))}
            </div>
          </div>

          {/* Filtration */}
          <div>
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">Filtration & Treatment</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label htmlFor="compact-unit-includes-filtration" className="block text-xs font-medium text-stone-500 mb-1">Includes Filtration</label>
                <input id="compact-unit-includes-filtration" value={form.includes_filtration} onChange={e => set('includes_filtration', e.target.value)}
                  className={inputCls} placeholder="e.g. Foam Fractionation + UV + Polishing" />
              </div>
              <div>
                <label htmlFor="compact-unit-uv-power" className="block text-xs font-medium text-stone-500 mb-1">UV Power (W)</label>
                <input id="compact-unit-uv-power" type="number" min="0" value={form.uv_power_w}
                  onChange={e => set('uv_power_w', e.target.value)} className={numCls} />
              </div>
            </div>
          </div>

          {/* Break tank */}
          <div>
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">Break / Sump Tank</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="compact-unit-break-tank-volume" className="block text-xs font-medium text-stone-500 mb-1">Break Tank Volume (L)</label>
                <input id="compact-unit-break-tank-volume" type="number" min="0" value={form.break_tank_volume_l}
                  onChange={e => set('break_tank_volume_l', e.target.value)} className={numCls} />
              </div>
              <div>
                <label htmlFor="compact-unit-inlet-connection" className="block text-xs font-medium text-stone-500 mb-1">Inlet Connection</label>
                <input id="compact-unit-inlet-connection" value={form.inlet_connection} onChange={e => set('inlet_connection', e.target.value)}
                  className={inputCls} placeholder="e.g. DN50 PN16" />
              </div>
              <div>
                <label htmlFor="compact-unit-outlet-connection" className="block text-xs font-medium text-stone-500 mb-1">Outlet Connection</label>
                <input id="compact-unit-outlet-connection" value={form.outlet_connection} onChange={e => set('outlet_connection', e.target.value)}
                  className={inputCls} placeholder="e.g. DN50 PN16" />
              </div>
            </div>
          </div>

          {/* Physical */}
          <div>
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">Physical Dimensions</p>
            <div className="grid grid-cols-5 gap-3">
              {[
                { k: 'footprint_l_mm', label: 'Length mm' },
                { k: 'footprint_w_mm', label: 'Width mm' },
                { k: 'height_mm',      label: 'Height mm' },
                { k: 'dry_weight_kg',  label: 'Dry Weight kg' },
                { k: 'power_kw',       label: 'Power kW' },
              ].map(f => (
                <div key={f.k}>
                  <label htmlFor={`compact-unit-${f.k}`} className="block text-xs font-medium text-stone-500 mb-1">{f.label}</label>
                  <input id={`compact-unit-${f.k}`} type="number" min="0" value={form[f.k]}
                    onChange={e => set(f.k, e.target.value)} className={numCls} />
                </div>
              ))}
            </div>
          </div>

          {/* PIM link */}
          <div>
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">PIM Product Link</p>
            <div>
              <label htmlFor="compact-unit-product-master" className="block text-xs font-medium text-stone-500 mb-1">Link to Product Master</label>
              <select id="compact-unit-product-master" value={form.product_master_id} onChange={e => handleProductMasterChange(e.target.value)}
                disabled={pimLoading}
                className={inputCls}>
                <option value="">— Not linked —</option>
                {products.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.product_code} — {p.product_name}</option>
                ))}
              </select>
              {form.product_master_id && (
                <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                  <span role="status" className={pimError ? 'text-amber-700' : 'text-stone-500'}>
                    {pimLoading
                      ? 'Loading Product Master specifications…'
                      : pimError
                        ? pimError
                        : pimValues
                          ? 'Specifications loaded as starting values. Compact-unit fields remain editable.'
                          : 'Product Master values are not applied automatically while editing.'}
                  </span>
                  {!pimLoading && (
                    <button type="button" onClick={handleApplyPimValues}
                      className="shrink-0 text-violet-700 hover:text-violet-900 font-medium">
                      {pimValues ? 'Reapply values' : 'Apply values'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="compact-unit-notes" className="block text-xs font-medium text-stone-500 mb-1">Notes</label>
            <textarea id="compact-unit-notes" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)}
              className={`${inputCls} resize-none`}
              placeholder="Design constraints, application notes, special requirements…" />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-stone-100 bg-stone-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm text-stone-500 border border-stone-200 bg-white rounded-lg hover:text-stone-700">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-violet-600 hover:bg-violet-700 rounded-lg disabled:opacity-50">
            <Check className="w-3.5 h-3.5" /> {saving ? 'Saving…' : unit ? 'Save Changes' : 'Create Unit'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LSSCompactUnitsCatalog() {
  const qc = useQueryClient();

  const { data: units = [], isLoading } = useQuery({
    queryKey: ['lss-compact-units'],
    queryFn: () => api.get('/lss-compact-units').then(r => r.data),
  });
  const { data: products = [] } = useQuery({
    queryKey: ['product-masters-list'],
    queryFn: () => api.get('/product-masters?page_size=500').then(r => r.data.items ?? r.data),
  });

  const [modal,    setModal]    = useState<'new' | any | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [filter,   setFilter]   = useState('');

  const refresh = () => qc.invalidateQueries({ queryKey: ['lss-compact-units'] });

  const handleDelete = async (unit: any) => {
    if (!confirm(`Delete ${unit.unit_code} — ${unit.unit_name}?`)) return;
    setDeleting(unit.id);
    try {
      await api.delete(`/lss-compact-units/${unit.id}`);
      toast.success('Unit deleted');
      refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to delete');
    } finally {
      setDeleting(null);
    }
  };

  const filtered = (units as any[]).filter(u =>
    !filter ||
    u.unit_code.toLowerCase().includes(filter.toLowerCase()) ||
    u.unit_name.toLowerCase().includes(filter.toLowerCase()) ||
    (u.manufacturer || '').toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {modal && (
        <UnitModal
          unit={modal === 'new' ? null : modal}
          products={products as any[]}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refresh(); }}
        />
      )}

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-stone-500">
        <Link to="/design-book-engine" className="hover:text-blue-600 transition-colors">Design Book Engine</Link>
        <span className="text-stone-300">/</span>
        <span className="text-stone-800 font-medium">LSS Unit Catalog</span>
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center shadow-lg shadow-violet-500/25">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-stone-800">LSS Compact Unit Catalog</h1>
            <p className="text-stone-400 text-sm">Master catalog of packaged life support units — flows, volumes, footprints and PIM links</p>
          </div>
        </div>
        <button onClick={() => setModal('new')}
          className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-violet-600 hover:bg-violet-700 rounded-lg shadow-sm transition-colors">
          <Plus className="w-4 h-4" /> Add Unit
        </button>
      </div>

      {/* Summary chips */}
      {!isLoading && (units as any[]).length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {(['Marine', 'Freshwater', 'Brackish', 'Universal'] as const).map(wt => {
            const count = (units as any[]).filter((u: any) => u.water_type === wt).length;
            if (!count) return null;
            return <WaterBadge key={wt} type={wt} />;
          })}
          <span className="text-xs text-stone-400 ml-1">{(units as any[]).length} unit{(units as any[]).length !== 1 ? 's' : ''} total</span>
        </div>
      )}

      {/* Search */}
      <input value={filter} onChange={e => setFilter(e.target.value)}
        placeholder="Search by code, name or manufacturer…"
        className="w-full max-w-sm border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40" />

      {/* Table */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        {isLoading ? (
          <div className="py-14 text-center text-stone-400 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <Layers className="w-10 h-10 text-stone-200 mx-auto mb-3" />
            <p className="text-stone-400 font-medium">
              {filter ? 'No units match your search' : 'No compact units in the catalog yet'}
            </p>
            {!filter && (
              <button onClick={() => setModal('new')}
                className="mt-3 flex items-center gap-1.5 px-3 py-1.5 text-sm text-violet-600 border border-violet-200 rounded-lg mx-auto hover:bg-violet-50 transition-colors">
                <Plus className="w-3.5 h-3.5" /> Add your first unit
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50/80 border-b border-stone-100">
                <tr>
                  {['Unit', 'Water Type', 'Tank Volume m³', 'Flow m³/h', 'Break Tank L', 'Filtration', 'Footprint', 'PIM', 'Status', ''].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((u: any) => (
                  <tr key={u.id} className="border-t border-stone-100 hover:bg-violet-50/20 transition-colors">
                    <td className="px-4 py-3">
                      <div>
                        <span className="font-mono text-xs bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded">{u.unit_code}</span>
                        <p className="font-medium text-stone-800 mt-0.5 text-sm leading-tight">{u.unit_name}</p>
                        {u.manufacturer && <p className="text-xs text-stone-400">{u.manufacturer}</p>}
                      </div>
                    </td>
                    <td className="px-4 py-3"><WaterBadge type={u.water_type} /></td>
                    <td className="px-4 py-3 font-mono text-xs text-stone-600">
                      {u.min_tank_volume_m3 != null || u.max_tank_volume_m3 != null
                        ? `${u.min_tank_volume_m3 ?? '?'} – ${u.max_tank_volume_m3 ?? '?'}`
                        : <span className="text-stone-300">—</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-stone-600">
                      {u.design_flow_m3h != null
                        ? <span>{parseFloat(u.design_flow_m3h).toFixed(1)}{u.max_flow_m3h ? ` – ${parseFloat(u.max_flow_m3h).toFixed(1)}` : ''}</span>
                        : <span className="text-stone-300">—</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-stone-600">
                      {u.break_tank_volume_l != null ? parseFloat(u.break_tank_volume_l).toFixed(0) : <span className="text-stone-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-stone-500 max-w-[180px]">
                      {u.includes_filtration || <span className="text-stone-300">—</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-stone-600">
                      {u.footprint_l_mm != null && u.footprint_w_mm != null
                        ? `${u.footprint_l_mm}×${u.footprint_w_mm} mm`
                        : <span className="text-stone-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {u.product_master_id ? (
                        <Link to={`/products/masters/${u.product_master_id}`}
                          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-mono">
                          <Package className="w-3 h-3" />
                          {u.product_code}
                          <ExternalLink className="w-2.5 h-2.5" />
                        </Link>
                      ) : <span className="text-stone-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={u.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button aria-label={`Edit ${u.unit_code}`} onClick={() => setModal(u)}
                          className="text-stone-400 hover:text-violet-600 p-1 rounded hover:bg-violet-50 transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button aria-label={`Delete ${u.unit_code}`} onClick={() => handleDelete(u)} disabled={deleting === u.id}
                          className="text-stone-400 hover:text-red-500 p-1 rounded hover:bg-red-50 transition-colors disabled:opacity-40">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Back */}
      <Link to="/design-book-engine"
        className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-violet-600 transition-colors">
        <ChevronLeft className="w-3.5 h-3.5" /> Back to Design Book Engine
      </Link>
    </div>
  );
}
