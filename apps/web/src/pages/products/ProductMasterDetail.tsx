import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import QueryError from '../../components/ui/QueryError';
import MetadataPanel from '../../components/ui/MetadataPanel';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import DataTable, { Column } from '../../components/ui/DataTable';
import { VendorOption, BOMLine, Document } from '../../types';
import { useRecordTitle } from '../../hooks/usePageTitle';
import { useEffect, useState, useRef } from 'react';
import FormulaInput from '../../components/ui/FormulaInput';
import { Network, FileText, FileCheck, FileSearch, Wrench, Award, Upload, Plus, X, Trash2, ArrowRight, ArrowLeft, Link2, Ruler, Box, Zap, Wind, Thermometer, Tag, Pencil, Check, Copy } from 'lucide-react';
import FamilyPickerModal from '../../components/ui/FamilyPickerModal';
import Button from '../../components/ui/Button';
import ActivityLog from '../../components/ui/ActivityLog';
import toast from 'react-hot-toast';
import { useConfirm } from '../../hooks/useConfirm';
import { useAuthStore } from '../../store/authStore';

type Tab = 'bom' | 'variants' | 'vendors' | 'related' | 'drawings' | 'documents' | 'projects' | 'activity';

const DRAWING_TYPE_VALUES = new Set(['Drawing', 'GA Drawing', 'Assembly Drawing', 'Fabrication Drawing', 'As-Built Drawing', '3D Model', 'P&ID', 'Wiring Diagram']);

const DOC_TYPES = [
  { value: 'Technical Data Sheet', label: 'Technical Data Sheet', abbr: 'TDS' },
  { value: 'O&M Manual', label: 'O&M Manual', abbr: 'OMM' },
  { value: 'Installation Manual', label: 'Installation Manual', abbr: 'IM' },
  { value: 'Certificate', label: 'Certificate', abbr: 'CERT' },
  { value: 'Drawing', label: 'Drawing (General)', abbr: 'DWG' },
  { value: 'GA Drawing', label: 'GA Drawing', abbr: 'GA' },
  { value: 'Assembly Drawing', label: 'Assembly Drawing', abbr: 'ASM' },
  { value: 'Fabrication Drawing', label: 'Fabrication Drawing', abbr: 'FAB' },
  { value: 'As-Built Drawing', label: 'As-Built Drawing', abbr: 'ABD' },
  { value: '3D Model', label: '3D Model', abbr: '3DM' },
  { value: 'P&ID', label: 'P&ID', abbr: 'PID' },
  { value: 'Wiring Diagram', label: 'Wiring Diagram', abbr: 'WD' },
  { value: 'Test Report', label: 'Test Report', abbr: 'TR' },
  { value: 'Specification', label: 'Specification', abbr: 'SPEC' },
];

const EDGE_TYPES = [
  { value: 'supersedes', label: 'Supersedes' },
  { value: 'replaced_by', label: 'Replaced By' },
  { value: 'compatible_with', label: 'Compatible With' },
  { value: 'alternate_for', label: 'Alternate For' },
  { value: 'paired_with', label: 'Paired With' },
  { value: 'upgrade_of', label: 'Upgrade Of' },
];

function calcSurfaceAreaMm2(shape: string, l: number, w: number, h: number): number | null {
  if (!(l > 0 && h > 0)) return null;
  const s = shape || 'Rectangular';
  if (s === 'Cylindrical') return Math.PI * (l / 2) ** 2 + Math.PI * l * h;
  if (s === 'Oval') {
    if (!(w > 0)) return null;
    const a = l / 2, b = w / 2;
    const perim = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    return Math.PI * a * b + perim * h;
  }
  if (s === 'Hexagonal') { const side = l / 2; return (3 * Math.sqrt(3) / 2) * side * side + 6 * side * h; }
  if (!(w > 0)) return null;
  return l * w + 2 * l * h + 2 * w * h;
}

function calcEstCostFromRates(shape: string, l: number, w: number, h: number, matCode: string | null, rates: any[]): { cost: number; rate: any } | null {
  const sa = calcSurfaceAreaMm2(shape, l, w, h);
  if (sa == null) return null;
  const sa_m2 = sa / 1e6;
  const matchingRate = rates.find(r => r.material_code === matCode) || rates.find(r => !r.material_code);
  if (!matchingRate) return null;
  return { cost: +(sa_m2 * Number(matchingRate.cost_per_sqm_usd)).toFixed(0), rate: matchingRate };
}

function calculateLampRatedPowerKw(lampCount: unknown, lampPowerW: unknown): number | null {
  if (lampCount === null || lampCount === undefined || String(lampCount).trim() === ''
    || lampPowerW === null || lampPowerW === undefined || String(lampPowerW).trim() === '') return null;
  const count = Number(lampCount);
  const power = Number(lampPowerW);
  return Number.isInteger(count) && count > 0 && Number.isFinite(power) && power > 0
    ? +(count * power / 1000).toFixed(6)
    : null;
}

type ThermalCapacityUnit = 'kW' | 'BTU/h' | 'TON';
const THERMAL_CAPACITY_UNITS: ThermalCapacityUnit[] = ['kW', 'BTU/h', 'TON'];
const THERMAL_KW_PER_BTU_H = 0.00029307107;
const THERMAL_KW_PER_TON = 3.51685284;

function thermalCapacityToKw(value: unknown, unit: ThermalCapacityUnit): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (unit === 'BTU/h') return numeric * THERMAL_KW_PER_BTU_H;
  if (unit === 'TON') return numeric * THERMAL_KW_PER_TON;
  return numeric;
}

function thermalCapacityFromKw(value: unknown, unit: ThermalCapacityUnit): number | null {
  const kw = thermalCapacityToKw(value, 'kW');
  if (kw === null) return null;
  if (unit === 'BTU/h') return +(kw / THERMAL_KW_PER_BTU_H).toFixed(2);
  if (unit === 'TON') return +(kw / THERMAL_KW_PER_TON).toFixed(3);
  return +kw.toFixed(3);
}

const docTypeIcon = (type: string) => {
  switch (type) {
    case 'Technical Data Sheet': return <FileSearch className="w-4 h-4 text-blue-500" />;
    case 'O&M Manual': return <Wrench className="w-4 h-4 text-blue-500" />;
    case 'Installation Manual': return <FileText className="w-4 h-4 text-green-500" />;
    case 'Certificate': return <Award className="w-4 h-4 text-purple-500" />;
    case 'Drawing':
    case 'GA Drawing':
    case 'Assembly Drawing':
    case 'Fabrication Drawing':
    case 'As-Built Drawing': return <Ruler className="w-4 h-4 text-indigo-500" />;
    case '3D Model': return <Box className="w-4 h-4 text-cyan-500" />;
    case 'P&ID': return <Network className="w-4 h-4 text-teal-500" />;
    case 'Wiring Diagram': return <Zap className="w-4 h-4 text-yellow-500" />;
    case 'Test Report': return <FileCheck className="w-4 h-4 text-red-500" />;
    default: return <FileText className="w-4 h-4 text-slate-400" />;
  }
};

const COMPONENT_TYPES = ['Vessel', 'Pump', 'Blower', 'Motor', 'Valve', 'Instrument', 'Pipe', 'Fitting', 'Sensor', 'Controller', 'Frame', 'Other'];
const UNITS = ['EA', 'SET', 'm', 'kg', 'L', 'kW', 'mm', 'pcs'];

export default function ProductMasterDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const { user } = useAuthStore();
  const canGenerateTds = (user?.role === 'admin' || user?.role === 'engineer')
    && user?.moduleAccess?.pim !== 'view'
    && user?.moduleAccess?.pim !== 'hidden'
    && user?.moduleAccess?.documents !== 'view'
    && user?.moduleAccess?.documents !== 'hidden';
  const canManagePim = (user?.role === 'admin' || user?.role === 'engineer')
    && user?.moduleAccess?.pim !== 'view'
    && user?.moduleAccess?.pim !== 'hidden';
  const [tab, setTab] = useState<Tab>('bom');

  const [showDocModal, setShowDocModal] = useState(false);
  const [docModalContext, setDocModalContext] = useState<'documents' | 'drawings'>('documents');
  const [docForm, setDocForm] = useState({ document_type: 'Technical Data Sheet', document_title: '', discipline: '', notes: '' });
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docSubmitting, setDocSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [showImageModal, setShowImageModal] = useState(false);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageInputMode, setImageInputMode] = useState<'url' | 'file'>('file');
  const [imageSubmitting, setImageSubmitting] = useState(false);
  const imageFileRef = useRef<HTMLInputElement>(null);

  const [editingDimensions, setEditingDimensions] = useState(false);
  const [dimensionsForm, setDimensionsForm] = useState<Record<string, any>>({});
  const [dimensionsSaving, setDimensionsSaving] = useState(false);

  const [editingElectrical, setEditingElectrical] = useState(false);
  const [electricalForm, setElectricalForm] = useState<Record<string, any>>({});
  const [electricalSaving, setElectricalSaving] = useState(false);

  const [editingHydraulic, setEditingHydraulic] = useState(false);
  const [hydraulicForm, setHydraulicForm] = useState<Record<string, any>>({});
  const [hydraulicSaving, setHydraulicSaving] = useState(false);
  const [hydraulicFlowResolution, setHydraulicFlowResolution] = useState<'hydraulic' | ''>('');

  const [editingPneumatic, setEditingPneumatic] = useState(false);
  const [pneumaticForm, setPneumaticForm] = useState<Record<string, any>>({});
  const [pneumaticSaving, setPneumaticSaving] = useState(false);

  const [editingThermal, setEditingThermal] = useState(false);
  const [thermalForm, setThermalForm] = useState<Record<string, any>>({});
  const [thermalSaving, setThermalSaving] = useState(false);
  const [thermalDisplayUnit, setThermalDisplayUnit] = useState<ThermalCapacityUnit>('kW');

  const [tankSpecsForm, setTankSpecsForm] = useState({ shape_type: '', length_mm: '', width_mm: '', height_mm: '', design_water_level_mm: '', wall_thickness_mm: '', weight_kg: '' });
  const [tankSpecsSubmitting, setTankSpecsSubmitting] = useState(false);

  const [showFamilyPicker, setShowFamilyPicker] = useState(false);
  const [familySaving, setFamilySaving] = useState(false);

  const [showSynonymsEdit, setShowSynonymsEdit] = useState(false);
  const [synonymInput, setSynonymInput] = useState('');
  const [synonymsSaving, setSynonymsSaving] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [generatingTds, setGeneratingTds] = useState(false);

  const [showRelModal, setShowRelModal] = useState(false);
  const [relSearch, setRelSearch] = useState('');
  const [relTarget, setRelTarget] = useState<{ id: string; product_code: string; product_name: string } | null>(null);
  const [relEdgeType, setRelEdgeType] = useState('supersedes');
  const [relSubmitting, setRelSubmitting] = useState(false);

  const [showVariantModal, setShowVariantModal] = useState(false);
  const [variantSearch, setVariantSearch] = useState('');
  const [variantTarget, setVariantTarget] = useState<{ id: string; product_code: string; product_name: string } | null>(null);
  const [variantSubmitting, setVariantSubmitting] = useState(false);
  const emptyVendorForm = { vendor_option_code: '', vendor_name: '', manufacturer_name: '', vendor_item_code: '', approved_status: 'Approved', lead_time_days: '', region_scope: '', unit_price: '', currency: 'USD' };
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [vendorForm, setVendorForm] = useState(emptyVendorForm);
  const [vendorSaving, setVendorSaving] = useState(false);

  const [showAddLine, setShowAddLine] = useState(false);
  const [lineSourceType, setLineSourceType] = useState<'component' | 'product'>('component');
  const [lineForm, setLineForm] = useState({ component_type: 'Vessel', component_name: '', component_reference_code: '', quantity: '1', unit: 'EA', is_optional: false, remarks: '' });
  const [lineSubmitting, setLineSubmitting] = useState(false);
  const [creatingBom, setCreatingBom] = useState(false);
  const [compSearch, setCompSearch] = useState('');
  const [selectedComp, setSelectedComp] = useState<{ id: string; component_code: string; component_name: string } | null>(null);
  const [prodSearch, setProdSearch] = useState('');
  const [selectedProd, setSelectedProd] = useState<{ id: string; product_code: string; product_name: string } | null>(null);

  const { data: product, isLoading, isError, refetch } = useQuery({
    queryKey: ['product-master', id],
    queryFn: () => api.get(`/product-masters/${id}`).then(r => r.data),
  });
  useRecordTitle(product?.product_name);

  const { data: relationships } = useQuery({
    queryKey: ['product-relationships', id],
    queryFn: () => api.get(`/product-masters/${id}/relationships`).then(r => r.data),
    enabled: tab === 'related',
  });

  const { data: peerVariants, refetch: refetchPeerVariants } = useQuery({
    queryKey: ['product-peer-variants', id],
    queryFn: () => api.get(`/product-masters/${id}/relationships`).then(r => ({
      items: (r.data.items || []).filter((rel: any) => rel.edge_type === 'variant')
    })),
    enabled: tab === 'variants',
  });

  const { data: variantSearchResults } = useQuery({
    queryKey: ['product-variant-search', variantSearch],
    queryFn: () => api.get(`/product-masters?q=${variantSearch}&page_size=8`).then(r => r.data),
    enabled: variantSearch.length >= 2 && !variantTarget,
  });

  const { data: bomDetail } = useQuery({
    queryKey: ['bom-detail', product?.boms?.[0]?.id],
    queryFn: () => api.get(`/product-boms/${product.boms[0].id}`).then(r => r.data),
    enabled: !!product?.boms?.[0]?.id,
  });

  const { data: relSearchResults } = useQuery({
    queryKey: ['product-search', relSearch],
    queryFn: () => api.get(`/product-masters?q=${relSearch}&page_size=8`).then(r => r.data),
    enabled: relSearch.length >= 2,
  });

  const { data: compSearchResults } = useQuery({
    queryKey: ['comp-search', compSearch],
    queryFn: () => api.get(`/components?search=${compSearch}&page_size=8`).then(r => r.data),
    enabled: compSearch.length >= 2,
  });

  const { data: prodBomSearchResults } = useQuery({
    queryKey: ['prod-bom-search', prodSearch],
    queryFn: () => api.get(`/product-masters?q=${prodSearch}&page_size=8`).then(r => r.data),
    enabled: prodSearch.length >= 2 && lineSourceType === 'product' && !selectedProd,
  });

  const { data: dimensionsData, refetch: refetchDimensions } = useQuery({
    queryKey: ['product-dimensions', id],
    queryFn: () => api.get(`/product-masters/${id}/dimensions`).then(r => r.data),
    enabled: !!product,
  });

  const { data: costRatesData } = useQuery({
    queryKey: ['tank-cost-rates'],
    queryFn: () => api.get('/admin/tank-cost-rates').then(r => r.data),
    staleTime: 120000,
  });
  const tankCostRates: any[] = costRatesData?.items || [];

  const { data: electricalData, refetch: refetchElectrical } = useQuery({
    queryKey: ['product-electrical', id],
    queryFn: () => api.get(`/product-masters/${id}/electrical`).then(r => r.data),
    enabled: !!product,
  });

  const { data: hydraulicData, refetch: refetchHydraulic } = useQuery({
    queryKey: ['product-hydraulic', id],
    queryFn: () => api.get(`/product-masters/${id}/hydraulic`).then(r => r.data),
    enabled: !!product,
  });

  const { data: pneumaticData, refetch: refetchPneumatic } = useQuery({
    queryKey: ['product-pneumatic', id],
    queryFn: () => api.get(`/product-masters/${id}/pneumatic`).then(r => r.data),
    enabled: String(product?.product_category || '').toLowerCase() === 'pneumatic',
  });

  const { data: thermalData, refetch: refetchThermal } = useQuery({
    queryKey: ['product-thermal', id],
    queryFn: () => api.get(`/product-masters/${id}/thermal`).then(r => r.data),
    enabled: String(product?.product_category || '').toLowerCase() === 'thermal',
  });

  useEffect(() => {
    if (THERMAL_CAPACITY_UNITS.includes(thermalData?.thermal_capacity_unit)) {
      setThermalDisplayUnit(thermalData.thermal_capacity_unit);
    }
  }, [thermalData?.thermal_capacity_unit]);

  const { data: materialsData } = useQuery({
    queryKey: ['materials-list'],
    queryFn: () => api.get('/materials').then(r => r.data),
  });

  const { data: tankFamiliesData } = useQuery({
    queryKey: ['tank-families'],
    queryFn: () => api.get('/tank-families').then(r => r.data),
    enabled: true,
  });
  const tankFamilies: any[] = tankFamiliesData?.items || [];

  const productPutPayload = (overrides: Record<string, any>) => ({
    product_name: product.product_name,
    product_category: product.product_category,
    application_type: product.application_type,
    design_flow_m3h: product.design_flow_m3h,
    design_head_m: product.design_head_m,
    power_kw: product.power_kw,
    primary_material_code: product.primary_material_code,
    standard_status: product.standard_status,
    image_url: product.image_url,
    notes: product.notes,
    product_description: (product as any).product_description ?? null,
    tank_classification: (product as any).tank_classification ?? null,
    tank_engineering_details: (product as any).tank_engineering_details || {},
    shape_type: product.shape_type,
    length_mm: product.length_mm,
    width_mm: product.width_mm,
    height_mm: product.height_mm,
    design_water_level_mm: product.design_water_level_mm,
    gross_volume_m3: product.gross_volume_m3,
    operating_volume_m3: product.operating_volume_m3,
    wall_thickness_mm: product.wall_thickness_mm,
    weight_kg: product.weight_kg,
    product_family_id: product.product_family_id,
    tank_family_id: product.tank_family_id,
    synonyms: product.synonyms || [],
    manufacturer: (product as any).manufacturer || null,
    model: (product as any).model || null,
    configuration: (product as any).configuration || null,
    control_type: (product as any).control_type || null,
    signal_type: (product as any).signal_type || null,
    control_type_optional: Boolean((product as any).control_type_optional),
    ozone_production_capacity_g_h: (product as any).ozone_production_capacity_g_h ?? null,
    cost: (product as any).cost ?? null,
    sell_price: (product as any).sell_price ?? null,
    currency: (product as any).currency || 'USD',
    ...overrides,
  });

  const startEdit = () => {
    setEditForm({
      product_code: product.product_code || '',
      product_name: product.product_name || '',
      standard_status: product.standard_status || 'Concept',
      application_type: product.application_type || '',
      configuration: product.configuration || '',
      control_type: product.control_type || '',
      signal_type: product.signal_type || '',
      control_type_optional: Boolean(product.control_type_optional),
      primary_material_code: product.primary_material_code || '',
      notes: product.notes || '',
      product_description: (product as any).product_description || '',
      tank_classification: (product as any).tank_classification || '',
      tank_engineering_details: {
        construction_type: (product as any).tank_engineering_details?.construction_type || '',
        fabrication_method: (product as any).tank_engineering_details?.fabrication_method || '',
        service_medium: (product as any).tank_engineering_details?.service_medium || '',
        operating_temperature_min_c: (product as any).tank_engineering_details?.operating_temperature_min_c ?? '',
        operating_temperature_max_c: (product as any).tank_engineering_details?.operating_temperature_max_c ?? '',
        max_operating_pressure_bar: (product as any).tank_engineering_details?.max_operating_pressure_bar ?? '',
        max_possible_pressure_bar: (product as any).tank_engineering_details?.max_possible_pressure_bar ?? '',
        vacuum_condition: (product as any).tank_engineering_details?.vacuum_condition || '',
        service_pressure_mode: (product as any).tank_engineering_details?.service_pressure_mode || '',
        proposed_design_standard: (product as any).tank_engineering_details?.proposed_design_standard || '',
        required_astm_tests: (product as any).tank_engineering_details?.required_astm_tests || '',
        certification_inspection_requirements: (product as any).tank_engineering_details?.certification_inspection_requirements || '',
      },
      tank_family_id: (product as any).tank_family_id || '',
      cost: (product as any).cost != null ? String((product as any).cost) : '',
      sell_price: (product as any).sell_price != null ? String((product as any).sell_price) : '',
      currency: (product as any).currency || 'USD',
      manufacturer: (product as any).manufacturer || '',
      model: (product as any).model || '',
      ozone_production_capacity_g_h: (product as any).ozone_production_capacity_g_h != null ? String((product as any).ozone_production_capacity_g_h) : '',
    });
    setEditing(true);
  };

  const handleSave = async () => {
    if (!editForm.product_code?.trim()) { toast.error('Product code is required'); return; }
    if (isTank) {
      const details = editForm.tank_engineering_details || {};
      const has = (value: any) => value !== '' && value != null;
      if (has(details.operating_temperature_min_c) && has(details.operating_temperature_max_c) &&
          Number(details.operating_temperature_min_c) > Number(details.operating_temperature_max_c)) {
        toast.error('Minimum operating temperature cannot exceed maximum operating temperature'); return;
      }
      if (has(details.max_operating_pressure_bar) && has(details.max_possible_pressure_bar) &&
          Number(details.max_operating_pressure_bar) > Number(details.max_possible_pressure_bar)) {
        toast.error('Maximum operating pressure cannot exceed maximum possible pressure'); return;
      }
    }
    setSaving(true);
    try {
      const { data: updated } = await api.put(`/product-masters/${id}`, productPutPayload({
        product_code: editForm.product_code.trim().toUpperCase(),
        product_name: editForm.product_name,
        standard_status: editForm.standard_status,
        application_type: editForm.application_type || null,
        primary_material_code: editForm.primary_material_code || null,
        configuration: isUvProduct ? editForm.configuration || null : product.configuration || null,
        control_type: isUvProduct ? editForm.control_type || null : product.control_type || null,
        signal_type: isUvProduct ? editForm.signal_type || null : product.signal_type || null,
        control_type_optional: isUvProduct ? Boolean(editForm.control_type_optional) : Boolean(product.control_type_optional),
        notes: editForm.notes || null,
        product_description: isTank ? editForm.product_description || null : (product as any).product_description || null,
        tank_classification: isTank ? editForm.tank_classification || null : (product as any).tank_classification || null,
        tank_engineering_details: isTank ? Object.fromEntries(Object.entries(editForm.tank_engineering_details || {}).map(([key, value]) => {
          const numeric = ['operating_temperature_min_c', 'operating_temperature_max_c', 'max_operating_pressure_bar', 'max_possible_pressure_bar'].includes(key);
          return [key, value === '' ? null : numeric ? Number(value) : value];
        })) : (product as any).tank_engineering_details || {},
        tank_family_id: editForm.tank_family_id || null,
        cost: editForm.cost !== '' ? parseFloat(editForm.cost) : null,
        sell_price: editForm.sell_price !== '' ? parseFloat(editForm.sell_price) : null,
        currency: editForm.currency || 'USD',
        manufacturer: editForm.manufacturer || null,
        model: editForm.model || null,
        ozone_production_capacity_g_h: editForm.ozone_production_capacity_g_h === '' ? null : Number(editForm.ozone_production_capacity_g_h),
      }));
      toast.success('Product updated');
      setEditing(false);
      if (updated) queryClient.setQueryData(['product-master', id], (old: any) => ({ ...old, ...updated }));
      queryClient.invalidateQueries({ queryKey: ['product-master', id] });
      queryClient.invalidateQueries({ queryKey: ['product-masters'] });
      queryClient.invalidateQueries({ queryKey: ['product-hydraulic', id] });
      queryClient.invalidateQueries({ queryKey: ['pump-selections'] });
    } catch {
      toast.error('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async () => {
    if (duplicating) return;
    setDuplicating(true);
    try {
      const { data: duplicate } = await api.post(`/product-masters/${id}/duplicate`, {});
      toast.success(`Product duplicated as ${duplicate.product_code}`);
      queryClient.invalidateQueries({ queryKey: ['product-masters'] });
      queryClient.invalidateQueries({ queryKey: ['product-masters-tanks'] });
      queryClient.invalidateQueries({ queryKey: ['product-masters-piping'] });
      navigate(`/products/masters/${duplicate.id}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || 'Duplicate failed');
    } finally {
      setDuplicating(false);
    }
  };

  const handleGenerateTds = async () => {
    if (generatingTds) return;
    const generatedTds = (product.documents || []).find((document: any) => document.generated_source === 'pim_tds');
    const ok = await confirm({
      title: generatedTds ? 'Regenerate Technical Data Sheet' : 'Generate Technical Data Sheet',
      message: generatedTds
        ? 'Refresh the editable TDS draft with the product’s current PIM data? Approved and released revisions will remain unchanged.'
        : 'Create a draft Technical Data Sheet from all currently available PIM product data?',
      confirmLabel: generatedTds ? 'Regenerate TDS' : 'Generate TDS',
    });
    if (!ok) return;
    setGeneratingTds(true);
    try {
      const { data } = await api.post(`/product-masters/${id}/generate-tds`);
      const action = data.generation?.action;
      toast.success(action === 'created' ? 'Technical Data Sheet generated' : 'Technical Data Sheet draft updated');
      if (data.generation?.warnings?.length) {
        toast(data.generation.warnings[0], { duration: 6000 });
      }
      queryClient.invalidateQueries({ queryKey: ['product-master', id] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      navigate(`/documents/${data.document.id}`);
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Could not generate the Technical Data Sheet');
    } finally {
      setGeneratingTds(false);
    }
  };

  const handleFamilySelect = async (fam: { id: string; code: string; name: string }) => {
    setFamilySaving(true);
    setShowFamilyPicker(false);
    try {
      await api.put(`/product-masters/${id}`, productPutPayload({ product_family_id: fam.id || null }));
      toast.success(fam.id ? `Family changed to ${fam.name}` : 'Family cleared');
      queryClient.invalidateQueries({ queryKey: ['product-master', id] });
    } catch {
      toast.error('Failed to update family');
    } finally {
      setFamilySaving(false); }
  };

  const addSynonym = async (raw: string) => {
    const terms = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (!terms.length) return;
    setSynonymsSaving(true);
    setSynonymInput('');
    try {
      const current: string[] = product.synonyms || [];
      const updated = [...new Set([...current, ...terms])];
      await api.put(`/product-masters/${id}`, productPutPayload({ synonyms: updated }));
      queryClient.invalidateQueries({ queryKey: ['product-master', id] });
    } catch { toast.error('Failed to save synonym'); }
    finally { setSynonymsSaving(false); }
  };

  const removeSynonym = async (term: string) => {
    setSynonymsSaving(true);
    try {
      const updated = (product.synonyms || []).filter((s: string) => s !== term);
      await api.put(`/product-masters/${id}`, productPutPayload({ synonyms: updated }));
      queryClient.invalidateQueries({ queryKey: ['product-master', id] });
    } catch { toast.error('Failed to remove synonym'); }
    finally { setSynonymsSaving(false); }
  };

  const handleSaveImage = async () => {
    setImageSubmitting(true);
    try {
      if (imageInputMode === 'file' && imageFile) {
        const form = new FormData();
        form.append('image', imageFile);
        await api.post(`/product-masters/${id}/image`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      } else {
        await api.put(`/product-masters/${id}`, productPutPayload({ image_url: imageUrlInput || null }));
      }
      toast.success('Image updated');
      setShowImageModal(false);
      setImageFile(null);
      setImageUrlInput('');
      queryClient.invalidateQueries({ queryKey: ['product-master', id] });
    } catch {
      toast.error('Failed to update image');
    } finally {
      setImageSubmitting(false);
    }
  };

  const handleSaveDimensions = async () => {
    const rawDiameter = dimensionsForm.diameter_mm;
    if (rawDiameter !== null && rawDiameter !== undefined && String(rawDiameter).trim() !== '') {
      const diameter = Number(rawDiameter);
      if (!Number.isFinite(diameter) || diameter < 0) {
        toast.error('Diameter must be a finite, non-negative value');
        return;
      }
    }
    const rawSandMediaPerFilter = dimensionsForm.sand_media_per_filter_kg;
    if (rawSandMediaPerFilter !== null && rawSandMediaPerFilter !== undefined && String(rawSandMediaPerFilter).trim() !== '') {
      const sandMediaPerFilter = Number(rawSandMediaPerFilter);
      if (!Number.isFinite(sandMediaPerFilter) || sandMediaPerFilter < 0) {
        toast.error('Sand/media per filter must be a finite, non-negative value');
        return;
      }
    }
    setDimensionsSaving(true);
    try {
      await api.put(`/product-masters/${id}/dimensions`, dimensionsForm);
      toast.success('Dimensions saved');
      setEditingDimensions(false);
      refetchDimensions();
    } catch { toast.error('Failed to save dimensions'); }
    finally { setDimensionsSaving(false); }
  };

  const handleSaveElectrical = async () => {
    const rawLampCount = isUvProduct ? electricalForm.lamp_count : undefined;
    if (isUvProduct && rawLampCount !== null && rawLampCount !== undefined && String(rawLampCount).trim() !== '') {
      const lampCount = Number(rawLampCount);
      if (!Number.isInteger(lampCount) || lampCount <= 0) {
        toast.error('Lamp Count must be a positive whole number');
        return;
      }
    }
    const rawLampPower = isUvProduct ? electricalForm.lamp_power_w : undefined;
    if (isUvProduct && rawLampPower !== null && rawLampPower !== undefined && String(rawLampPower).trim() !== '') {
      const lampPower = Number(rawLampPower);
      if (!Number.isFinite(lampPower) || lampPower <= 0) {
        toast.error('Lamp Power must be greater than zero');
        return;
      }
    }
    setElectricalSaving(true);
    try {
      const electricalPayload = { ...electricalForm };
      if (isUvProduct) {
        delete electricalPayload.rated_power_kw;
        electricalPayload.lamp_count = String(rawLampCount ?? '').trim() === '' ? null : Number(rawLampCount);
        electricalPayload.lamp_power_w = String(rawLampPower ?? '').trim() === '' ? null : Number(rawLampPower);
      }
      await api.put(`/product-masters/${id}/electrical`, {
        ...electricalPayload,
      });
      toast.success('Electrical data saved');
      setEditingElectrical(false);
      refetchElectrical();
      queryClient.invalidateQueries({ queryKey: ['product-master', id] });
      queryClient.invalidateQueries({ queryKey: ['uv-engineering'] });
    } catch { toast.error('Failed to save electrical data'); }
    finally { setElectricalSaving(false); }
  };

  const handleSaveHydraulic = async () => {
    for (const [key, label] of [
      ['suction_dn_mm', 'Suction DN'],
      ['discharge_dn_mm', 'Discharge DN'],
    ] as const) {
      const raw = hydraulicForm[key];
      if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
        const value = Number(raw);
        if (!Number.isFinite(value) || value <= 0) {
          toast.error(`${label} must be a positive number`);
          return;
        }
      }
    }
    const rawVenturiFlow = hydraulicForm.venturi_flow_m3h;
    if (rawVenturiFlow !== null && rawVenturiFlow !== undefined && String(rawVenturiFlow).trim() !== '') {
      const venturiFlow = Number(rawVenturiFlow);
      if (!Number.isFinite(venturiFlow) || venturiFlow < 0) {
        toast.error('Venturi flow must be a finite, non-negative value');
        return;
      }
    }
    const rawFrictionLoss = hydraulicForm.friction_loss_mh2o;
    if (rawFrictionLoss !== null && rawFrictionLoss !== undefined && String(rawFrictionLoss).trim() !== '') {
      const frictionLoss = Number(rawFrictionLoss);
      if (!Number.isFinite(frictionLoss) || frictionLoss < 0) {
        toast.error('Friction loss must be a finite, non-negative value');
        return;
      }
    }
    if (hydraulicData?.design_flow_sync_status === 'conflict' && hydraulicFlowResolution !== 'hydraulic') {
      toast.error('Choose which stored Design Flow to keep before saving');
      return;
    }
    setHydraulicSaving(true);
    try {
      const { data: updatedHydraulic } = await api.put(`/product-masters/${id}/hydraulic`, {
        ...hydraulicForm,
        design_flow_conflict_resolution: hydraulicFlowResolution || undefined,
        venturi_flow_m3h: rawVenturiFlow === null || rawVenturiFlow === undefined || String(rawVenturiFlow).trim() === ''
          ? null
          : Number(rawVenturiFlow),
        friction_loss_mh2o: rawFrictionLoss === null || rawFrictionLoss === undefined || String(rawFrictionLoss).trim() === ''
          ? null
          : Number(rawFrictionLoss),
      });
      toast.success('Hydraulic data saved');
      setEditingHydraulic(false);
      if (updatedHydraulic) {
        queryClient.setQueryData(['product-hydraulic', id], updatedHydraulic);
        queryClient.setQueryData(['product-master', id], (old: any) => ({
          ...old,
          design_flow_m3h: updatedHydraulic.design_flow_m3h,
          design_flow_sync_status: updatedHydraulic.design_flow_sync_status,
        }));
      }
      refetchHydraulic();
      queryClient.invalidateQueries({ queryKey: ['product-master', id] });
      queryClient.invalidateQueries({ queryKey: ['product-masters'] });
      queryClient.invalidateQueries({ queryKey: ['pump-selections'] });
    } catch { toast.error('Failed to save hydraulic data'); }
    finally { setHydraulicSaving(false); }
  };

  const handleSavePneumatic = async () => {
    if (pneumaticSaving) return;
    const fields = [
      ['gas_flow_value', 'gas_flow_unit', 'Gas flow', false],
      ['operating_temperature_value', 'operating_temperature_unit', 'Operating temperature', true],
      ['dew_point_value', 'dew_point_unit', 'Dew point', true],
      ['inlet_port_value', 'inlet_port_unit', 'Inlet port', false],
      ['outlet_port_value', 'outlet_port_unit', 'Outlet port', false],
    ] as const;
    for (const [valueKey, unitKey, label, allowNegative] of fields) {
      const rawValue = pneumaticForm[valueKey];
      const hasValue = rawValue !== null && rawValue !== undefined && String(rawValue).trim() !== '';
      const hasUnit = pneumaticForm[unitKey] !== null && pneumaticForm[unitKey] !== undefined && String(pneumaticForm[unitKey]).trim() !== '';
      if (!hasValue) {
        if (hasUnit) { toast.error(`${label} unit cannot be set without a value`); return; }
        continue;
      }
      const numeric = Number(rawValue);
      if (!Number.isFinite(numeric) || (!allowNegative && numeric < 0)) {
        toast.error(`${label} must be a finite, ${allowNegative ? '' : 'non-negative '}number`);
        return;
      }
      if (!hasUnit) { toast.error(`${label} requires a unit`); return; }
    }
    setPneumaticSaving(true);
    try {
      const payload = { ...pneumaticForm };
      for (const [valueKey] of fields) {
        payload[valueKey] = payload[valueKey] === null || payload[valueKey] === undefined || String(payload[valueKey]).trim() === ''
          ? null
          : Number(payload[valueKey]);
      }
      for (const [, unitKey] of fields) {
        payload[unitKey] = payload[unitKey] === null || payload[unitKey] === undefined || String(payload[unitKey]).trim() === ''
          ? null
          : String(payload[unitKey]).trim();
      }
      const { data: saved } = await api.put(`/product-masters/${id}/pneumatic`, payload);
      if (!saved || typeof saved !== 'object') {
        throw new Error('The server did not return the saved pneumatic specifications');
      }
      queryClient.setQueryData(['product-pneumatic', id], saved);
      toast.success('Pneumatic specifications saved');
      setEditingPneumatic(false);
      refetchPneumatic();
    } catch (error: any) {
      const message = error?.response?.data?.error?.message
        || (error?.code === 'ECONNABORTED'
          ? 'Saving pneumatic specifications timed out. Check your connection and try again.'
          : error?.message === 'Network Error'
            ? 'Could not reach the server. Check your connection and try again.'
            : error?.message);
      toast.error(message || 'Failed to save pneumatic specifications');
    } finally {
      setPneumaticSaving(false);
    }
  };

  const handleSaveThermal = async () => {
    if (thermalSaving) return;
    const capacityUnit: ThermalCapacityUnit = THERMAL_CAPACITY_UNITS.includes(thermalForm.thermal_capacity_unit)
      ? thermalForm.thermal_capacity_unit
      : 'kW';
    const nonNegativeFields = [
      ['thermal_capacity_kw', 'Thermal capacity'],
      ['flow_rate_m3h', 'Flow rate'],
      ['pressure_rating_bar', 'Pressure rating'],
    ] as const;
    const positiveFields = [
      ['primary_inlet_dn_mm', 'Primary-side inlet DN'],
      ['primary_outlet_dn_mm', 'Primary-side outlet DN'],
      ['secondary_inlet_dn_mm', 'Secondary-side inlet DN'],
      ['secondary_outlet_dn_mm', 'Secondary-side outlet DN'],
    ] as const;
    const temperatureFields = [
      ['operating_temperature_min_c', 'Minimum operating temperature'],
      ['operating_temperature_max_c', 'Maximum operating temperature'],
      ['design_temperature_c', 'Design temperature'],
    ] as const;
    const hasValue = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== '';
    for (const [key, label] of nonNegativeFields) {
      if (hasValue(thermalForm[key]) && (!Number.isFinite(Number(thermalForm[key])) || Number(thermalForm[key]) < 0)) {
        toast.error(`${label} must be a finite, non-negative number`);
        return;
      }
    }
    for (const [key, label] of positiveFields) {
      if (hasValue(thermalForm[key]) && (!Number.isFinite(Number(thermalForm[key])) || Number(thermalForm[key]) <= 0)) {
        toast.error(`${label} must be a positive number`);
        return;
      }
    }
    for (const [key, label] of temperatureFields) {
      if (hasValue(thermalForm[key]) && !Number.isFinite(Number(thermalForm[key]))) {
        toast.error(`${label} must be a finite number`);
        return;
      }
    }
    if (hasValue(thermalForm.efficiency_pct)
      && (!Number.isFinite(Number(thermalForm.efficiency_pct))
        || Number(thermalForm.efficiency_pct) < 0
        || Number(thermalForm.efficiency_pct) > 100)) {
      toast.error('Efficiency must be between 0 and 100 percent');
      return;
    }
    if (hasValue(thermalForm.operating_temperature_min_c)
      && hasValue(thermalForm.operating_temperature_max_c)
      && Number(thermalForm.operating_temperature_min_c) > Number(thermalForm.operating_temperature_max_c)) {
      toast.error('Minimum operating temperature cannot exceed maximum operating temperature');
      return;
    }

    setThermalSaving(true);
    try {
      const numericFields = [...nonNegativeFields, ...positiveFields, ...temperatureFields, ['efficiency_pct', 'Efficiency'] as const];
      const payload = { ...thermalForm };
      for (const [key] of numericFields) {
        payload[key] = hasValue(payload[key]) ? Number(payload[key]) : null;
      }
      payload.thermal_capacity_kw = thermalCapacityToKw(payload.thermal_capacity_kw, capacityUnit);
      payload.thermal_capacity_unit = capacityUnit;
      for (const key of ['thermal_duty', 'fluid_type', 'flow_switch_status', 'notes']) {
        payload[key] = hasValue(payload[key]) ? String(payload[key]).trim() : null;
      }
      const { data: saved } = await api.put(`/product-masters/${id}/thermal`, payload);
      if (!saved || typeof saved !== 'object') {
        throw new Error('The server did not return the saved thermal specifications');
      }
      queryClient.setQueryData(['product-thermal', id], saved);
      setThermalDisplayUnit(capacityUnit);
      toast.success('Thermal specifications saved');
      setEditingThermal(false);
      refetchThermal();
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || error?.message || 'Failed to save thermal specifications');
    } finally {
      setThermalSaving(false);
    }
  };

  const calcTankShapeVolumes = (shape: string, L: number|null, W: number|null, H: number|null, WL: number|null) => {
    const s = shape || 'Rectangular';
    let grossV: number|null = null, opV: number|null = null;
    if (s === 'Cylindrical') {
      if (L && L > 0 && H && H > 0) grossV = Math.PI * (L/2)**2 * H;
      if (L && L > 0 && WL && WL > 0) opV = Math.PI * (L/2)**2 * WL;
    } else if (s === 'Oval') {
      if (L && W && L > 0 && W > 0 && H && H > 0) grossV = Math.PI * (L/2) * (W/2) * H;
      if (L && W && L > 0 && W > 0 && WL && WL > 0) opV = Math.PI * (L/2) * (W/2) * WL;
    } else if (s === 'Hexagonal') {
      const hexArea = (side: number) => (3 * Math.sqrt(3) / 2) * side * side;
      if (L && L > 0 && H && H > 0) grossV = hexArea(L/2) * H;
      if (L && L > 0 && WL && WL > 0) opV = hexArea(L/2) * WL;
    } else {
      if (L && W && L > 0 && W > 0 && H && H > 0) grossV = L * W * H;
      if (L && W && L > 0 && W > 0 && WL && WL > 0) opV = L * W * WL;
    }
    return {
      gross: grossV != null ? +(grossV / 1e9).toFixed(6) : null,
      op: opV != null ? +(opV / 1e9).toFixed(6) : null,
    };
  };

  const handleSaveTankSpecs = async () => {
    setTankSpecsSubmitting(true);
    try {
      const L = tankSpecsForm.length_mm ? Number(tankSpecsForm.length_mm) : null;
      const W = tankSpecsForm.width_mm ? Number(tankSpecsForm.width_mm) : null;
      const H = tankSpecsForm.height_mm ? Number(tankSpecsForm.height_mm) : null;
      const WL = tankSpecsForm.design_water_level_mm ? Number(tankSpecsForm.design_water_level_mm) : null;
      const { gross: grossCalc, op: opCalc } = calcTankShapeVolumes(tankSpecsForm.shape_type, L, W, H, WL);
      await api.put(`/product-masters/${id}`, productPutPayload({
        shape_type: tankSpecsForm.shape_type || null,
        length_mm: L, width_mm: W, height_mm: H, design_water_level_mm: WL,
        gross_volume_m3: grossCalc,
        operating_volume_m3: opCalc,
        wall_thickness_mm: tankSpecsForm.wall_thickness_mm ? Number(tankSpecsForm.wall_thickness_mm) : null,
        weight_kg: tankSpecsForm.weight_kg ? Number(tankSpecsForm.weight_kg) : null,
      }));
      toast.success('Tank dimensions saved');
      setEditingDimensions(false);
      queryClient.invalidateQueries({ queryKey: ['product-master', id] });
    } catch {
      toast.error('Failed to save tank dimensions');
    } finally {
      setTankSpecsSubmitting(false);
    }
  };

  if (isLoading) return <div className="p-8 text-slate-400">Loading...</div>;
  if (isError) return <QueryError message="Could not load product" onRetry={() => refetch()} />;
  if (!product) return <div className="p-8 text-slate-400">Product not found</div>;

  const isPiping = product.product_category === 'Piping';
  const isTank = product.product_category === 'Tank';
  const isPneumatic = String(product.product_category || '').toLowerCase() === 'pneumatic';
  const isThermal = String(product.product_category || '').toLowerCase() === 'thermal';
  const isOzoneGenerator = String(product.product_category || '').trim().toLowerCase() === 'ozone generators';
  const productFamilyCode = String(product.product_family_code || '').trim().toUpperCase();
  const productCode = String(product.product_code || '').trim().toUpperCase();
  const isUvProduct = productFamilyCode === 'PFM-UV'
    || productCode.includes('UV')
    || String(product.product_category || '').trim().toLowerCase() === 'disinfection';
  const bom = product.boms?.[0];
  const bomLines: BOMLine[] = bomDetail?.lines || bom?.lines || [];
  const documents: Document[] = product.documents || [];
  const drawings = documents.filter(d => DRAWING_TYPE_VALUES.has(d.document_type));
  const nonDrawingDocs = documents.filter(d => !DRAWING_TYPE_VALUES.has(d.document_type));
  const rels = relationships?.items || [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['product-master', id] });
    queryClient.invalidateQueries({ queryKey: ['bom-detail'] });
  };

  const handleCreateBom = async () => {
    setCreatingBom(true);
    try {
      const bomCode = `BOM-${product.product_code}-A`;
      await api.post('/product-boms', { bom_code: bomCode, product_master_id: product.id, revision_code: 'A' });
      toast.success('BOM created');
      invalidate();
    } catch {
      toast.error('Failed to create BOM');
    } finally {
      setCreatingBom(false);
    }
  };

  const resetAddLineModal = () => {
    setLineForm({ component_type: 'Vessel', component_name: '', component_reference_code: '', quantity: '1', unit: 'EA', is_optional: false, remarks: '' });
    setSelectedComp(null);
    setCompSearch('');
    setSelectedProd(null);
    setProdSearch('');
    setLineSourceType('component');
  };

  const handleAddLine = async () => {
    if (lineSourceType === 'component') {
      if (!lineForm.component_name || !lineForm.component_type) { toast.error('Type and name are required'); return; }
    } else {
      if (!selectedProd) { toast.error('Select a product sub-assembly'); return; }
    }
    setLineSubmitting(true);
    try {
      const nextLine = bomLines.length + 1;
      const payload: any = {
        line_number: nextLine,
        quantity: parseFloat(lineForm.quantity) || 1,
        unit: lineForm.unit,
        is_optional: lineForm.is_optional,
        remarks: lineForm.remarks || null,
      };
      if (lineSourceType === 'component') {
        payload.component_id = selectedComp?.id || null;
        payload.component_type = lineForm.component_type;
        payload.component_name = lineForm.component_name;
        payload.component_reference_code = lineForm.component_reference_code || null;
      } else {
        payload.sub_product_id = selectedProd!.id;
        payload.component_type = 'Sub-Assembly';
        payload.component_name = selectedProd!.product_name;
        payload.component_reference_code = selectedProd!.product_code;
      }
      await api.post(`/product-boms/${bom.id}/lines`, payload);
      toast.success('Line added');
      setShowAddLine(false);
      resetAddLineModal();
      queryClient.invalidateQueries({ queryKey: ['bom-detail', bom.id] });
    } catch {
      toast.error('Failed to add line');
    } finally {
      setLineSubmitting(false);
    }
  };

  const handleDeleteLine = async (lineId: string) => {
    try {
      await api.delete(`/product-boms/${bom.id}/lines/${lineId}`);
      toast.success('Line removed');
      queryClient.invalidateQueries({ queryKey: ['bom-detail', bom.id] });
    } catch {
      toast.error('Failed to remove line');
    }
  };

  const handleAddDocument = async () => {
    if (!docForm.document_title) { toast.error('Title is required'); return; }
    setDocSubmitting(true);
    try {
      const abbr = DOC_TYPES.find(t => t.value === docForm.document_type)?.abbr || 'DOC';
      const code = `${product.product_code}-${abbr}-${Date.now().toString(36).toUpperCase()}`;
      const docRes = await api.post('/documents', {
        document_code: code,
        document_title: docForm.document_title,
        document_type: docForm.document_type,
        discipline: docForm.discipline || null,
        product_id: product.id,
        notes: docForm.notes || null,
      });
      if (docFile) {
        const fd = new FormData();
        fd.append('file', docFile);
        fd.append('revision_code', 'A');
        fd.append('revision_purpose', 'Initial issue');
        await api.post(`/documents/${docRes.data.id}/revisions`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      toast.success('Document added');
      setShowDocModal(false);
      setDocForm({ document_type: 'Technical Data Sheet', document_title: '', discipline: '', notes: '' });
      setDocFile(null);
      queryClient.invalidateQueries({ queryKey: ['product-master', id] });
    } catch {
      toast.error('Failed to add document');
    } finally {
      setDocSubmitting(false);
    }
  };

  const handleLinkProduct = async () => {
    if (!relTarget) { toast.error('Select a product to link'); return; }
    setRelSubmitting(true);
    try {
      await api.post(`/product-masters/${id}/relationships`, { target_product_id: relTarget.id, edge_type: relEdgeType });
      toast.success('Relationship created');
      setShowRelModal(false);
      setRelTarget(null);
      setRelSearch('');
      queryClient.invalidateQueries({ queryKey: ['product-relationships', id] });
    } catch {
      toast.error('Failed to create relationship');
    } finally {
      setRelSubmitting(false);
    }
  };

  const handleLinkVariant = async () => {
    if (!variantTarget) { toast.error('Select a product to link as variant'); return; }
    setVariantSubmitting(true);
    try {
      await api.post(`/product-masters/${id}/relationships`, { target_product_id: variantTarget.id, edge_type: 'variant' });
      toast.success('Variant linked');
      setShowVariantModal(false);
      setVariantTarget(null);
      setVariantSearch('');
      refetchPeerVariants();
    } catch {
      toast.error('Failed to link variant');
    } finally {
      setVariantSubmitting(false);
    }
  };

  const handleUnlinkVariant = async (relId: string) => {
    try {
      await api.delete(`/entity-relationships/${relId}`);
      toast.success('Variant unlinked');
      refetchPeerVariants();
    } catch {
      toast.error('Failed to unlink');
    }
  };
  const saveVendor = async () => {
    if (!vendorForm.vendor_option_code.trim() || !vendorForm.vendor_name.trim()) return toast.error('Vendor option code and vendor are required');
    setVendorSaving(true);
    try {
      const body = {
        ...vendorForm,
        product_master_id: product.id,
        unit_price: vendorForm.unit_price === '' ? null : Number(vendorForm.unit_price),
        lead_time_days: vendorForm.lead_time_days === '' ? null : Number(vendorForm.lead_time_days),
      };
      if (editingVendorId) await api.put(`/vendor-options/${editingVendorId}`, body);
      else await api.post('/vendor-options', body);
      await refetch();
      setShowVendorForm(false); setEditingVendorId(null); setVendorForm(emptyVendorForm);
      toast.success(editingVendorId ? 'Vendor option updated' : 'Vendor option added');
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Could not save vendor option');
    } finally { setVendorSaving(false); }
  };
  const editVendor = (vendor: VendorOption) => {
    setEditingVendorId(vendor.id);
    setVendorForm({
      vendor_option_code: vendor.vendor_option_code,
      vendor_name: vendor.vendor_name || '',
      manufacturer_name: vendor.manufacturer_name || '',
      vendor_item_code: vendor.vendor_item_code || '',
      approved_status: vendor.approved_status || 'Approved',
      lead_time_days: vendor.lead_time_days == null ? '' : String(vendor.lead_time_days),
      region_scope: vendor.region_scope || '',
      unit_price: vendor.unit_price == null ? '' : String(vendor.unit_price),
      currency: vendor.currency || 'USD',
    });
    setShowVendorForm(true);
  };
  const deleteVendor = async (vendor: VendorOption) => {
    if (!await confirm({ title: 'Remove vendor option?', message: `${vendor.vendor_name || vendor.vendor_option_code} will be removed from this product.`, confirmLabel: 'Remove', danger: true })) return;
    try { await api.delete(`/vendor-options/${vendor.id}`); await refetch(); toast.success('Vendor option removed'); }
    catch (error: any) { toast.error(error?.response?.data?.error?.message || 'Could not remove vendor option'); }
  };

  const bomCols: Column<BOMLine>[] = [
    { key: 'line_number', header: '#', className: 'w-10' },
    { key: 'component_type', header: 'Type', render: r => (
      r.sub_product_id
        ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-medium border border-green-200">Sub-Assembly</span>
        : <span className="text-xs text-slate-600">{r.component_type}</span>
    )},
    { key: 'component_reference_code', header: 'Code', render: r => {
      const code = r.sub_product_code || r.component_reference_code;
      return code ? <EntityCode code={code} /> : <span className="text-slate-300">—</span>;
    }},
    { key: 'component_name', header: 'Item', render: r => (
      <span className="font-medium">{r.sub_product_name || r.component_name}</span>
    )},
    { key: 'quantity', header: 'Qty' },
    { key: 'unit', header: 'Unit' },
    { key: 'is_optional', header: 'Optional', render: r => r.is_optional ? <span className="text-blue-600 text-xs">Optional</span> : null },
    { key: 'remarks', header: 'Remarks' },
    { key: 'id', header: '', className: 'w-10', render: r => (
      <button aria-label="Delete BOM line" title="Delete BOM line" onClick={() => handleDeleteLine((r as any).id)} className="text-slate-300 hover:text-red-500 transition-colors">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    )},
  ];

  const vendorCols: Column<VendorOption>[] = [
    { key: 'vendor_option_code', header: 'Code', render: r => <EntityCode code={r.vendor_option_code} /> },
    { key: 'vendor_name', header: 'Vendor' },
    { key: 'manufacturer_name', header: 'Manufacturer' },
    { key: 'vendor_item_code', header: 'Item Code', render: r => r.vendor_item_code ? <EntityCode code={r.vendor_item_code} /> : <span className="text-slate-300">—</span> },
    { key: 'approved_status', header: 'Status', render: r => <StatusBadge status={r.approved_status} /> },
    { key: 'lead_time_days', header: 'Lead Time', render: r => r.lead_time_days ? `${r.lead_time_days} days` : '—' },
    { key: 'region_scope', header: 'Region' },
    { key: 'unit_price', header: 'Vendor Price', render: r => r.unit_price == null ? '—' : `${Number(r.unit_price).toFixed(2)} ${r.currency || 'USD'}` },
    { key: 'id', header: '', className: 'w-20', render: r => canManagePim ? <div className="flex gap-2"><button type="button" aria-label={`Edit vendor ${r.vendor_name}`} onClick={()=>editVendor(r)} className="text-slate-400 hover:text-blue-600"><Pencil className="h-4 w-4"/></button><button type="button" aria-label={`Delete vendor ${r.vendor_name}`} onClick={()=>void deleteVendor(r)} className="text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4"/></button></div> : null },
  ];

  const docCols: Column<Document>[] = [
    { key: 'document_type', header: 'Type', render: r => <div className="flex items-center gap-2">{docTypeIcon(r.document_type)}<span className="text-xs text-slate-600">{r.document_type}</span></div> },
    { key: 'document_code', header: 'Code', render: r => <EntityCode code={r.document_code} /> },
    { key: 'document_title', header: 'Title', render: r => <Link to={`/documents/${r.id}`} className="font-medium text-blue-600 hover:underline">{r.document_title}</Link> },
    { key: 'current_revision', header: 'Rev', render: r => r.current_revision ? <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{r.current_revision}</span> : <span className="text-slate-300">—</span> },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
  ];

  const tabs: { key: Tab; label: string }[] = [
    ...(!isPiping ? [{ key: 'bom' as Tab, label: `BOM (${bom ? bom.revision_code : '—'})` }] : []),
    { key: 'variants', label: 'Variants' },
    { key: 'vendors', label: 'Vendors' },
    { key: 'related', label: `Related (${rels.length})` },
    { key: 'drawings', label: `Drawings (${drawings.length})` },
    { key: 'documents', label: `Documents (${nonDrawingDocs.length})` },
    { key: 'projects', label: 'Projects' },
    { key: 'activity', label: 'Activity' },
  ];
  const activeTab: Tab = tabs.find(t => t.key === tab) ? tab : (tabs[0]?.key ?? 'vendors');

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        code={product.product_code}
        title={editing ? editForm.product_name : product.product_name}
        status={editing ? editForm.standard_status : product.standard_status}
        subtitle={`${product.product_category || ''} ${product.application_type ? '· ' + product.application_type : ''}`}
        crumbs={[
          { label: 'PIM', href: '/pim' },
          { label: 'Products', href: '/products/masters' },
          ...(product.product_family_id && product.product_family_name
            ? [{
                label: product.product_family_name,
                href: `/products/masters?${new URLSearchParams({ family: String(product.product_family_id) }).toString()}`,
              }]
            : []),
          { label: product.product_code },
        ]}
        actions={
          isTank ? (
            <div className="flex gap-2">
              {!editing && canGenerateTds && (
                <Button size="sm" variant="primary" onClick={handleGenerateTds} disabled={generatingTds}>
                  <FileSearch className="w-3.5 h-3.5" />{generatingTds ? 'Generating…' : 'Generate TDS'}
                </Button>
              )}
              {!editing && (
                <Button size="sm" onClick={handleDuplicate} disabled={duplicating}>
                  <Copy className="w-3.5 h-3.5" />{duplicating ? 'Duplicating…' : 'Duplicate'}
                </Button>
              )}
              <Button size="sm" onClick={() => navigate(`/graph?start=${product.id}&type=product`)}>
                <Network className="w-3.5 h-3.5" />Graph
              </Button>
            </div>
          ) : editing ? (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}><X className="w-3.5 h-3.5" /> Cancel</Button>
              <Button size="sm" onClick={handleSave} disabled={saving}><Check className="w-3.5 h-3.5" />{saving ? 'Saving...' : 'Save'}</Button>
            </div>
          ) : (
            <div className="flex gap-2">
              {canGenerateTds && (
                <Button size="sm" variant="primary" onClick={handleGenerateTds} disabled={generatingTds}>
                  <FileSearch className="w-3.5 h-3.5" />{generatingTds ? 'Generating…' : 'Generate TDS'}
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={startEdit}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
              <Button size="sm" onClick={handleDuplicate} disabled={duplicating}>
                <Copy className="w-3.5 h-3.5" />{duplicating ? 'Duplicating…' : 'Duplicate'}
              </Button>
              <Button size="sm" onClick={() => navigate(`/graph?start=${product.id}&type=product`)}>
                <Network className="w-3.5 h-3.5" />Graph
              </Button>
            </div>
          )
        }
      />

      <div className="flex-1 overflow-auto p-4">
        {(product.source_tank_id || product.source_tank_snapshot) && (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 flex items-start gap-2.5 text-sm text-blue-900">
            <Link2 className="w-4 h-4 mt-0.5 shrink-0 text-blue-600" />
            <div>
              <p className="font-semibold">Promoted from a project tank</p>
              <p className="text-xs text-blue-800 mt-0.5">
                Source: {product.source_tank_code || product.source_tank_id}
                {product.source_project_code ? ` · ${product.source_project_code} — ${product.source_project_name || ''}` : ''}
              </p>
            </div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="col-span-2">
            {isTank ? (
            <div className="bg-white border border-slate-200 rounded-lg">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Details</span>
                {!editing
                  ? <button onClick={startEdit} className="text-xs text-blue-600 hover:underline">Edit</button>
                  : <div className="flex gap-3">
                      <button onClick={() => setEditing(false)} className="text-xs text-slate-400 hover:underline">Cancel</button>
                      <button onClick={handleSave} disabled={saving} className="text-xs text-blue-600 font-semibold hover:underline disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
                    </div>}
              </div>
              {!editing ? (
              <MetadataPanel noBorder fields={[
                { label: 'Category', value: product.product_category },
                { label: 'Tank Type', value: product.application_type },
                { label: 'Tank Family', value: tankFamilies.find((f: any) => f.id === (product as any).tank_family_id)?.name ?? null },
                { label: 'Manufacturer', value: (product as any).manufacturer },
                { label: 'Model', value: (product as any).model },
                 { label: 'Classification', value: (product as any).tank_classification },
                 { label: 'Product Description', value: (product as any).product_description },
                 { label: 'Construction', value: (product as any).tank_engineering_details?.construction_type },
                 { label: 'Fabrication Method', value: (product as any).tank_engineering_details?.fabrication_method },
                 { label: 'Service Medium', value: (product as any).tank_engineering_details?.service_medium },
                 { label: 'Operating Temperature', value: (product as any).tank_engineering_details?.operating_temperature_min_c != null || (product as any).tank_engineering_details?.operating_temperature_max_c != null
                   ? `${(product as any).tank_engineering_details?.operating_temperature_min_c ?? '—'} to ${(product as any).tank_engineering_details?.operating_temperature_max_c ?? '—'} °C` : null },
                 { label: 'Maximum Operating Pressure', value: (product as any).tank_engineering_details?.max_operating_pressure_bar != null ? `${(product as any).tank_engineering_details.max_operating_pressure_bar} bar` : null },
                 { label: 'Maximum Possible Pressure', value: (product as any).tank_engineering_details?.max_possible_pressure_bar != null ? `${(product as any).tank_engineering_details.max_possible_pressure_bar} bar` : null },
                 { label: 'Vacuum Condition', value: (product as any).tank_engineering_details?.vacuum_condition },
                 { label: 'Service Type', value: (product as any).tank_engineering_details?.service_pressure_mode },
                 { label: 'Proposed Design Standard', value: (product as any).tank_engineering_details?.proposed_design_standard },
                 { label: 'Required ASTM Tests', value: (product as any).tank_engineering_details?.required_astm_tests },
                 { label: 'Certification / Third-party Inspection', value: (product as any).tank_engineering_details?.certification_inspection_requirements },
               ...(isOzoneGenerator && (product as any).ozone_production_capacity_g_h != null ? [{ label: 'Ozone Production Capacity', value: `${(product as any).ozone_production_capacity_g_h} g/h` }] : []),
                { label: 'Primary Material', value: product.primary_material_code ? <Link to="/knowledge/materials" className="inline-flex items-center gap-1.5 hover:underline"><EntityCode code={product.primary_material_code} />{product.material_name && <span className="text-slate-500 text-xs">{product.material_name}</span>}</Link> : null },
                ...(() => {
                  const shape = product.shape_type || 'Rectangular';
                  const est = calcEstCostFromRates(shape, Number(product.length_mm), Number(product.width_mm), Number(product.height_mm), product.primary_material_code, tankCostRates);
                  if (!est) return [];
                  return [{ label: 'Est. Cost', value: <span className="font-mono text-green-700 font-semibold">{Number(est.cost).toLocaleString()} <span className="font-normal text-xs text-green-600">{est.rate.currency}</span><span className="text-slate-400 font-normal text-xs ml-1">(shell area)</span></span> }];
                })(),
                ...((product as any).cost != null ? [{ label: 'Cost Price', value: <span className="font-mono font-semibold text-slate-800">{Number((product as any).cost).toFixed(2)} <span className="font-normal text-xs text-slate-500">{(product as any).currency || 'USD'}</span></span> }] : []),
                ...((product as any).sell_price != null ? [{ label: 'Sell Price', value: `${Number((product as any).sell_price).toFixed(2)} ${(product as any).currency || 'USD'}` }] : []),
                { label: 'Notes', value: product.notes },
              ]} />
              ) : (
              <div className="p-4">
                <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Product Code *</label>
                  <input value={editForm.product_code} onChange={e => setEditForm((f: any) => ({ ...f, product_code: e.target.value.toUpperCase() }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Product Name *</label>
                  <input value={editForm.product_name} onChange={e => setEditForm((f: any) => ({ ...f, product_name: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                  <select value={editForm.standard_status} onChange={e => setEditForm((f: any) => ({ ...f, standard_status: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                    {['Concept', 'Development', 'ApprovedStandard', 'Active', 'Deprecated', 'Obsolete'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{isTank ? 'Tank Type' : 'Application Type'}</label>
                  <input value={editForm.application_type} onChange={e => setEditForm((f: any) => ({ ...f, application_type: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                </div>
                {isTank && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Tank Family</label>
                    <select value={editForm.tank_family_id ?? ''} onChange={e => setEditForm((f: any) => ({ ...f, tank_family_id: e.target.value || null }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white">
                      <option value="">— None —</option>
                      {tankFamilies.map((fam: any) => (
                        <option key={fam.id} value={fam.id}>{fam.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Primary Material</label>
                  <select value={editForm.primary_material_code ?? ''} onChange={e => setEditForm((f: any) => ({ ...f, primary_material_code: e.target.value || null }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white">
                    <option value="">— None —</option>
                    {(materialsData?.items ?? []).map((m: any) => (
                      <option key={m.material_code} value={m.material_code}>
                        {m.material_code}{m.material_name ? ` — ${m.material_name}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tank Classification</label>
                  <select value={editForm.tank_classification ?? ''} onChange={e => setEditForm((f: any) => ({ ...f, tank_classification: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
                    <option value="">— Select —</option>
                    {['Cylindrical atmospheric FRP tank', 'Rectangular atmospheric FRP tank', 'Atmospheric FRP steel tank'].map(value => <option key={value}>{value}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Product Description</label>
                  <textarea rows={2} value={editForm.product_description ?? ''} onChange={e => setEditForm((f: any) => ({ ...f, product_description: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Construction</label>
                  <select value={editForm.tank_engineering_details?.construction_type ?? ''} onChange={e => setEditForm((f: any) => ({ ...f, tank_engineering_details: { ...f.tank_engineering_details, construction_type: e.target.value } }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
                    <option value="">— Select —</option><option>FRP</option><option>FRP with SHS steel</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Fabrication Method</label>
                  <select value={editForm.tank_engineering_details?.fabrication_method ?? ''} onChange={e => setEditForm((f: any) => ({ ...f, tank_engineering_details: { ...f.tank_engineering_details, fabrication_method: e.target.value } }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
                    <option value="">— Select —</option><option>Contact moulded</option><option>Filament wound</option><option>Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Service Medium</label>
                  <select value={editForm.tank_engineering_details?.service_medium ?? ''} onChange={e => setEditForm((f: any) => ({ ...f, tank_engineering_details: { ...f.tank_engineering_details, service_medium: e.target.value } }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
                    <option value="">— Select —</option><option>Freshwater</option><option>Seawater</option><option>Chemical</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Atmospheric / Pressurised Service</label>
                  <select value={editForm.tank_engineering_details?.service_pressure_mode ?? ''} onChange={e => setEditForm((f: any) => ({ ...f, tank_engineering_details: { ...f.tank_engineering_details, service_pressure_mode: e.target.value } }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
                    <option value="">— Select —</option><option>Atmospheric</option><option>Pressurised</option>
                  </select>
                </div>
                {[
                  ['operating_temperature_min_c', 'Operating Temperature Min (°C)'],
                  ['operating_temperature_max_c', 'Operating Temperature Max (°C)'],
                  ['max_operating_pressure_bar', 'Maximum Operating Pressure (bar)'],
                  ['max_possible_pressure_bar', 'Maximum Possible Pressure (bar)'],
                ].map(([key, label]) => <div key={key}>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
                  <input type="number" step="any" min={key.includes('pressure') ? 0 : undefined}
                    value={editForm.tank_engineering_details?.[key] ?? ''}
                    onChange={e => setEditForm((f: any) => ({ ...f, tank_engineering_details: { ...f.tank_engineering_details, [key]: e.target.value } }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                </div>)}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Possible Vacuum Condition</label>
                  <select value={editForm.tank_engineering_details?.vacuum_condition ?? ''} onChange={e => setEditForm((f: any) => ({ ...f, tank_engineering_details: { ...f.tank_engineering_details, vacuum_condition: e.target.value } }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
                    <option value="">— Select —</option><option>None</option><option>Partial vacuum</option><option>Full vacuum</option><option>Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Proposed Design Standard</label>
                  <input value={editForm.tank_engineering_details?.proposed_design_standard ?? ''} onChange={e => setEditForm((f: any) => ({ ...f, tank_engineering_details: { ...f.tank_engineering_details, proposed_design_standard: e.target.value } }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Required ASTM Tests</label>
                  <textarea rows={2} value={editForm.tank_engineering_details?.required_astm_tests ?? ''} onChange={e => setEditForm((f: any) => ({ ...f, tank_engineering_details: { ...f.tank_engineering_details, required_astm_tests: e.target.value } }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Required Certification / Third-party Inspection</label>
                  <textarea rows={2} value={editForm.tank_engineering_details?.certification_inspection_requirements ?? ''} onChange={e => setEditForm((f: any) => ({ ...f, tank_engineering_details: { ...f.tank_engineering_details, certification_inspection_requirements: e.target.value } }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="col-span-2">
                  {(() => {
                    const shape = (editingDimensions ? tankSpecsForm.shape_type : product.shape_type) || 'Rectangular';
                    const L = editingDimensions ? Number(tankSpecsForm.length_mm) : Number(product.length_mm);
                    const W = editingDimensions ? Number(tankSpecsForm.width_mm) : Number(product.width_mm);
                    const H = editingDimensions ? Number(tankSpecsForm.height_mm) : Number(product.height_mm);
                    const est = calcEstCostFromRates(shape, L, W, H, editForm.primary_material_code || null, tankCostRates);
                    return (
                      <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-500 flex items-center justify-between">
                        <span>Est. Cost <span className="text-slate-400">(shell area × rate)</span></span>
                        {est
                          ? <span className="font-mono text-green-700 font-semibold">{Number(est.cost).toLocaleString()} {est.rate.currency}</span>
                          : <span className="text-slate-300 italic">{tankCostRates.length === 0 ? 'no rates in admin' : 'enter dimensions first'}</span>}
                      </div>
                    );
                  })()}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Cost Price <span className="font-normal text-slate-400">(override)</span></label>
                  <input type="number" min="0" step="any" placeholder="Leave blank to use estimate" value={editForm.cost} onChange={e => setEditForm((f: any) => ({ ...f, cost: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Sell Price</label>
                  <input type="number" min="0" step="any" placeholder="0.00" value={editForm.sell_price} onChange={e => setEditForm((f: any) => ({ ...f, sell_price: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Currency</label>
                  <select value={editForm.currency} onChange={e => setEditForm((f: any) => ({ ...f, currency: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white">
                    {['USD','EUR','GBP','AED','SAR','SGD','AUD','CAD','JPY','CNY'].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Manufacturer</label>
                  <input value={editForm.manufacturer} onChange={e => setEditForm((f: any) => ({ ...f, manufacturer: e.target.value }))}
                    placeholder="e.g. Grundfos"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Model</label>
                  <input value={editForm.model} onChange={e => setEditForm((f: any) => ({ ...f, model: e.target.value }))}
                    placeholder="e.g. CR 5-10"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                </div>
                 {isOzoneGenerator && <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Ozone Production Capacity (g/h)</label>
                  <input aria-label="Ozone Production Capacity (g/h)" type="number" min="0" step="any" value={editForm.ozone_production_capacity_g_h} onChange={e => setEditForm((f: any) => ({ ...f, ozone_production_capacity_g_h: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                 </div>}
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                  <textarea rows={2} value={editForm.notes} onChange={e => setEditForm((f: any) => ({ ...f, notes: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                </div>
              </div>
            </div>
            )}
            </div>
            ) : (
            <>
            {!editing ? (
            <>
            <MetadataPanel fields={[
              { label: 'Family', value: product.product_family_name,
                action: <button onClick={() => setShowFamilyPicker(true)} disabled={familySaving}
                  className="text-xs text-blue-600 hover:underline whitespace-nowrap">{familySaving ? '...' : 'Change'}</button> },
              { label: 'Category', value: product.product_category },
              { label: 'Manufacturer', value: (product as any).manufacturer },
              { label: 'Model', value: (product as any).model },
              ...(isOzoneGenerator && (product as any).ozone_production_capacity_g_h != null ? [{ label: 'Ozone Production Capacity', value: `${(product as any).ozone_production_capacity_g_h} g/h` }] : []),
              ...(!isPiping ? [{ label: 'Application', value: product.application_type }] : []),
               ...(isUvProduct ? [
                 { label: 'Configuration', value: product.configuration },
                 { label: 'Control Type', value: product.control_type },
                 { label: 'Signal Type', value: product.signal_type },
                 { label: 'Optional', value: product.control_type_optional ? 'Yes' : 'No' },
               ] : []),
              ...(!isPiping ? [{ label: 'Design Flow', value: (hydraulicData?.design_flow_m3h ?? product.design_flow_m3h) != null ? `${hydraulicData?.design_flow_m3h ?? product.design_flow_m3h} m³/h` : null }] : []),
              ...(!isPiping ? [{ label: 'Design Head', value: product.design_head_m ? `${product.design_head_m} m` : null }] : []),
              { label: 'Primary Material', value: product.primary_material_code ? <Link to="/knowledge/materials" className="inline-flex items-center gap-1.5 hover:underline"><EntityCode code={product.primary_material_code} />{product.material_name && <span className="text-slate-500 text-xs">{product.material_name}</span>}</Link> : null },
              ...((product as any).cost != null ? [{ label: 'Cost Price', value: `${Number((product as any).cost).toFixed(2)} ${(product as any).currency || 'USD'}` }] : []),
              ...((product as any).sell_price != null ? [{ label: 'Sell Price', value: `${Number((product as any).sell_price).toFixed(2)} ${(product as any).currency || 'USD'}` }] : []),
              { label: 'Notes', value: product.notes },
            ]} />
            {isUvProduct && <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-blue-900">UV Installation &amp; Control</div>
                  <p className="mt-0.5 text-xs text-slate-500">PIM-owned equipment configuration and control metadata</p>
                </div>
                <button onClick={startEdit} className="text-xs font-semibold text-blue-700 hover:underline">Edit</button>
              </div>
              <div className="grid grid-cols-2 gap-x-5 gap-y-2 md:grid-cols-4">
                {[
                  ['Configuration', product.configuration || 'Not set'],
                  ['Control Type', product.control_type || 'Not set'],
                  ['Signal Type', product.signal_type || 'Not set'],
                  ['Optional', product.control_type_optional ? 'Yes' : 'No'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
                    <div className="mt-1 text-sm font-medium text-slate-700">{value}</div>
                  </div>
                ))}
              </div>
            </div>}
            </>
            ) : (
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-3">Edit Details</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Product Code *</label>
                  <input value={editForm.product_code} onChange={e => setEditForm((f: any) => ({ ...f, product_code: e.target.value.toUpperCase() }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Product Name *</label>
                  <input value={editForm.product_name} onChange={e => setEditForm((f: any) => ({ ...f, product_name: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                  <select value={editForm.standard_status} onChange={e => setEditForm((f: any) => ({ ...f, standard_status: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                    {['Concept', 'Development', 'ApprovedStandard', 'Active', 'Deprecated', 'Obsolete'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Application Type</label>
                  <input value={editForm.application_type} onChange={e => setEditForm((f: any) => ({ ...f, application_type: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                </div>
                {isUvProduct && <>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Configuration</label>
                    <select value={editForm.configuration ?? ''} onChange={e => setEditForm((f: any) => ({ ...f, configuration: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white">
                      <option value="">— Select configuration —</option>
                      <option value="Wall mounted">Wall mounted</option>
                      <option value="Stand">Stand</option>
                      <option value="No stand">No stand</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Control Type</label>
                    <input value={editForm.control_type ?? ''} onChange={e => setEditForm((f: any) => ({ ...f, control_type: e.target.value }))}
                      placeholder="e.g. Local, PLC interlock"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Signal Type</label>
                    <input value={editForm.signal_type ?? ''} onChange={e => setEditForm((f: any) => ({ ...f, signal_type: e.target.value }))}
                      placeholder="e.g. On/off, 0–10 V, Modbus"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                  </div>
                  <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-600">
                    <input type="checkbox" checked={Boolean(editForm.control_type_optional)} onChange={e => setEditForm((f: any) => ({ ...f, control_type_optional: e.target.checked }))}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600" />
                    Optional control arrangement
                  </label>
                </>}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Primary Material</label>
                  <select value={editForm.primary_material_code ?? ''} onChange={e => setEditForm((f: any) => ({ ...f, primary_material_code: e.target.value || null }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white">
                    <option value="">— None —</option>
                    {(materialsData?.items ?? []).map((m: any) => (
                      <option key={m.material_code} value={m.material_code}>
                        {m.material_code}{m.material_name ? ` — ${m.material_name}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Cost Price</label>
                  <input type="number" min="0" step="any" placeholder="0.00" value={editForm.cost} onChange={e => setEditForm((f: any) => ({ ...f, cost: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Sell Price</label>
                  <input type="number" min="0" step="any" placeholder="0.00" value={editForm.sell_price} onChange={e => setEditForm((f: any) => ({ ...f, sell_price: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Currency</label>
                  <select value={editForm.currency} onChange={e => setEditForm((f: any) => ({ ...f, currency: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white">
                    {['USD','EUR','GBP','AED','SAR','SGD','AUD','CAD','JPY','CNY'].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Manufacturer</label>
                  <input value={editForm.manufacturer} onChange={e => setEditForm((f: any) => ({ ...f, manufacturer: e.target.value }))}
                    placeholder="e.g. Grundfos"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Model</label>
                  <input value={editForm.model} onChange={e => setEditForm((f: any) => ({ ...f, model: e.target.value }))}
                    placeholder="e.g. CR 5-10"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                </div>
                {isOzoneGenerator && <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Ozone Production Capacity (g/h)</label>
                  <input aria-label="Ozone Production Capacity (g/h)" type="number" min="0" step="any" value={editForm.ozone_production_capacity_g_h} onChange={e => setEditForm((f: any) => ({ ...f, ozone_production_capacity_g_h: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                </div>}
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                  <textarea rows={2} value={editForm.notes} onChange={e => setEditForm((f: any) => ({ ...f, notes: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                </div>
              </div>
            </div>
            )}
            </>
            )}

            {/* Dimensions Card */}
            {(() => {
              const matList: any[] = materialsData?.items ?? [];
              const getMaterialDensity = (code: string | null | undefined): number | null => {
                if (!code) return null;
                const mat = matList.find((m: any) => m.material_code === code);
                return mat?.density != null ? Number(mat.density) : null;
              };
              const getMaterialName = (code: string | null | undefined): string | null => {
                if (!code) return null;
                return matList.find((m: any) => m.material_code === code)?.material_name ?? null;
              };

              const calcEstWeight = (shape: string, l: number, w: number, h: number, t: number, density: number|null): number|null => {
                const sa = calcSurfaceAreaMm2(shape, l, w, h);
                if (sa == null || !(t>0) || density==null) return null;
                return +(sa * t / 1e9 * density).toFixed(1);
              };

              const getDimLabels = (shape: string) => {
                switch(shape) {
                  case 'Cylindrical': return { L:'Diameter (mm)', W:null, volFormula:'π×r²×H', weightFormula:'π×r²×t + π×D×H×t' };
                  case 'Oval':        return { L:'Major Axis (mm)', W:'Minor Axis (mm)', volFormula:'π×a×b×H', weightFormula:'(π×a×b + perim×H)×t' };
                  case 'Hexagonal':   return { L:'Diameter v-v (mm)', W:null, volFormula:'(3√3/2)×s²×H', weightFormula:'((3√3/2)×s² + 6×s×H)×t' };
                  default:            return { L:'Length (mm)', W:'Width (mm)', volFormula:'L×W×H', weightFormula:'(L×W + 2LH + 2WH)×t' };
                }
              };

              if (isTank) {
                const density = getMaterialDensity(product.primary_material_code);
                const shape = product.shape_type || 'Rectangular';
                const { gross, op } = calcTankShapeVolumes(shape, product.length_mm, product.width_mm, product.height_mm, product.design_water_level_mm);
                const estWeight = calcEstWeight(shape, Number(product.length_mm), Number(product.width_mm), Number(product.height_mm), Number(product.wall_thickness_mm), density);
                const estCostResult = calcEstCostFromRates(shape, Number(product.length_mm), Number(product.width_mm), Number(product.height_mm), product.primary_material_code, tankCostRates);

                const editShape = tankSpecsForm.shape_type || 'Rectangular';
                const editLabels = getDimLabels(editShape);
                const editDensity = getMaterialDensity(product.primary_material_code);
                const editVols = editingDimensions ? calcTankShapeVolumes(editShape,
                  tankSpecsForm.length_mm ? Number(tankSpecsForm.length_mm) : null,
                  tankSpecsForm.width_mm ? Number(tankSpecsForm.width_mm) : null,
                  tankSpecsForm.height_mm ? Number(tankSpecsForm.height_mm) : null,
                  tankSpecsForm.design_water_level_mm ? Number(tankSpecsForm.design_water_level_mm) : null,
                ) : null;
                const editEstWeight = editingDimensions ? calcEstWeight(editShape,
                  Number(tankSpecsForm.length_mm), Number(tankSpecsForm.width_mm),
                  Number(tankSpecsForm.height_mm), Number(tankSpecsForm.wall_thickness_mm), editDensity,
                ) : null;
                const editEstCostResult = editingDimensions ? calcEstCostFromRates(editShape,
                  Number(tankSpecsForm.length_mm), Number(tankSpecsForm.width_mm),
                  Number(tankSpecsForm.height_mm), product.primary_material_code, tankCostRates,
                ) : null;

                const viewLabels = getDimLabels(shape);
                return (
                  <div className="bg-white border border-slate-200 rounded-lg mt-3">
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
                      <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5"><Ruler className="w-3.5 h-3.5" />Dimensions</span>
                      {!editingDimensions
                        ? <button onClick={() => { setTankSpecsForm({ shape_type: product.shape_type||'', length_mm: product.length_mm!=null?String(product.length_mm):'', width_mm: product.width_mm!=null?String(product.width_mm):'', height_mm: product.height_mm!=null?String(product.height_mm):'', design_water_level_mm: product.design_water_level_mm!=null?String(product.design_water_level_mm):'', wall_thickness_mm: product.wall_thickness_mm!=null?String(product.wall_thickness_mm):'', weight_kg: product.weight_kg!=null?String(product.weight_kg):'' }); setEditingDimensions(true); }} className="text-xs text-blue-600 hover:underline">Edit</button>
                        : <div className="flex gap-2"><button onClick={() => setEditingDimensions(false)} className="text-xs text-slate-400 hover:underline">Cancel</button><button onClick={handleSaveTankSpecs} disabled={tankSpecsSubmitting} className="text-xs text-blue-600 font-semibold hover:underline disabled:opacity-50">{tankSpecsSubmitting ? 'Saving…' : 'Save'}</button></div>}
                    </div>
                    {editingDimensions ? (
                      <div className="p-3 space-y-2 text-xs">
                        <div>
                          <label className="block text-slate-500 mb-0.5">Shape</label>
                          <select value={tankSpecsForm.shape_type} onChange={e => setTankSpecsForm(f=>({...f,shape_type:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600">
                            <option value="">— Select —</option>
                            {['Rectangular','Cylindrical','Oval','Hexagonal','Custom'].map(o=><option key={o} value={o}>{o}</option>)}
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-slate-500 mb-0.5">{editLabels.L}</label>
                            <FormulaInput value={tankSpecsForm.length_mm} onChange={v=>setTankSpecsForm(f=>({...f,length_mm:v}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600"/>
                          </div>
                          {editLabels.W != null ? (
                            <div>
                              <label className="block text-slate-500 mb-0.5">{editLabels.W}</label>
                              <FormulaInput value={tankSpecsForm.width_mm} onChange={v=>setTankSpecsForm(f=>({...f,width_mm:v}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600"/>
                            </div>
                          ) : <div/>}
                          <div>
                            <label className="block text-slate-500 mb-0.5">Height (mm)</label>
                            <FormulaInput value={tankSpecsForm.height_mm} onChange={v=>setTankSpecsForm(f=>({...f,height_mm:v}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600"/>
                          </div>
                          <div>
                            <label className="block text-slate-500 mb-0.5">Water Level (mm)</label>
                            <FormulaInput value={tankSpecsForm.design_water_level_mm} onChange={v=>setTankSpecsForm(f=>({...f,design_water_level_mm:v}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600"/>
                          </div>
                          <div>
                            <label className="block text-slate-500 mb-0.5">Wall Thickness (mm)</label>
                            <FormulaInput value={tankSpecsForm.wall_thickness_mm} onChange={v=>setTankSpecsForm(f=>({...f,wall_thickness_mm:v}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600"/>
                          </div>
                          <div>
                            <label className="block text-slate-500 mb-0.5">Actual Weight (kg)</label>
                            <input type="number" placeholder="measured weight" value={tankSpecsForm.weight_kg} onChange={e=>setTankSpecsForm(f=>({...f,weight_kg:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600"/>
                          </div>
                        </div>
                        <div className="border-t border-slate-100 pt-2">
                          <p className="text-slate-400 mb-1.5 font-medium">Calculated (estimated)</p>
                          <div className="grid grid-cols-2 gap-1.5">
                            <div>
                              <div className="text-slate-400 mb-0.5">Gross Vol <span className="text-slate-300">({editLabels.volFormula})</span></div>
                              <div className={`rounded px-2 py-1 font-mono border ${editVols?.gross!=null?'bg-blue-50 border-blue-200 text-blue-700':'bg-slate-50 border-slate-200 text-slate-400'}`}>{editVols?.gross!=null?`${editVols.gross} m³`:'—'}</div>
                            </div>
                            <div>
                              <div className="text-slate-400 mb-0.5">Op. Vol (water level)</div>
                              <div className={`rounded px-2 py-1 font-mono border ${editVols?.op!=null?'bg-blue-50 border-blue-200 text-blue-700':'bg-slate-50 border-slate-200 text-slate-400'}`}>{editVols?.op!=null?`${editVols.op} m³`:'—'}</div>
                            </div>
                            <div className="col-span-2">
                              <div className="text-slate-400 mb-0.5">Est. Shell Weight <span className="text-slate-300">({editLabels.weightFormula})×ρ</span></div>
                              <div className={`rounded px-2 py-1 font-mono border ${editEstWeight!=null?'bg-blue-50 border-blue-200 text-blue-700':'bg-slate-50 border-slate-200 text-slate-400'}`}>
                                {editEstWeight!=null ? `${editEstWeight} kg`
                                  : !product.primary_material_code ? 'set a Primary Material first'
                                  : editDensity==null ? `no density for ${product.primary_material_code} — add in Admin → Materials`
                                  : 'enter dims + wall thickness'}
                              </div>
                              {editDensity!=null && (
                                <div className="text-slate-400 mt-0.5">
                                  ρ = {editDensity} kg/m³
                                  {getMaterialName(product.primary_material_code)
                                    ? <> · <span className="text-slate-500">{getMaterialName(product.primary_material_code)}</span></>
                                    : <> ({product.primary_material_code})</>}
                                </div>
                              )}
                            </div>
                            <div className="col-span-2">
                              <div className="text-slate-400 mb-0.5">Est. Material Cost <span className="text-slate-300">(SA×rate)</span></div>
                              <div className={`rounded px-2 py-1 font-mono border ${editEstCostResult!=null?'bg-green-50 border-green-200 text-green-700':'bg-slate-50 border-slate-200 text-slate-400'}`}>
                                {editEstCostResult!=null
                                  ? `${Number(editEstCostResult.cost).toLocaleString()} ${editEstCostResult.rate.currency}`
                                  : tankCostRates.length===0 ? 'no rates configured in admin' : 'enter dimensions'}
                              </div>
                              {editEstCostResult!=null && (
                                <div className="text-slate-400 mt-0.5">
                                  {editEstCostResult.rate.cost_per_sqm_usd} {editEstCostResult.rate.currency}/m² × {((calcSurfaceAreaMm2(editShape, Number(tankSpecsForm.length_mm), Number(tankSpecsForm.width_mm), Number(tankSpecsForm.height_mm)) || 0)/1e6).toFixed(2)} m²
                                  {editEstCostResult.rate.material_code ? ` (${editEstCostResult.rate.material_code})` : ' (default rate)'}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 space-y-1 text-xs">
                        {[
                          ['Shape', product.shape_type, ''],
                          [viewLabels.L.replace(' (mm)',''), product.length_mm, 'mm'],
                          ...(viewLabels.W ? [[viewLabels.W.replace(' (mm)',''), product.width_mm, 'mm'] as [string,any,string]] : []),
                          ['Height', product.height_mm, 'mm'],
                          ['Water Level', product.design_water_level_mm, 'mm'],
                          ['Wall Thickness', product.wall_thickness_mm, 'mm'],
                        ].filter(([,v])=>v!=null&&v!=='').length===0 && gross==null
                          ? <p className="text-slate-300 text-center py-2">No dimensions recorded — click Edit to add</p>
                          : <>
                            {[
                              ['Shape', product.shape_type, ''],
                              [viewLabels.L.replace(' (mm)',''), product.length_mm, 'mm'],
                              ...(viewLabels.W ? [[viewLabels.W.replace(' (mm)',''), product.width_mm, 'mm'] as [string,any,string]] : []),
                              ['Height', product.height_mm, 'mm'],
                              ['Water Level', product.design_water_level_mm, 'mm'],
                              ['Wall Thickness', product.wall_thickness_mm, 'mm'],
                            ].filter(([,v])=>v!=null&&v!=='').map(([l,v,u])=>(
                              <div key={String(l)} className="flex justify-between"><span className="text-slate-400">{l}</span><span className="text-slate-700 font-medium">{String(v)}{u?<span className="text-slate-400 ml-1">{u}</span>:''}</span></div>
                            ))}
                            {(gross!=null||op!=null||estWeight!=null||product.weight_kg!=null||estCostResult!=null) && <div className="border-t border-slate-100 my-1"/>}
                            {gross!=null && <div className="flex justify-between"><span className="text-slate-400">Gross Vol <span className="text-slate-300">({viewLabels.volFormula})</span></span><span className="font-mono text-blue-600 font-medium">{gross} m³</span></div>}
                            {op!=null && <div className="flex justify-between"><span className="text-slate-400">Op. Vol</span><span className="font-mono text-blue-600 font-medium">{op} m³</span></div>}
                            {estWeight!=null && <div className="flex justify-between"><span className="text-slate-400">Est. Weight <span className="text-slate-300">(shell)</span></span><span className="font-mono text-blue-600 font-medium">{estWeight} kg</span></div>}
                            {product.weight_kg!=null && <div className="flex justify-between"><span className="text-slate-400">Actual Weight</span><span className="font-mono text-slate-800 font-semibold">{product.weight_kg} kg</span></div>}
                            {estCostResult!=null && (
                              <div className="flex justify-between items-baseline">
                                <span className="text-slate-400">Est. Cost <span className="text-slate-300">(shell)</span></span>
                                <span className="font-mono text-green-700 font-semibold">{Number(estCostResult.cost).toLocaleString()} <span className="font-normal text-xs text-green-600">{estCostResult.rate.currency}</span></span>
                              </div>
                            )}
                          </>
                        }
                      </div>
                    )}
                  </div>
                );
              }
              return (
                <div className="bg-white border border-slate-200 rounded-lg mt-3">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5"><Ruler className="w-3.5 h-3.5" />Dimensions</span>
                    {!editingDimensions
                      ? <button onClick={() => { setDimensionsForm({ ...dimensionsData }); setEditingDimensions(true); }} className="text-xs text-blue-600 hover:underline">Edit</button>
                      : <div className="flex gap-2"><button onClick={() => setEditingDimensions(false)} className="text-xs text-slate-400 hover:underline">Cancel</button><button onClick={handleSaveDimensions} disabled={dimensionsSaving} className="text-xs text-blue-600 font-semibold hover:underline disabled:opacity-50">{dimensionsSaving ? 'Saving…' : 'Save'}</button></div>}
                  </div>
                  {editingDimensions ? (
                    <div className="p-3 grid grid-cols-2 gap-2">
                      {[['length_mm','Length (mm)'],['width_mm','Width (mm)'],['height_mm','Height (mm)'],['diameter_mm','Diameter (mm)'],['sand_media_per_filter_kg','Sand/Media per Filter (kg)'],['weight_kg','Weight (kg)'],['inlet_dn_mm','Inlet DN (mm)'],['outlet_dn_mm','Outlet DN (mm)']].map(([k,l]) => (
                        <div key={k}><label className="block text-xs text-slate-500 mb-0.5">{l}</label><input type="number" min={k === 'diameter_mm' || k === 'sand_media_per_filter_kg' ? 0 : undefined} step={k === 'diameter_mm' || k === 'sand_media_per_filter_kg' ? 'any' : undefined} value={dimensionsForm[k] ?? ''} onChange={e => setDimensionsForm((f:any) => ({...f,[k]:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600" /></div>
                      ))}
                      <div className="col-span-2"><label className="block text-xs text-slate-500 mb-0.5">Notes</label><input value={dimensionsForm.notes ?? ''} onChange={e => setDimensionsForm((f:any) => ({...f,notes:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600" /></div>
                    </div>
                  ) : (
                    <div className="p-3">
                      {[['Length',dimensionsData?.length_mm,'mm'],['Width',dimensionsData?.width_mm,'mm'],['Height',dimensionsData?.height_mm,'mm'],['Diameter',dimensionsData?.diameter_mm,'mm'],['Sand/Media per Filter',dimensionsData?.sand_media_per_filter_kg,'kg'],['Weight',dimensionsData?.weight_kg,'kg'],['Inlet DN',dimensionsData?.inlet_dn_mm,'mm'],['Outlet DN',dimensionsData?.outlet_dn_mm,'mm'],['Notes',dimensionsData?.notes,'']].filter(([,v])=>v!=null&&v!=='').length === 0
                        ? <p className="text-xs text-slate-300 text-center py-2">No dimensions recorded — click Edit to add</p>
                        : <div className="space-y-1">
                            {[['Length',dimensionsData?.length_mm,'mm'],['Width',dimensionsData?.width_mm,'mm'],['Height',dimensionsData?.height_mm,'mm'],['Diameter',dimensionsData?.diameter_mm,'mm'],['Sand/Media per Filter',dimensionsData?.sand_media_per_filter_kg,'kg'],['Weight',dimensionsData?.weight_kg,'kg'],['Inlet DN',dimensionsData?.inlet_dn_mm,'mm'],['Outlet DN',dimensionsData?.outlet_dn_mm,'mm'],['Notes',dimensionsData?.notes,'']].filter(([,v])=>v!=null&&v!=='').map(([l,v,u])=>(
                              <div key={String(l)} className="flex justify-between text-xs"><span className="text-slate-400">{l}</span><span className="text-slate-700 font-medium">{String(v)}{u ? <span className="text-slate-400 ml-1">{u}</span> : ''}</span></div>
                            ))}
                          </div>}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Pneumatic Card */}
            {isPneumatic && <div className="bg-white border border-slate-200 rounded-lg mt-3">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5"><Wind className="w-3.5 h-3.5" />Pneumatic Specifications</span>
                {!editingPneumatic
                  ? <button onClick={() => { setPneumaticForm({ ...pneumaticData }); setEditingPneumatic(true); }} className="text-xs text-blue-600 hover:underline">Edit</button>
                  : <div className="flex gap-2"><button onClick={() => setEditingPneumatic(false)} className="text-xs text-slate-400 hover:underline">Cancel</button><button onClick={handleSavePneumatic} disabled={pneumaticSaving} className="text-xs text-blue-600 font-semibold hover:underline disabled:opacity-50">{pneumaticSaving ? 'Saving…' : 'Save'}</button></div>}
              </div>
              {editingPneumatic ? (
                <div className="p-3 grid grid-cols-2 gap-2">
                  {[
                    ['gas_flow_value', 'gas_flow_unit', 'Gas Flow', [['m3/h', 'm³/h'], ['SCFM', 'SCFM']], false],
                    ['operating_temperature_value', 'operating_temperature_unit', 'Operating Temperature', [['°C', '°C'], ['°F', '°F']], true],
                    ['dew_point_value', 'dew_point_unit', 'Dew Point', [['°C', '°C'], ['°F', '°F']], true],
                    ['inlet_port_value', 'inlet_port_unit', 'Inlet Port', [['DN', 'DN'], ['mm', 'mm'], ['in', 'in']], false],
                    ['outlet_port_value', 'outlet_port_unit', 'Outlet Port', [['DN', 'DN'], ['mm', 'mm'], ['in', 'in']], false],
                  ].map(([valueKey, unitKey, label, units, allowNegative]: any) => (
                    <div key={valueKey}>
                      <label className="block text-xs text-slate-500 mb-0.5">{label}</label>
                      <div className="flex">
                        <input
                          type="number"
                          min={allowNegative ? undefined : 0}
                          step="any"
                          value={pneumaticForm[valueKey] ?? ''}
                          onChange={e => setPneumaticForm((form: any) => ({ ...form, [valueKey]: e.target.value }))}
                          className="min-w-0 flex-1 border border-r-0 border-slate-200 rounded-l px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600"
                        />
                        <select
                          aria-label={`${label} unit`}
                          value={pneumaticForm[unitKey] ?? ''}
                          onChange={e => setPneumaticForm((form: any) => ({ ...form, [unitKey]: e.target.value }))}
                          className="w-20 border border-slate-200 rounded-r px-1.5 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-600"
                        >
                          <option value="">Unit</option>
                          {units.map(([value, unitLabel]: [string, string]) => <option key={value} value={value}>{unitLabel}</option>)}
                        </select>
                      </div>
                    </div>
                  ))}
                  <p className="col-span-2 text-xs text-slate-400">Clear both the value and unit to remove a saved specification.</p>
                </div>
              ) : (
                <div className="p-3">
                  {[
                    ['Gas Flow', pneumaticData?.gas_flow_value, pneumaticData?.gas_flow_unit],
                    ['Operating Temperature', pneumaticData?.operating_temperature_value, pneumaticData?.operating_temperature_unit],
                    ['Dew Point', pneumaticData?.dew_point_value, pneumaticData?.dew_point_unit],
                    ['Inlet Port', pneumaticData?.inlet_port_value, pneumaticData?.inlet_port_unit],
                    ['Outlet Port', pneumaticData?.outlet_port_value, pneumaticData?.outlet_port_unit],
                  ].filter(([, value]) => value !== null && value !== undefined && value !== '').length === 0
                    ? <p className="text-xs text-slate-300 text-center py-2">No pneumatic specifications recorded — click Edit to add</p>
                    : <div className="space-y-1">
                        {[
                          ['Gas Flow', pneumaticData?.gas_flow_value, pneumaticData?.gas_flow_unit],
                          ['Operating Temperature', pneumaticData?.operating_temperature_value, pneumaticData?.operating_temperature_unit],
                          ['Dew Point', pneumaticData?.dew_point_value, pneumaticData?.dew_point_unit],
                          ['Inlet Port', pneumaticData?.inlet_port_value, pneumaticData?.inlet_port_unit],
                          ['Outlet Port', pneumaticData?.outlet_port_value, pneumaticData?.outlet_port_unit],
                        ].filter(([, value]) => value !== null && value !== undefined && value !== '').map(([label, value, unit]) => (
                          <div key={String(label)} className="flex justify-between text-xs">
                            <span className="text-slate-400">{label}</span>
                            <span className="text-slate-700 font-medium">{String(value)}{unit ? <span className="text-slate-400 ml-1">{String(unit)}</span> : ''}</span>
                          </div>
                        ))}
                      </div>}
                </div>
              )}
            </div>}

            {/* Thermal Card */}
            {isThermal && <div className="bg-white border border-slate-200 rounded-lg mt-3">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5"><Thermometer className="w-3.5 h-3.5" />Thermal Specifications</span>
                {!editingThermal
                  ? <div className="flex items-center gap-2">
                      <select aria-label="Thermal capacity display unit" value={thermalDisplayUnit} onChange={event => setThermalDisplayUnit(event.target.value as ThermalCapacityUnit)} className="border border-slate-200 rounded px-1.5 py-1 text-xs bg-white text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-600">
                        {THERMAL_CAPACITY_UNITS.map(unit => <option key={unit} value={unit}>{unit}</option>)}
                      </select>
                      <button onClick={() => {
                        const capacityUnit = thermalDisplayUnit;
                        setThermalForm({
                          ...thermalData,
                          thermal_capacity_unit: capacityUnit,
                          thermal_capacity_kw: thermalCapacityFromKw(thermalData?.thermal_capacity_kw, capacityUnit) ?? '',
                        });
                        setEditingThermal(true);
                      }} className="text-xs text-blue-600 hover:underline">Edit</button>
                    </div>
                  : <div className="flex gap-2"><button onClick={() => setEditingThermal(false)} className="text-xs text-slate-400 hover:underline">Cancel</button><button onClick={handleSaveThermal} disabled={thermalSaving} className="text-xs text-blue-600 font-semibold hover:underline disabled:opacity-50">{thermalSaving ? 'Saving…' : 'Save'}</button></div>}
              </div>
              {editingThermal ? (
                <div className="p-3 grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-500 mb-0.5">Thermal Capacity</label>
                    <div className="flex">
                      <input type="number" min={0} step="any" value={thermalForm.thermal_capacity_kw ?? ''} onChange={event => setThermalForm(form => ({ ...form, thermal_capacity_kw: event.target.value }))} className="min-w-0 flex-1 border border-r-0 border-slate-200 rounded-l px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600" />
                      <select aria-label="Thermal Capacity unit" value={thermalForm.thermal_capacity_unit ?? 'kW'} onChange={event => {
                        const nextUnit = event.target.value as ThermalCapacityUnit;
                        setThermalForm(form => {
                          const currentUnit: ThermalCapacityUnit = THERMAL_CAPACITY_UNITS.includes(form.thermal_capacity_unit) ? form.thermal_capacity_unit : 'kW';
                          const capacityKw = thermalCapacityToKw(form.thermal_capacity_kw, currentUnit);
                          return {
                            ...form,
                            thermal_capacity_unit: nextUnit,
                            thermal_capacity_kw: capacityKw === null ? '' : thermalCapacityFromKw(capacityKw, nextUnit),
                          };
                        });
                      }} className="w-20 border border-slate-200 rounded-r px-1.5 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-600">
                        {THERMAL_CAPACITY_UNITS.map(unit => <option key={unit} value={unit}>{unit}</option>)}
                      </select>
                    </div>
                  </div>
                  {[
                    ['flow_rate_m3h', 'Flow Rate (m³/h)', 0],
                    ['operating_temperature_min_c', 'Operating Temperature Min (°C)', undefined],
                    ['operating_temperature_max_c', 'Operating Temperature Max (°C)', undefined],
                    ['design_temperature_c', 'Design Temperature (°C)', undefined],
                    ['pressure_rating_bar', 'Pressure Rating (bar)', 0],
                    ['efficiency_pct', 'Efficiency (%)', 0],
                    ['primary_inlet_dn_mm', 'Primary-side Inlet DN (mm)', 0],
                    ['primary_outlet_dn_mm', 'Primary-side Outlet DN (mm)', 0],
                    ['secondary_inlet_dn_mm', 'Secondary-side Inlet DN (mm)', 0],
                    ['secondary_outlet_dn_mm', 'Secondary-side Outlet DN (mm)', 0],
                  ].map(([key, label, min]: any) => (
                    <div key={key}>
                      <label className="block text-xs text-slate-500 mb-0.5">{label}</label>
                      <input type="number" min={min} max={key === 'efficiency_pct' ? 100 : undefined} step="any" value={thermalForm[key] ?? ''} onChange={event => setThermalForm(form => ({ ...form, [key]: event.target.value }))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600" />
                    </div>
                  ))}
                  <div>
                    <label className="block text-xs text-slate-500 mb-0.5">Thermal Duty / Service</label>
                    <input value={thermalForm.thermal_duty ?? ''} onChange={event => setThermalForm(form => ({ ...form, thermal_duty: event.target.value }))} placeholder="e.g. Heating, chilling, heat recovery" className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-0.5">Fluid Type</label>
                    <input value={thermalForm.fluid_type ?? ''} onChange={event => setThermalForm(form => ({ ...form, fluid_type: event.target.value }))} placeholder="e.g. Fresh water, glycol" className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-0.5">Flow Switch</label>
                    <select value={thermalForm.flow_switch_status ?? ''} onChange={event => setThermalForm(form => ({ ...form, flow_switch_status: event.target.value }))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-600">
                      <option value="">—</option>
                      <option value="included">Included</option>
                      <option value="optional">Optional</option>
                      <option value="not_included">Not included</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-slate-500 mb-0.5">Notes</label>
                    <textarea rows={2} value={thermalForm.notes ?? ''} onChange={event => setThermalForm(form => ({ ...form, notes: event.target.value }))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600" />
                  </div>
                </div>
              ) : (
                <div className="p-3">
                  {[
                    ['Thermal Capacity', thermalCapacityFromKw(thermalData?.thermal_capacity_kw, thermalDisplayUnit), thermalDisplayUnit],
                    ['Thermal Duty / Service', thermalData?.thermal_duty, ''],
                    ['Fluid Type', thermalData?.fluid_type, ''],
                    ['Operating Temperature Min', thermalData?.operating_temperature_min_c, '°C'],
                    ['Operating Temperature Max', thermalData?.operating_temperature_max_c, '°C'],
                    ['Design Temperature', thermalData?.design_temperature_c, '°C'],
                    ['Flow Rate', thermalData?.flow_rate_m3h, 'm³/h'],
                    ['Pressure Rating', thermalData?.pressure_rating_bar, 'bar'],
                    ['Efficiency', thermalData?.efficiency_pct, '%'],
                    ['Primary-side Inlet DN', thermalData?.primary_inlet_dn_mm, 'mm'],
                    ['Primary-side Outlet DN', thermalData?.primary_outlet_dn_mm, 'mm'],
                    ['Secondary-side Inlet DN', thermalData?.secondary_inlet_dn_mm, 'mm'],
                    ['Secondary-side Outlet DN', thermalData?.secondary_outlet_dn_mm, 'mm'],
                    ['Flow Switch', thermalData?.flow_switch_status === 'included' ? 'Included' : thermalData?.flow_switch_status === 'optional' ? 'Optional' : thermalData?.flow_switch_status === 'not_included' ? 'Not included' : null, ''],
                    ['Notes', thermalData?.notes, ''],
                  ].filter(([, value]) => value !== null && value !== undefined && value !== '').length === 0
                    ? <p className="text-xs text-slate-300 text-center py-2">No thermal specifications recorded — click Edit to add</p>
                    : <div className="space-y-1">
                        {[
                          ['Thermal Capacity', thermalCapacityFromKw(thermalData?.thermal_capacity_kw, thermalDisplayUnit), thermalDisplayUnit],
                          ['Thermal Duty / Service', thermalData?.thermal_duty, ''],
                          ['Fluid Type', thermalData?.fluid_type, ''],
                          ['Operating Temperature Min', thermalData?.operating_temperature_min_c, '°C'],
                          ['Operating Temperature Max', thermalData?.operating_temperature_max_c, '°C'],
                          ['Design Temperature', thermalData?.design_temperature_c, '°C'],
                          ['Flow Rate', thermalData?.flow_rate_m3h, 'm³/h'],
                          ['Pressure Rating', thermalData?.pressure_rating_bar, 'bar'],
                          ['Efficiency', thermalData?.efficiency_pct, '%'],
                          ['Primary-side Inlet DN', thermalData?.primary_inlet_dn_mm, 'mm'],
                          ['Primary-side Outlet DN', thermalData?.primary_outlet_dn_mm, 'mm'],
                          ['Secondary-side Inlet DN', thermalData?.secondary_inlet_dn_mm, 'mm'],
                          ['Secondary-side Outlet DN', thermalData?.secondary_outlet_dn_mm, 'mm'],
                          ['Flow Switch', thermalData?.flow_switch_status === 'included' ? 'Included' : thermalData?.flow_switch_status === 'optional' ? 'Optional' : thermalData?.flow_switch_status === 'not_included' ? 'Not included' : null, ''],
                          ['Notes', thermalData?.notes, ''],
                        ].filter(([, value]) => value !== null && value !== undefined && value !== '').map(([label, value, unit]) => (
                          <div key={String(label)} className="flex justify-between gap-4 text-xs">
                            <span className="text-slate-400">{label}</span>
                            <span className="text-slate-700 font-medium text-right">{String(value)}{unit ? <span className="text-slate-400 ml-1">{String(unit)}</span> : ''}</span>
                          </div>
                        ))}
                      </div>}
                </div>
              )}
            </div>}

            {/* Hydraulic Card */}
            <div className="bg-white border border-slate-200 rounded-lg mt-3">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5"><Network className="w-3.5 h-3.5" />Hydraulic</span>
                {!editingHydraulic
                  ? <button onClick={() => { setHydraulicFlowResolution(''); setHydraulicForm({ ...hydraulicData }); setEditingHydraulic(true); }} className="text-xs text-blue-600 hover:underline">Edit</button>
                  : <div className="flex gap-2"><button onClick={() => setEditingHydraulic(false)} className="text-xs text-slate-400 hover:underline">Cancel</button><button onClick={handleSaveHydraulic} disabled={hydraulicSaving} className="text-xs text-blue-600 font-semibold hover:underline disabled:opacity-50">{hydraulicSaving ? 'Saving…' : 'Save'}</button></div>}
              </div>
              {editingHydraulic ? (
                <div className="p-3 grid grid-cols-2 gap-2">
                  {hydraulicData?.design_flow_sync_status === 'conflict' && (
                    <label className="col-span-2 rounded border border-amber-200 bg-amber-50 p-2 flex items-start gap-2 text-xs text-amber-800">
                      <input type="radio" checked={hydraulicFlowResolution === 'hydraulic'} onChange={() => {
                        setHydraulicFlowResolution('hydraulic');
                        setHydraulicForm((f: any) => ({ ...f, design_flow_m3h: String(hydraulicData.hydraulic_design_flow_m3h) }));
                      }} />
                      Keep Hydraulic value ({hydraulicData.hydraulic_design_flow_m3h} m³/h); Product Master currently has {hydraulicData.product_design_flow_m3h} m³/h
                    </label>
                  )}
                  {[['design_flow_m3h','Design Flow (m³/h)'],['min_flow_m3h','Min Flow (m³/h)'],['max_flow_m3h','Max Flow (m³/h)'],['venturi_flow_m3h','Venturi Flow (m³/h)'],['friction_loss_mh2o','Friction Loss (mH₂O)'],['design_head_m','Design Head (m)'],['design_pressure_bar','Design Pressure (bar)'],['max_pressure_bar','Max Pressure (bar)'],['npsh_required_m','NPSH Required (m)'],['suction_dn_mm','Suction DN (mm)'],['discharge_dn_mm','Discharge DN (mm)'],['min_temperature_c','Min Temp (°C)'],['max_temperature_c','Max Temp (°C)']].map(([k,l]) => (
                      <div key={k}><label className="block text-xs text-slate-500 mb-0.5">{l}</label><input type="number" min={k === 'venturi_flow_m3h' || k === 'friction_loss_mh2o' ? 0 : undefined} step="any" value={hydraulicForm[k] ?? ''} onChange={e => setHydraulicForm((f:any) => ({...f,[k]:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600" /></div>
                  ))}
                  <div><label className="block text-xs text-slate-500 mb-0.5">Fluid Type</label><input value={hydraulicForm.fluid_type ?? ''} onChange={e => setHydraulicForm((f:any) => ({...f,fluid_type:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600" /></div>
                  <div className="col-span-2"><label className="block text-xs text-slate-500 mb-0.5">Notes</label><input value={hydraulicForm.notes ?? ''} onChange={e => setHydraulicForm((f:any) => ({...f,notes:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600" /></div>
                </div>
              ) : (
                <div className="p-3">
                  {[['Design Flow',hydraulicData?.design_flow_m3h,'m³/h'],['Min Flow',hydraulicData?.min_flow_m3h,'m³/h'],['Max Flow',hydraulicData?.max_flow_m3h,'m³/h'],['Venturi Flow',hydraulicData?.venturi_flow_m3h,'m³/h'],['Friction Loss',hydraulicData?.friction_loss_mh2o,'mH₂O'],['Design Head',hydraulicData?.design_head_m,'m'],['Design Pressure',hydraulicData?.design_pressure_bar,'bar'],['Max Pressure',hydraulicData?.max_pressure_bar,'bar'],['NPSH Required',hydraulicData?.npsh_required_m,'m'],['Suction DN',hydraulicData?.suction_dn_mm,'mm'],['Discharge DN',hydraulicData?.discharge_dn_mm,'mm'],['Fluid Type',hydraulicData?.fluid_type,''],['Min Temp',hydraulicData?.min_temperature_c,'°C'],['Max Temp',hydraulicData?.max_temperature_c,'°C'],['Notes',hydraulicData?.notes,'']].filter(([,v])=>v!=null&&v!=='').length === 0
                    ? <p className="text-xs text-slate-300 text-center py-2">No hydraulic data recorded — click Edit to add</p>
                    : <div className="space-y-1">
                        {[['Design Flow',hydraulicData?.design_flow_m3h,'m³/h'],['Min Flow',hydraulicData?.min_flow_m3h,'m³/h'],['Max Flow',hydraulicData?.max_flow_m3h,'m³/h'],['Venturi Flow',hydraulicData?.venturi_flow_m3h,'m³/h'],['Friction Loss',hydraulicData?.friction_loss_mh2o,'mH₂O'],['Design Head',hydraulicData?.design_head_m,'m'],['Design Pressure',hydraulicData?.design_pressure_bar,'bar'],['Max Pressure',hydraulicData?.max_pressure_bar,'bar'],['NPSH Required',hydraulicData?.npsh_required_m,'m'],['Suction DN',hydraulicData?.suction_dn_mm,'mm'],['Discharge DN',hydraulicData?.discharge_dn_mm,'mm'],['Fluid Type',hydraulicData?.fluid_type,''],['Min Temp',hydraulicData?.min_temperature_c,'°C'],['Max Temp',hydraulicData?.max_temperature_c,'°C'],['Notes',hydraulicData?.notes,'']].filter(([,v])=>v!=null&&v!=='').map(([l,v,u])=>(
                          <div key={String(l)} className="flex justify-between text-xs"><span className="text-slate-400">{l}</span><span className="text-slate-700 font-medium">{String(v)}{u ? <span className="text-slate-400 ml-1">{u}</span> : ''}</span></div>
                        ))}
                      </div>}
                </div>
              )}
            </div>

            {/* Electrical Card */}
            {!isTank && <div className="bg-white border border-slate-200 rounded-lg mt-3">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" />Electrical</span>
                  {!editingElectrical
                   ? <button onClick={() => { setElectricalForm({ ...electricalData, ...(!isUvProduct ? { rated_power_kw: electricalData?.rated_power_kw ?? product.power_kw ?? '' } : {}), ...(isUvProduct ? { lamp_count: product.lamp_count ?? '', lamp_power_w: electricalData?.lamp_power_w ?? '' } : {}) }); setEditingElectrical(true); }} className="text-xs text-blue-600 hover:underline">Edit</button>
                  : <div className="flex gap-2"><button onClick={() => setEditingElectrical(false)} className="text-xs text-slate-400 hover:underline">Cancel</button><button onClick={handleSaveElectrical} disabled={electricalSaving} className="text-xs text-blue-600 font-semibold hover:underline disabled:opacity-50">{electricalSaving ? 'Saving…' : 'Save'}</button></div>}
              </div>
              {editingElectrical ? (
                <div className="p-3 grid grid-cols-2 gap-2">
                  {[...(isUvProduct ? [['lamp_count','Lamp Count'],['lamp_power_w','Lamp Power (W)']] : [['rated_power_kw','Rated Power (kW)']]), ['voltage_v','Voltage (V)'],['frequency_hz','Frequency (Hz)'],['full_load_current_a','Full Load Current (A)'],['rated_speed_rpm','Rated Speed (RPM)']].map(([k,l]) => (
                    <div key={k}><label className="block text-xs text-slate-500 mb-0.5">{l}</label><input type="number" min={k === 'lamp_count' ? 1 : undefined} step={k === 'lamp_count' ? 1 : 'any'} value={electricalForm[k] ?? ''} onChange={e => setElectricalForm((f:any) => ({...f,[k]:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600" /></div>
                  ))}
                  {isUvProduct && <div className="col-span-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                    <span className="font-medium">Total Rated Power (calculated)</span>
                    <strong className="ml-2">{calculateLampRatedPowerKw(electricalForm.lamp_count, electricalForm.lamp_power_w) != null
                      ? `${calculateLampRatedPowerKw(electricalForm.lamp_count, electricalForm.lamp_power_w)} kW`
                      : 'Enter Lamp Count and Lamp Power'}</strong>
                  </div>}
                  <div><label className="block text-xs text-slate-500 mb-0.5">Phases</label><select value={electricalForm.phases ?? ''} onChange={e => setElectricalForm((f:any) => ({...f,phases:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600"><option value="">—</option><option value="1">1-Phase</option><option value="3">3-Phase</option></select></div>
                  {[['motor_type','Motor Type'],['insulation_class','Insulation Class'],['protection_class','Protection Class (IP)'],['efficiency_class','Efficiency Class']].map(([k,l]) => (
                    <div key={k}><label className="block text-xs text-slate-500 mb-0.5">{l}</label><input value={electricalForm[k] ?? ''} onChange={e => setElectricalForm((f:any) => ({...f,[k]:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600" /></div>
                  ))}
                  <div className="col-span-2"><label className="block text-xs text-slate-500 mb-0.5">Notes</label><input value={electricalForm.notes ?? ''} onChange={e => setElectricalForm((f:any) => ({...f,notes:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600" /></div>
                </div>
              ) : (
                <div className="p-3">
                  {[...(isUvProduct ? [['Total Rated Power',product.power_kw,'kW'],['Lamp Count',product.lamp_count,''],['Lamp Power',electricalData?.lamp_power_w,'W']] : [['Rated Power',electricalData?.rated_power_kw ?? product.power_kw,'kW']]), ['Voltage',electricalData?.voltage_v,'V'],['Phases',electricalData?.phases ? (electricalData.phases === 1 || electricalData.phases === '1' ? '1-Phase' : '3-Phase') : null,''],['Frequency',electricalData?.frequency_hz,'Hz'],['Full Load Current',electricalData?.full_load_current_a,'A'],['Rated Speed',electricalData?.rated_speed_rpm,'RPM'],['Motor Type',electricalData?.motor_type,''],['Insulation Class',electricalData?.insulation_class,''],['Protection Class',electricalData?.protection_class,''],['Efficiency Class',electricalData?.efficiency_class,''],['Notes',electricalData?.notes,'']].filter(([,v])=>v!=null&&v!=='').length === 0
                    ? <p className="text-xs text-slate-300 text-center py-2">No electrical data recorded — click Edit to add</p>
                    : <div className="space-y-1">
                        {[...(isUvProduct ? [['Total Rated Power',product.power_kw,'kW'],['Lamp Count',product.lamp_count,''],['Lamp Power',electricalData?.lamp_power_w,'W']] : [['Rated Power',electricalData?.rated_power_kw ?? product.power_kw,'kW']]), ['Voltage',electricalData?.voltage_v,'V'],['Phases',electricalData?.phases ? (electricalData.phases === 1 || electricalData.phases === '1' ? '1-Phase' : '3-Phase') : null,''],['Frequency',electricalData?.frequency_hz,'Hz'],['Full Load Current',electricalData?.full_load_current_a,'A'],['Rated Speed',electricalData?.rated_speed_rpm,'RPM'],['Motor Type',electricalData?.motor_type,''],['Insulation Class',electricalData?.insulation_class,''],['Protection Class',electricalData?.protection_class,''],['Efficiency Class',electricalData?.efficiency_class,''],['Notes',electricalData?.notes,'']].filter(([,v])=>v!=null&&v!=='').map(([l,v,u])=>(
                          <div key={String(l)} className="flex justify-between text-xs"><span className="text-slate-400">{l}</span><span className="text-slate-700 font-medium">{String(v)}{u ? <span className="text-slate-400 ml-1">{u}</span> : ''}</span></div>
                        ))}
                      </div>}
                </div>
              )}
            </div>}

            <div className="bg-white border border-slate-200 rounded-lg p-4 mt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-400 uppercase tracking-wide flex items-center gap-1"><Tag className="w-3 h-3" /> Synonyms</span>
                <button onClick={() => setShowSynonymsEdit(s => !s)} className="text-xs text-blue-600 hover:underline">{showSynonymsEdit ? 'Done' : 'Edit'}</button>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {(product.synonyms || []).length === 0 && !showSynonymsEdit && <span className="text-xs text-slate-300">No synonyms — add alternate names to improve search</span>}
                {(product.synonyms || []).map((s: string) => (
                  <span key={s} className="inline-flex items-center gap-1 bg-blue-600/10 text-blue-600 text-xs px-2 py-0.5 rounded-full">
                    {s}
                    {showSynonymsEdit && <button aria-label={`Remove synonym ${s}`} title={`Remove synonym ${s}`} onClick={() => removeSynonym(s)} disabled={synonymsSaving} className="hover:text-red-500"><X className="w-3 h-3" /></button>}
                  </span>
                ))}
              </div>
              {showSynonymsEdit && (
                <div className="flex gap-2 mt-2">
                  <input
                    value={synonymInput}
                    onChange={e => setSynonymInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addSynonym(synonymInput); } }}
                    placeholder="Type a synonym and press Enter"
                    disabled={synonymsSaving}
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <button onClick={() => addSynonym(synonymInput)} disabled={synonymsSaving || !synonymInput.trim()}
                    className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-sm hover:bg-slate-200 disabled:opacity-40">Add</button>
                </div>
              )}
            </div>
          </div>
          <div className="space-y-3">
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
                <span className="text-xs text-slate-400 uppercase tracking-wide">Image</span>
                <button
                  onClick={() => { setImageUrlInput(product.image_url || ''); setImageFile(null); setImageInputMode('file'); setShowImageModal(true); }}
                  className="text-xs text-blue-600 hover:underline"
                >{product.image_url ? 'Change' : 'Add image'}</button>
              </div>
              {product.image_url
                ? <img src={product.image_url} alt={product.product_name} className="w-full h-40 object-contain p-2 bg-slate-50" />
                : <div className="h-32 flex items-center justify-center bg-slate-50 text-slate-300 text-sm">No image</div>
              }
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg">
          <div className="flex border-b border-slate-200 overflow-x-auto">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === 'bom' && (
            <div>
              {!bom ? (
                <div className="p-10 text-center">
                  <div className="text-slate-400 mb-4">No BOM defined for this product</div>
                  <Button onClick={handleCreateBom} disabled={creatingBom}>
                    <Plus className="w-4 h-4" />{creatingBom ? 'Creating...' : 'Create BOM'}
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                    <span className="text-sm text-slate-500">Revision {bom.revision_code} · {bomLines.length} line{bomLines.length !== 1 ? 's' : ''}</span>
                    <Button size="sm" onClick={() => setShowAddLine(true)}>
                      <Plus className="w-3.5 h-3.5" /> Add Line
                    </Button>
                  </div>
                  <DataTable columns={bomCols} data={bomLines} emptyMessage="No BOM lines — add components above" />
                </>
              )}
            </div>
          )}

          {activeTab === 'variants' && (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/50">
                <div>
                  <span className="text-sm font-semibold text-slate-700">Variant Products</span>
                  <p className="text-xs text-slate-400 mt-0.5">Other library products that are variants of this one</p>
                </div>
                <Button size="sm" onClick={() => { setVariantSearch(''); setVariantTarget(null); setShowVariantModal(true); }}>
                  <Link2 className="w-3.5 h-3.5" /> Link Variant
                </Button>
              </div>
              {(peerVariants?.items || []).filter((v: any) => v.edge_type === 'variant').length === 0 ? (
                <div className="p-10 text-center text-sm text-slate-400">
                  No variants linked — click <strong>Link Variant</strong> to connect related products
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {(peerVariants?.items || []).filter((v: any) => v.edge_type === 'variant').map((v: any) => (
                    <div key={v.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 group">
                      <Link to={`/products/masters/${v.related_code}`} className="flex items-center gap-2 hover:underline flex-1">
                        <EntityCode code={v.related_code} />
                        <span className="text-sm font-medium text-slate-800">{v.related_name}</span>
                      </Link>
                      {v.related_status && <StatusBadge status={v.related_status} />}
                      <button
                        onClick={() => handleUnlinkVariant(v.id)}
                        className="opacity-0 group-hover:opacity-100 text-xs text-slate-400 hover:text-red-500 border border-slate-200 rounded px-2 py-0.5 transition-opacity"
                        title="Unlink variant"
                      >Unlink</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {activeTab === 'vendors' && <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-[1250px] w-full text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-left uppercase tracking-wide text-slate-500"><tr>
                {['Code','Vendor','Manufacturer','Item code','Unit price','Currency','Status','Lead time','Region',''].map(header=><th key={header} className="px-3 py-2 font-semibold">{header}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {(product.vendors || []).map((vendor: VendorOption) => {
                  const editingVendor = editingVendorId === vendor.id;
                  if (editingVendor) return <tr key={vendor.id} className="bg-blue-50/40">
                    <td className="px-2 py-2"><input disabled value={vendorForm.vendor_option_code} aria-label="Vendor option code" className="w-32 rounded border bg-slate-100 px-2 py-1.5 font-mono"/></td>
                    <td className="px-2 py-2"><input autoFocus value={vendorForm.vendor_name} onChange={e=>setVendorForm({...vendorForm,vendor_name:e.target.value})} aria-label="Vendor name" className="w-40 rounded border px-2 py-1.5"/></td>
                    <td className="px-2 py-2"><input value={vendorForm.manufacturer_name} onChange={e=>setVendorForm({...vendorForm,manufacturer_name:e.target.value})} aria-label="Vendor manufacturer" className="w-36 rounded border px-2 py-1.5"/></td>
                    <td className="px-2 py-2"><input value={vendorForm.vendor_item_code} onChange={e=>setVendorForm({...vendorForm,vendor_item_code:e.target.value})} aria-label="Vendor item code" className="w-32 rounded border px-2 py-1.5 font-mono"/></td>
                    <td className="px-2 py-2"><input type="number" min="0" step="0.01" value={vendorForm.unit_price} onChange={e=>setVendorForm({...vendorForm,unit_price:e.target.value})} aria-label="Vendor unit price" className="w-28 rounded border px-2 py-1.5"/></td>
                    <td className="px-2 py-2"><select value={vendorForm.currency} onChange={e=>setVendorForm({...vendorForm,currency:e.target.value})} aria-label="Vendor currency" className="rounded border px-2 py-1.5">{['USD','CNY','AUD','NZD','EUR'].map(currency=><option key={currency}>{currency}</option>)}</select></td>
                    <td className="px-2 py-2"><select value={vendorForm.approved_status} onChange={e=>setVendorForm({...vendorForm,approved_status:e.target.value})} aria-label="Vendor status" className="rounded border px-2 py-1.5">{['Approved','Pending','Rejected'].map(status=><option key={status}>{status}</option>)}</select></td>
                    <td className="px-2 py-2"><input type="number" min="0" value={vendorForm.lead_time_days} onChange={e=>setVendorForm({...vendorForm,lead_time_days:e.target.value})} aria-label="Vendor lead time days" className="w-24 rounded border px-2 py-1.5"/></td>
                    <td className="px-2 py-2"><input value={vendorForm.region_scope} onChange={e=>setVendorForm({...vendorForm,region_scope:e.target.value})} aria-label="Vendor region" className="w-28 rounded border px-2 py-1.5"/></td>
                    <td className="px-2 py-2"><div className="flex gap-1"><button type="button" disabled={vendorSaving} onClick={saveVendor} className="rounded bg-blue-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50">Save</button><button type="button" onClick={()=>{setEditingVendorId(null);setShowVendorForm(false);setVendorForm(emptyVendorForm);}} className="rounded border bg-white px-2 py-1.5 text-slate-600">Cancel</button></div></td>
                  </tr>;
                  return <tr key={vendor.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2"><EntityCode code={vendor.vendor_option_code}/></td><td className="px-3 py-2 font-medium text-slate-800">{vendor.vendor_name || '—'}</td><td className="px-3 py-2">{vendor.manufacturer_name || '—'}</td><td className="px-3 py-2">{vendor.vendor_item_code || '—'}</td><td className="px-3 py-2 font-mono">{vendor.unit_price == null ? '—' : Number(vendor.unit_price).toFixed(2)}</td><td className="px-3 py-2">{vendor.currency || 'USD'}</td><td className="px-3 py-2"><StatusBadge status={vendor.approved_status}/></td><td className="px-3 py-2">{vendor.lead_time_days == null ? '—' : `${vendor.lead_time_days} days`}</td><td className="px-3 py-2">{vendor.region_scope || '—'}</td>
                    <td className="px-3 py-2">{canManagePim && <div className="flex gap-2"><button type="button" aria-label={`Edit vendor ${vendor.vendor_name}`} onClick={()=>editVendor(vendor)} className="text-slate-400 hover:text-blue-600"><Pencil className="h-4 w-4"/></button><button type="button" aria-label={`Delete vendor ${vendor.vendor_name}`} onClick={()=>void deleteVendor(vendor)} className="text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4"/></button></div>}</td>
                  </tr>;
                })}
                {canManagePim && (showVendorForm && !editingVendorId ? <tr className="bg-blue-50/40">
                  <td className="px-2 py-2"><input autoFocus value={vendorForm.vendor_option_code} onChange={e=>setVendorForm({...vendorForm,vendor_option_code:e.target.value.toUpperCase()})} placeholder="Code *" aria-label="Vendor option code" className="w-32 rounded border px-2 py-1.5 font-mono"/></td>
                  <td className="px-2 py-2"><input value={vendorForm.vendor_name} onChange={e=>setVendorForm({...vendorForm,vendor_name:e.target.value})} placeholder="Vendor *" aria-label="Vendor name" className="w-40 rounded border px-2 py-1.5"/></td>
                  <td className="px-2 py-2"><input value={vendorForm.manufacturer_name} onChange={e=>setVendorForm({...vendorForm,manufacturer_name:e.target.value})} placeholder="Manufacturer" aria-label="Vendor manufacturer" className="w-36 rounded border px-2 py-1.5"/></td>
                  <td className="px-2 py-2"><input value={vendorForm.vendor_item_code} onChange={e=>setVendorForm({...vendorForm,vendor_item_code:e.target.value})} placeholder="Item code" aria-label="Vendor item code" className="w-32 rounded border px-2 py-1.5 font-mono"/></td>
                  <td className="px-2 py-2"><input type="number" min="0" step="0.01" value={vendorForm.unit_price} onChange={e=>setVendorForm({...vendorForm,unit_price:e.target.value})} placeholder="0.00" aria-label="Vendor unit price" className="w-28 rounded border px-2 py-1.5"/></td>
                  <td className="px-2 py-2"><select value={vendorForm.currency} onChange={e=>setVendorForm({...vendorForm,currency:e.target.value})} aria-label="Vendor currency" className="rounded border px-2 py-1.5">{['USD','CNY','AUD','NZD','EUR'].map(currency=><option key={currency}>{currency}</option>)}</select></td>
                  <td className="px-2 py-2"><select value={vendorForm.approved_status} onChange={e=>setVendorForm({...vendorForm,approved_status:e.target.value})} aria-label="Vendor status" className="rounded border px-2 py-1.5">{['Approved','Pending','Rejected'].map(status=><option key={status}>{status}</option>)}</select></td>
                  <td className="px-2 py-2"><input type="number" min="0" value={vendorForm.lead_time_days} onChange={e=>setVendorForm({...vendorForm,lead_time_days:e.target.value})} placeholder="Days" aria-label="Vendor lead time days" className="w-24 rounded border px-2 py-1.5"/></td>
                  <td className="px-2 py-2"><input value={vendorForm.region_scope} onChange={e=>setVendorForm({...vendorForm,region_scope:e.target.value})} placeholder="Region" aria-label="Vendor region" className="w-28 rounded border px-2 py-1.5"/></td>
                  <td className="px-2 py-2"><div className="flex gap-1"><button type="button" disabled={vendorSaving} onClick={saveVendor} className="rounded bg-blue-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50">Add</button><button type="button" onClick={()=>{setShowVendorForm(false);setVendorForm(emptyVendorForm);}} className="rounded border bg-white px-2 py-1.5 text-slate-600">Cancel</button></div></td>
                </tr> : <tr><td colSpan={10} className="px-3 py-2"><button type="button" onClick={()=>{setEditingVendorId(null);setVendorForm(emptyVendorForm);setShowVendorForm(true);}} className="inline-flex items-center gap-1.5 rounded px-2 py-1.5 font-medium text-blue-700 hover:bg-blue-50"><Plus className="h-4 w-4"/> Add vendor row</button></td></tr>)}
                {!canManagePim && !(product.vendors || []).length && <tr><td colSpan={10} className="p-8 text-center text-sm text-slate-400">No vendor options</td></tr>}
              </tbody>
            </table>
          </div>}

          {activeTab === 'related' && (
            <div>
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <span className="text-sm text-slate-500">{rels.length} product relationship{rels.length !== 1 ? 's' : ''}</span>
                <Button size="sm" onClick={() => setShowRelModal(true)}>
                  <Link2 className="w-3.5 h-3.5" /> Link Product
                </Button>
              </div>
              {rels.length === 0
                ? <div className="p-8 text-center text-slate-400">No product relationships — link a superseded product, alternate, or compatible product</div>
                : (
                  <div className="divide-y divide-slate-100">
                    {rels.map((r: any) => (
                      <div key={r.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                        <div className="flex items-center gap-1 text-xs">
                          {r.direction === 'outgoing'
                            ? <><span className="text-slate-400">This</span><ArrowRight className="w-3 h-3 text-slate-400" /></>
                            : <><ArrowLeft className="w-3 h-3 text-slate-400" /><span className="text-slate-400">This</span></>
                          }
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          r.edge_type === 'supersedes' ? 'bg-red-50 text-red-700' :
                          r.edge_type === 'replaced_by' ? 'bg-blue-50 text-blue-700' :
                          r.edge_type === 'compatible_with' ? 'bg-green-50 text-green-700' :
                          r.edge_type === 'alternate_for' ? 'bg-blue-50 text-blue-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>{r.edge_type.replace(/_/g, ' ')}</span>
                        <Link to={`/products/masters/${r.related_code}`} className="flex items-center gap-2 hover:underline">
                          <EntityCode code={r.related_code} />
                          <span className="text-sm">{r.related_name}</span>
                        </Link>
                        {r.related_status && <StatusBadge status={r.related_status} />}
                      </div>
                    ))}
                  </div>
                )
              }
            </div>
          )}

          {activeTab === 'drawings' && (
            <div>
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <span className="text-sm text-slate-500">{drawings.length} drawing{drawings.length !== 1 ? 's' : ''} & model{drawings.length !== 1 ? 's' : ''} attached</span>
                <Button size="sm" onClick={() => { setDocModalContext('drawings'); setDocForm(f => ({ ...f, document_type: 'GA Drawing' })); setShowDocModal(true); }}>
                  <Plus className="w-3.5 h-3.5" /> Add Drawing
                </Button>
              </div>
              <DataTable columns={docCols} data={drawings} emptyMessage="No drawings or models attached — add a GA drawing, fabrication drawing, 3D model or P&ID above" />
            </div>
          )}

          {activeTab === 'documents' && (
            <div>
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <span className="text-sm text-slate-500">{nonDrawingDocs.length} document{nonDrawingDocs.length !== 1 ? 's' : ''} attached</span>
                <Button size="sm" onClick={() => { setDocModalContext('documents'); setDocForm(f => ({ ...f, document_type: 'Technical Data Sheet' })); setShowDocModal(true); }}>
                  <Plus className="w-3.5 h-3.5" /> Add Document
                </Button>
              </div>
              <DataTable columns={docCols} data={nonDrawingDocs} emptyMessage="No documents attached — add a data sheet, manual, certificate or test report above" />
            </div>
          )}

          {activeTab === 'projects' && (
            <div className="p-4">
              {product.projects?.length === 0
                ? <div className="text-slate-400">Not used in any projects</div>
                : product.projects?.map((p: any) => (
                  <Link key={p.project_code} to={`/projects/${p.project_code}`} className="flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg">
                    <EntityCode code={p.project_code} />
                    <span className="text-sm">{p.project_name}</span>
                    <StatusBadge status={p.project_status} />
                  </Link>
                ))}
            </div>
          )}
          {activeTab === 'activity' && (
            <div className="p-4">
              <ActivityLog entityType="product" entityId={product.id} />
            </div>
          )}
        </div>
      </div>

      {showImageModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-semibold text-slate-800">Product Image</h2>
              <button aria-label="Close product image dialog" title="Close dialog" onClick={() => setShowImageModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
                <button onClick={() => setImageInputMode('file')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${imageInputMode === 'file' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  Upload File
                </button>
                <button onClick={() => setImageInputMode('url')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${imageInputMode === 'url' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  Paste URL
                </button>
              </div>
              {imageInputMode === 'file' ? (
                <div>
                  <input ref={imageFileRef} type="file" accept="image/*" className="hidden"
                    onChange={e => setImageFile(e.target.files?.[0] || null)} />
                  {imageFile ? (
                    <div className="space-y-2">
                      <img src={URL.createObjectURL(imageFile)} alt="Preview" className="w-full h-36 object-contain border border-slate-100 rounded-lg bg-slate-50" />
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500 truncate">{imageFile.name}</span>
                        <button onClick={() => setImageFile(null)} className="text-xs text-slate-400 hover:text-red-500">Remove</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => imageFileRef.current?.click()}
                      className="w-full h-28 border-2 border-dashed border-slate-200 rounded-lg flex flex-col items-center justify-center gap-2 text-slate-400 hover:border-blue-600 hover:text-blue-600 transition-colors">
                      <Upload className="w-6 h-6" />
                      <span className="text-xs">Click to select an image</span>
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Image URL</label>
                  <input type="url" placeholder="https://example.com/image.jpg"
                    value={imageUrlInput} onChange={e => setImageUrlInput(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                  {imageUrlInput && (
                    <img src={imageUrlInput} alt="Preview" className="w-full h-36 object-contain border border-slate-100 rounded-lg bg-slate-50 mt-2" onError={e => (e.currentTarget.style.display = 'none')} />
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
              {product.image_url && (
                <Button variant="ghost" onClick={async () => {
                  await api.put(`/product-masters/${id}`, productPutPayload({ image_url: null }));
                  queryClient.invalidateQueries({ queryKey: ['product-master', id] });
                  setShowImageModal(false);
                }} className="text-red-500 hover:text-red-700 mr-auto">Remove</Button>
              )}
              <Button variant="ghost" onClick={() => setShowImageModal(false)}>Cancel</Button>
              <Button onClick={handleSaveImage} disabled={imageSubmitting || (imageInputMode === 'file' && !imageFile) || (imageInputMode === 'url' && !imageUrlInput)}>
                {imageSubmitting ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showAddLine && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-semibold text-slate-800">Add BOM Line</h2>
              <button aria-label="Close add BOM line dialog" title="Close dialog" onClick={() => { setShowAddLine(false); resetAddLineModal(); }} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              {/* Source type toggle */}
              <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                <button
                  onClick={() => { setLineSourceType('component'); setSelectedProd(null); setProdSearch(''); }}
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${lineSourceType === 'component' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  Component
                </button>
                <button
                  onClick={() => { setLineSourceType('product'); setSelectedComp(null); setCompSearch(''); }}
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${lineSourceType === 'product' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  Sub-Assembly (Product)
                </button>
              </div>

              {lineSourceType === 'component' ? (
              <>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Search Component Library (optional)</label>
                <input type="text" placeholder="Type to search components..."
                  value={compSearch} onChange={e => { setCompSearch(e.target.value); if (selectedComp) setSelectedComp(null); }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                {compSearch.length >= 2 && !selectedComp && (
                  <div className="border border-slate-200 rounded-lg mt-1 max-h-36 overflow-auto divide-y divide-slate-100 bg-white shadow-sm">
                    {(compSearchResults?.items || []).map((c: any) => (
                      <button key={c.id} onClick={() => {
                        setSelectedComp(c);
                        setCompSearch(c.component_name);
                        setLineForm(f => ({
                          ...f,
                          component_type: c.component_type || f.component_type,
                          component_name: c.component_name,
                          component_reference_code: c.component_code,
                          unit: c.unit || f.unit,
                        }));
                      }}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2">
                        <EntityCode code={c.component_code} />
                        <span className="text-sm truncate">{c.component_name}</span>
                        {c.component_type && <span className="text-xs text-slate-400 ml-auto">{c.component_type}</span>}
                      </button>
                    ))}
                    {(compSearchResults?.items || []).length === 0 && <div className="p-3 text-sm text-slate-400">No components found</div>}
                  </div>
                )}
                {selectedComp && (
                  <div className="mt-1 px-3 py-2 bg-blue-50 rounded-lg flex items-center gap-2 text-sm">
                    <EntityCode code={selectedComp.component_code} />
                    <span className="text-slate-700 text-xs">Linked from component library</span>
                    <button aria-label="Clear selected component" title="Clear selected component" onClick={() => { setSelectedComp(null); setCompSearch(''); }} className="ml-auto text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Component Type *</label>
                  <select value={lineForm.component_type} onChange={e => setLineForm(f => ({ ...f, component_type: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                    {COMPONENT_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Reference Code</label>
                  <input type="text" placeholder="e.g. COMP-BLW-01" value={lineForm.component_reference_code}
                    onChange={e => setLineForm(f => ({ ...f, component_reference_code: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Component Name *</label>
                  <input type="text" placeholder="e.g. Air Blower" value={lineForm.component_name}
                    onChange={e => setLineForm(f => ({ ...f, component_name: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                </div>
              </div>
              </>
            ) : (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Search Product Library *</label>
                <input type="text" placeholder="Type product name or code..."
                  value={prodSearch} onChange={e => { setProdSearch(e.target.value); if (selectedProd) setSelectedProd(null); }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                {prodSearch.length >= 2 && !selectedProd && (
                  <div className="border border-slate-200 rounded-lg mt-1 max-h-40 overflow-auto divide-y divide-slate-100 bg-white shadow-sm">
                    {(prodBomSearchResults?.items || []).map((p: any) => (
                      <button key={p.id} onClick={() => { setSelectedProd(p); setProdSearch(p.product_name); }}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2">
                        <EntityCode code={p.product_code} />
                        <span className="text-sm truncate">{p.product_name}</span>
                        {p.product_category && <span className="text-xs text-slate-400 ml-auto">{p.product_category}</span>}
                      </button>
                    ))}
                    {(prodBomSearchResults?.items || []).length === 0 && <div className="p-3 text-sm text-slate-400">No products found</div>}
                  </div>
                )}
                {selectedProd && (
                  <div className="mt-1 px-3 py-2 bg-green-50 rounded-lg flex items-center gap-2 text-sm border border-green-200">
                    <EntityCode code={selectedProd.product_code} />
                    <span className="text-slate-700 text-xs">{selectedProd.product_name}</span>
                    <button aria-label="Clear selected product" title="Clear selected product" onClick={() => { setSelectedProd(null); setProdSearch(''); }} className="ml-auto text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>
            )}

            {/* Shared fields: qty, unit, remarks, optional */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Quantity</label>
                <input type="number" min="0.01" step="0.01" value={lineForm.quantity}
                  onChange={e => setLineForm(f => ({ ...f, quantity: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Unit</label>
                <select value={lineForm.unit} onChange={e => setLineForm(f => ({ ...f, unit: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                  {UNITS.map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Remarks</label>
                <input type="text" placeholder="Optional notes" value={lineForm.remarks}
                  onChange={e => setLineForm(f => ({ ...f, remarks: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div className="col-span-2">
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={lineForm.is_optional} onChange={e => setLineForm(f => ({ ...f, is_optional: e.target.checked }))} />
                  Optional item
                </label>
              </div>
            </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <Button variant="ghost" onClick={() => { setShowAddLine(false); resetAddLineModal(); }}>Cancel</Button>
              <Button onClick={handleAddLine} disabled={lineSubmitting}>
                {lineSubmitting ? 'Adding...' : 'Add Line'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showRelModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-semibold text-slate-800">Link Related Product</h2>
              <button aria-label="Close link related product dialog" title="Close dialog" onClick={() => setShowRelModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Relationship Type</label>
                <select value={relEdgeType} onChange={e => setRelEdgeType(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                  {EDGE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Search Product</label>
                <input type="text" placeholder="Type product name or code..."
                  value={relSearch} onChange={e => { setRelSearch(e.target.value); setRelTarget(null); }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                {relSearch.length >= 2 && !relTarget && (
                  <div className="border border-slate-200 rounded-lg mt-1 max-h-48 overflow-auto divide-y divide-slate-100">
                    {(relSearchResults?.items || []).filter((p: any) => p.id !== product.id).map((p: any) => (
                      <button key={p.id} onClick={() => { setRelTarget(p); setRelSearch(p.product_name); }}
                        className="w-full text-left px-3 py-2.5 hover:bg-slate-50 flex items-center gap-2">
                        <EntityCode code={p.product_code} />
                        <span className="text-sm truncate">{p.product_name}</span>
                      </button>
                    ))}
                    {(relSearchResults?.items || []).length === 0 && <div className="p-3 text-sm text-slate-400">No products found</div>}
                  </div>
                )}
                {relTarget && (
                  <div className="mt-2 p-3 bg-blue-50 rounded-lg flex items-center gap-2 text-sm">
                    <EntityCode code={relTarget.product_code} />
                    <span className="text-slate-700">{relTarget.product_name}</span>
                    <button aria-label="Clear selected related product" title="Clear selected related product" onClick={() => { setRelTarget(null); setRelSearch(''); }} className="ml-auto text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <Button variant="ghost" onClick={() => setShowRelModal(false)}>Cancel</Button>
              <Button onClick={handleLinkProduct} disabled={relSubmitting || !relTarget}>
                {relSubmitting ? 'Linking...' : 'Link Product'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showVariantModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-semibold text-slate-800">Link Peer Variant</h2>
              <button aria-label="Close link variant dialog" title="Close dialog" onClick={() => setShowVariantModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-500">Search for another product in the library that is a variant of this one. The link is bidirectional.</p>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Search Product</label>
                <input type="text" placeholder="Type product name or code..."
                  value={variantSearch} onChange={e => { setVariantSearch(e.target.value); setVariantTarget(null); }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" autoFocus />
                {variantSearch.length >= 2 && !variantTarget && (
                  <div className="border border-slate-200 rounded-lg mt-1 max-h-52 overflow-auto divide-y divide-slate-100">
                    {(variantSearchResults?.items || []).filter((p: any) => p.id !== product.id).map((p: any) => (
                      <button key={p.id} onClick={() => { setVariantTarget(p); setVariantSearch(''); }}
                        className="w-full text-left px-3 py-2.5 hover:bg-slate-50 flex items-center gap-2">
                        <EntityCode code={p.product_code} />
                        <span className="text-sm truncate">{p.product_name}</span>
                        {p.status && <StatusBadge status={p.status} />}
                      </button>
                    ))}
                    {(variantSearchResults?.items || []).length === 0 && <div className="p-3 text-sm text-slate-400">No products found</div>}
                  </div>
                )}
                {variantTarget && (
                  <div className="mt-2 p-3 bg-purple-50 border border-purple-100 rounded-lg flex items-center gap-2 text-sm">
                    <EntityCode code={variantTarget.product_code} />
                    <span className="text-slate-700 font-medium">{variantTarget.product_name}</span>
                    <button aria-label="Clear selected variant" title="Clear selected variant" onClick={() => { setVariantTarget(null); setVariantSearch(''); }} className="ml-auto text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <Button variant="ghost" onClick={() => setShowVariantModal(false)}>Cancel</Button>
              <Button onClick={handleLinkVariant} disabled={variantSubmitting || !variantTarget}>
                {variantSubmitting ? 'Linking...' : 'Link as Variant'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showDocModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-semibold text-slate-800">
                {docModalContext === 'drawings' ? 'Add Drawing / Model' : 'Add Document'} — {product.product_code}
              </h2>
              <button aria-label="Close add document dialog" title="Close dialog" onClick={() => setShowDocModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Type *</label>
                <select value={docForm.document_type} onChange={e => setDocForm(f => ({ ...f, document_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                  {DOC_TYPES.filter(t => docModalContext === 'drawings' ? DRAWING_TYPE_VALUES.has(t.value) : !DRAWING_TYPE_VALUES.has(t.value))
                    .map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Title *</label>
                <input type="text" placeholder={`e.g. ${product.product_name} Technical Data Sheet`}
                  value={docForm.document_title} onChange={e => setDocForm(f => ({ ...f, document_title: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Discipline</label>
                <input type="text" placeholder="e.g. Mechanical, Electrical"
                  value={docForm.discipline} onChange={e => setDocForm(f => ({ ...f, discipline: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                <textarea rows={2} placeholder="Optional notes"
                  value={docForm.notes} onChange={e => setDocForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">File (optional)</label>
                <div onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 rounded-lg p-4 text-center cursor-pointer hover:border-blue-600 transition-colors">
                  {docFile
                    ? <div className="flex items-center justify-center gap-2 text-sm text-slate-700"><FileText className="w-4 h-4 text-blue-600" />{docFile.name} <span className="text-slate-400">({(docFile.size / 1024).toFixed(0)} KB)</span></div>
                    : <div className="flex flex-col items-center gap-1 text-slate-400"><Upload className="w-5 h-5" /><span className="text-sm">Click to upload file</span><span className="text-xs">PDF, DWG, XLSX, PNG — max 100MB</span></div>
                  }
                </div>
                <input ref={fileRef} type="file" className="hidden" onChange={e => setDocFile(e.target.files?.[0] || null)} />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <Button variant="ghost" onClick={() => setShowDocModal(false)}>Cancel</Button>
              <Button onClick={handleAddDocument} disabled={docSubmitting}>
                {docSubmitting ? 'Saving...' : 'Add Document'}
              </Button>
            </div>
          </div>
        </div>
      )}


      {showFamilyPicker && (
        <FamilyPickerModal
          currentFamilyId={product.product_family_id}
          onSelect={handleFamilySelect}
          onClose={() => setShowFamilyPicker(false)}
        />
      )}
      {dialog}
    </div>
  );
}
