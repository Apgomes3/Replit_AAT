import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import MetadataPanel from '../../components/ui/MetadataPanel';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import DataTable, { Column } from '../../components/ui/DataTable';
import { VendorOption, BOMLine, Document } from '../../types';
import { useRecordTitle } from '../../hooks/usePageTitle';
import { useState, useRef } from 'react';
import { Network, FileText, FileCheck, FileSearch, Wrench, Award, Upload, Plus, X, Trash2, ArrowRight, ArrowLeft, Link2, Ruler, Box, Zap, Tag, Pencil, Check } from 'lucide-react';
import FamilyPickerModal from '../../components/ui/FamilyPickerModal';
import Button from '../../components/ui/Button';
import toast from 'react-hot-toast';

type Tab = 'bom' | 'variants' | 'vendors' | 'related' | 'drawings' | 'documents' | 'projects';

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

  const [showRelModal, setShowRelModal] = useState(false);
  const [relSearch, setRelSearch] = useState('');
  const [relTarget, setRelTarget] = useState<{ id: string; product_code: string; product_name: string } | null>(null);
  const [relEdgeType, setRelEdgeType] = useState('supersedes');
  const [relSubmitting, setRelSubmitting] = useState(false);

  const [showVariantModal, setShowVariantModal] = useState(false);
  const [variantSearch, setVariantSearch] = useState('');
  const [variantTarget, setVariantTarget] = useState<{ id: string; product_code: string; product_name: string } | null>(null);
  const [variantSubmitting, setVariantSubmitting] = useState(false);

  const [showAddLine, setShowAddLine] = useState(false);
  const [lineSourceType, setLineSourceType] = useState<'component' | 'product'>('component');
  const [lineForm, setLineForm] = useState({ component_type: 'Vessel', component_name: '', component_reference_code: '', quantity: '1', unit: 'EA', is_optional: false, remarks: '' });
  const [lineSubmitting, setLineSubmitting] = useState(false);
  const [creatingBom, setCreatingBom] = useState(false);
  const [compSearch, setCompSearch] = useState('');
  const [selectedComp, setSelectedComp] = useState<{ id: string; component_code: string; component_name: string } | null>(null);
  const [prodSearch, setProdSearch] = useState('');
  const [selectedProd, setSelectedProd] = useState<{ id: string; product_code: string; product_name: string } | null>(null);

  const { data: product, isLoading } = useQuery({
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
    ...overrides,
  });

  const startEdit = () => {
    setEditForm({
      product_name: product.product_name || '',
      standard_status: product.standard_status || 'Concept',
      application_type: product.application_type || '',
      design_flow_m3h: product.design_flow_m3h != null ? String(product.design_flow_m3h) : '',
      design_head_m: product.design_head_m != null ? String(product.design_head_m) : '',
      power_kw: product.power_kw != null ? String(product.power_kw) : '',
      primary_material_code: product.primary_material_code || '',
      notes: product.notes || '',
      tank_family_id: (product as any).tank_family_id || '',
      cost: (product as any).cost != null ? String((product as any).cost) : '',
      sell_price: (product as any).sell_price != null ? String((product as any).sell_price) : '',
      currency: (product as any).currency || 'USD',
      manufacturer: (product as any).manufacturer || '',
      model: (product as any).model || '',
    });
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/product-masters/${id}`, productPutPayload({
        product_name: editForm.product_name,
        standard_status: editForm.standard_status,
        application_type: editForm.application_type || null,
        design_flow_m3h: editForm.design_flow_m3h ? parseFloat(editForm.design_flow_m3h) : null,
        design_head_m: editForm.design_head_m ? parseFloat(editForm.design_head_m) : null,
        power_kw: editForm.power_kw ? parseFloat(editForm.power_kw) : null,
        primary_material_code: editForm.primary_material_code || null,
        notes: editForm.notes || null,
        tank_family_id: editForm.tank_family_id || null,
        cost: editForm.cost !== '' ? parseFloat(editForm.cost) : null,
        sell_price: editForm.sell_price !== '' ? parseFloat(editForm.sell_price) : null,
        currency: editForm.currency || 'USD',
        manufacturer: editForm.manufacturer || null,
        model: editForm.model || null,
      }));
      toast.success('Product updated');
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['product-master', id] });
    } catch {
      toast.error('Failed to save changes');
    } finally {
      setSaving(false);
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
    setElectricalSaving(true);
    try {
      await api.put(`/product-masters/${id}/electrical`, electricalForm);
      toast.success('Electrical data saved');
      setEditingElectrical(false);
      refetchElectrical();
    } catch { toast.error('Failed to save electrical data'); }
    finally { setElectricalSaving(false); }
  };

  const handleSaveHydraulic = async () => {
    setHydraulicSaving(true);
    try {
      await api.put(`/product-masters/${id}/hydraulic`, hydraulicForm);
      toast.success('Hydraulic data saved');
      setEditingHydraulic(false);
      refetchHydraulic();
    } catch { toast.error('Failed to save hydraulic data'); }
    finally { setHydraulicSaving(false); }
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
  if (!product) return <div className="p-8 text-slate-400">Product not found</div>;

  const isPiping = product.product_category === 'Piping';
  const isTank = product.product_category === 'Tank';
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
      <button onClick={() => handleDeleteLine((r as any).id)} className="text-slate-300 hover:text-red-500 transition-colors">
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
          { label: product.product_code },
        ]}
        actions={
          isTank ? (
            <Button size="sm" onClick={() => navigate(`/graph?start=${product.id}&type=product`)}>
              <Network className="w-3.5 h-3.5" />Graph
            </Button>
          ) : editing ? (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}><X className="w-3.5 h-3.5" /> Cancel</Button>
              <Button size="sm" onClick={handleSave} disabled={saving}><Check className="w-3.5 h-3.5" />{saving ? 'Saving...' : 'Save'}</Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={startEdit}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
              <Button size="sm" onClick={() => navigate(`/graph?start=${product.id}&type=product`)}>
                <Network className="w-3.5 h-3.5" />Graph
              </Button>
            </div>
          )
        }
      />

      <div className="flex-1 overflow-auto p-4">
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
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Product Name</label>
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
                {!isPiping && !isTank && (<>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Design Flow (m³/h)</label>
                    <input type="number" value={editForm.design_flow_m3h} onChange={e => setEditForm((f: any) => ({ ...f, design_flow_m3h: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Design Head (m)</label>
                    <input type="number" value={editForm.design_head_m} onChange={e => setEditForm((f: any) => ({ ...f, design_head_m: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Power (kW)</label>
                    <input type="number" value={editForm.power_kw} onChange={e => setEditForm((f: any) => ({ ...f, power_kw: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                  </div>
                </>)}
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
            <MetadataPanel fields={[
              { label: 'Family', value: product.product_family_name,
                action: <button onClick={() => setShowFamilyPicker(true)} disabled={familySaving}
                  className="text-xs text-blue-600 hover:underline whitespace-nowrap">{familySaving ? '...' : 'Change'}</button> },
              { label: 'Category', value: product.product_category },
              { label: 'Manufacturer', value: (product as any).manufacturer },
              { label: 'Model', value: (product as any).model },
              ...(!isPiping ? [{ label: 'Application', value: product.application_type }] : []),
              ...(!isPiping ? [{ label: 'Design Flow', value: product.design_flow_m3h ? `${product.design_flow_m3h} m³/h` : null }] : []),
              ...(!isPiping ? [{ label: 'Design Head', value: product.design_head_m ? `${product.design_head_m} m` : null }] : []),
              ...(!isPiping ? [{ label: 'Power', value: product.power_kw ? `${product.power_kw} kW` : null }] : []),
              { label: 'Primary Material', value: product.primary_material_code ? <Link to="/knowledge/materials" className="inline-flex items-center gap-1.5 hover:underline"><EntityCode code={product.primary_material_code} />{product.material_name && <span className="text-slate-500 text-xs">{product.material_name}</span>}</Link> : null },
              ...((product as any).cost != null ? [{ label: 'Cost Price', value: `${Number((product as any).cost).toFixed(2)} ${(product as any).currency || 'USD'}` }] : []),
              ...((product as any).sell_price != null ? [{ label: 'Sell Price', value: `${Number((product as any).sell_price).toFixed(2)} ${(product as any).currency || 'USD'}` }] : []),
              { label: 'Notes', value: product.notes },
            ]} />
            ) : (
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-3">Edit Details</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Product Name</label>
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
                {!isPiping && (<>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Design Flow (m³/h)</label>
                    <input type="number" value={editForm.design_flow_m3h} onChange={e => setEditForm((f: any) => ({ ...f, design_flow_m3h: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Design Head (m)</label>
                    <input type="number" value={editForm.design_head_m} onChange={e => setEditForm((f: any) => ({ ...f, design_head_m: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Power (kW)</label>
                    <input type="number" value={editForm.power_kw} onChange={e => setEditForm((f: any) => ({ ...f, power_kw: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                  </div>
                </>)}
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
                            <input type="number" value={tankSpecsForm.length_mm} onChange={e=>setTankSpecsForm(f=>({...f,length_mm:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600"/>
                          </div>
                          {editLabels.W != null ? (
                            <div>
                              <label className="block text-slate-500 mb-0.5">{editLabels.W}</label>
                              <input type="number" value={tankSpecsForm.width_mm} onChange={e=>setTankSpecsForm(f=>({...f,width_mm:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600"/>
                            </div>
                          ) : <div/>}
                          <div>
                            <label className="block text-slate-500 mb-0.5">Height (mm)</label>
                            <input type="number" value={tankSpecsForm.height_mm} onChange={e=>setTankSpecsForm(f=>({...f,height_mm:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600"/>
                          </div>
                          <div>
                            <label className="block text-slate-500 mb-0.5">Water Level (mm)</label>
                            <input type="number" value={tankSpecsForm.design_water_level_mm} onChange={e=>setTankSpecsForm(f=>({...f,design_water_level_mm:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600"/>
                          </div>
                          <div>
                            <label className="block text-slate-500 mb-0.5">Wall Thickness (mm)</label>
                            <input type="number" value={tankSpecsForm.wall_thickness_mm} onChange={e=>setTankSpecsForm(f=>({...f,wall_thickness_mm:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600"/>
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
                              <div className={`rounded px-2 py-1 font-mono border ${editEstWeight!=null?'bg-amber-50 border-amber-200 text-amber-700':'bg-slate-50 border-slate-200 text-slate-400'}`}>
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
                            {estWeight!=null && <div className="flex justify-between"><span className="text-slate-400">Est. Weight <span className="text-slate-300">(shell)</span></span><span className="font-mono text-amber-600 font-medium">{estWeight} kg</span></div>}
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
                      {[['length_mm','Length (mm)'],['width_mm','Width (mm)'],['height_mm','Height (mm)'],['weight_kg','Weight (kg)'],['inlet_dn_mm','Inlet DN (mm)'],['outlet_dn_mm','Outlet DN (mm)']].map(([k,l]) => (
                        <div key={k}><label className="block text-xs text-slate-500 mb-0.5">{l}</label><input type="number" value={dimensionsForm[k] ?? ''} onChange={e => setDimensionsForm((f:any) => ({...f,[k]:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600" /></div>
                      ))}
                      <div className="col-span-2"><label className="block text-xs text-slate-500 mb-0.5">Notes</label><input value={dimensionsForm.notes ?? ''} onChange={e => setDimensionsForm((f:any) => ({...f,notes:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600" /></div>
                    </div>
                  ) : (
                    <div className="p-3">
                      {[['Length',dimensionsData?.length_mm,'mm'],['Width',dimensionsData?.width_mm,'mm'],['Height',dimensionsData?.height_mm,'mm'],['Weight',dimensionsData?.weight_kg,'kg'],['Inlet DN',dimensionsData?.inlet_dn_mm,'mm'],['Outlet DN',dimensionsData?.outlet_dn_mm,'mm'],['Notes',dimensionsData?.notes,'']].filter(([,v])=>v!=null&&v!=='').length === 0
                        ? <p className="text-xs text-slate-300 text-center py-2">No dimensions recorded — click Edit to add</p>
                        : <div className="space-y-1">
                            {[['Length',dimensionsData?.length_mm,'mm'],['Width',dimensionsData?.width_mm,'mm'],['Height',dimensionsData?.height_mm,'mm'],['Weight',dimensionsData?.weight_kg,'kg'],['Inlet DN',dimensionsData?.inlet_dn_mm,'mm'],['Outlet DN',dimensionsData?.outlet_dn_mm,'mm'],['Notes',dimensionsData?.notes,'']].filter(([,v])=>v!=null&&v!=='').map(([l,v,u])=>(
                              <div key={String(l)} className="flex justify-between text-xs"><span className="text-slate-400">{l}</span><span className="text-slate-700 font-medium">{String(v)}{u ? <span className="text-slate-400 ml-1">{u}</span> : ''}</span></div>
                            ))}
                          </div>}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Hydraulic Card */}
            <div className="bg-white border border-slate-200 rounded-lg mt-3">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5"><Network className="w-3.5 h-3.5" />Hydraulic</span>
                {!editingHydraulic
                  ? <button onClick={() => { setHydraulicForm({ ...hydraulicData }); setEditingHydraulic(true); }} className="text-xs text-blue-600 hover:underline">Edit</button>
                  : <div className="flex gap-2"><button onClick={() => setEditingHydraulic(false)} className="text-xs text-slate-400 hover:underline">Cancel</button><button onClick={handleSaveHydraulic} disabled={hydraulicSaving} className="text-xs text-blue-600 font-semibold hover:underline disabled:opacity-50">{hydraulicSaving ? 'Saving…' : 'Save'}</button></div>}
              </div>
              {editingHydraulic ? (
                <div className="p-3 grid grid-cols-2 gap-2">
                  {[['design_flow_m3h','Design Flow (m³/h)'],['min_flow_m3h','Min Flow (m³/h)'],['max_flow_m3h','Max Flow (m³/h)'],['design_head_m','Design Head (m)'],['design_pressure_bar','Design Pressure (bar)'],['max_pressure_bar','Max Pressure (bar)'],['npsh_required_m','NPSH Required (m)'],['min_temperature_c','Min Temp (°C)'],['max_temperature_c','Max Temp (°C)']].map(([k,l]) => (
                    <div key={k}><label className="block text-xs text-slate-500 mb-0.5">{l}</label><input type="number" value={hydraulicForm[k] ?? ''} onChange={e => setHydraulicForm((f:any) => ({...f,[k]:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600" /></div>
                  ))}
                  <div><label className="block text-xs text-slate-500 mb-0.5">Fluid Type</label><input value={hydraulicForm.fluid_type ?? ''} onChange={e => setHydraulicForm((f:any) => ({...f,fluid_type:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600" /></div>
                  <div className="col-span-2"><label className="block text-xs text-slate-500 mb-0.5">Notes</label><input value={hydraulicForm.notes ?? ''} onChange={e => setHydraulicForm((f:any) => ({...f,notes:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600" /></div>
                </div>
              ) : (
                <div className="p-3">
                  {[['Design Flow',hydraulicData?.design_flow_m3h,'m³/h'],['Min Flow',hydraulicData?.min_flow_m3h,'m³/h'],['Max Flow',hydraulicData?.max_flow_m3h,'m³/h'],['Design Head',hydraulicData?.design_head_m,'m'],['Design Pressure',hydraulicData?.design_pressure_bar,'bar'],['Max Pressure',hydraulicData?.max_pressure_bar,'bar'],['NPSH Required',hydraulicData?.npsh_required_m,'m'],['Fluid Type',hydraulicData?.fluid_type,''],['Min Temp',hydraulicData?.min_temperature_c,'°C'],['Max Temp',hydraulicData?.max_temperature_c,'°C'],['Notes',hydraulicData?.notes,'']].filter(([,v])=>v!=null&&v!=='').length === 0
                    ? <p className="text-xs text-slate-300 text-center py-2">No hydraulic data recorded — click Edit to add</p>
                    : <div className="space-y-1">
                        {[['Design Flow',hydraulicData?.design_flow_m3h,'m³/h'],['Min Flow',hydraulicData?.min_flow_m3h,'m³/h'],['Max Flow',hydraulicData?.max_flow_m3h,'m³/h'],['Design Head',hydraulicData?.design_head_m,'m'],['Design Pressure',hydraulicData?.design_pressure_bar,'bar'],['Max Pressure',hydraulicData?.max_pressure_bar,'bar'],['NPSH Required',hydraulicData?.npsh_required_m,'m'],['Fluid Type',hydraulicData?.fluid_type,''],['Min Temp',hydraulicData?.min_temperature_c,'°C'],['Max Temp',hydraulicData?.max_temperature_c,'°C'],['Notes',hydraulicData?.notes,'']].filter(([,v])=>v!=null&&v!=='').map(([l,v,u])=>(
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
                  ? <button onClick={() => { setElectricalForm({ ...electricalData }); setEditingElectrical(true); }} className="text-xs text-blue-600 hover:underline">Edit</button>
                  : <div className="flex gap-2"><button onClick={() => setEditingElectrical(false)} className="text-xs text-slate-400 hover:underline">Cancel</button><button onClick={handleSaveElectrical} disabled={electricalSaving} className="text-xs text-blue-600 font-semibold hover:underline disabled:opacity-50">{electricalSaving ? 'Saving…' : 'Save'}</button></div>}
              </div>
              {editingElectrical ? (
                <div className="p-3 grid grid-cols-2 gap-2">
                  {[['rated_power_kw','Rated Power (kW)'],['voltage_v','Voltage (V)'],['frequency_hz','Frequency (Hz)'],['full_load_current_a','Full Load Current (A)'],['rated_speed_rpm','Rated Speed (RPM)']].map(([k,l]) => (
                    <div key={k}><label className="block text-xs text-slate-500 mb-0.5">{l}</label><input type="number" value={electricalForm[k] ?? ''} onChange={e => setElectricalForm((f:any) => ({...f,[k]:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600" /></div>
                  ))}
                  <div><label className="block text-xs text-slate-500 mb-0.5">Phases</label><select value={electricalForm.phases ?? ''} onChange={e => setElectricalForm((f:any) => ({...f,phases:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600"><option value="">—</option><option value="1">1-Phase</option><option value="3">3-Phase</option></select></div>
                  {[['motor_type','Motor Type'],['insulation_class','Insulation Class'],['protection_class','Protection Class (IP)'],['efficiency_class','Efficiency Class']].map(([k,l]) => (
                    <div key={k}><label className="block text-xs text-slate-500 mb-0.5">{l}</label><input value={electricalForm[k] ?? ''} onChange={e => setElectricalForm((f:any) => ({...f,[k]:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600" /></div>
                  ))}
                  <div className="col-span-2"><label className="block text-xs text-slate-500 mb-0.5">Notes</label><input value={electricalForm.notes ?? ''} onChange={e => setElectricalForm((f:any) => ({...f,notes:e.target.value}))} className="w-full border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600" /></div>
                </div>
              ) : (
                <div className="p-3">
                  {[['Rated Power',electricalData?.rated_power_kw,'kW'],['Voltage',electricalData?.voltage_v,'V'],['Phases',electricalData?.phases ? (electricalData.phases === 1 || electricalData.phases === '1' ? '1-Phase' : '3-Phase') : null,''],['Frequency',electricalData?.frequency_hz,'Hz'],['Full Load Current',electricalData?.full_load_current_a,'A'],['Rated Speed',electricalData?.rated_speed_rpm,'RPM'],['Motor Type',electricalData?.motor_type,''],['Insulation Class',electricalData?.insulation_class,''],['Protection Class',electricalData?.protection_class,''],['Efficiency Class',electricalData?.efficiency_class,''],['Notes',electricalData?.notes,'']].filter(([,v])=>v!=null&&v!=='').length === 0
                    ? <p className="text-xs text-slate-300 text-center py-2">No electrical data recorded — click Edit to add</p>
                    : <div className="space-y-1">
                        {[['Rated Power',electricalData?.rated_power_kw,'kW'],['Voltage',electricalData?.voltage_v,'V'],['Phases',electricalData?.phases ? (electricalData.phases === 1 || electricalData.phases === '1' ? '1-Phase' : '3-Phase') : null,''],['Frequency',electricalData?.frequency_hz,'Hz'],['Full Load Current',electricalData?.full_load_current_a,'A'],['Rated Speed',electricalData?.rated_speed_rpm,'RPM'],['Motor Type',electricalData?.motor_type,''],['Insulation Class',electricalData?.insulation_class,''],['Protection Class',electricalData?.protection_class,''],['Efficiency Class',electricalData?.efficiency_class,''],['Notes',electricalData?.notes,'']].filter(([,v])=>v!=null&&v!=='').map(([l,v,u])=>(
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
                    {showSynonymsEdit && <button onClick={() => removeSynonym(s)} disabled={synonymsSaving} className="hover:text-red-500"><X className="w-3 h-3" /></button>}
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
          {activeTab === 'vendors' && <DataTable columns={vendorCols} data={product.vendors || []} emptyMessage="No vendor options" />}

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
        </div>
      </div>

      {showImageModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-semibold text-slate-800">Product Image</h2>
              <button onClick={() => setShowImageModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
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
              <button onClick={() => { setShowAddLine(false); resetAddLineModal(); }} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
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
                    <button onClick={() => { setSelectedComp(null); setCompSearch(''); }} className="ml-auto text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
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
                    <button onClick={() => { setSelectedProd(null); setProdSearch(''); }} className="ml-auto text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
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
              <button onClick={() => setShowRelModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
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
                    <button onClick={() => { setRelTarget(null); setRelSearch(''); }} className="ml-auto text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
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
              <button onClick={() => setShowVariantModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
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
                    <button onClick={() => { setVariantTarget(null); setVariantSearch(''); }} className="ml-auto text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
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
              <button onClick={() => setShowDocModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
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
    </div>
  );
}
