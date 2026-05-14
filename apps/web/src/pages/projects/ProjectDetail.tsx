import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useState, lazy, Suspense, useRef, useEffect, Fragment } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import MetadataPanel from '../../components/ui/MetadataPanel';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import DataTable, { Column } from '../../components/ui/DataTable';
import Button from '../../components/ui/Button';
import NewEntityModal from '../../components/ui/NewEntityModal';
import { System, Document, ChangeRequest } from '../../types';
import toast from 'react-hot-toast';
import { Plus, Network, X, Search, FileText, Send, Trash2, ChevronDown, ChevronRight, Pencil, MapPin, CheckCircle2, ArrowRight as ArrowRightIcon, User, ShoppingCart, ExternalLink, ImagePlus, GripVertical } from 'lucide-react';
import CountryCombobox from '../../components/ui/CountryCombobox';
import { useAuthStore } from '../../store/authStore';
import { useRecordTitle } from '../../hooks/usePageTitle';
import ProjectReleasePOModal from './ProjectReleasePOModal';

const ProjectsMap = lazy(() => import('../../components/ui/ProjectsMap'));

type Tab = 'systems' | 'tanks' | 'piping' | 'documents' | 'changes' | 'bom-release' | 'pos';


type Tank = {
  id: string; tank_code: string; tank_name: string; tank_type?: string;
  product_code?: string;
  product_shape?: string; product_length_mm?: number; product_width_mm?: number; product_height_mm?: number;
  product_water_level_mm?: number; product_gross_volume_m3?: number; product_operating_volume_m3?: number;
  product_material?: string; status?: string;
};

const PROJECT_LIFECYCLE = ['Draft', 'Concept', 'Design', 'Handover', 'Released', 'Complete'];

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const isPrivileged = user?.role === 'admin' || user?.role === 'engineer';
  const [tab, setTab] = useState<Tab>('systems');
  const [showNewSystem, setShowNewSystem] = useState(false);
  const [showNewTank, setShowNewTank] = useState(false);
  const [editSystemRow, setEditSystemRow] = useState<any>(null);
  const [editSystemForm, setEditSystemForm] = useState<any>(null);
  const [editSystemSaving, setEditSystemSaving] = useState(false);
  const [deletingSystemId, setDeletingSystemId] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState(false);
  const [projectForm, setProjectForm] = useState<any>(null);
  const [projectSaving, setProjectSaving] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [tankDisplayOrder, setTankDisplayOrder] = useState<string[]>([]);
  const tankDragIdx = useRef<number | null>(null);
  const tankOverIdx = useRef<number | null>(null);
  const [draggingTankId, setDraggingTankId] = useState<string | null>(null);
  const [overTankId, setOverTankId] = useState<string | null>(null);

  const [tankProductSearch, setTankProductSearch] = useState('');
  const [selectedTankProduct, setSelectedTankProduct] = useState<any>(null);
  const [tankCode, setTankCode] = useState('');
  const [tankStatus, setTankStatus] = useState('Active');
  const [tankSystemId, setTankSystemId] = useState('');
  const [tankQuantity, setTankQuantity] = useState(1);
  const [tankSubmitting, setTankSubmitting] = useState(false);
  const [tankMode, setTankMode] = useState<'search' | 'manual'>('search');
  const [tankName, setTankName] = useState('');
  const [tankType, setTankType] = useState('');
  const [tankShapeType, setTankShapeType] = useState('');
  const [tankLengthMm, setTankLengthMm] = useState('');
  const [tankWidthMm, setTankWidthMm] = useState('');
  const [tankHeightMm, setTankHeightMm] = useState('');
  const [tankDesignWaterLevel, setTankDesignWaterLevel] = useState('');
  const [tankWallThickness, setTankWallThickness] = useState('');
  const [tankMaterial, setTankMaterial] = useState('');
  const [tankGrossVolume, setTankGrossVolume] = useState('');
  const [tankOperatingVolume, setTankOperatingVolume] = useState('');
  const [tankSaveToFamily, setTankSaveToFamily] = useState(false);
  const [tankFamilyId, setTankFamilyId] = useState('');
  const [tankNewProductCode, setTankNewProductCode] = useState('');
  const [expandedTanks, setExpandedTanks] = useState<Set<string>>(new Set());
  const [editingInstance, setEditingInstance] = useState<{ id: string; value: string } | null>(null);
  const [savingInstanceId, setSavingInstanceId] = useState<string | null>(null);
  const [deletingTankId, setDeletingTankId] = useState<string | null>(null);
  const [saveTankDbModal, setSaveTankDbModal] = useState<any>(null);
  const [saveTankDbCode, setSaveTankDbCode] = useState('');
  const [saveTankDbName, setSaveTankDbName] = useState('');
  const [saveTankDbFamilyId, setSaveTankDbFamilyId] = useState('');
  const [saveTankDbSubmitting, setSaveTankDbSubmitting] = useState(false);
  const [editTankModal, setEditTankModal] = useState<any>(null);
  const [editTankForm, setEditTankForm] = useState<any>({});
  const [editTankSubmitting, setEditTankSubmitting] = useState(false);

  const [showNewPiping, setShowNewPiping] = useState(false);
  const [pipingProductSearch, setPipingProductSearch] = useState('');
  const [selectedPipingProduct, setSelectedPipingProduct] = useState<any>(null);
  const [pipingCode, setPipingCode] = useState('');
  const [pipingQty, setPipingQty] = useState('1');
  const [pipingUnit, setPipingUnit] = useState('EA');
  const [pipingDesc, setPipingDesc] = useState('');
  const [pipingSubmitting, setPipingSubmitting] = useState(false);

  const [pmEditMode, setPmEditMode] = useState<'pick' | 'manual'>('pick');
  const [pmEditSearch, setPmEditSearch] = useState('');
  const [pmEditOpen, setPmEditOpen] = useState(false);
  const pmEditRef = useRef<HTMLDivElement>(null);

  const [showReleasePOModal, setShowReleasePOModal] = useState(false);

  const [showNewBomRelease, setShowNewBomRelease] = useState(false);
  const [bomTitle, setBomTitle] = useState('');
  const [bomRevision, setBomRevision] = useState('A');
  const [bomNotes, setBomNotes] = useState('');
  const [bomSections, setBomSections] = useState<Record<string, boolean>>({ Products: true, Tank: true, Piping: true });
  const [bomSubmitting, setBomSubmitting] = useState(false);
  const [selectedRelease, setSelectedRelease] = useState<any>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({ Products: true, Equipment: true, Tank: true, Piping: true });

  const { data: project, isLoading, refetch } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.get(`/projects/${id}`).then(r => r.data),
  });
  useRecordTitle(project?.project_name);

  const { data: systems } = useQuery({
    queryKey: ['project-systems', id],
    queryFn: () => api.get(`/projects/${id}/systems`).then(r => r.data),
    enabled: tab === 'systems',
  });


  const { data: tanks } = useQuery({
    queryKey: ['project-tanks', id],
    queryFn: () => api.get(`/tanks?project_id=${id}`).then(r => r.data),
    enabled: tab === 'tanks',
  });

  const { data: documents } = useQuery({
    queryKey: ['project-docs', id],
    queryFn: () => api.get(`/documents?project_id=${id}&page_size=200`).then(r => r.data),
    enabled: tab === 'documents',
  });

  const { data: changes } = useQuery({
    queryKey: ['project-changes', id],
    queryFn: () => api.get(`/change-requests?project_id=${id}&page_size=200`).then(r => r.data),
    enabled: tab === 'changes',
  });

  const { data: tankProductResults } = useQuery({
    queryKey: ['tank-product-search', tankProductSearch],
    queryFn: () => api.get(`/product-masters?q=${tankProductSearch}&category=Tank&page_size=8`).then(r => r.data),
    enabled: tankProductSearch.length >= 2 && !selectedTankProduct,
  });

  const { data: tankFamilies } = useQuery({
    queryKey: ['tank-families'],
    queryFn: () => api.get('/tank-families').then(r => r.data),
    enabled: (showNewTank && tankMode === 'manual' && tankSaveToFamily) || saveTankDbModal != null,
  });

  const { data: materialsData } = useQuery({
    queryKey: ['materials-list'],
    queryFn: () => api.get('/materials').then(r => r.data),
    enabled: showNewTank && tankMode === 'manual',
    staleTime: 5 * 60 * 1000,
  });
  const materials: { material_code: string; material_name: string }[] = materialsData?.items ?? [];

  const { data: piping } = useQuery({
    queryKey: ['project-piping', id],
    queryFn: () => api.get(`/projects/${id}/piping`).then(r => r.data),
    enabled: tab === 'piping',
  });

  const { data: systemTypesData } = useQuery({
    queryKey: ['system-types'],
    queryFn: () => api.get('/admin/system-types').then(r => r.data),
  });
  const systemTypeOptions: string[] = (systemTypesData?.items || []).map((t: any) => t.name);

  const { data: pipingProductResults } = useQuery({
    queryKey: ['piping-product-search', pipingProductSearch],
    queryFn: () => api.get(`/product-masters?q=${pipingProductSearch}&category=Piping&page_size=8`).then(r => r.data),
    enabled: pipingProductSearch.length >= 2 && !selectedPipingProduct,
  });

  const { data: bomReleases } = useQuery({
    queryKey: ['project-bom-releases', id],
    queryFn: () => api.get(`/projects/${id}/bom-releases`).then(r => r.data),
    enabled: tab === 'bom-release',
  });

  const { data: projectPOs } = useQuery({
    queryKey: ['project-pos', id],
    queryFn: () => api.get(`/purchase-orders?project_id=${id}&page_size=100`).then(r => r.data),
    enabled: tab === 'pos',
  });

  const { data: usersData } = useQuery({
    queryKey: ['admin-users-list'],
    queryFn: () => api.get('/admin/users').then(r => r.data),
    staleTime: 60_000,
  });
  const allUsers: any[] = usersData?.items || [];

  useEffect(() => {
    if (!pmEditOpen) return;
    const h = (e: MouseEvent) => { if (!pmEditRef.current?.contains(e.target as Node)) setPmEditOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [pmEditOpen]);

  if (isLoading) return <div className="p-8 text-slate-400">Loading...</div>;
  if (!project) return <div className="p-8 text-slate-400">Project not found</div>;

  const startEditProject = () => {
    setProjectForm({
      project_name: project.project_name || '',
      client_name: project.client_name || '',
      site_name: project.site_name || '',
      country: project.country || '',
      city: project.city || '',
      latitude: project.latitude ?? '',
      longitude: project.longitude ?? '',
      project_status: project.project_status || 'Draft',
      start_date: project.start_date?.split('T')[0] || '',
      target_completion_date: project.target_completion_date?.split('T')[0] || '',
      project_manager: project.project_manager || '',
      engineering_manager: project.engineering_manager || '',
      qa_owner: project.qa_owner || '',
      notes: project.notes || '',
    });
    setEditingProject(true);
  };

  const handleSaveProject = async () => {
    setProjectSaving(true);
    try {
      await api.put(`/projects/${project.id}`, projectForm);
      toast.success('Project saved');
      refetch();
      qc.invalidateQueries({ queryKey: ['projects'] });
      setEditingProject(false);
    } catch { toast.error('Save failed'); }
    finally { setProjectSaving(false); }
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      await api.put(`/projects/${project.id}`, { ...project, project_status: newStatus });
      toast.success(`Status updated to ${newStatus}`);
      refetch();
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['pending-approvals'] });
    } catch { toast.error('Status update failed'); }
  };

  const openEditSystem = (row: any) => {
    setEditSystemRow(row);
    setEditSystemForm({
      system_code: row.system_code || '',
      system_name: row.system_name || '',
      system_type: row.system_type || '',
      water_type: row.water_type || '',
      design_flow_m3h: row.design_flow_m3h ?? '',
      turnover_rate_hr: row.turnover_rate_hr ?? '',
      status: row.status || 'Draft',
      duty_description: row.duty_description || '',
      redundancy_strategy: row.redundancy_strategy || '',
    });
  };

  const handleEditSystemSave = async () => {
    if (!editSystemRow) return;
    setEditSystemSaving(true);
    try {
      await api.put(`/systems/${editSystemRow.id}`, editSystemForm);
      toast.success('System updated');
      qc.invalidateQueries({ queryKey: ['project-systems'] });
      setEditSystemRow(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Save failed');
    }
    finally { setEditSystemSaving(false); }
  };

  const handleDeleteSystem = async (sys: System) => {
    if (!window.confirm(`Delete system "${sys.system_code} – ${sys.system_name}"? This cannot be undone.`)) return;
    setDeletingSystemId(sys.id);
    try {
      await api.delete(`/systems/${sys.id}`);
      toast.success('System deleted');
      qc.invalidateQueries({ queryKey: ['project-systems'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to delete system');
    } finally {
      setDeletingSystemId(null);
    }
  };

  const sysCols: Column<System>[] = [
    { key: 'system_code', header: 'Code', render: r => <EntityCode code={r.system_code} /> },
    { key: 'system_name', header: 'System Name', render: r => <span className="font-medium">{r.system_name}</span> },
    { key: 'system_type', header: 'Type' },
    { key: 'water_type', header: 'Water Type' },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
  ];

  const docCols: Column<Document>[] = [
    { key: 'document_code', header: 'Code', render: r => <EntityCode code={r.document_code} /> },
    { key: 'document_title', header: 'Title', render: r => <span className="font-medium">{r.document_title}</span> },
    { key: 'document_type', header: 'Type' },
    { key: 'current_revision', header: 'Rev', render: r => <span className="font-mono text-xs">{r.current_revision}</span> },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
  ];

  const fmt = (v?: number | null) => v != null ? <span>{v}</span> : <span className="text-slate-300">—</span>;

  const tankCols: Column<Tank>[] = [
    { key: 'tank_code', header: 'Tag', render: r => <EntityCode code={r.tank_code} /> },
    { key: 'tank_name', header: 'Tank Name', render: r => <span className="font-medium">{r.tank_name}</span> },
    { key: 'quantity' as any, header: 'Qty', render: (r: any) => <span className="font-mono text-sm">{r.quantity ?? 1}</span> },
    { key: 'system_code' as any, header: 'System', render: (r: any) => r.system_code
      ? <EntityCode code={r.system_code} />
      : <span className="text-slate-300">—</span>
    },
    { key: 'product_code', header: 'Product', render: r => r.product_code
      ? <Link to={`/products/masters/${r.product_code}`} onClick={e => e.stopPropagation()} className="text-blue-600 hover:underline"><EntityCode code={r.product_code} /></Link>
      : <span className="text-slate-300">—</span>
    },
    { key: 'tank_type', header: 'Type', render: r => r.tank_type ? <span>{r.tank_type}</span> : <span className="text-slate-300">—</span> },
    { key: 'eff_shape' as any, header: 'Shape', render: (r: any) => r.eff_shape ? <span>{r.eff_shape}</span> : <span className="text-slate-300">—</span> },
    { key: 'eff_length_mm' as any, header: 'L (mm)', render: (r: any) => fmt(r.eff_length_mm) },
    { key: 'eff_width_mm' as any, header: 'W (mm)', render: (r: any) => fmt(r.eff_width_mm) },
    { key: 'eff_height_mm' as any, header: 'H (mm)', render: (r: any) => fmt(r.eff_height_mm) },
    { key: 'eff_water_level_mm' as any, header: 'Water Level (mm)', render: (r: any) => fmt(r.eff_water_level_mm) },
    { key: 'gross_volume_m3' as any, header: 'Gross Vol (m³)', render: (r: any) => (r as any).gross_volume_m3 != null ? <span className="font-mono text-xs">{parseFloat((r as any).gross_volume_m3).toFixed(4)}</span> : <span className="text-slate-300 text-xs italic">no dims</span> },
    { key: 'design_volume_m3' as any, header: 'Design Vol (m³)', render: (r: any) => (r as any).design_volume_m3 != null ? <span className="font-mono text-xs">{parseFloat((r as any).design_volume_m3).toFixed(4)}</span> : <span className="text-slate-300 text-xs italic">no dims</span> },
    { key: 'product_material' as any, header: 'Material', render: (r: any) => r.product_material ? <EntityCode code={r.product_material} /> : <span className="text-slate-300">—</span> },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status || 'Active'} /> },
  ];

  const crCols: Column<ChangeRequest>[] = [
    { key: 'change_code', header: 'Code', render: r => <EntityCode code={r.change_code} /> },
    { key: 'title', header: 'Title', render: r => <span className="font-medium">{r.title}</span> },
    { key: 'risk_level', header: 'Risk' },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
    { key: 'requested_by_name', header: 'Requested By' },
  ];

  const pipingCols: Column<any>[] = [
    { key: 'piping_code', header: 'Tag', render: r => <EntityCode code={r.piping_code} /> },
    { key: 'product_code', header: 'Product', render: r => r.product_code
      ? <Link to={`/products/masters/${r.product_code}`} onClick={e => e.stopPropagation()} className="text-blue-600 hover:underline"><EntityCode code={r.product_code} /></Link>
      : <span className="text-slate-300">—</span>
    },
    { key: 'product_name', header: 'Description', render: r => <span className="font-medium">{r.description || r.product_name || '—'}</span> },
    { key: 'application_type', header: 'Type', render: r => r.application_type ? <span>{r.application_type}</span> : <span className="text-slate-300">—</span> },
    { key: 'quantity', header: 'Qty', render: r => <span>{r.quantity}</span> },
    { key: 'unit', header: 'Unit' },
    { key: 'system_code', header: 'System', render: r => r.system_code ? <EntityCode code={r.system_code} /> : <span className="text-slate-300">—</span> },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status || 'Design'} /> },
  ];

  const bomReleaseCols: Column<any>[] = [
    { key: 'release_code', header: 'Code', render: r => <EntityCode code={r.release_code} /> },
    { key: 'title', header: 'Title', render: r => <span className="font-medium">{r.title}</span> },
    { key: 'revision', header: 'Rev', render: r => <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{r.revision}</span> },
    { key: 'line_count', header: 'Items', render: r => <span>{r.line_count}</span> },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
    { key: 'issued_date', header: 'Issued', render: r => r.issued_date ? <span className="text-sm">{r.issued_date.split('T')[0]}</span> : <span className="text-slate-300">—</span> },
    { key: 'created_by_name', header: 'Created By' },
  ];

  const resetTankForm = () => {
    setSelectedTankProduct(null); setTankProductSearch('');
    setTankCode(''); setTankStatus('Active'); setTankSystemId(''); setTankQuantity(1);
    setTankMode('search'); setTankName(''); setTankType('Display'); setTankShapeType('Rectangular');
    setTankLengthMm(''); setTankWidthMm(''); setTankHeightMm('');
    setTankDesignWaterLevel(''); setTankWallThickness(''); setTankMaterial('');
    setTankGrossVolume(''); setTankOperatingVolume('');
    setTankSaveToFamily(false); setTankFamilyId(''); setTankNewProductCode('');
  };

  const handleAddTank = async () => {
    if (!tankCode.trim()) { toast.error('Tank tag code is required'); return; }
    if (tankMode === 'search' && !selectedTankProduct) { toast.error('Select a tank product from the Shark OS'); return; }
    if (tankMode === 'manual' && !tankName.trim()) { toast.error('Tank name is required'); return; }
    if (tankMode === 'manual' && tankSaveToFamily && !tankNewProductCode.trim()) { toast.error('Product code is required to save to Tank Families'); return; }
    setTankSubmitting(true);
    try {
      if (tankMode === 'search') {
        await api.post('/tanks', {
          tank_code: tankCode.trim().toUpperCase(),
          tank_name: selectedTankProduct.product_name,
          tank_type: selectedTankProduct.application_type || null,
          product_master_id: selectedTankProduct.id,
          project_id: project.id,
          system_id: tankSystemId || null,
          quantity: tankQuantity || 1,
          status: tankStatus,
        });
      } else {
        let productMasterId: string | null = null;
        if (tankSaveToFamily) {
          const pmRes = await api.post('/product-masters', {
            product_code: tankNewProductCode.trim().toUpperCase(),
            product_name: tankName.trim(),
            product_category: 'Tank',
            application_type: tankType || null,
            shape_type: tankShapeType || null,
            length_mm: tankLengthMm ? parseFloat(tankLengthMm) : null,
            width_mm: tankWidthMm ? parseFloat(tankWidthMm) : null,
            height_mm: tankHeightMm ? parseFloat(tankHeightMm) : null,
            design_water_level_mm: tankDesignWaterLevel ? parseFloat(tankDesignWaterLevel) : null,
            wall_thickness_mm: tankWallThickness ? parseFloat(tankWallThickness) : null,
            primary_material_code: tankMaterial || null,
            tank_family_id: tankFamilyId || null,
            standard_status: 'Concept',
          });
          productMasterId = pmRes.data.id;
          toast.success(`Saved to Tank Families as ${tankNewProductCode.trim().toUpperCase()}`);
        }
        await api.post('/tanks', {
          tank_code: tankCode.trim().toUpperCase(),
          tank_name: tankName.trim(),
          tank_type: tankType || null,
          product_master_id: productMasterId,
          project_id: project.id,
          system_id: tankSystemId || null,
          quantity: tankQuantity || 1,
          status: tankStatus,
          shape_type: !productMasterId ? (tankShapeType || null) : null,
          length_mm: !productMasterId ? (tankLengthMm ? parseFloat(tankLengthMm) : null) : null,
          width_mm: !productMasterId ? (tankWidthMm ? parseFloat(tankWidthMm) : null) : null,
          height_mm: !productMasterId ? (tankHeightMm ? parseFloat(tankHeightMm) : null) : null,
          design_water_level_mm: !productMasterId ? (tankDesignWaterLevel ? parseFloat(tankDesignWaterLevel) : null) : null,
          primary_material: !productMasterId ? (tankMaterial || null) : null,
          gross_volume_m3: (!productMasterId && tankShapeType === 'Custom' && tankGrossVolume) ? parseFloat(tankGrossVolume) : undefined,
          operating_volume_m3: (!productMasterId && tankShapeType === 'Custom' && tankOperatingVolume) ? parseFloat(tankOperatingVolume) : undefined,
        });
      }
      toast.success('Tank added');
      resetTankForm();
      setShowNewTank(false);
      qc.invalidateQueries({ queryKey: ['project-tanks'] });
      qc.invalidateQueries({ queryKey: ['project-systems'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || 'Failed to add tank');
    } finally {
      setTankSubmitting(false);
    }
  };

  const toggleTankExpand = (tankId: string) => {
    setExpandedTanks(prev => {
      const next = new Set(prev);
      if (next.has(tankId)) { next.delete(tankId); } else { next.add(tankId); }
      return next;
    });
  };

  const handleSaveInstanceTag = async (instanceId: string, newTag: string) => {
    if (!newTag.trim()) { toast.error('Tag cannot be empty'); return; }
    setSavingInstanceId(instanceId);
    try {
      await api.patch(`/tank-instances/${instanceId}`, { tag: newTag.trim() });
      toast.success('Tag updated');
      setEditingInstance(null);
      qc.invalidateQueries({ queryKey: ['project-tanks'] });
    } catch {
      toast.error('Failed to update tag');
    } finally {
      setSavingInstanceId(null);
    }
  };

  const openEditTank = (tank: any) => {
    setEditTankModal(tank);
    setEditTankForm({
      tank_code: tank.tank_code || '',
      tank_name: tank.tank_name || '',
      tank_type: tank.tank_type || '',
      shape_type: tank.eff_shape || tank.shape_type || '',
      length_mm: tank.eff_length_mm ?? tank.length_mm ?? '',
      width_mm: tank.eff_width_mm ?? tank.width_mm ?? '',
      height_mm: tank.eff_height_mm ?? tank.height_mm ?? '',
      design_water_level_mm: tank.eff_water_level_mm ?? tank.design_water_level_mm ?? '',
      primary_material: tank.primary_material || '',
      status: tank.status || 'Active',
      quantity: tank.quantity ?? 1,
      notes: tank.notes || '',
      system_id: tank.system_id || '',
    });
  };

  const handleSaveTankEdit = async () => {
    if (!editTankModal) return;
    setEditTankSubmitting(true);
    try {
      await api.put(`/tanks/${editTankModal.id}`, editTankForm);
      toast.success('Tank updated');
      qc.invalidateQueries({ queryKey: ['project-tanks'] });
      setEditTankModal(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to update tank');
    } finally {
      setEditTankSubmitting(false);
    }
  };

  const handleDeleteTank = async (tank: any) => {
    if (!window.confirm(`Remove tank "${tank.tank_code} – ${tank.tank_name}" from this project? This cannot be undone.`)) return;
    setDeletingTankId(tank.id);
    try {
      await api.delete(`/tanks/${tank.id}`);
      toast.success('Tank removed');
      qc.invalidateQueries({ queryKey: ['project-tanks'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to remove tank');
    } finally {
      setDeletingTankId(null);
    }
  };

  const openSaveTankToDb = (tank: any) => {
    setSaveTankDbModal(tank);
    setSaveTankDbCode(tank.tank_code);
    setSaveTankDbName(tank.tank_name);
    setSaveTankDbFamilyId('');
  };

  const handleSaveTankToDb = async () => {
    if (!saveTankDbModal || !saveTankDbCode.trim()) return;
    setSaveTankDbSubmitting(true);
    try {
      const t = saveTankDbModal;
      const pm = await api.post('/product-masters', {
        product_code: saveTankDbCode.trim().toUpperCase(),
        product_name: saveTankDbName.trim() || t.tank_name,
        product_category: 'Tank',
        tank_family_id: saveTankDbFamilyId || null,
        shape_type: t.eff_shape || t.shape_type || null,
        length_mm: t.eff_length_mm || t.length_mm || null,
        width_mm: t.eff_width_mm || t.width_mm || null,
        height_mm: t.eff_height_mm || t.height_mm || null,
        design_water_level_mm: t.eff_water_level_mm || t.design_water_level_mm || null,
        gross_volume_m3: t.gross_volume_m3 || null,
        operating_volume_m3: t.operating_volume_m3 || null,
        primary_material_code: t.product_material || t.primary_material || null,
        standard_status: 'Concept',
      });
      await api.patch(`/tanks/${t.id}`, { product_master_id: pm.data.id });
      toast.success(`Saved as ${pm.data.product_code} in Tank Database`);
      qc.invalidateQueries({ queryKey: ['project-tanks'] });
      setSaveTankDbModal(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Save to Tank Database failed');
    } finally {
      setSaveTankDbSubmitting(false);
    }
  };

  const handleAddPiping = async () => {
    if (!pipingCode.trim()) { toast.error('Tag code is required'); return; }
    if (!selectedPipingProduct) { toast.error('Select a piping product from the Shark OS'); return; }
    setPipingSubmitting(true);
    try {
      await api.post('/piping-items', {
        piping_code: pipingCode.trim().toUpperCase(),
        project_id: project.id,
        product_master_id: selectedPipingProduct.id,
        description: pipingDesc.trim() || null,
        quantity: parseFloat(pipingQty) || 1,
        unit: pipingUnit,
      });
      toast.success('Piping item added');
      setShowNewPiping(false);
      setSelectedPipingProduct(null);
      setPipingProductSearch('');
      setPipingCode('');
      setPipingQty('1');
      setPipingUnit('EA');
      setPipingDesc('');
      qc.invalidateQueries({ queryKey: ['project-piping'] });
    } catch {
      toast.error('Failed to add piping item');
    } finally {
      setPipingSubmitting(false);
    }
  };

  const handleDeletePiping = async (itemId: string) => {
    try {
      await api.delete(`/piping-items/${itemId}`);
      toast.success('Item removed');
      qc.invalidateQueries({ queryKey: ['project-piping'] });
    } catch {
      toast.error('Failed to remove item');
    }
  };

  const handleCreateBomRelease = async () => {
    setBomSubmitting(true);
    try {
      const selectedSections = Object.entries(bomSections).filter(([, v]) => v).map(([k]) => k);
      if (selectedSections.length === 0) { toast.error('Select at least one section to include'); setBomSubmitting(false); return; }
      await api.post('/bom-releases', {
        project_id: project.id,
        title: bomTitle.trim() || undefined,
        revision: bomRevision || 'A',
        notes: bomNotes.trim() || undefined,
        include_sections: selectedSections,
      });
      toast.success('BOM release created');
      setShowNewBomRelease(false);
      setBomTitle('');
      setBomRevision('A');
      setBomNotes('');
      setBomSections({ Products: true, Tank: true, Piping: true });
      qc.invalidateQueries({ queryKey: ['project-bom-releases'] });
    } catch {
      toast.error('Failed to create BOM release');
    } finally {
      setBomSubmitting(false);
    }
  };

  const handleIssueRelease = async (releaseId: string) => {
    try {
      const updated = await api.post(`/bom-releases/${releaseId}/issue`, {});
      toast.success('BOM release issued');
      qc.invalidateQueries({ queryKey: ['project-bom-releases'] });
      if (selectedRelease?.id === releaseId) setSelectedRelease({ ...selectedRelease, status: 'Issued', issued_date: updated.data.issued_date });
    } catch {
      toast.error('Failed to issue release');
    }
  };

  const handleDeleteRelease = async (releaseId: string) => {
    try {
      await api.delete(`/bom-releases/${releaseId}`);
      toast.success('BOM release deleted');
      qc.invalidateQueries({ queryKey: ['project-bom-releases'] });
      if (selectedRelease?.id === releaseId) setSelectedRelease(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to delete release');
    }
  };

  const handleViewRelease = async (releaseId: string) => {
    try {
      const result = await api.get(`/bom-releases/${releaseId}`);
      setSelectedRelease(result.data);
    } catch {
      toast.error('Failed to load release');
    }
  };

  useEffect(() => {
    if (!tanks?.items) return;
    const ids: string[] = tanks.items.map((t: any) => t.id);
    setTankDisplayOrder(prev => {
      if (prev.length === ids.length && ids.every(id => prev.includes(id))) return prev;
      return ids;
    });
  }, [tanks?.items]);

  const handleTankDragStart = (e: React.DragEvent, idx: number) => {
    tankDragIdx.current = idx;
    setDraggingTankId(tankDisplayOrder[idx] ?? null);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleTankDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    tankOverIdx.current = idx;
    setOverTankId(tankDisplayOrder[idx] ?? null);
  };

  const handleTankDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const from = tankDragIdx.current, to = tankOverIdx.current;
    tankDragIdx.current = null; tankOverIdx.current = null;
    setDraggingTankId(null); setOverTankId(null);
    if (from === null || to === null || from === to) return;
    const next = [...tankDisplayOrder];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setTankDisplayOrder(next);
    try { await api.patch('/tanks/reorder', { orderedIds: next }); }
    catch { toast.error('Failed to save order'); }
  };

  const handleTankDragEnd = () => {
    setDraggingTankId(null); setOverTankId(null);
    tankDragIdx.current = null; tankOverIdx.current = null;
  };

  const handleLogoUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    setLogoUploading(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      await api.post(`/projects/${project.id}/logo`, fd, { headers: { 'Content-Type': undefined } });
      toast.success('Logo updated');
      qc.invalidateQueries({ queryKey: ['project', id] });
    } catch {
      toast.error('Failed to upload logo');
    } finally {
      setLogoUploading(false);
    }
  };

  const toggleSection = (section: string) =>
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        code={project.project_code} title={project.project_name} status={project.project_status}
        subtitle={`${project.client_name || ''} ${project.country ? '· ' + project.country : ''}`}
        crumbs={[{ label: 'Projects', href: '/projects' }, { label: project.project_code }]}
        actions={
          <div className="flex gap-2">
            <Button size="sm" onClick={() => navigate(`/graph?start=${project.id}&type=project`)}>
              <Network className="w-3.5 h-3.5" />Graph
            </Button>
            {!editingProject ? (
              <Button size="sm" variant="primary" onClick={startEditProject}>
                <Pencil className="w-3.5 h-3.5" />Edit
              </Button>
            ) : (
              <>
                <Button size="sm" onClick={() => setEditingProject(false)}>Cancel</Button>
                <Button size="sm" variant="primary" onClick={handleSaveProject} disabled={projectSaving}>
                  {projectSaving ? 'Saving...' : 'Save Changes'}
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="col-span-2">
            {!editingProject ? (
              <MetadataPanel fields={[
                { label: 'Client', value: project.client_name },
                { label: 'Site', value: project.site_name },
                { label: 'Location', value: [project.city, project.country].filter(Boolean).join(', ') },
                { label: 'Coordinates', value: project.latitude != null && project.longitude != null ? `${project.latitude}, ${project.longitude}` : null },
                { label: 'Start Date', value: project.start_date?.split('T')[0] },
                { label: 'Target Completion', value: project.target_completion_date?.split('T')[0] },
                { label: 'Project Manager', value: project.project_manager },
                { label: 'Engineering Manager', value: project.engineering_manager },
                { label: 'QA Owner', value: project.qa_owner },
              ]} />
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg p-5">
                <div className="text-xs text-slate-400 uppercase tracking-wide mb-4">Edit Project Details</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Project Name</label>
                    <input value={projectForm.project_name} onChange={e => setProjectForm((f: any) => ({ ...f, project_name: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Client</label>
                    <input value={projectForm.client_name} onChange={e => setProjectForm((f: any) => ({ ...f, client_name: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Site Name</label>
                    <input value={projectForm.site_name} onChange={e => setProjectForm((f: any) => ({ ...f, site_name: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Country</label>
                    <CountryCombobox value={projectForm.country} onChange={v => setProjectForm((f: any) => ({ ...f, country: v }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">City</label>
                    <input value={projectForm.city} onChange={e => setProjectForm((f: any) => ({ ...f, city: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" />Latitude</label>
                    <input type="number" step="any" placeholder="e.g. 25.2048" value={projectForm.latitude} onChange={e => setProjectForm((f: any) => ({ ...f, latitude: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" />Longitude</label>
                    <input type="number" step="any" placeholder="e.g. 55.2708" value={projectForm.longitude} onChange={e => setProjectForm((f: any) => ({ ...f, longitude: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                    <select value={projectForm.project_status} onChange={e => setProjectForm((f: any) => ({ ...f, project_status: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30">
                      {['Draft', 'Concept', 'Design', 'Handover', 'Released', 'Complete', 'On Hold', 'Cancelled'].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Start Date</label>
                    <input type="date" value={projectForm.start_date} onChange={e => setProjectForm((f: any) => ({ ...f, start_date: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Target Completion</label>
                    <input type="date" value={projectForm.target_completion_date} onChange={e => setProjectForm((f: any) => ({ ...f, target_completion_date: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-slate-600">Project Manager</label>
                      <button type="button" onClick={() => { setPmEditMode(m => m === 'pick' ? 'manual' : 'pick'); setPmEditSearch(''); }}
                        className="text-[11px] text-blue-600 hover:underline">
                        {pmEditMode === 'pick' ? 'Type manually' : 'Pick from users'}
                      </button>
                    </div>
                    {pmEditMode === 'manual' ? (
                      <input value={projectForm.project_manager} onChange={e => setProjectForm((f: any) => ({ ...f, project_manager: e.target.value }))}
                        placeholder="Enter full name…"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30" />
                    ) : (
                      <div ref={pmEditRef} className="relative">
                        <div className="flex items-center border border-slate-200 rounded-lg px-3 py-2 text-sm cursor-pointer focus-within:ring-2 focus-within:ring-blue-600/30"
                          onClick={() => setPmEditOpen(o => !o)}>
                          <User className="w-3.5 h-3.5 text-slate-400 mr-2 shrink-0" />
                          {pmEditOpen ? (
                            <input autoFocus value={pmEditSearch} onChange={e => setPmEditSearch(e.target.value)}
                              placeholder={projectForm.project_manager || 'Search users…'}
                              className="flex-1 outline-none text-sm bg-transparent"
                              onKeyDown={e => { if (e.key === 'Escape') setPmEditOpen(false); }} />
                          ) : (
                            <span className={`flex-1 ${projectForm.project_manager ? 'text-slate-800' : 'text-slate-400'}`}>
                              {projectForm.project_manager || 'Select project manager…'}
                            </span>
                          )}
                          {projectForm.project_manager && !pmEditOpen && (
                            <button type="button" onClick={e => { e.stopPropagation(); setProjectForm((f: any) => ({ ...f, project_manager: '' })); }}
                              className="text-slate-300 hover:text-slate-500 ml-1"><X className="w-3.5 h-3.5" /></button>
                          )}
                        </div>
                        {pmEditOpen && (
                          <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-44 overflow-y-auto">
                            {(pmEditSearch ? allUsers.filter(u => `${u.first_name} ${u.last_name}`.toLowerCase().includes(pmEditSearch.toLowerCase())) : allUsers).map((u: any) => {
                              const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email;
                              return (
                                <button key={u.id} type="button"
                                  onMouseDown={() => { setProjectForm((f: any) => ({ ...f, project_manager: name })); setPmEditOpen(false); setPmEditSearch(''); }}
                                  className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2.5 border-b border-slate-50 last:border-0">
                                  <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold shrink-0">
                                    {(u.first_name?.[0] || u.email[0]).toUpperCase()}
                                  </div>
                                  <div>
                                    <div className="text-sm font-medium text-slate-800">{name}</div>
                                    <div className="text-xs text-slate-400">{u.role}</div>
                                  </div>
                                </button>
                              );
                            })}
                            <button type="button"
                              onMouseDown={() => { setPmEditMode('manual'); setPmEditOpen(false); }}
                              className="w-full text-left px-3 py-2 text-xs text-blue-600 hover:bg-blue-50 border-t border-slate-100 font-medium">
                              + Enter a name not in the system
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Engineering Manager</label>
                    <input value={projectForm.engineering_manager} onChange={e => setProjectForm((f: any) => ({ ...f, engineering_manager: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">QA Owner</label>
                    <input value={projectForm.qa_owner} onChange={e => setProjectForm((f: any) => ({ ...f, qa_owner: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                    <textarea value={projectForm.notes} onChange={e => setProjectForm((f: any) => ({ ...f, notes: e.target.value }))}
                      rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30" />
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="space-y-3">
            {/* Client Logo Card */}
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-3">Client Logo</div>
              <input ref={logoInputRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); if (logoInputRef.current) logoInputRef.current.value = ''; }} />
              {project.logo_url ? (
                <div className="flex flex-col items-center gap-3">
                  <img src={project.logo_url} alt="Client logo"
                    className="max-h-20 max-w-full object-contain rounded" />
                  {isPrivileged && (
                    <button onClick={() => logoInputRef.current?.click()} disabled={logoUploading}
                      className="text-xs text-slate-400 hover:text-blue-600 transition-colors disabled:opacity-50">
                      {logoUploading ? 'Uploading…' : 'Change logo'}
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => isPrivileged && logoInputRef.current?.click()}
                  disabled={logoUploading || !isPrivileged}
                  className={`flex flex-col items-center justify-center gap-2 w-full border-2 border-dashed rounded-lg py-6 transition-colors
                    ${isPrivileged ? 'border-slate-200 hover:border-blue-300 hover:text-blue-500 text-slate-400 cursor-pointer' : 'border-slate-100 text-slate-300 cursor-default'}`}>
                  <ImagePlus className="w-6 h-6" />
                  <span className="text-xs">{logoUploading ? 'Uploading…' : isPrivileged ? 'Upload client logo' : 'No logo'}</span>
                </button>
              )}
            </div>

            {/* Status Card with workflow popup */}
            <div className="bg-white border border-slate-200 rounded-lg p-4 relative">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Status</div>
              <div className="flex items-center justify-between">
                <StatusBadge status={project.project_status} className="text-sm px-3 py-1" />
                {isPrivileged && !editingProject && (
                  <button
                    onClick={() => setShowStatusMenu(v => !v)}
                    className="text-xs text-slate-400 hover:text-blue-600 border border-slate-200 rounded-lg px-2 py-1 hover:bg-slate-50 transition-colors flex items-center gap-1"
                    title="Change status"
                  >
                    <ArrowRightIcon className="w-3 h-3" /> Advance
                  </button>
                )}
              </div>

              {/* Workflow Popup */}
              {showStatusMenu && isPrivileged && (() => {
                const currentIdx = PROJECT_LIFECYCLE.indexOf(project.project_status);
                const nextStage = currentIdx >= 0 && currentIdx < PROJECT_LIFECYCLE.length - 1 ? PROJECT_LIFECYCLE[currentIdx + 1] : null;
                const isTerminal = project.project_status === 'Complete' || project.project_status === 'Released' || project.project_status === 'Cancelled';
                return (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowStatusMenu(false)} />
                    <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-40 overflow-hidden">
                      {/* Progress bar */}
                      <div className="px-4 pt-4 pb-3 border-b border-slate-100">
                        <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Project Lifecycle</div>
                        <div className="flex flex-col gap-1">
                          {PROJECT_LIFECYCLE.map((stage, idx) => {
                            const isPast = idx < currentIdx;
                            const isCurrent = stage === project.project_status;
                            return (
                              <button
                                key={stage}
                                onClick={async () => {
                                  if (isCurrent) return;
                                  await handleStatusChange(stage);
                                  setShowStatusMenu(false);
                                }}
                                disabled={isCurrent}
                                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors w-full
                                  ${isCurrent ? 'bg-blue-600 text-white cursor-default'
                                    : 'hover:bg-slate-50 text-slate-700'}
                                `}
                              >
                                <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-xs font-bold
                                  ${isCurrent ? 'bg-white/20 text-white' : isPast ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-400'}
                                `}>
                                  {isPast ? <CheckCircle2 className="w-3.5 h-3.5" /> : <span>{idx + 1}</span>}
                                </span>
                                <span className="font-medium">{stage}</span>
                                {isCurrent && <span className="ml-auto text-xs text-white/70">current</span>}
                                {!isCurrent && stage === nextStage && <span className="ml-auto text-xs text-blue-600 font-semibold">next →</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {/* Side actions */}
                      <div className="px-4 py-3 flex flex-col gap-1">
                        <div className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Other actions</div>
                        {!isTerminal && (
                          <>
                            <button onClick={async () => { await handleStatusChange('On Hold'); setShowStatusMenu(false); }}
                              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left text-blue-600 hover:bg-blue-50 transition-colors w-full font-medium">
                              ⏸ Put On Hold
                            </button>
                            <button onClick={async () => { await handleStatusChange('Cancelled'); setShowStatusMenu(false); }}
                              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left text-red-600 hover:bg-red-50 transition-colors w-full font-medium">
                              ✕ Cancel Project
                            </button>
                          </>
                        )}
                        {isTerminal && (
                          <button onClick={async () => { await handleStatusChange('Draft'); setShowStatusMenu(false); }}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left text-blue-600 hover:bg-blue-50 transition-colors w-full font-medium">
                            ↩ Reopen Project
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
            {project.latitude != null && project.longitude != null && !editingProject && (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden" style={{ height: '160px' }}>
                <Suspense fallback={<div className="h-full flex items-center justify-center text-slate-400 text-xs">Loading map...</div>}>
                  <ProjectsMap projects={[project]} height="160px" singleProject />
                </Suspense>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg">
          <div className="flex border-b border-slate-200">
            {([
              { key: 'systems', label: 'Systems' },
              { key: 'tanks', label: 'Tanks' },
              { key: 'piping', label: 'Piping & Fittings' },
              { key: 'bom-release', label: 'BOM Releases' },
              { key: 'pos', label: `Purchase Orders${projectPOs?.items?.length ? ` (${projectPOs.items.length})` : ''}` },
              { key: 'documents', label: 'Documents' },
              { key: 'changes', label: 'Changes' },
            ] as { key: Tab; label: string }[]).map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {t.label}
              </button>
            ))}
            <div className="ml-auto p-2 flex items-center gap-2">
              {tab === 'systems' && <Button size="sm" variant="primary" onClick={() => setShowNewSystem(true)}><Plus className="w-3.5 h-3.5" />System</Button>}
              {tab === 'tanks' && <Button size="sm" variant="primary" onClick={() => { resetTankForm(); setShowNewTank(true); }}><Plus className="w-3.5 h-3.5" />Add Tank</Button>}
              {tab === 'piping' && <Button size="sm" variant="primary" onClick={() => { setSelectedPipingProduct(null); setPipingProductSearch(''); setPipingCode(''); setPipingQty('1'); setPipingUnit('EA'); setPipingDesc(''); setShowNewPiping(true); }}><Plus className="w-3.5 h-3.5" />Add Item</Button>}
              {tab === 'bom-release' && <Button size="sm" variant="primary" onClick={() => { setBomTitle(''); setBomRevision('A'); setBomNotes(''); setBomSections({ Products: true, Tank: true, Piping: true }); setShowNewBomRelease(true); }}><FileText className="w-3.5 h-3.5" />New Release</Button>}
              {tab === 'pos' && <Button size="sm" variant="primary" onClick={() => setShowReleasePOModal(true)}><ShoppingCart className="w-3.5 h-3.5" />Release PO</Button>}
            </div>
          </div>

          {tab === 'systems' && (() => {
            const sysItems: System[] = systems?.items || [];
            if (sysItems.length === 0) return (
              <div className="p-8 text-center text-sm text-slate-400">No systems added yet — click <strong>System</strong> to add one</div>
            );
            return (
              <div className="divide-y divide-slate-100">
                {sysItems.map(sys => (
                  <div
                    key={sys.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer group"
                    onClick={() => navigate(`/systems/${sys.id}`)}
                  >
                    <EntityCode code={sys.system_code} />
                    <span className="font-medium text-sm text-slate-800 flex-1">{sys.system_name}</span>
                    <span className="text-xs text-slate-400">{sys.system_type}</span>
                    {sys.water_type && <span className="text-xs bg-blue-50 text-blue-600 border border-blue-100 rounded px-1.5 py-0.5">{sys.water_type}</span>}
                    {(sys as any).design_flow_m3h && parseFloat((sys as any).total_operating_volume_m3) > 0 && (
                      <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 font-mono" title="Calculated turnover rate (design flow ÷ operating volume)">
                        {(parseFloat((sys as any).design_flow_m3h) / parseFloat((sys as any).total_operating_volume_m3)).toFixed(1)} /hr
                      </span>
                    )}
                    {(sys as any).tank_count > 0 && (
                      <span className="text-xs text-slate-500 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 font-mono">
                        {(sys as any).tank_count} tank{(sys as any).tank_count !== 1 ? 's' : ''}
                        {parseFloat((sys as any).total_operating_volume_m3) > 0
                          ? ` · ${parseFloat((sys as any).total_operating_volume_m3).toFixed(1)} m³ op.`
                          : parseFloat((sys as any).total_volume_m3) > 0 ? ` · ${parseFloat((sys as any).total_volume_m3).toFixed(1)} m³` : ''}
                      </span>
                    )}
                    <StatusBadge status={sys.status} />
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => openEditSystem(sys)}
                        className="text-xs text-slate-400 hover:text-slate-700 px-1.5 py-0.5 border border-slate-200 rounded hover:bg-slate-100"
                      >Edit</button>
                      <button
                        onClick={async () => {
                          await api.post(`/systems/${sys.id}/duplicate`, {});
                          toast.success('System duplicated');
                          qc.invalidateQueries({ queryKey: ['project-systems'] });
                        }}
                        className="text-xs text-slate-400 hover:text-slate-700 px-1.5 py-0.5 border border-slate-200 rounded hover:bg-slate-100"
                      >Duplicate</button>
                      <button
                        onClick={() => handleDeleteSystem(sys)}
                        disabled={deletingSystemId === sys.id}
                        className="text-xs text-red-400 hover:text-red-600 px-1.5 py-0.5 border border-red-100 rounded hover:bg-red-50 disabled:opacity-50"
                        title="Delete system"
                      >{deletingSystemId === sys.id ? '…' : 'Delete'}</button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
          {tab === 'tanks' && (() => {
            const tankItems: any[] = tanks?.items || [];
            if (tankItems.length === 0) return (
              <div className="text-center py-16 text-slate-400 text-sm">No tanks added to this project yet — click Add Tank above</div>
            );
            const sortedTankItems = tankDisplayOrder.length > 0
              ? tankDisplayOrder.map(tid => tankItems.find((t: any) => t.id === tid)).filter(Boolean)
              : tankItems;
            const fmtV = (v?: number | null) => v != null ? <span className="font-mono text-xs">{parseFloat(String(v)).toFixed(4)}</span> : <span className="text-slate-300 text-xs italic">—</span>;
            const fmtN = (v?: number | null) => v != null ? <span>{v}</span> : <span className="text-slate-300">—</span>;
            return (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="text-left px-3 py-2 font-medium text-xs text-slate-500 uppercase tracking-wide w-10"></th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-slate-500 uppercase tracking-wide">Tag</th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-slate-500 uppercase tracking-wide">Tank Name</th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-slate-500 uppercase tracking-wide">Qty</th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-slate-500 uppercase tracking-wide">System</th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-slate-500 uppercase tracking-wide">Product</th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-slate-500 uppercase tracking-wide">Shape</th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-slate-500 uppercase tracking-wide">L (mm)</th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-slate-500 uppercase tracking-wide">W (mm)</th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-slate-500 uppercase tracking-wide">H (mm)</th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-slate-500 uppercase tracking-wide">Gross Vol (m³)</th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-slate-500 uppercase tracking-wide">Design Vol (m³)</th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-slate-500 uppercase tracking-wide">Material</th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-slate-500 uppercase tracking-wide">Status</th>
                      <th className="px-3 py-2 font-medium text-xs text-slate-500 uppercase tracking-wide w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTankItems.map((tank: any, idx: number) => {
                      const qty = tank.quantity ?? 1;
                      const isExpanded = expandedTanks.has(tank.id);
                      const instances: any[] = Array.isArray(tank.instances) ? tank.instances : [];
                      const isDragging = draggingTankId === tank.id;
                      const isOver = overTankId === tank.id && draggingTankId !== tank.id;
                      return (
                        <Fragment key={tank.id}>
                          <tr
                            draggable
                            onDragStart={e => handleTankDragStart(e, idx)}
                            onDragOver={e => handleTankDragOver(e, idx)}
                            onDrop={handleTankDrop}
                            onDragEnd={handleTankDragEnd}
                            className={`border-b transition-colors
                              ${isDragging ? 'opacity-40 bg-slate-50' : 'hover:bg-slate-50'}
                              ${isOver ? 'border-t-2 border-t-blue-400 border-b-slate-100' : 'border-b-slate-100'}`}
                          >
                            <td className="px-2 py-2.5">
                              <div className="flex items-center gap-0.5">
                                <span className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 transition-colors">
                                  <GripVertical className="w-3.5 h-3.5" />
                                </span>
                                {qty > 1 ? (
                                  <button
                                    onClick={() => toggleTankExpand(tank.id)}
                                    className="text-slate-400 hover:text-blue-600 transition-colors p-0.5 rounded"
                                    title={isExpanded ? 'Collapse individual tanks' : 'Expand individual tanks'}
                                  >
                                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                  </button>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-3 py-2.5"><EntityCode code={tank.tank_code} /></td>
                            <td className="px-3 py-2.5 font-medium text-slate-800">{tank.tank_name}</td>
                            <td className="px-3 py-2.5">
                              <span className={`font-mono text-sm ${qty > 1 ? 'text-blue-600 font-semibold' : 'text-slate-600'}`}>{qty}</span>
                            </td>
                            <td className="px-3 py-2.5">{tank.system_code ? <EntityCode code={tank.system_code} /> : <span className="text-slate-300">—</span>}</td>
                            <td className="px-3 py-2.5">{tank.product_code ? <Link to={`/products/masters/${tank.product_code}`} onClick={e => e.stopPropagation()} className="text-blue-600 hover:underline"><EntityCode code={tank.product_code} /></Link> : <span className="text-slate-300">—</span>}</td>
                            <td className="px-3 py-2.5">{tank.eff_shape ? <span>{tank.eff_shape}</span> : <span className="text-slate-300">—</span>}</td>
                            <td className="px-3 py-2.5">{fmtN(tank.eff_length_mm)}</td>
                            <td className="px-3 py-2.5">{fmtN(tank.eff_width_mm)}</td>
                            <td className="px-3 py-2.5">{fmtN(tank.eff_height_mm)}</td>
                            <td className="px-3 py-2.5">{fmtV(tank.gross_volume_m3)}</td>
                            <td className="px-3 py-2.5">{fmtV(tank.design_volume_m3)}</td>
                            <td className="px-3 py-2.5">{tank.product_material ? <EntityCode code={tank.product_material} /> : <span className="text-slate-300">—</span>}</td>
                            <td className="px-3 py-2.5"><StatusBadge status={tank.status || 'Active'} /></td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1">
                                {!tank.product_code && (
                                  <>
                                    <button
                                      onClick={e => { e.stopPropagation(); openEditTank(tank); }}
                                      className="text-slate-300 hover:text-blue-500 p-1 rounded transition-colors"
                                      title="Edit tank"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={e => { e.stopPropagation(); openSaveTankToDb(tank); }}
                                      className="text-xs text-amber-600 hover:text-amber-800 border border-amber-200 hover:border-amber-400 px-1.5 py-0.5 rounded hover:bg-amber-50 whitespace-nowrap"
                                      title="Save this tank to the Tank Database as a product master"
                                    >+ DB</button>
                                  </>
                                )}
                                <button
                                  onClick={e => { e.stopPropagation(); handleDeleteTank(tank); }}
                                  disabled={deletingTankId === tank.id}
                                  className="text-slate-300 hover:text-red-500 p-1 rounded disabled:opacity-50 transition-colors"
                                  title="Remove tank from project"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded && instances.map((inst: any) => {
                            const isEditingThis = editingInstance?.id === inst.id;
                            return (
                              <tr key={inst.id} className="border-b border-blue-50 bg-blue-50/40">
                                <td className="px-3 py-2"></td>
                                <td className="px-3 py-2" colSpan={1}>
                                  <div className="flex items-center gap-1.5 pl-4">
                                    <div className="w-px h-4 bg-blue-200 mr-1" />
                                    {isEditingThis ? (
                                      <div className="flex items-center gap-1">
                                        <input
                                          autoFocus
                                          value={editingInstance.value}
                                          onChange={e => setEditingInstance({ id: inst.id, value: e.target.value.toUpperCase() })}
                                          onKeyDown={e => {
                                            if (e.key === 'Enter') handleSaveInstanceTag(inst.id, editingInstance.value);
                                            if (e.key === 'Escape') setEditingInstance(null);
                                          }}
                                          className="border border-blue-400 rounded px-2 py-0.5 text-xs font-mono w-36 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        <button
                                          onClick={() => handleSaveInstanceTag(inst.id, editingInstance.value)}
                                          disabled={savingInstanceId === inst.id}
                                          className="text-xs text-white bg-blue-600 hover:bg-blue-700 px-2 py-0.5 rounded disabled:opacity-50"
                                        >{savingInstanceId === inst.id ? '…' : 'Save'}</button>
                                        <button onClick={() => setEditingInstance(null)} className="text-xs text-slate-400 hover:text-slate-600 px-1 py-0.5">✕</button>
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-1.5 group">
                                        <span className="font-mono text-xs bg-slate-100 border border-slate-200 text-slate-700 px-2 py-0.5 rounded">{inst.tag}</span>
                                        <button
                                          onClick={() => setEditingInstance({ id: inst.id, value: inst.tag })}
                                          className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-blue-600"
                                          title="Edit tag"
                                        ><Pencil className="w-3 h-3" /></button>
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-xs text-slate-400 italic" colSpan={13}>
                                  Unit {inst.instance_index} of {qty} — {tank.tank_name}
                                </td>
                              </tr>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
          {tab === 'piping' && (
            <DataTable
              columns={[
                ...pipingCols,
                { key: 'actions' as any, header: '', render: (r: any) => (
                  <button onClick={e => { e.stopPropagation(); handleDeletePiping(r.id); }} className="text-slate-300 hover:text-red-500 p-1 rounded">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )},
              ]}
              data={piping?.items || []}
              tableId="project-piping"
              emptyMessage="No piping or fittings added — click Add Item above"
            />
          )}
          {tab === 'bom-release' && (
            <div>
              <DataTable
                columns={bomReleaseCols}
                data={bomReleases?.items || []}
                tableId="project-bom-releases"
                emptyMessage="No BOM releases yet — click New Release to create a snapshot of selected project items"
                onRowClick={r => handleViewRelease(r.id)}
              />
            </div>
          )}
          {tab === 'pos' && (() => {
            const poItems: any[] = projectPOs?.items || [];
            const formatStatus = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const statusColor = (s: string) => {
              if (s === 'released') return 'bg-green-100 text-green-700 border-green-200';
              if (s === 'draft') return 'bg-slate-100 text-slate-600 border-slate-200';
              if (s === 'pending_approval') return 'bg-amber-100 text-amber-700 border-amber-200';
              if (s === 'engineering_review' || s === 'po_review') return 'bg-blue-100 text-blue-700 border-blue-200';
              return 'bg-slate-100 text-slate-600 border-slate-200';
            };
            if (poItems.length === 0) return (
              <div className="py-16 text-center text-sm text-slate-400">
                No purchase orders released for this project yet —
                click <strong>Release PO</strong> to create one from the project's equipment and tanks.
              </div>
            );
            return (
              <div className="divide-y divide-slate-100">
                {poItems.map((po: any) => (
                  <div
                    key={po.id}
                    onClick={() => navigate(`/purchase-orders/${po.id}`)}
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 cursor-pointer group transition-colors"
                  >
                    <span className="font-mono text-sm font-semibold text-slate-800 w-36 shrink-0">{po.po_code}</span>
                    <span className={`text-xs px-2.5 py-0.5 rounded-full border font-medium shrink-0 ${statusColor(po.status)}`}>
                      {formatStatus(po.status)}
                    </span>
                    {po.fo_number && (
                      <span className="text-xs font-mono bg-green-50 border border-green-200 text-green-700 px-2 py-0.5 rounded shrink-0">{po.fo_number}</span>
                    )}
                    <span className="text-xs text-slate-400 shrink-0">{po.item_count} item{po.item_count !== 1 ? 's' : ''}</span>
                    {po.total_cost_usd > 0 && (
                      <span className="text-xs text-slate-500 font-mono shrink-0">
                        {parseFloat(po.total_cost_usd).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} USD
                      </span>
                    )}
                    <span className="flex-1" />
                    <span className="text-xs text-slate-400 shrink-0">{po.created_by_name}</span>
                    <span className="text-xs text-slate-400 shrink-0">{po.created_at?.split('T')[0]}</span>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-500 transition-colors shrink-0" />
                  </div>
                ))}
              </div>
            );
          })()}
          {tab === 'documents' && <DataTable columns={docCols} data={documents?.items || []} tableId="project-documents" onRowClick={r => navigate(`/documents/${r.id}`)} />}
          {tab === 'changes' && <DataTable columns={crCols} data={changes?.items || []} tableId="project-changes" />}
        </div>
      </div>

      {showReleasePOModal && (
        <ProjectReleasePOModal
          projectId={project.id}
          projectCode={project.project_code}
          onClose={() => setShowReleasePOModal(false)}
        />
      )}

      {showNewSystem && (
        <NewEntityModal title="New System Instance" onClose={() => setShowNewSystem(false)}
          fields={[
            { name: 'system_code', label: 'System Code', required: true, placeholder: 'SYS-LSS-XX-01' },
            { name: 'system_name', label: 'System Name', required: true },
            { name: 'system_type', label: 'System Type', options: systemTypeOptions },
            { name: 'water_type', label: 'Water Type', options: ['Marine', 'Freshwater', 'Brackish', 'Other'] },
            { name: 'design_flow_m3h', label: 'Design Flow (m³/h)', type: 'number' },
          ]}
          onSubmit={async (data) => {
            await api.post('/systems', { ...data, project_id: project.id });
            toast.success('System created');
            qc.invalidateQueries({ queryKey: ['project-systems'] });
            setShowNewSystem(false);
          }}
        />
      )}

      {showNewTank && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
              <h2 className="text-lg font-semibold text-slate-800">Add Tank to Project</h2>
              <button onClick={() => { resetTankForm(); setShowNewTank(false); }} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>

            {/* Mode toggle */}
            <div className="px-6 pt-4 flex-shrink-0">
              <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
                <button
                  className={`flex-1 py-2 font-medium transition-colors ${tankMode === 'search' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                  onClick={() => setTankMode('search')}
                >
                  Find Existing
                </button>
                <button
                  className={`flex-1 py-2 font-medium transition-colors ${tankMode === 'manual' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                  onClick={() => setTankMode('manual')}
                >
                  Enter Dimensions
                </button>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">

              {/* ── SEARCH MODE ── */}
              {tankMode === 'search' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tank Product (Shark OS) *</label>
                  {selectedTankProduct ? (
                    <div className="border border-blue-600 rounded-lg p-3 bg-blue-50 flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <EntityCode code={selectedTankProduct.product_code} />
                          <span className="text-sm font-medium text-slate-800">{selectedTankProduct.product_name}</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {selectedTankProduct.application_type || 'Tank'}
                          {selectedTankProduct.shape_type ? ' · ' + selectedTankProduct.shape_type : ''}
                          {selectedTankProduct.length_mm != null ? ` · ${selectedTankProduct.length_mm}×${selectedTankProduct.width_mm ?? '?'}×${selectedTankProduct.height_mm ?? '?'} mm` : ''}
                          {selectedTankProduct.gross_volume_m3 != null ? ` · ${selectedTankProduct.gross_volume_m3} m³` : ''}
                        </div>
                      </div>
                      <button onClick={() => { setSelectedTankProduct(null); setTankProductSearch(''); }} className="text-slate-400 hover:text-slate-600 flex-shrink-0"><X className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        autoFocus
                        placeholder="Search tank products by name or code..."
                        value={tankProductSearch}
                        onChange={e => setTankProductSearch(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                      {tankProductResults?.items?.length > 0 && (
                        <div className="absolute top-full left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg mt-1 z-10 max-h-48 overflow-auto">
                          {tankProductResults.items.map((p: any) => (
                            <button key={p.id} onClick={() => setSelectedTankProduct(p)}
                              className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0">
                              <div className="flex items-center gap-2">
                                <EntityCode code={p.product_code} />
                                <span className="text-sm font-medium">{p.product_name}</span>
                              </div>
                              <div className="text-xs text-slate-400 mt-0.5">
                                {p.application_type || 'Tank'}
                                {p.shape_type ? ' · ' + p.shape_type : ''}
                                {p.length_mm != null ? ` · ${p.length_mm}×${p.width_mm ?? '?'}×${p.height_mm ?? '?'} mm` : ''}
                                {p.gross_volume_m3 != null ? ` · ${p.gross_volume_m3} m³` : ''}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      {tankProductSearch.length >= 2 && !tankProductResults?.items?.length && (
                        <div className="mt-2 text-xs text-slate-400">No tank products found. Switch to "Enter Dimensions" to create one on the fly.</div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── MANUAL / DIMENSIONS MODE ── */}
              {tankMode === 'manual' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Tank Name *</label>
                      <input
                        autoFocus
                        placeholder="e.g. Display Tank — Shark Exhibit"
                        value={tankName}
                        onChange={e => setTankName(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Shape</label>
                      <select value={tankShapeType} onChange={e => setTankShapeType(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                        <option value="">— Select —</option>
                        {['Rectangular', 'Cylindrical', 'Custom'].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Type / Application</label>
                      <select value={tankType} onChange={e => setTankType(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                        <option value="">— None —</option>
                        {['Display', 'Sump', 'Filter', 'Holding', 'Quarantine', 'Treatment', 'Header', 'Reservoir', 'Other'].map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Dimensions / Volumes */}
                  <div>
                    {tankShapeType === 'Custom' ? (
                      <>
                        <p className="text-xs font-medium text-slate-600 mb-2">Volumes (m³) — enter manually</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[11px] text-slate-500 mb-1">Gross Volume (m³)</label>
                            <input type="number" min={0} step="0.001" placeholder="e.g. 12.500" value={tankGrossVolume} onChange={e => setTankGrossVolume(e.target.value)}
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 font-mono" />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-500 mb-1">Operating Volume (m³)</label>
                            <input type="number" min={0} step="0.001" placeholder="e.g. 10.500" value={tankOperatingVolume} onChange={e => setTankOperatingVolume(e.target.value)}
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 font-mono" />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-500 mb-1">Material</label>
                            <select value={tankMaterial} onChange={e => setTankMaterial(e.target.value)}
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                              <option value="">— Select material —</option>
                              {materials.map(m => (
                                <option key={m.material_code} value={m.material_code}>{m.material_code} — {m.material_name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        {(tankGrossVolume || tankOperatingVolume) && (
                          <div className="mt-2 flex gap-4 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                            {tankGrossVolume && <span>Gross: <strong className="text-slate-700">{parseFloat(tankGrossVolume).toFixed(3)} m³</strong></span>}
                            {tankOperatingVolume && <span>Operating: <strong className="text-slate-700">{parseFloat(tankOperatingVolume).toFixed(3)} m³</strong></span>}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-xs font-medium text-slate-600 mb-2">Dimensions (mm)</p>
                        <div className="grid grid-cols-3 gap-2">
                          {tankShapeType !== 'Cylindrical' && (
                            <div>
                              <label className="block text-[11px] text-slate-500 mb-1">Length</label>
                              <input type="number" min={0} placeholder="e.g. 5000" value={tankLengthMm} onChange={e => setTankLengthMm(e.target.value)}
                                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 font-mono" />
                            </div>
                          )}
                          <div>
                            <label className="block text-[11px] text-slate-500 mb-1">{tankShapeType === 'Cylindrical' ? 'Diameter' : 'Width'}</label>
                            <input type="number" min={0} placeholder="e.g. 2000" value={tankWidthMm} onChange={e => setTankWidthMm(e.target.value)}
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 font-mono" />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-500 mb-1">Height</label>
                            <input type="number" min={0} placeholder="e.g. 1500" value={tankHeightMm} onChange={e => setTankHeightMm(e.target.value)}
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 font-mono" />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-500 mb-1">Water Level</label>
                            <input type="number" min={0} placeholder="e.g. 1300" value={tankDesignWaterLevel} onChange={e => setTankDesignWaterLevel(e.target.value)}
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 font-mono" />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-500 mb-1">Wall Thickness</label>
                            <input type="number" min={0} placeholder="e.g. 20" value={tankWallThickness} onChange={e => setTankWallThickness(e.target.value)}
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 font-mono" />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-500 mb-1">Material</label>
                            <select value={tankMaterial} onChange={e => setTankMaterial(e.target.value)}
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                              <option value="">— Select material —</option>
                              {materials.map(m => (
                                <option key={m.material_code} value={m.material_code}>
                                  {m.material_code} — {m.material_name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        {/* Live volume preview */}
                        {(() => {
                          const cyl = tankShapeType === 'Cylindrical';
                          const d = parseFloat(tankWidthMm);
                          const l = parseFloat(tankLengthMm);
                          const w = parseFloat(tankWidthMm);
                          const h = parseFloat(tankHeightMm);
                          const wl = parseFloat(tankDesignWaterLevel);
                          const hasGross = cyl ? (d > 0 && h > 0) : (l > 0 && w > 0 && h > 0);
                          if (!hasGross) return null;
                          const gross = cyl
                            ? Math.PI * (d / 2) * (d / 2) * h / 1e9
                            : l * w * h / 1e9;
                          const op = cyl
                            ? (wl > 0 ? Math.PI * (d / 2) * (d / 2) * wl / 1e9 : null)
                            : (wl > 0 ? l * w * wl / 1e9 : null);
                          return (
                            <div className="mt-2 flex gap-4 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                              <span>{cyl ? '¼π·D²·H' : 'L×W×H'}: <strong className="text-slate-700">{gross.toFixed(3)} m³</strong></span>
                              {op != null && (
                                <span>Operating: <strong className="text-slate-700">{op.toFixed(3)} m³</strong></span>
                              )}
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </div>

                  {/* Save to Tank Family */}
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <label className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50">
                      <input type="checkbox" checked={tankSaveToFamily} onChange={e => setTankSaveToFamily(e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                      <div>
                        <div className="text-sm font-medium text-slate-800">Also add to Tank Families</div>
                        <div className="text-xs text-slate-500">Creates a reusable product master with these dimensions</div>
                      </div>
                    </label>
                    {tankSaveToFamily && (
                      <div className="border-t border-slate-200 px-4 pb-4 pt-3 space-y-3 bg-slate-50">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Product Code *</label>
                            <input
                              placeholder="e.g. TNK-DIS-5000"
                              value={tankNewProductCode}
                              onChange={e => setTankNewProductCode(e.target.value.toUpperCase())}
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 font-mono bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Tank Family <span className="text-slate-400 font-normal">(optional)</span></label>
                            <select value={tankFamilyId} onChange={e => setTankFamilyId(e.target.value)}
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white">
                              <option value="">— None —</option>
                              {(Array.isArray(tankFamilies) ? tankFamilies : []).map((f: any) => (
                                <option key={f.id} value={f.id}>{f.code} – {f.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* ── SHARED FIELDS (both modes) ── */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Project Tag Code *</label>
                  <input
                    placeholder="e.g. TNK-DIS-001"
                    value={tankCode}
                    onChange={e => setTankCode(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Quantity</label>
                  <input
                    type="number" min={1} value={tankQuantity}
                    onChange={e => setTankQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">System <span className="text-slate-400 font-normal">(optional)</span></label>
                  <select value={tankSystemId} onChange={e => setTankSystemId(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                    <option value="">— No system —</option>
                    {(systems?.items || []).map((s: any) => (
                      <option key={s.id} value={s.id}>{s.system_code} – {s.system_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                  <select value={tankStatus} onChange={e => setTankStatus(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                    {['Design', 'Procurement', 'Installation', 'Commissioning', 'Active', 'Decommissioned'].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 flex-shrink-0">
              <Button variant="ghost" onClick={() => { resetTankForm(); setShowNewTank(false); }}>Cancel</Button>
              <Button
                onClick={handleAddTank}
                disabled={
                  tankSubmitting || !tankCode.trim() ||
                  (tankMode === 'search' && !selectedTankProduct) ||
                  (tankMode === 'manual' && !tankName.trim()) ||
                  (tankMode === 'manual' && tankSaveToFamily && !tankNewProductCode.trim())
                }
              >
                {tankSubmitting ? 'Adding...' : tankMode === 'manual' && tankSaveToFamily ? 'Add Tank & Save to Families' : 'Add Tank'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showNewPiping && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-800">Add Piping / Fitting to Project</h2>
              <button onClick={() => setShowNewPiping(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Piping Product (Shark OS) *</label>
                {selectedPipingProduct ? (
                  <div className="border border-blue-600 rounded-lg p-3 bg-blue-50 flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <EntityCode code={selectedPipingProduct.product_code} />
                        <span className="text-sm font-medium text-slate-800">{selectedPipingProduct.product_name}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{selectedPipingProduct.application_type || 'Piping'}</div>
                    </div>
                    <button onClick={() => { setSelectedPipingProduct(null); setPipingProductSearch(''); }} className="text-slate-400 hover:text-slate-600 flex-shrink-0"><X className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input autoFocus placeholder="Search piping products by name or code..."
                      value={pipingProductSearch} onChange={e => setPipingProductSearch(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                    {pipingProductResults?.items?.length > 0 && (
                      <div className="absolute top-full left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg mt-1 z-10 max-h-48 overflow-auto">
                        {pipingProductResults.items.map((p: any) => (
                          <button key={p.id} onClick={() => setSelectedPipingProduct(p)}
                            className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0">
                            <div className="flex items-center gap-2">
                              <EntityCode code={p.product_code} />
                              <span className="text-sm font-medium">{p.product_name}</span>
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5">{p.application_type || 'Piping'}</div>
                          </button>
                        ))}
                      </div>
                    )}
                    {pipingProductSearch.length >= 2 && !pipingProductResults?.items?.length && (
                      <div className="mt-2 text-xs text-slate-400">No piping products found — add them in the Shark OS first</div>
                    )}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Project Tag Code *</label>
                  <input placeholder="e.g. PIP-LSS-001" value={pipingCode} onChange={e => setPipingCode(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                  <input placeholder="Optional override description" value={pipingDesc} onChange={e => setPipingDesc(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Quantity</label>
                  <input type="number" min="0.01" step="0.01" value={pipingQty} onChange={e => setPipingQty(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Unit</label>
                  <select value={pipingUnit} onChange={e => setPipingUnit(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600">
                    {['EA', 'm', 'kg', 'set', 'lot'].map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <Button variant="ghost" onClick={() => setShowNewPiping(false)}>Cancel</Button>
              <Button onClick={handleAddPiping} disabled={pipingSubmitting || !selectedPipingProduct || !pipingCode.trim()}>
                {pipingSubmitting ? 'Adding...' : 'Add Item'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showNewBomRelease && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-800">New BOM Release</h2>
              <button onClick={() => setShowNewBomRelease(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2">Include sections *</label>
                <div className="space-y-2">
                  {([
                    { key: 'Products', label: 'Products', sub: 'Equipment items assigned to systems' },
                    { key: 'Tank', label: 'Tanks', sub: 'Tank items in this project' },
                    { key: 'Piping', label: 'Pipes & Fittings', sub: 'Piping items in this project' },
                  ] as const).map(s => (
                    <label key={s.key} className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${bomSections[s.key] ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}>
                      <input type="checkbox" checked={!!bomSections[s.key]}
                        onChange={e => setBomSections(prev => ({ ...prev, [s.key]: e.target.checked }))}
                        className="mt-0.5 accent-blue-600" />
                      <div>
                        <div className="text-sm font-medium text-slate-800">{s.label}</div>
                        <div className="text-xs text-slate-400">{s.sub}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Title</label>
                <input placeholder="e.g. Issued for Procurement" value={bomTitle} onChange={e => setBomTitle(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Revision</label>
                  <input placeholder="A" maxLength={5} value={bomRevision} onChange={e => setBomRevision(e.target.value.toUpperCase())}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                <textarea rows={2} placeholder="Optional notes or purpose of this release" value={bomNotes} onChange={e => setBomNotes(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <Button variant="ghost" onClick={() => setShowNewBomRelease(false)}>Cancel</Button>
              <Button onClick={handleCreateBomRelease} disabled={bomSubmitting || !Object.values(bomSections).some(Boolean)}>
                {bomSubmitting ? 'Creating...' : 'Create Release'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {selectedRelease && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-end z-50" onClick={() => setSelectedRelease(null)}>
          <div className="bg-white w-full max-w-2xl h-full overflow-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white z-10">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <EntityCode code={selectedRelease.release_code} />
                  <StatusBadge status={selectedRelease.status} />
                  <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">Rev {selectedRelease.revision}</span>
                </div>
                <div className="text-lg font-semibold text-slate-800">{selectedRelease.title}</div>
                {selectedRelease.notes && <div className="text-xs text-slate-400 mt-0.5">{selectedRelease.notes}</div>}
              </div>
              <div className="flex items-center gap-2">
                {selectedRelease.status === 'Draft' && (
                  <Button size="sm" onClick={() => handleIssueRelease(selectedRelease.id)}>
                    <Send className="w-3.5 h-3.5" />Issue
                  </Button>
                )}
                {selectedRelease.status === 'Draft' && (
                  <Button size="sm" variant="ghost" onClick={() => handleDeleteRelease(selectedRelease.id)}>
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  </Button>
                )}
                <button onClick={() => setSelectedRelease(null)} className="text-slate-400 hover:text-slate-600 p-1"><X className="w-5 h-5" /></button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {selectedRelease.issued_date && (
                <div className="text-xs text-slate-500">Issued: {selectedRelease.issued_date.split('T')[0]} · By {selectedRelease.created_by_name}</div>
              )}
              {(['Products', 'Tank', 'Piping'] as const).map(section => {
                const lines = (selectedRelease.lines || []).filter((l: any) =>
                  section === 'Products' ? (l.section === 'Products' || l.section === 'Equipment') : l.section === section
                );
                if (lines.length === 0) return null;
                const isOpen = expandedSections[section] !== false;
                return (
                  <div key={section} className="border border-slate-200 rounded-lg overflow-hidden">
                    <button onClick={() => toggleSection(section)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors">
                      <div className="flex items-center gap-2">
                        {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                        <span className="font-medium text-sm text-slate-700">{section}</span>
                        <span className="text-xs text-slate-400 bg-white px-2 py-0.5 rounded-full border border-slate-200">{lines.length} item{lines.length !== 1 ? 's' : ''}</span>
                      </div>
                    </button>
                    {isOpen && (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-100 text-xs text-slate-400 uppercase tracking-wide">
                            <th className="text-left px-4 py-2">Tag</th>
                            <th className="text-left px-4 py-2">Description</th>
                            <th className="text-left px-4 py-2">Product</th>
                            <th className="text-right px-4 py-2">Qty</th>
                            <th className="text-left px-4 py-2">Unit</th>
                            <th className="text-left px-4 py-2">System</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((line: any) => (
                            <tr key={line.id} className="border-b border-slate-50 hover:bg-slate-50">
                              <td className="px-4 py-2.5"><EntityCode code={line.tag_code} /></td>
                              <td className="px-4 py-2.5 text-slate-700">{line.description || '—'}</td>
                              <td className="px-4 py-2.5">
                                {line.product_code
                                  ? <Link to={`/products/masters/${line.product_code}`} onClick={() => setSelectedRelease(null)} className="text-blue-600 hover:underline text-xs">{line.product_code}</Link>
                                  : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-4 py-2.5 text-right">{line.quantity}</td>
                              <td className="px-4 py-2.5 text-slate-500">{line.unit}</td>
                              <td className="px-4 py-2.5 text-slate-400 text-xs">{line.system_ref || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
              {(!selectedRelease.lines || selectedRelease.lines.length === 0) && (
                <div className="text-center text-slate-400 py-10">No items in this release — the selected sections had no items at the time of creation.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {editSystemRow && editSystemForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-[520px] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h3 className="font-semibold text-slate-800">Edit System</h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{editSystemRow.system_code}</p>
              </div>
              <button onClick={() => setEditSystemRow(null)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">System Code</label>
                <input value={editSystemForm.system_code} onChange={e => setEditSystemForm((f: any) => ({ ...f, system_code: e.target.value.toUpperCase() }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-600/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                <select value={editSystemForm.status} onChange={e => setEditSystemForm((f: any) => ({ ...f, status: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30">
                  {['Draft', 'Internal Review', 'Approved', 'Released', 'Superseded', 'Obsolete'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">System Name</label>
                <input value={editSystemForm.system_name} onChange={e => setEditSystemForm((f: any) => ({ ...f, system_name: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">System Type</label>
                <select value={editSystemForm.system_type} onChange={e => setEditSystemForm((f: any) => ({ ...f, system_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30">
                  <option value="">— select —</option>
                  {systemTypeOptions.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Water Type</label>
                <select value={editSystemForm.water_type} onChange={e => setEditSystemForm((f: any) => ({ ...f, water_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30">
                  <option value="">— select —</option>
                  {['Fresh Water', 'Salt Water', 'Brackish', 'N/A'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Design Flow (m³/h)</label>
                <input type="number" value={editSystemForm.design_flow_m3h} onChange={e => setEditSystemForm((f: any) => ({ ...f, design_flow_m3h: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Turnover Rate (/hr)</label>
                <input type="number" value={editSystemForm.turnover_rate_hr} onChange={e => setEditSystemForm((f: any) => ({ ...f, turnover_rate_hr: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Redundancy Strategy</label>
                <input value={editSystemForm.redundancy_strategy} onChange={e => setEditSystemForm((f: any) => ({ ...f, redundancy_strategy: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Duty Description</label>
                <textarea value={editSystemForm.duty_description} onChange={e => setEditSystemForm((f: any) => ({ ...f, duty_description: e.target.value }))}
                  rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <Button onClick={() => setEditSystemRow(null)}>Cancel</Button>
              <Button variant="primary" onClick={handleEditSystemSave} disabled={editSystemSaving}>
                {editSystemSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {editTankModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-semibold text-slate-800">Edit Tank</h3>
                <p className="text-xs text-slate-500 mt-0.5">Only available while this tank is not yet in the Tank Database</p>
              </div>
              <button onClick={() => setEditTankModal(null)} className="text-slate-400 hover:text-slate-600 p-1 rounded">✕</button>
            </div>
            <div className="px-5 py-4 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tag / Code</label>
                <input
                  value={editTankForm.tank_code}
                  onChange={e => setEditTankForm((f: any) => ({ ...f, tank_code: e.target.value.toUpperCase() }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tank Name <span className="text-red-400">*</span></label>
                <input
                  value={editTankForm.tank_name}
                  onChange={e => setEditTankForm((f: any) => ({ ...f, tank_name: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">System <span className="text-slate-400 font-normal">(optional)</span></label>
                <select
                  value={editTankForm.system_id || ''}
                  onChange={e => setEditTankForm((f: any) => ({ ...f, system_id: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                >
                  <option value="">— No system —</option>
                  {(systems?.items || []).map((s: any) => (
                    <option key={s.id} value={s.id}>{s.system_code} – {s.system_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tank Type</label>
                <select
                  value={editTankForm.tank_type}
                  onChange={e => setEditTankForm((f: any) => ({ ...f, tank_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                >
                  <option value="">— None —</option>
                  {['Display', 'Sump', 'Filter', 'Holding', 'Quarantine', 'Treatment', 'Header', 'Reservoir', 'Other'].map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Shape</label>
                <select
                  value={editTankForm.shape_type}
                  onChange={e => setEditTankForm((f: any) => ({ ...f, shape_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                >
                  <option value="">— None —</option>
                  {['Rectangular', 'Cylindrical', 'Oval', 'D-Shape', 'Irregular', 'Custom'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              {editTankForm.shape_type === 'Custom' ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Gross Volume (m³)</label>
                    <input type="number" min={0} step="0.001" value={editTankForm.gross_volume_m3 ?? ''}
                      onChange={e => setEditTankForm((f: any) => ({ ...f, gross_volume_m3: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Operating Volume (m³)</label>
                    <input type="number" min={0} step="0.001" value={editTankForm.operating_volume_m3 ?? ''}
                      onChange={e => setEditTankForm((f: any) => ({ ...f, operating_volume_m3: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 font-mono" />
                  </div>
                </>
              ) : (
                <>
                  {editTankForm.shape_type !== 'Cylindrical' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Length (mm)</label>
                      <input type="number" value={editTankForm.length_mm}
                        onChange={e => setEditTankForm((f: any) => ({ ...f, length_mm: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">{editTankForm.shape_type === 'Cylindrical' ? 'Diameter (mm)' : 'Width (mm)'}</label>
                    <input type="number" value={editTankForm.width_mm}
                      onChange={e => setEditTankForm((f: any) => ({ ...f, width_mm: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Height (mm)</label>
                    <input type="number" value={editTankForm.height_mm}
                      onChange={e => setEditTankForm((f: any) => ({ ...f, height_mm: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Design Water Level (mm)</label>
                    <input type="number" value={editTankForm.design_water_level_mm}
                      onChange={e => setEditTankForm((f: any) => ({ ...f, design_water_level_mm: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
                  </div>
                </>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Material</label>
                <select
                  value={editTankForm.primary_material}
                  onChange={e => setEditTankForm((f: any) => ({ ...f, primary_material: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                >
                  <option value="">— None —</option>
                  {materials.map(m => (
                    <option key={m.material_code} value={m.material_code}>{m.material_name} ({m.material_code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                <select
                  value={editTankForm.status}
                  onChange={e => setEditTankForm((f: any) => ({ ...f, status: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                >
                  {['Active', 'Inactive', 'Draft', 'On Hold'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Quantity</label>
                <input type="number" min={1} value={editTankForm.quantity}
                  onChange={e => setEditTankForm((f: any) => ({ ...f, quantity: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                <textarea value={editTankForm.notes}
                  onChange={e => setEditTankForm((f: any) => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
              {(() => {
                const isCustom = editTankForm.shape_type === 'Custom';
                const cyl = editTankForm.shape_type === 'Cylindrical';
                if (isCustom) {
                  const gv = parseFloat(editTankForm.gross_volume_m3);
                  const ov = parseFloat(editTankForm.operating_volume_m3);
                  if (!gv && !ov) return null;
                  return (
                    <div className="col-span-2 bg-slate-50 rounded-lg px-3 py-2 text-xs text-slate-600 flex gap-6">
                      {gv > 0 && <span>Gross Vol: <span className="font-mono font-medium">{gv.toFixed(4)} m³</span></span>}
                      {ov > 0 && <span>Operating Vol: <span className="font-mono font-medium">{ov.toFixed(4)} m³</span></span>}
                    </div>
                  );
                }
                const d = parseFloat(editTankForm.width_mm);
                const l = parseFloat(editTankForm.length_mm);
                const w = parseFloat(editTankForm.width_mm);
                const h = parseFloat(editTankForm.height_mm);
                const wl = parseFloat(editTankForm.design_water_level_mm);
                const hasGross = cyl ? (d > 0 && h > 0) : (l > 0 && w > 0 && h > 0);
                if (!hasGross) return null;
                const gross = cyl
                  ? Math.PI * (d / 2) * (d / 2) * h / 1e9
                  : l * w * h / 1e9;
                const op = cyl
                  ? (wl > 0 ? Math.PI * (d / 2) * (d / 2) * wl / 1e9 : null)
                  : (wl > 0 ? l * w * wl / 1e9 : null);
                return (
                  <div className="col-span-2 bg-slate-50 rounded-lg px-3 py-2 text-xs text-slate-600 flex gap-6">
                    <span>Gross Vol: <span className="font-mono font-medium">{gross.toFixed(4)} m³</span></span>
                    {op != null && <span>Operating Vol: <span className="font-mono font-medium">{op.toFixed(4)} m³</span></span>}
                  </div>
                );
              })()}
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <Button onClick={() => setEditTankModal(null)}>Cancel</Button>
              <Button variant="primary" onClick={handleSaveTankEdit} disabled={editTankSubmitting || !editTankForm.tank_name?.trim()}>
                {editTankSubmitting ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {saveTankDbModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-semibold text-slate-800">Save to Tank Database</h3>
                <p className="text-xs text-slate-500 mt-0.5">Creates a new Tank product master from this tank's dimensions</p>
              </div>
              <button onClick={() => setSaveTankDbModal(null)} className="text-slate-400 hover:text-slate-600 p-1 rounded">✕</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Product Code <span className="text-red-400">*</span></label>
                  <input
                    value={saveTankDbCode}
                    onChange={e => setSaveTankDbCode(e.target.value.toUpperCase())}
                    placeholder="e.g. TK-FW-001"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tank Family</label>
                  <select
                    value={saveTankDbFamilyId}
                    onChange={e => setSaveTankDbFamilyId(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-400"
                  >
                    <option value="">— None —</option>
                    {(tankFamilies?.items || []).map((f: any) => (
                      <option key={f.id} value={f.id}>{f.family_name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Product Name</label>
                <input
                  value={saveTankDbName}
                  onChange={e => setSaveTankDbName(e.target.value)}
                  placeholder="Tank product name"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-400"
                />
              </div>
              <div className="bg-slate-50 rounded-lg px-3 py-2.5 text-xs text-slate-600 space-y-1">
                <div className="font-medium text-slate-700 mb-1">Dimensions to be saved:</div>
                {saveTankDbModal.eff_shape && <div>Shape: <span className="font-mono">{saveTankDbModal.eff_shape}</span></div>}
                {saveTankDbModal.eff_length_mm && <div>L × W × H: <span className="font-mono">{saveTankDbModal.eff_length_mm} × {saveTankDbModal.eff_width_mm} × {saveTankDbModal.eff_height_mm} mm</span></div>}
                {saveTankDbModal.gross_volume_m3 && <div>Gross Vol: <span className="font-mono">{parseFloat(saveTankDbModal.gross_volume_m3).toFixed(4)} m³</span></div>}
                {!saveTankDbModal.eff_length_mm && <div className="text-slate-400 italic">No dimensions stored on this tank</div>}
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <Button onClick={() => setSaveTankDbModal(null)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={handleSaveTankToDb}
                disabled={saveTankDbSubmitting || !saveTankDbCode.trim()}
              >
                {saveTankDbSubmitting ? 'Saving…' : 'Save to Tank Database'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
