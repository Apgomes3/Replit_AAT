import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import MetadataPanel from '../../components/ui/MetadataPanel';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import DataTable, { Column } from '../../components/ui/DataTable';
import { VendorOption, BOMLine, Document } from '../../types';
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

const docTypeIcon = (type: string) => {
  switch (type) {
    case 'Technical Data Sheet': return <FileSearch className="w-4 h-4 text-blue-500" />;
    case 'O&M Manual': return <Wrench className="w-4 h-4 text-amber-500" />;
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

  const [showClassifiersEdit, setShowClassifiersEdit] = useState(false);
  const [classifierEdits, setClassifierEdits] = useState<Record<string, string>>({});
  const [classifiersSaving, setClassifiersSaving] = useState(false);

  const [showTankSpecsModal, setShowTankSpecsModal] = useState(false);
  const [tankSpecsForm, setTankSpecsForm] = useState({ shape_type: '', length_mm: '', width_mm: '', height_mm: '', design_water_level_mm: '', gross_volume_m3: '', operating_volume_m3: '' });
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
  const [lineForm, setLineForm] = useState({ component_type: 'Vessel', component_name: '', component_reference_code: '', quantity: '1', unit: 'EA', is_optional: false, remarks: '' });
  const [lineSubmitting, setLineSubmitting] = useState(false);
  const [creatingBom, setCreatingBom] = useState(false);
  const [compSearch, setCompSearch] = useState('');
  const [selectedComp, setSelectedComp] = useState<{ id: string; component_code: string; component_name: string } | null>(null);

  const { data: product, isLoading } = useQuery({
    queryKey: ['product-master', id],
    queryFn: () => api.get(`/product-masters/${id}`).then(r => r.data),
  });

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
    queryFn: () => api.get(`/product-masters?search=${variantSearch}&page_size=8`).then(r => r.data),
    enabled: variantSearch.length >= 2 && !variantTarget,
  });

  const { data: bomDetail } = useQuery({
    queryKey: ['bom-detail', product?.boms?.[0]?.id],
    queryFn: () => api.get(`/product-boms/${product.boms[0].id}`).then(r => r.data),
    enabled: !!product?.boms?.[0]?.id,
  });

  const { data: relSearchResults } = useQuery({
    queryKey: ['product-search', relSearch],
    queryFn: () => api.get(`/product-masters?search=${relSearch}&page_size=8`).then(r => r.data),
    enabled: relSearch.length >= 2,
  });

  const { data: compSearchResults } = useQuery({
    queryKey: ['comp-search', compSearch],
    queryFn: () => api.get(`/components?search=${compSearch}&page_size=8`).then(r => r.data),
    enabled: compSearch.length >= 2,
  });

  const { data: classifierData, refetch: refetchClassifiers } = useQuery({
    queryKey: ['product-classifier-values', id],
    queryFn: () => api.get(`/product-masters/${id}/classifier-values`).then(r => r.data),
    enabled: !!product,
  });

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
    product_family_id: product.product_family_id,
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

  const handleSaveClassifiers = async () => {
    setClassifiersSaving(true);
    try {
      await api.put(`/product-masters/${id}/classifier-values`, { values: classifierEdits });
      toast.success('Classifiers saved');
      setShowClassifiersEdit(false);
      setClassifierEdits({});
      refetchClassifiers();
    } catch {
      toast.error('Failed to save classifiers');
    } finally {
      setClassifiersSaving(false);
    }
  };

  const handleSaveTankSpecs = async () => {
    setTankSpecsSubmitting(true);
    try {
      await api.put(`/product-masters/${id}`, productPutPayload({
        shape_type: tankSpecsForm.shape_type || null,
        length_mm: tankSpecsForm.length_mm ? Number(tankSpecsForm.length_mm) : null,
        width_mm: tankSpecsForm.width_mm ? Number(tankSpecsForm.width_mm) : null,
        height_mm: tankSpecsForm.height_mm ? Number(tankSpecsForm.height_mm) : null,
        design_water_level_mm: tankSpecsForm.design_water_level_mm ? Number(tankSpecsForm.design_water_level_mm) : null,
        gross_volume_m3: tankSpecsForm.gross_volume_m3 ? Number(tankSpecsForm.gross_volume_m3) : null,
        operating_volume_m3: tankSpecsForm.operating_volume_m3 ? Number(tankSpecsForm.operating_volume_m3) : null,
      }));
      toast.success('Tank specifications saved');
      setShowTankSpecsModal(false);
      queryClient.invalidateQueries({ queryKey: ['product-master', id] });
    } catch {
      toast.error('Failed to save tank specs');
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

  const handleAddLine = async () => {
    if (!lineForm.component_name || !lineForm.component_type) { toast.error('Type and name are required'); return; }
    setLineSubmitting(true);
    try {
      const nextLine = bomLines.length + 1;
      await api.post(`/product-boms/${bom.id}/lines`, {
        line_number: nextLine,
        component_id: selectedComp?.id || null,
        component_type: lineForm.component_type,
        component_name: lineForm.component_name,
        component_reference_code: lineForm.component_reference_code || null,
        quantity: parseFloat(lineForm.quantity) || 1,
        unit: lineForm.unit,
        is_optional: lineForm.is_optional,
        remarks: lineForm.remarks || null,
      });
      toast.success('Line added');
      setShowAddLine(false);
      setLineForm({ component_type: 'Vessel', component_name: '', component_reference_code: '', quantity: '1', unit: 'EA', is_optional: false, remarks: '' });
      setSelectedComp(null);
      setCompSearch('');
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
    { key: 'component_type', header: 'Type' },
    { key: 'component_reference_code', header: 'Code', render: r => r.component_reference_code ? <EntityCode code={r.component_reference_code} /> : <span className="text-slate-300">—</span> },
    { key: 'component_name', header: 'Component', render: r => <span className="font-medium">{r.component_name}</span> },
    { key: 'quantity', header: 'Qty' },
    { key: 'unit', header: 'Unit' },
    { key: 'is_optional', header: 'Optional', render: r => r.is_optional ? <span className="text-amber-600 text-xs">Optional</span> : null },
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
    { key: 'document_title', header: 'Title', render: r => <Link to={`/documents/${r.id}`} className="font-medium text-[#3E5C76] hover:underline">{r.document_title}</Link> },
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
        breadcrumb={<><Link to="/products" className="hover:underline">Families</Link> / <Link to="/products/masters" className="hover:underline">Products</Link></>}
        actions={
          editing ? (
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
            {!editing ? (
            <MetadataPanel fields={[
              { label: 'Family', value: product.product_family_name,
                action: <button onClick={() => setShowFamilyPicker(true)} disabled={familySaving}
                  className="text-xs text-[#3E5C76] hover:underline whitespace-nowrap">{familySaving ? '...' : 'Change'}</button> },
              { label: 'Category', value: product.product_category },
              ...(!isPiping && !isTank ? [{ label: 'Application', value: product.application_type }] : []),
              ...(isTank ? [{ label: 'Tank Type', value: product.application_type }] : []),
              ...(!isPiping && !isTank ? [{ label: 'Design Flow', value: product.design_flow_m3h ? `${product.design_flow_m3h} m³/h` : null }] : []),
              ...(!isPiping && !isTank ? [{ label: 'Design Head', value: product.design_head_m ? `${product.design_head_m} m` : null }] : []),
              ...(!isPiping && !isTank ? [{ label: 'Power', value: product.power_kw ? `${product.power_kw} kW` : null }] : []),
              { label: 'Primary Material', value: product.primary_material_code ? <><EntityCode code={product.primary_material_code} /> {product.material_name && <span className="text-slate-500 text-xs ml-1">{product.material_name}</span>}</> : null },
              { label: 'Notes', value: product.notes },
            ]} />
            ) : (
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-3">Edit Details</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Product Name</label>
                  <input value={editForm.product_name} onChange={e => setEditForm((f: any) => ({ ...f, product_name: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                  <select value={editForm.standard_status} onChange={e => setEditForm((f: any) => ({ ...f, standard_status: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]">
                    {['Concept', 'Development', 'ApprovedStandard', 'Active', 'Deprecated', 'Obsolete'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{isTank ? 'Tank Type' : 'Application Type'}</label>
                  <input value={editForm.application_type} onChange={e => setEditForm((f: any) => ({ ...f, application_type: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                </div>
                {!isPiping && !isTank && (<>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Design Flow (m³/h)</label>
                    <input type="number" value={editForm.design_flow_m3h} onChange={e => setEditForm((f: any) => ({ ...f, design_flow_m3h: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Design Head (m)</label>
                    <input type="number" value={editForm.design_head_m} onChange={e => setEditForm((f: any) => ({ ...f, design_head_m: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Power (kW)</label>
                    <input type="number" value={editForm.power_kw} onChange={e => setEditForm((f: any) => ({ ...f, power_kw: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                  </div>
                </>)}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Primary Material Code</label>
                  <input value={editForm.primary_material_code} onChange={e => setEditForm((f: any) => ({ ...f, primary_material_code: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                  <textarea rows={2} value={editForm.notes} onChange={e => setEditForm((f: any) => ({ ...f, notes: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                </div>
              </div>
            </div>
            )}

            {classifierData?.classifiers?.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-lg mt-3">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
                  <span className="text-xs text-slate-400 uppercase tracking-wide">Classifiers</span>
                  <button
                    onClick={() => {
                      if (!showClassifiersEdit) {
                        const edits: Record<string, string> = {};
                        for (const c of classifierData.classifiers) {
                          edits[c.id] = classifierData.values?.[c.id] ?? '';
                        }
                        setClassifierEdits(edits);
                      }
                      setShowClassifiersEdit(v => !v);
                    }}
                    className="text-xs text-[#3E5C76] hover:underline"
                  >{showClassifiersEdit ? 'Cancel' : 'Edit'}</button>
                </div>
                {showClassifiersEdit ? (
                  <div className="p-3 space-y-2">
                    {classifierData.classifiers.map((c: any) => (
                      <div key={c.id} className="flex items-center gap-3">
                        <label className="w-32 text-xs text-slate-500 shrink-0">
                          {c.label}{c.unit ? <span className="text-slate-300 ml-1">({c.unit})</span> : ''}
                        </label>
                        <input
                          type={c.field_type === 'number' ? 'number' : 'text'}
                          value={classifierEdits[c.id] ?? ''}
                          onChange={e => setClassifierEdits(prev => ({ ...prev, [c.id]: e.target.value }))}
                          placeholder="—"
                          className="flex-1 border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-[#3E5C76]"
                        />
                      </div>
                    ))}
                    <div className="flex justify-end gap-2 pt-1">
                      <button onClick={() => setShowClassifiersEdit(false)} className="text-xs px-3 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200">Cancel</button>
                      <button onClick={handleSaveClassifiers} disabled={classifiersSaving}
                        className="text-xs px-3 py-1 bg-[#3E5C76] text-white rounded hover:bg-[#2d4a63] disabled:opacity-50">
                        {classifiersSaving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 space-y-1.5">
                    {classifierData.classifiers
                      .filter((c: any) => classifierData.values?.[c.id])
                      .map((c: any) => (
                        <div key={c.id} className="flex justify-between gap-2 text-xs">
                          <span className="text-slate-400">{c.label}</span>
                          <span className="text-slate-700 font-medium">
                            {classifierData.values[c.id]}{c.unit ? <span className="text-slate-400 ml-1">{c.unit}</span> : ''}
                          </span>
                        </div>
                      ))}
                    {classifierData.classifiers.filter((c: any) => classifierData.values?.[c.id]).length === 0 && (
                      <div className="text-xs text-slate-300 text-center py-2">No values set — click Edit to add</div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="bg-white border border-slate-200 rounded-lg p-4 mt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-400 uppercase tracking-wide flex items-center gap-1"><Tag className="w-3 h-3" /> Synonyms</span>
                <button onClick={() => setShowSynonymsEdit(s => !s)} className="text-xs text-[#3E5C76] hover:underline">{showSynonymsEdit ? 'Done' : 'Edit'}</button>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {(product.synonyms || []).length === 0 && !showSynonymsEdit && <span className="text-xs text-slate-300">No synonyms — add alternate names to improve search</span>}
                {(product.synonyms || []).map((s: string) => (
                  <span key={s} className="inline-flex items-center gap-1 bg-[#3E5C76]/10 text-[#3E5C76] text-xs px-2 py-0.5 rounded-full">
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
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]"
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
                  className="text-xs text-[#3E5C76] hover:underline"
                >{product.image_url ? 'Change' : 'Add image'}</button>
              </div>
              {product.image_url
                ? <img src={product.image_url} alt={product.product_name} className="w-full h-40 object-contain p-2 bg-slate-50" />
                : <div className="h-32 flex items-center justify-center bg-slate-50 text-slate-300 text-sm">No image</div>
              }
            </div>
            {isTank && (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
                  <span className="text-xs text-slate-400 uppercase tracking-wide">Tank Specifications</span>
                  <button
                    onClick={() => {
                      setTankSpecsForm({
                        shape_type: product.shape_type || '',
                        length_mm: product.length_mm != null ? String(product.length_mm) : '',
                        width_mm: product.width_mm != null ? String(product.width_mm) : '',
                        height_mm: product.height_mm != null ? String(product.height_mm) : '',
                        design_water_level_mm: product.design_water_level_mm != null ? String(product.design_water_level_mm) : '',
                        gross_volume_m3: product.gross_volume_m3 != null ? String(product.gross_volume_m3) : '',
                        operating_volume_m3: product.operating_volume_m3 != null ? String(product.operating_volume_m3) : '',
                      });
                      setShowTankSpecsModal(true);
                    }}
                    className="text-xs text-[#3E5C76] hover:underline"
                  >Edit</button>
                </div>
                <div className="p-3 space-y-1.5 text-xs">
                  {[
                    { label: 'Shape', value: product.shape_type },
                    { label: 'L × W × H', value: product.length_mm != null ? `${product.length_mm} × ${product.width_mm ?? '—'} × ${product.height_mm ?? '—'} mm` : null },
                    { label: 'Water Level', value: product.design_water_level_mm != null ? `${product.design_water_level_mm} mm` : null },
                    { label: 'Gross Volume', value: product.gross_volume_m3 != null ? `${product.gross_volume_m3} m³` : null },
                    { label: 'Op. Volume', value: product.operating_volume_m3 != null ? `${product.operating_volume_m3} m³` : null },
                  ].map(row => (
                    <div key={row.label} className="flex justify-between gap-2">
                      <span className="text-slate-400">{row.label}</span>
                      <span className="text-slate-700 font-medium">{row.value ?? <span className="text-slate-300">—</span>}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg">
          <div className="flex border-b border-slate-200 overflow-x-auto">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === t.key ? 'border-[#3E5C76] text-[#3E5C76]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
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
                          r.edge_type === 'replaced_by' ? 'bg-orange-50 text-orange-700' :
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
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${imageInputMode === 'file' ? 'bg-white text-[#3E5C76] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  Upload File
                </button>
                <button onClick={() => setImageInputMode('url')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${imageInputMode === 'url' ? 'bg-white text-[#3E5C76] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
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
                      className="w-full h-28 border-2 border-dashed border-slate-200 rounded-lg flex flex-col items-center justify-center gap-2 text-slate-400 hover:border-[#3E5C76] hover:text-[#3E5C76] transition-colors">
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
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
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
              <button onClick={() => setShowAddLine(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Search Component Library (optional)</label>
                <input type="text" placeholder="Type to search components..."
                  value={compSearch} onChange={e => { setCompSearch(e.target.value); if (selectedComp) setSelectedComp(null); }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
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
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]">
                  {COMPONENT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Reference Code</label>
                <input type="text" placeholder="e.g. PM-PUMP-22" value={lineForm.component_reference_code}
                  onChange={e => setLineForm(f => ({ ...f, component_reference_code: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Component Name *</label>
                <input type="text" placeholder="e.g. Air Blower Pump" value={lineForm.component_name}
                  onChange={e => setLineForm(f => ({ ...f, component_name: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Quantity</label>
                <input type="number" min="0.01" step="0.01" value={lineForm.quantity}
                  onChange={e => setLineForm(f => ({ ...f, quantity: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Unit</label>
                <select value={lineForm.unit} onChange={e => setLineForm(f => ({ ...f, unit: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]">
                  {UNITS.map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Remarks</label>
                <input type="text" placeholder="Optional notes" value={lineForm.remarks}
                  onChange={e => setLineForm(f => ({ ...f, remarks: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
              </div>
              <div className="col-span-2">
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={lineForm.is_optional} onChange={e => setLineForm(f => ({ ...f, is_optional: e.target.checked }))} />
                  Optional component
                </label>
              </div>
            </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <Button variant="ghost" onClick={() => setShowAddLine(false)}>Cancel</Button>
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
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]">
                  {EDGE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Search Product</label>
                <input type="text" placeholder="Type product name or code..."
                  value={relSearch} onChange={e => { setRelSearch(e.target.value); setRelTarget(null); }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
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
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" autoFocus />
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
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]">
                  {DOC_TYPES.filter(t => docModalContext === 'drawings' ? DRAWING_TYPE_VALUES.has(t.value) : !DRAWING_TYPE_VALUES.has(t.value))
                    .map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Title *</label>
                <input type="text" placeholder={`e.g. ${product.product_name} Technical Data Sheet`}
                  value={docForm.document_title} onChange={e => setDocForm(f => ({ ...f, document_title: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Discipline</label>
                <input type="text" placeholder="e.g. Mechanical, Electrical"
                  value={docForm.discipline} onChange={e => setDocForm(f => ({ ...f, discipline: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                <textarea rows={2} placeholder="Optional notes"
                  value={docForm.notes} onChange={e => setDocForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">File (optional)</label>
                <div onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 rounded-lg p-4 text-center cursor-pointer hover:border-[#3E5C76] transition-colors">
                  {docFile
                    ? <div className="flex items-center justify-center gap-2 text-sm text-slate-700"><FileText className="w-4 h-4 text-[#3E5C76]" />{docFile.name} <span className="text-slate-400">({(docFile.size / 1024).toFixed(0)} KB)</span></div>
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

      {showTankSpecsModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-800">Tank Specifications</h2>
              <button onClick={() => setShowTankSpecsModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-3">
              {[
                { key: 'shape_type', label: 'Shape', isSelect: true, options: ['Rectangular', 'Cylindrical', 'Oval', 'Hexagonal', 'Custom'] },
                { key: 'length_mm', label: 'Length (mm)', placeholder: 'e.g. 2000' },
                { key: 'width_mm', label: 'Width (mm)', placeholder: 'e.g. 800' },
                { key: 'height_mm', label: 'Height (mm)', placeholder: 'e.g. 600' },
                { key: 'design_water_level_mm', label: 'Design Water Level (mm)', placeholder: 'e.g. 550' },
                { key: 'gross_volume_m3', label: 'Gross Volume (m³)', placeholder: 'e.g. 0.96' },
                { key: 'operating_volume_m3', label: 'Operating Volume (m³)', placeholder: 'e.g. 0.88' },
              ].map(field => (
                <div key={field.key}>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{field.label}</label>
                  {field.isSelect ? (
                    <select value={(tankSpecsForm as any)[field.key]} onChange={e => setTankSpecsForm(f => ({ ...f, [field.key]: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]">
                      <option value="">— Select —</option>
                      {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type="number" placeholder={field.placeholder} value={(tankSpecsForm as any)[field.key]}
                      onChange={e => setTankSpecsForm(f => ({ ...f, [field.key]: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <Button variant="ghost" onClick={() => setShowTankSpecsModal(false)}>Cancel</Button>
              <Button onClick={handleSaveTankSpecs} disabled={tankSpecsSubmitting}>
                {tankSpecsSubmitting ? 'Saving...' : 'Save Specifications'}
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
