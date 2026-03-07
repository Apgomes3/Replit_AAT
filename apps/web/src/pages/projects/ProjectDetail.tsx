import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useState, lazy, Suspense } from 'react';
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
import { Plus, Network, X, Search, FileText, Send, Trash2, ChevronDown, ChevronRight, Pencil, MapPin, CheckCircle2, ArrowRight as ArrowRightIcon } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

const ProjectsMap = lazy(() => import('../../components/ui/ProjectsMap'));

type Tab = 'systems' | 'tanks' | 'piping' | 'documents' | 'changes' | 'bom-release';

type EquipmentItem = {
  id: string; equip_code: string; product_code?: string; product_name?: string;
  description?: string; quantity?: number; unit?: string; status?: string;
  system_code?: string; system_name?: string; system_id?: string;
};

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
  const isAdmin = user?.role === 'admin';
  const APPROVAL_GATES: Record<string, string[]> = {
    'Design': ['Draft', 'Concept'],
  };
  const [tab, setTab] = useState<Tab>('systems');
  const [showNewSystem, setShowNewSystem] = useState(false);
  const [showNewTank, setShowNewTank] = useState(false);
  const [editSystemRow, setEditSystemRow] = useState<any>(null);
  const [editSystemForm, setEditSystemForm] = useState<any>(null);
  const [editSystemSaving, setEditSystemSaving] = useState(false);
  const [expandedSystemIds, setExpandedSystemIds] = useState<Set<string>>(new Set());

  const toggleSystem = (sysId: string) => setExpandedSystemIds(prev => {
    const next = new Set(prev);
    if (next.has(sysId)) next.delete(sysId); else next.add(sysId);
    return next;
  });
  const [editingProject, setEditingProject] = useState(false);
  const [projectForm, setProjectForm] = useState<any>(null);
  const [projectSaving, setProjectSaving] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);

  const [tankProductSearch, setTankProductSearch] = useState('');
  const [selectedTankProduct, setSelectedTankProduct] = useState<any>(null);
  const [tankCode, setTankCode] = useState('');
  const [tankStatus, setTankStatus] = useState('Active');
  const [tankSubmitting, setTankSubmitting] = useState(false);

  const [showNewPiping, setShowNewPiping] = useState(false);
  const [pipingProductSearch, setPipingProductSearch] = useState('');
  const [selectedPipingProduct, setSelectedPipingProduct] = useState<any>(null);
  const [pipingCode, setPipingCode] = useState('');
  const [pipingQty, setPipingQty] = useState('1');
  const [pipingUnit, setPipingUnit] = useState('EA');
  const [pipingDesc, setPipingDesc] = useState('');
  const [pipingSubmitting, setPipingSubmitting] = useState(false);

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

  const { data: systems } = useQuery({
    queryKey: ['project-systems', id],
    queryFn: () => api.get(`/projects/${id}/systems`).then(r => r.data),
    enabled: tab === 'systems',
  });

  const { data: equipment } = useQuery({
    queryKey: ['project-equipment', id],
    queryFn: () => api.get(`/projects/${id}/equipment`).then(r => r.data),
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

  const { data: piping } = useQuery({
    queryKey: ['project-piping', id],
    queryFn: () => api.get(`/projects/${id}/piping`).then(r => r.data),
    enabled: tab === 'piping',
  });

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
    } catch { toast.error('Save failed'); }
    finally { setEditSystemSaving(false); }
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
    { key: 'product_code', header: 'Product', render: r => r.product_code
      ? <Link to={`/products/masters/${r.product_code}`} onClick={e => e.stopPropagation()} className="text-[#3E5C76] hover:underline"><EntityCode code={r.product_code} /></Link>
      : <span className="text-slate-300">—</span>
    },
    { key: 'tank_type', header: 'Type', render: r => r.tank_type ? <span>{r.tank_type}</span> : <span className="text-slate-300">—</span> },
    { key: 'product_shape' as any, header: 'Shape', render: (r: any) => r.product_shape ? <span>{r.product_shape}</span> : <span className="text-slate-300">—</span> },
    { key: 'product_length_mm' as any, header: 'L (mm)', render: (r: any) => fmt(r.product_length_mm) },
    { key: 'product_width_mm' as any, header: 'W (mm)', render: (r: any) => fmt(r.product_width_mm) },
    { key: 'product_height_mm' as any, header: 'H (mm)', render: (r: any) => fmt(r.product_height_mm) },
    { key: 'product_water_level_mm' as any, header: 'Water Level (mm)', render: (r: any) => fmt(r.product_water_level_mm) },
    { key: 'product_gross_volume_m3' as any, header: 'Gross Vol (m³)', render: (r: any) => fmt(r.product_gross_volume_m3) },
    { key: 'product_operating_volume_m3' as any, header: 'Op. Vol (m³)', render: (r: any) => fmt(r.product_operating_volume_m3) },
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
      ? <Link to={`/products/masters/${r.product_code}`} onClick={e => e.stopPropagation()} className="text-[#3E5C76] hover:underline"><EntityCode code={r.product_code} /></Link>
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

  const handleAddTank = async () => {
    if (!tankCode.trim()) { toast.error('Tank tag code is required'); return; }
    if (!selectedTankProduct) { toast.error('Select a tank product from the ASW Library'); return; }
    setTankSubmitting(true);
    try {
      await api.post('/tanks', {
        tank_code: tankCode.trim().toUpperCase(),
        tank_name: selectedTankProduct.product_name,
        tank_type: selectedTankProduct.application_type || null,
        product_master_id: selectedTankProduct.id,
        project_id: project.id,
        status: tankStatus,
      });
      toast.success('Tank added');
      setShowNewTank(false);
      setSelectedTankProduct(null);
      setTankProductSearch('');
      setTankCode('');
      setTankStatus('Active');
      qc.invalidateQueries({ queryKey: ['project-tanks'] });
    } catch {
      toast.error('Failed to add tank');
    } finally {
      setTankSubmitting(false);
    }
  };

  const handleAddPiping = async () => {
    if (!pipingCode.trim()) { toast.error('Tag code is required'); return; }
    if (!selectedPipingProduct) { toast.error('Select a piping product from the ASW Library'); return; }
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

  const toggleSection = (section: string) =>
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        code={project.project_code} title={project.project_name} status={project.project_status}
        subtitle={`${project.client_name || ''} ${project.country ? '· ' + project.country : ''}`}
        breadcrumb={<Link to="/projects" className="hover:underline">Projects</Link>}
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
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Client</label>
                    <input value={projectForm.client_name} onChange={e => setProjectForm((f: any) => ({ ...f, client_name: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Site Name</label>
                    <input value={projectForm.site_name} onChange={e => setProjectForm((f: any) => ({ ...f, site_name: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Country</label>
                    <input value={projectForm.country} onChange={e => setProjectForm((f: any) => ({ ...f, country: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">City</label>
                    <input value={projectForm.city} onChange={e => setProjectForm((f: any) => ({ ...f, city: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" />Latitude</label>
                    <input type="number" step="any" placeholder="e.g. 25.2048" value={projectForm.latitude} onChange={e => setProjectForm((f: any) => ({ ...f, latitude: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" />Longitude</label>
                    <input type="number" step="any" placeholder="e.g. 55.2708" value={projectForm.longitude} onChange={e => setProjectForm((f: any) => ({ ...f, longitude: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                    <select value={projectForm.project_status} onChange={e => setProjectForm((f: any) => ({ ...f, project_status: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30">
                      {['Draft', 'Concept', 'Design', 'Handover', 'Released', 'Complete', 'On Hold', 'Cancelled'].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Start Date</label>
                    <input type="date" value={projectForm.start_date} onChange={e => setProjectForm((f: any) => ({ ...f, start_date: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Target Completion</label>
                    <input type="date" value={projectForm.target_completion_date} onChange={e => setProjectForm((f: any) => ({ ...f, target_completion_date: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Project Manager</label>
                    <input value={projectForm.project_manager} onChange={e => setProjectForm((f: any) => ({ ...f, project_manager: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Engineering Manager</label>
                    <input value={projectForm.engineering_manager} onChange={e => setProjectForm((f: any) => ({ ...f, engineering_manager: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">QA Owner</label>
                    <input value={projectForm.qa_owner} onChange={e => setProjectForm((f: any) => ({ ...f, qa_owner: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                    <textarea value={projectForm.notes} onChange={e => setProjectForm((f: any) => ({ ...f, notes: e.target.value }))}
                      rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="space-y-3">
            {/* Status Card with workflow popup */}
            <div className="bg-white border border-slate-200 rounded-lg p-4 relative">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Status</div>
              <div className="flex items-center justify-between">
                <StatusBadge status={project.project_status} className="text-sm px-3 py-1" />
                {isPrivileged && !editingProject && (
                  <button
                    onClick={() => setShowStatusMenu(v => !v)}
                    className="text-xs text-slate-400 hover:text-[#3E5C76] border border-slate-200 rounded-lg px-2 py-1 hover:bg-slate-50 transition-colors flex items-center gap-1"
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
                            const gateFromStatuses = APPROVAL_GATES[stage];
                            const isGated = !!(gateFromStatuses && gateFromStatuses.includes(project.project_status));
                            const isLocked = isGated && !isAdmin;
                            return (
                              <button
                                key={stage}
                                onClick={async () => {
                                  if (isCurrent || isLocked) return;
                                  await handleStatusChange(stage);
                                  setShowStatusMenu(false);
                                }}
                                disabled={isCurrent || isLocked}
                                title={isLocked ? 'Requires admin approval to advance to Design' : undefined}
                                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors w-full
                                  ${isCurrent ? 'bg-[#3E5C76] text-white cursor-default'
                                    : isLocked ? 'opacity-50 cursor-not-allowed text-slate-400'
                                    : 'hover:bg-slate-50 text-slate-700'}
                                `}
                              >
                                <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-xs font-bold
                                  ${isCurrent ? 'bg-white/20 text-white' : isPast ? 'bg-green-100 text-green-600' : isLocked ? 'bg-slate-100 text-slate-300' : 'bg-slate-100 text-slate-400'}
                                `}>
                                  {isPast ? <CheckCircle2 className="w-3.5 h-3.5" /> : isLocked ? <span>🔒</span> : <span>{idx + 1}</span>}
                                </span>
                                <span className="font-medium">{stage}</span>
                                {isCurrent && <span className="ml-auto text-xs text-white/70">current</span>}
                                {isLocked && <span className="ml-auto text-xs text-slate-400">admin only</span>}
                                {!isCurrent && !isLocked && stage === nextStage && <span className="ml-auto text-xs text-[#3E5C76] font-semibold">next →</span>}
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
                              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left text-orange-600 hover:bg-orange-50 transition-colors w-full font-medium">
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
                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left text-[#3E5C76] hover:bg-blue-50 transition-colors w-full font-medium">
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
              { key: 'documents', label: 'Documents' },
              { key: 'changes', label: 'Changes' },
            ] as { key: Tab; label: string }[]).map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${tab === t.key ? 'border-[#3E5C76] text-[#3E5C76]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {t.label}
              </button>
            ))}
            <div className="ml-auto p-2 flex items-center gap-2">
              {tab === 'systems' && <Button size="sm" variant="primary" onClick={() => setShowNewSystem(true)}><Plus className="w-3.5 h-3.5" />System</Button>}
              {tab === 'tanks' && <Button size="sm" variant="primary" onClick={() => { setSelectedTankProduct(null); setTankProductSearch(''); setTankCode(''); setTankStatus('Active'); setShowNewTank(true); }}><Plus className="w-3.5 h-3.5" />Add Tank</Button>}
              {tab === 'piping' && <Button size="sm" variant="primary" onClick={() => { setSelectedPipingProduct(null); setPipingProductSearch(''); setPipingCode(''); setPipingQty('1'); setPipingUnit('EA'); setPipingDesc(''); setShowNewPiping(true); }}><Plus className="w-3.5 h-3.5" />Add Item</Button>}
              {tab === 'bom-release' && <Button size="sm" variant="primary" onClick={() => { setBomTitle(''); setBomRevision('A'); setBomNotes(''); setBomSections({ Products: true, Tank: true, Piping: true }); setShowNewBomRelease(true); }}><FileText className="w-3.5 h-3.5" />New Release</Button>}
            </div>
          </div>

          {tab === 'systems' && (() => {
            const sysItems: System[] = systems?.items || [];
            const eqItems: EquipmentItem[] = equipment?.items || [];
            const eqBySystem = eqItems.reduce<Record<string, EquipmentItem[]>>((acc, eq) => {
              const key = (eq as any).system_id || '__none__';
              if (!acc[key]) acc[key] = [];
              acc[key].push(eq);
              return acc;
            }, {});

            if (sysItems.length === 0) return (
              <div className="p-8 text-center text-sm text-slate-400">No systems added yet — click <strong>System</strong> to add one</div>
            );

            return (
              <div className="divide-y divide-slate-100">
                {sysItems.map(sys => {
                  const expanded = expandedSystemIds.has(sys.id);
                  const sysProducts = eqBySystem[sys.id] || [];
                  return (
                    <div key={sys.id}>
                      <div
                        className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer group"
                        onClick={() => toggleSystem(sys.id)}
                        onContextMenu={e => {
                          e.preventDefault();
                          openEditSystem(sys);
                        }}
                      >
                        <button
                          onClick={e => { e.stopPropagation(); toggleSystem(sys.id); }}
                          className="text-slate-400 hover:text-slate-600 shrink-0"
                        >
                          {expanded
                            ? <ChevronDown className="w-4 h-4" />
                            : <ChevronRight className="w-4 h-4" />}
                        </button>
                        <EntityCode code={sys.system_code} />
                        <span className="font-medium text-sm text-slate-800 flex-1">{sys.system_name}</span>
                        <span className="text-xs text-slate-400">{sys.system_type}</span>
                        {sys.water_type && <span className="text-xs bg-blue-50 text-blue-600 border border-blue-100 rounded px-1.5 py-0.5">{sys.water_type}</span>}
                        {sysProducts.length > 0 && (
                          <span className="text-xs bg-slate-100 text-slate-500 rounded-full px-2 py-0.5 font-medium">
                            {sysProducts.length} product{sysProducts.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        <StatusBadge status={sys.status} />
                        <button
                          onClick={e => { e.stopPropagation(); navigate(`/systems/${sys.id}`); }}
                          className="opacity-0 group-hover:opacity-100 text-xs text-[#3E5C76] hover:underline font-medium shrink-0 flex items-center gap-1 transition-opacity"
                        >
                          Open <ChevronRight className="w-3 h-3" />
                        </button>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={e => { e.stopPropagation(); openEditSystem(sys); }}
                            className="text-xs text-slate-400 hover:text-slate-700 px-1.5 py-0.5 border border-slate-200 rounded hover:bg-slate-100"
                          >Edit</button>
                          <button
                            onClick={async e => {
                              e.stopPropagation();
                              await api.post(`/systems/${sys.id}/duplicate`, {});
                              toast.success('System duplicated');
                              qc.invalidateQueries({ queryKey: ['project-systems'] });
                            }}
                            className="text-xs text-slate-400 hover:text-slate-700 px-1.5 py-0.5 border border-slate-200 rounded hover:bg-slate-100"
                          >Duplicate</button>
                        </div>
                      </div>

                      {expanded && (
                        <div className="bg-slate-50/70 border-t border-b border-slate-100 ml-12 mr-0">
                          {sysProducts.length === 0 ? (
                            <div className="px-6 py-4 text-sm text-slate-400 italic">
                              No products assigned to this system yet. Go to the <strong>Products</strong> tab to add items.
                            </div>
                          ) : (
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-slate-200">
                                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Tag</th>
                                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Product</th>
                                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Code</th>
                                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Qty</th>
                                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {sysProducts.map(eq => (
                                  <tr key={eq.id} className="hover:bg-white/80">
                                    <td className="px-4 py-2.5"><EntityCode code={eq.equip_code} /></td>
                                    <td className="px-4 py-2.5 font-medium text-slate-800">{eq.product_name || (eq as any).description || '—'}</td>
                                    <td className="px-4 py-2.5">
                                      {eq.product_code
                                        ? <Link to={`/products/masters/${eq.product_code}`} className="text-[#3E5C76] hover:underline"><EntityCode code={eq.product_code} /></Link>
                                        : <span className="text-slate-300">—</span>}
                                    </td>
                                    <td className="px-4 py-2.5 text-slate-600">{eq.quantity ?? 1} {eq.unit || 'EA'}</td>
                                    <td className="px-4 py-2.5"><StatusBadge status={eq.status || 'Design'} /></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
          {tab === 'tanks' && <DataTable columns={tankCols} data={tanks?.items || []} tableId="project-tanks" emptyMessage="No tanks added to this project yet — click Add Tank above" />}
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
          {tab === 'documents' && <DataTable columns={docCols} data={documents?.items || []} tableId="project-documents" onRowClick={r => navigate(`/documents/${r.id}`)} />}
          {tab === 'changes' && <DataTable columns={crCols} data={changes?.items || []} tableId="project-changes" />}
        </div>
      </div>

      {showNewSystem && (
        <NewEntityModal title="New System Instance" onClose={() => setShowNewSystem(false)}
          fields={[
            { name: 'system_code', label: 'System Code', required: true, placeholder: 'SYS-LSS-XX-01' },
            { name: 'system_name', label: 'System Name', required: true },
            { name: 'system_type', label: 'System Type', options: ['Life Support', 'Utility', 'HVAC', 'Fire Fighting', 'Electrical', 'Other'] },
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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-800">Add Tank to Project</h2>
              <button onClick={() => setShowNewTank(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tank Product (ASW Library) *</label>
                {selectedTankProduct ? (
                  <div className="border border-[#3E5C76] rounded-lg p-3 bg-blue-50 flex items-start justify-between gap-2">
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
                      className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]"
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
                      <div className="mt-2 text-xs text-slate-400">No tank products found — add them in the ASW Library first</div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Project Tag Code *</label>
                <input
                  placeholder="e.g. TNK-DIS-001"
                  value={tankCode}
                  onChange={e => setTankCode(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                <select value={tankStatus} onChange={e => setTankStatus(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]">
                  {['Design', 'Procurement', 'Installation', 'Commissioning', 'Active', 'Decommissioned'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <Button variant="ghost" onClick={() => setShowNewTank(false)}>Cancel</Button>
              <Button onClick={handleAddTank} disabled={tankSubmitting || !selectedTankProduct || !tankCode.trim()}>
                {tankSubmitting ? 'Adding...' : 'Add Tank'}
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
                <label className="block text-xs font-medium text-slate-600 mb-1">Piping Product (ASW Library) *</label>
                {selectedPipingProduct ? (
                  <div className="border border-[#3E5C76] rounded-lg p-3 bg-blue-50 flex items-start justify-between gap-2">
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
                      className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
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
                      <div className="mt-2 text-xs text-slate-400">No piping products found — add them in the ASW Library first</div>
                    )}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Project Tag Code *</label>
                  <input placeholder="e.g. PIP-LSS-001" value={pipingCode} onChange={e => setPipingCode(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                  <input placeholder="Optional override description" value={pipingDesc} onChange={e => setPipingDesc(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Quantity</label>
                  <input type="number" min="0.01" step="0.01" value={pipingQty} onChange={e => setPipingQty(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Unit</label>
                  <select value={pipingUnit} onChange={e => setPipingUnit(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]">
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
                    <label key={s.key} className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${bomSections[s.key] ? 'border-[#3E5C76] bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}>
                      <input type="checkbox" checked={!!bomSections[s.key]}
                        onChange={e => setBomSections(prev => ({ ...prev, [s.key]: e.target.checked }))}
                        className="mt-0.5 accent-[#3E5C76]" />
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
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Revision</label>
                  <input placeholder="A" maxLength={5} value={bomRevision} onChange={e => setBomRevision(e.target.value.toUpperCase())}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                <textarea rows={2} placeholder="Optional notes or purpose of this release" value={bomNotes} onChange={e => setBomNotes(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76] resize-none" />
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
                                  ? <Link to={`/products/masters/${line.product_code}`} onClick={() => setSelectedRelease(null)} className="text-[#3E5C76] hover:underline text-xs">{line.product_code}</Link>
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
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">System Name</label>
                <input value={editSystemForm.system_name} onChange={e => setEditSystemForm((f: any) => ({ ...f, system_name: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">System Type</label>
                <select value={editSystemForm.system_type} onChange={e => setEditSystemForm((f: any) => ({ ...f, system_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30">
                  <option value="">— select —</option>
                  {['Life Support', 'Utility', 'HVAC', 'Fire Fighting', 'Electrical', 'Other'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Water Type</label>
                <select value={editSystemForm.water_type} onChange={e => setEditSystemForm((f: any) => ({ ...f, water_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30">
                  <option value="">— select —</option>
                  {['Fresh Water', 'Salt Water', 'Brackish', 'N/A'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Design Flow (m³/h)</label>
                <input type="number" value={editSystemForm.design_flow_m3h} onChange={e => setEditSystemForm((f: any) => ({ ...f, design_flow_m3h: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Turnover Rate (/hr)</label>
                <input type="number" value={editSystemForm.turnover_rate_hr} onChange={e => setEditSystemForm((f: any) => ({ ...f, turnover_rate_hr: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                <select value={editSystemForm.status} onChange={e => setEditSystemForm((f: any) => ({ ...f, status: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30">
                  {['Draft', 'Internal Review', 'Approved', 'Released', 'Superseded', 'Obsolete'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Redundancy Strategy</label>
                <input value={editSystemForm.redundancy_strategy} onChange={e => setEditSystemForm((f: any) => ({ ...f, redundancy_strategy: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Duty Description</label>
                <textarea value={editSystemForm.duty_description} onChange={e => setEditSystemForm((f: any) => ({ ...f, duty_description: e.target.value }))}
                  rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
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
    </div>
  );
}
