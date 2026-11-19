import { useEffect, useMemo, useRef, useState } from 'react';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import {
  ChevronLeft, Plus, Pencil, Trash2, X, Save, Check,
  Waves, ExternalLink, Layers, AlertCircle, Package, Search,
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
  source_bom_id: '', source_bom_code: '', source_bom_revision: '',
  equipment: [] as CompactUnitEquipment[],
};

export type CompactUnitEquipment = {
  id?: string;
  sort_order?: number;
  source_bom_line_id?: string | null;
  source_component_id?: string | null;
  source_product_id?: string | null;
  source_bom_id?: string | null;
  line_number?: number | null;
  component_type?: string | null;
  component_reference_code?: string | null;
  component_name: string;
  quantity: number | string;
  unit?: string | null;
  is_optional?: boolean;
  included?: boolean;
  is_filtration?: boolean;
  size_or_power?: string | null;
  size_or_power_override?: string | null;
  remarks?: string | null;
  is_custom?: boolean;
};

function normalizeEquipmentLine(line: any, index: number): CompactUnitEquipment {
  return {
    ...line,
    sort_order: line.sort_order ?? index,
    component_name: line.component_name || '',
    quantity: line.quantity ?? 1,
    unit: line.unit || 'EA',
    is_optional: Boolean(line.is_optional),
    included: line.included !== false,
    is_filtration: Boolean(line.is_filtration),
    size_or_power: line.size_or_power || null,
    size_or_power_override: line.size_or_power_override || null,
    is_custom: Boolean(line.is_custom),
  };
}

function productSizeOrPower(product: Record<string, any>) {
  if (hasSourceValue(product.standard_size)) return String(product.standard_size);
  const dimensions = [product.length_mm, product.width_mm, product.height_mm]
    .filter(hasSourceValue)
    .map(value => `${value} mm`);
  if (dimensions.length) return dimensions.join(' × ');
  if (hasSourceValue(product.power_kw)) return `${product.power_kw} kW`;
  return null;
}

export function summarizeFiltration(
  equipment: CompactUnitEquipment[] = [],
  legacyText = '',
) {
  const selected = equipment
    .filter(line => line.is_filtration && line.included !== false)
    .map(line => {
      const value = line.size_or_power_override || line.size_or_power;
      return value ? `${line.component_name} (${value})` : line.component_name;
    })
    .filter(Boolean);
  if (selected.length) return selected.join(' + ');
  return equipment.length ? '' : legacyText || '';
}

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

  const equipment = Array.isArray(form.equipment)
    ? form.equipment.map((line: any, index: number) => normalizeEquipmentLine(line, index))
    : undefined;
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
    includes_filtration: summarizeFiltration(equipment || [], form.includes_filtration),
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
    source_bom_id: form.source_bom_id || null,
    source_bom_code: form.source_bom_code || null,
    source_bom_revision: form.source_bom_revision || null,
    ...(equipment === undefined ? {} : { equipment }),
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
    source_bom_id: unit.source_bom_id || '',
    source_bom_code: unit.source_bom_code || '',
    source_bom_revision: unit.source_bom_revision || '',
    equipment: Array.isArray(unit.equipment)
      ? unit.equipment.map(normalizeEquipmentLine)
      : [],
  } : { ...EMPTY_FORM });

  const [saving, setSaving] = useState(false);
  const [pimLoading, setPimLoading] = useState(false);
  const [pimError, setPimError] = useState('');
  const [pimValues, setPimValues] = useState<Record<string, any> | null>(null);
  const [bomLoading, setBomLoading] = useState(false);
  const [bomError, setBomError] = useState('');
  const [bomState, setBomState] = useState<any>(null);
  const [equipmentChooser, setEquipmentChooser] = useState<'menu' | 'component' | 'product' | null>(null);
  const [equipmentSearch, setEquipmentSearch] = useState('');
  const pimRequest = useRef(0);
  const bomRequest = useRef(0);
  const set = (k: string, v: string) => setForm((f: any) => ({ ...f, [k]: v }));
  const setEquipment = (equipment: CompactUnitEquipment[]) =>
    setForm((f: any) => ({ ...f, equipment }));

  const { data: componentData, isFetching: componentsLoading } = useQuery({
    queryKey: ['compact-unit-equipment-components', equipmentSearch],
    queryFn: () => api.get(`/components?search=${encodeURIComponent(equipmentSearch.trim())}&page_size=20`)
      .then(response => response.data),
    enabled: equipmentChooser === 'component' && equipmentSearch.trim().length >= 2,
    staleTime: 60 * 1000,
  });
  const componentChoices = componentData?.items ?? componentData ?? [];
  const productChoices = useMemo(() => {
    const search = equipmentSearch.trim().toLowerCase();
    if (!search) return products.slice(0, 20);
    return products.filter((product: any) =>
      [product.product_code, product.product_name, product.product_category]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(search)),
    ).slice(0, 20);
  }, [equipmentSearch, products]);

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

  const loadBom = async (productMasterId: string, applyValues: boolean) => {
    if (!productMasterId) {
      setBomLoading(false);
      setBomState(null);
      setBomError('');
      return;
    }
    const request = ++bomRequest.current;
    setBomLoading(true);
    setBomError('');
    try {
      const response = await api.get(`/lss-compact-units/bom/${productMasterId}`);
      if (request !== bomRequest.current) return;
      const imported = response.data;
      setBomState(imported);
      if (applyValues && imported.available) {
        setForm((current: any) => ({
          ...current,
          source_bom_id: imported.bom.id || '',
          source_bom_code: imported.bom.bom_code || '',
          source_bom_revision: imported.bom.revision_code || '',
          equipment: imported.lines.map(normalizeEquipmentLine),
        }));
      }
    } catch (err: any) {
      if (request !== bomRequest.current) return;
      setBomState(null);
      setBomError(err?.response?.data?.error?.message || 'Product Master BOM could not be loaded. You can configure equipment manually.');
    } finally {
      if (request === bomRequest.current) setBomLoading(false);
    }
  };

  useEffect(() => {
    if (unit?.product_master_id) void loadBom(unit.product_master_id, false);
    // The saved equipment snapshot is deliberately not refreshed when the
    // modal opens; this request only discovers whether a baseline is available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit?.id]);

  const handleProductMasterChange = (productMasterId: string) => {
    setForm((current: any) => {
      const changesSource = Boolean(unit)
        && String(productMasterId || '') !== String(unit.product_master_id || '');
      if (!changesSource) return { ...current, product_master_id: productMasterId };
      return {
        ...current,
        product_master_id: productMasterId,
        source_bom_id: '',
        source_bom_code: '',
        source_bom_revision: '',
        // Relinking intentionally retains the point-in-time list as manual
        // equipment until the designer explicitly imports the new baseline.
        equipment: (current.equipment || []).map((line: any) => {
          const wasBomImported = Boolean(line.source_bom_line_id || line.source_bom_id);
          return {
            ...line,
            source_bom_line_id: null,
            source_component_id: wasBomImported ? null : line.source_component_id,
            source_product_id: wasBomImported ? null : line.source_product_id,
            source_bom_id: null,
            is_custom: wasBomImported ? true : line.is_custom,
          };
        }),
      };
    });
    setPimValues(null);
    setPimError('');
    setBomState(null);
    setBomError('');
    if (productMasterId) {
      // Editing a saved unit must never replace its overrides as a side
      // effect of changing the link. New units get a convenient first pass.
      void loadPimValues(productMasterId, !unit);
      void loadBom(productMasterId, !unit);
    } else {
      pimRequest.current += 1;
      bomRequest.current += 1;
      setPimLoading(false);
      setBomLoading(false);
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

  const handleApplyBom = async () => {
    if (!bomState?.available) return;
    const productChanged = Boolean(unit)
      && String(form.product_master_id || '') !== String(unit.product_master_id || '');
    if (unit && !productChanged) {
      if (!confirm('Reimport the latest active BOM now? Saved quantities, selections, custom equipment, and size/power overrides will be preserved where possible. Unsaved modal edits will be replaced by the saved snapshot.')) return;
      setBomLoading(true);
      try {
        const response = await api.post(`/lss-compact-units/${unit.id}/reimport-bom`, { confirm: true });
        const imported = response.data;
        setBomState(imported);
        setForm((current: any) => ({
          ...current,
          source_bom_id: imported.bom.id || '',
          source_bom_code: imported.bom.bom_code || '',
          source_bom_revision: imported.bom.revision_code || '',
          equipment: (imported.equipment || []).map(normalizeEquipmentLine),
        }));
        toast.success('Latest BOM imported; saved overrides were preserved');
      } catch (err: any) {
        toast.error(err?.response?.data?.error?.message || 'BOM reimport failed; the unit was not changed');
      } finally {
        setBomLoading(false);
      }
      return;
    }
    if (productChanged && !confirm('Import the selected Product Master BOM as the new baseline? Existing manual equipment will be retained where it does not match the new BOM.')) return;
    setForm((current: any) => ({
      ...current,
      source_bom_id: bomState.bom.id || '',
      source_bom_code: bomState.bom.bom_code || '',
      source_bom_revision: bomState.bom.revision_code || '',
      equipment: (() => {
        const currentLines = (current.equipment || []).map((line: any, currentIndex: number) => ({ line, currentIndex }));
        const countBy = (items: any[], field: string, readLine = (item: any) => item) => {
          const counts = new Map<string, number>();
          items.forEach(item => {
            const value = readLine(item)[field];
            if (!value) return;
            const key = String(value);
            counts.set(key, (counts.get(key) || 0) + 1);
          });
          return counts;
        };
        const sourceCandidates = currentLines.filter(item => item.line.source_bom_line_id);
        const componentCandidates = currentLines.filter(item =>
          item.line.source_bom_line_id && item.line.source_component_id && !item.line.is_custom);
        const productCandidates = currentLines.filter(item =>
          item.line.source_bom_line_id && item.line.source_product_id && !item.line.is_custom);
        const referenceCandidates = currentLines.filter(item =>
          item.line.source_bom_line_id && item.line.component_reference_code && !item.line.is_custom);
        type IndexedEquipment = { line: any; currentIndex: number };
        const bySource = new Map<string, IndexedEquipment>(
          sourceCandidates.map(item => [String(item.line.source_bom_line_id), item]),
        );
        const byComponent = new Map<string, IndexedEquipment>(
          componentCandidates.map(item => [String(item.line.source_component_id), item]),
        );
        const byProduct = new Map<string, IndexedEquipment>(
          productCandidates.map(item => [String(item.line.source_product_id), item]),
        );
        const byReference = new Map<string, IndexedEquipment>(
          referenceCandidates.map(item => [String(item.line.component_reference_code), item]),
        );
        const incomingComponentCounts = countBy(bomState.lines, 'source_component_id');
        const incomingProductCounts = countBy(bomState.lines, 'source_product_id');
        const incomingReferenceCounts = countBy(bomState.lines, 'component_reference_code');
        const currentComponentCounts = countBy(componentCandidates, 'source_component_id', item => item.line);
        const currentProductCounts = countBy(productCandidates, 'source_product_id', item => item.line);
        const currentReferenceCounts = countBy(referenceCandidates, 'component_reference_code', item => item.line);
        const matchedCurrentIndexes = new Set<number>();
        const imported = bomState.lines.map((line: any, index: number) => {
          const oldEntry = bySource.get(String(line.source_bom_line_id || ''))
            || (line.source_component_id
              && incomingComponentCounts.get(String(line.source_component_id)) === 1
              && currentComponentCounts.get(String(line.source_component_id)) === 1
              ? byComponent.get(String(line.source_component_id)) : null)
            || (line.source_product_id
              && incomingProductCounts.get(String(line.source_product_id)) === 1
              && currentProductCounts.get(String(line.source_product_id)) === 1
              ? byProduct.get(String(line.source_product_id)) : null)
            || (line.component_reference_code
              && incomingReferenceCounts.get(String(line.component_reference_code)) === 1
              && currentReferenceCounts.get(String(line.component_reference_code)) === 1
              ? byReference.get(String(line.component_reference_code)) : null);
          if (oldEntry) matchedCurrentIndexes.add(oldEntry.currentIndex);
          const old = oldEntry?.line;
          return normalizeEquipmentLine(old ? {
            ...line,
            included: old.included,
            quantity: old.quantity,
            size_or_power_override: old.size_or_power_override,
            component_name: old.is_custom ? old.component_name : line.component_name,
            remarks: old.remarks || line.remarks,
            is_custom: false,
          } : line, index);
        });
        const retained = currentLines
          .filter(item => !item.line.source_bom_line_id && !matchedCurrentIndexes.has(item.currentIndex))
          .map(item => item.line);
        return [...imported, ...retained].map(normalizeEquipmentLine);
      })(),
    }));
    toast.success('Standard BOM loaded as an independent starting point');
  };

  const updateEquipment = (index: number, changes: Partial<CompactUnitEquipment>) => {
    setEquipment((form.equipment || []).map((line: CompactUnitEquipment, itemIndex: number) =>
      itemIndex === index ? { ...line, ...changes } : line));
  };

  const addEquipmentLine = (line: Partial<CompactUnitEquipment>) => {
    setEquipment([
      ...(form.equipment || []),
      normalizeEquipmentLine(line, (form.equipment || []).length),
    ]);
    setEquipmentChooser(null);
    setEquipmentSearch('');
  };

  const addCustomEquipment = (isFiltration = false) => {
    addEquipmentLine({
      component_name: '',
      component_type: isFiltration ? 'Filtration' : 'Other',
      is_filtration: isFiltration,
      is_custom: true,
    });
  };

  const addPimComponent = (component: any) => {
    addEquipmentLine({
      source_component_id: component.id,
      component_reference_code: component.component_code || '',
      component_name: component.component_name || '',
      component_type: component.component_type || 'Other',
      unit: component.unit || 'EA',
      size_or_power: component.standard_size || null,
      is_custom: false,
    });
  };

  const addPimProduct = (product: any) => {
    addEquipmentLine({
      source_product_id: product.id,
      component_reference_code: product.product_code || '',
      component_name: product.product_name || '',
      component_type: product.product_category || product.application_type || 'Product',
      unit: product.unit || 'EA',
      size_or_power: productSizeOrPower(product),
      is_custom: false,
    });
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
              <div>
                <label htmlFor="compact-unit-uv-power" className="block text-xs font-medium text-stone-500 mb-1">UV Power (W)</label>
                <input id="compact-unit-uv-power" type="number" min="0" value={form.uv_power_w}
                  onChange={e => set('uv_power_w', e.target.value)} className={numCls} />
              </div>
            </div>
          </div>

          {/* BOM / equipment snapshot */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide">Equipment & BOM</p>
                <p className="text-xs text-stone-400 mt-1">
                  {form.source_bom_code
                    ? `PIM baseline ${form.source_bom_code}, Rev ${form.source_bom_revision || '—'} — this copy is independent`
                    : 'Configure a unit-specific equipment list; source Product Master data is never edited here.'}
                </p>
              </div>
              <button type="button" onClick={() => setEquipmentChooser('menu')}
                className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 border border-violet-200 rounded-lg px-2.5 py-1.5 hover:bg-violet-50">
                <Plus className="w-3 h-3" /> Add equipment
              </button>
            </div>
            {equipmentChooser && (
              <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 mb-3" role="dialog" aria-label="Add equipment">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-xs font-semibold text-violet-900">Choose an equipment source</p>
                  <button type="button" aria-label="Close equipment chooser" onClick={() => {
                    setEquipmentChooser(null);
                    setEquipmentSearch('');
                  }} className="p-1 text-stone-400 hover:text-stone-600 rounded">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex gap-2 mb-3">
                  <button type="button" onClick={() => { setEquipmentChooser('component'); setEquipmentSearch(''); }}
                    className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${equipmentChooser === 'component' ? 'border-violet-500 bg-violet-600 text-white' : 'border-violet-200 bg-white text-violet-800 hover:bg-violet-50'}`}>
                    PIM Component
                  </button>
                  <button type="button" onClick={() => { setEquipmentChooser('product'); setEquipmentSearch(''); }}
                    className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${equipmentChooser === 'product' ? 'border-violet-500 bg-violet-600 text-white' : 'border-violet-200 bg-white text-violet-800 hover:bg-violet-50'}`}>
                    PIM Product
                  </button>
                  <button type="button" onClick={() => addCustomEquipment(false)}
                    className="flex-1 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-medium text-violet-800 hover:bg-violet-50">
                    Custom item
                  </button>
                </div>
                {(equipmentChooser === 'component' || equipmentChooser === 'product') && (
                  <div>
                    <label htmlFor="compact-unit-equipment-search" className="sr-only">Search {equipmentChooser === 'component' ? 'PIM components' : 'PIM products'}</label>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-stone-400" />
                      <input id="compact-unit-equipment-search" value={equipmentSearch}
                        onChange={e => setEquipmentSearch(e.target.value)}
                        className={`${inputCls} pl-8`} placeholder={`Search ${equipmentChooser === 'component' ? 'components' : 'products'} by code or name…`} autoFocus />
                    </div>
                    {equipmentChooser === 'component' && equipmentSearch.trim().length < 2 && (
                      <p className="text-[11px] text-stone-500 mt-2">Enter at least 2 characters to search the Component Library.</p>
                    )}
                    {equipmentChooser === 'component' && equipmentSearch.trim().length >= 2 && (
                      <div className="mt-2 max-h-40 overflow-auto rounded-lg border border-stone-200 bg-white divide-y divide-stone-100">
                        {componentsLoading && <p className="px-3 py-2 text-xs text-stone-400">Searching components…</p>}
                        {!componentsLoading && componentChoices.length === 0 && <p className="px-3 py-2 text-xs text-stone-400">No components found.</p>}
                        {!componentsLoading && componentChoices.map((component: any) => (
                          <button type="button" key={component.id} onClick={() => addPimComponent(component)}
                            className="w-full text-left px-3 py-2 hover:bg-violet-50 flex items-center gap-2">
                            <span className="font-mono text-[11px] text-violet-700">{component.component_code}</span>
                            <span className="text-xs text-stone-700 truncate">{component.component_name}</span>
                            {component.component_type && <span className="ml-auto text-[11px] text-stone-400">{component.component_type}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    {equipmentChooser === 'product' && (
                      <div className="mt-2 max-h-40 overflow-auto rounded-lg border border-stone-200 bg-white divide-y divide-stone-100">
                        {productChoices.length === 0 && <p className="px-3 py-2 text-xs text-stone-400">No products found.</p>}
                        {productChoices.map((product: any) => (
                          <button type="button" key={product.id} onClick={() => addPimProduct(product)}
                            className="w-full text-left px-3 py-2 hover:bg-violet-50 flex items-center gap-2">
                            <span className="font-mono text-[11px] text-violet-700">{product.product_code}</span>
                            <span className="text-xs text-stone-700 truncate">{product.product_name}</span>
                            {product.product_category && <span className="ml-auto text-[11px] text-stone-400">{product.product_category}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {form.product_master_id && (
              <div className="rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2 mb-3">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className={bomError ? 'text-amber-700' : 'text-stone-600'}>
                    {bomLoading ? 'Loading applicable Product Master BOM…'
                      : bomError ? bomError
                        : bomState?.available ? `${bomState.lines.length} standard BOM item${bomState.lines.length === 1 ? '' : 's'} available`
                          : bomState?.reason === 'empty_bom' ? 'Product Master BOM is empty. You can configure equipment manually.'
                            : bomState?.reason === 'missing_bom' ? 'No applicable Product Master BOM found. You can configure equipment manually.'
                              : 'Product Master BOM status is unavailable. You can configure equipment manually.'}
                  </span>
                  {!bomLoading && bomState?.available && (
                    <button type="button" onClick={handleApplyBom}
                      className="shrink-0 font-medium text-blue-700 hover:text-blue-900">
                      {form.source_bom_id ? 'Reimport baseline' : 'Import standard BOM'}
                    </button>
                  )}
                </div>
              </div>
            )}
            {!form.product_master_id && (
              <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 mb-3 text-xs text-stone-600">
                No BOM associated yet. Link a Product Master to discover an applicable standard BOM.
              </div>
            )}
            {(form.equipment || []).length === 0 ? (
              <div className="rounded-lg border border-dashed border-stone-200 px-4 py-5 text-center text-xs text-stone-400">
                No equipment configured yet. Add equipment manually or import a Product Master BOM.
              </div>
            ) : (
              <div className="space-y-2">
                {(form.equipment || []).map((line: CompactUnitEquipment, index: number) => (
                  <div key={`${line.id || 'new'}-${index}`} className="rounded-lg border border-stone-200 bg-stone-50/50 p-3">
                    <div className="flex items-start gap-2">
                      <input type="checkbox" aria-label={`Include ${line.component_name || `equipment ${index + 1}`}`}
                        checked={line.included !== false}
                        onChange={e => updateEquipment(index, { included: e.target.checked })}
                        className="mt-2 h-4 w-4 rounded border-stone-300 text-violet-600" />
                      <div className="grid flex-1 grid-cols-1 sm:grid-cols-12 gap-2">
                        <div className="sm:col-span-3">
                          <label className="block text-[11px] font-medium text-stone-500 mb-1">Equipment</label>
                          <input aria-label={`Equipment name ${index + 1}`} value={line.component_name}
                           onChange={e => updateEquipment(index, { component_name: e.target.value })}
                            className={inputCls} placeholder="Equipment name" />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-medium text-stone-500 mb-1">Type</label>
                          <input aria-label={`Equipment type ${index + 1}`} value={line.component_type || ''}
                            onChange={e => updateEquipment(index, { component_type: e.target.value })}
                            className={inputCls} placeholder="Pump, filter…" />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-medium text-stone-500 mb-1">Reference</label>
                          <input aria-label={`Equipment reference ${index + 1}`} value={line.component_reference_code || ''}
                             onChange={e => updateEquipment(index, { component_reference_code: e.target.value })}
                            className={inputCls} placeholder="Part / tag" />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-medium text-stone-500 mb-1">Quantity / unit</label>
                          <div className="flex gap-1">
                            <input aria-label={`Equipment quantity ${index + 1}`} type="number" min="0" step="any" value={line.quantity}
                               onChange={e => updateEquipment(index, { quantity: e.target.value })}
                              className={`${numCls} min-w-0`} />
                            <input aria-label={`Equipment unit ${index + 1}`} value={line.unit || ''}
                               onChange={e => updateEquipment(index, { unit: e.target.value })}
                              className={`${inputCls} w-16 px-2`} placeholder="EA" />
                          </div>
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-medium text-stone-500 mb-1">Size / power</label>
                          <input aria-label={`Equipment size or power ${index + 1}`}
                            value={line.size_or_power_override ?? line.size_or_power ?? ''}
                             onChange={e => updateEquipment(index, { size_or_power_override: e.target.value })}
                            className={inputCls} placeholder={line.size_or_power ? String(line.size_or_power) : 'Not specified'} />
                        </div>
                        <div className="sm:col-span-1 flex items-end justify-end">
                          <button type="button" aria-label={`Remove equipment ${index + 1}`} onClick={() => setEquipment((form.equipment || []).filter((_: any, i: number) => i !== index))}
                            className="p-2 text-stone-400 hover:text-red-600 rounded-lg hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 ml-6 flex items-center gap-4 text-xs">
                      <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">
                        {line.source_bom_line_id ? 'Standard BOM'
                          : line.source_component_id ? 'PIM Component'
                            : line.source_product_id ? 'PIM Product'
                              : 'Custom item'}
                      </span>
                      <label className="inline-flex items-center gap-1.5 text-stone-600">
                        <input type="checkbox" aria-label={`Filtration item ${index + 1}`} checked={Boolean(line.is_filtration)}
                           onChange={e => updateEquipment(index, { is_filtration: e.target.checked })}
                          className="h-3.5 w-3.5 rounded border-stone-300 text-violet-600" />
                        Included filtration
                      </label>
                      {line.is_optional && <span className="text-amber-700">Optional PIM item</span>}
                      {!line.size_or_power && !line.size_or_power_override && <span className="text-stone-400">No size/power specified</span>}
                    </div>
                  </div>
                ))}
                 <button type="button" onClick={() => addCustomEquipment(true)}
                  className="text-xs font-medium text-violet-700 hover:text-violet-900">+ Add filtration item</button>
              </div>
            )}
            {unit?.includes_filtration && !(form.equipment || []).some((line: CompactUnitEquipment) => line.is_filtration) && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <label htmlFor="compact-unit-legacy-filtration" className="block text-xs font-medium text-amber-800 mb-1">Legacy filtration description (editable)</label>
                <input id="compact-unit-legacy-filtration" value={form.includes_filtration}
                  onChange={e => set('includes_filtration', e.target.value)} className={inputCls}
                  aria-describedby="compact-unit-legacy-filtration-help" />
                <p id="compact-unit-legacy-filtration-help" className="text-[11px] text-amber-700 mt-1">This older free-text value is retained until structured filtration items are selected.</p>
              </div>
            )}
            {!!(form.equipment || []).some((line: CompactUnitEquipment) => line.is_filtration && line.included !== false) && (
              <p className="mt-3 text-xs text-stone-500"><span className="font-medium text-stone-700">Filtration summary:</span> {summarizeFiltration(form.equipment)}</p>
            )}
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
    <div>
      <PageHeader crumbs={[{ label: 'Engineering' }, { label: 'LSS Unit Catalog' }]} title="LSS Unit Catalog" subtitle="Packaged life support units: flows, volumes, footprints and PIM links."
        actions={<Button variant="primary" onClick={() => setModal('new')}><Plus className="w-4 h-4" /> Add Unit</Button>} />
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {modal && (
        <UnitModal
          unit={modal === 'new' ? null : modal}
          products={products as any[]}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); refresh(); }}
        />
      )}


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
                      {summarizeFiltration(u.equipment || [], u.includes_filtration)
                        || <span className="text-stone-300">—</span>}
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
    </div>
  );
}
