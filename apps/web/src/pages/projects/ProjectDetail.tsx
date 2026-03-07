import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useState } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import MetadataPanel from '../../components/ui/MetadataPanel';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import DataTable, { Column } from '../../components/ui/DataTable';
import Button from '../../components/ui/Button';
import NewEntityModal from '../../components/ui/NewEntityModal';
import { System, EquipmentInstance, Document, ChangeRequest } from '../../types';
import toast from 'react-hot-toast';
import { Plus, Network, X, Search } from 'lucide-react';

type Tab = 'systems' | 'equipment' | 'tanks' | 'documents' | 'changes';

type Tank = {
  id: string; tank_code: string; tank_name: string; tank_type?: string;
  product_code?: string;
  product_shape?: string; product_length_mm?: number; product_width_mm?: number; product_height_mm?: number;
  product_water_level_mm?: number; product_gross_volume_m3?: number; product_operating_volume_m3?: number;
  product_material?: string; status?: string;
};

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('systems');
  const [showNewSystem, setShowNewSystem] = useState(false);
  const [showNewTank, setShowNewTank] = useState(false);

  const [tankProductSearch, setTankProductSearch] = useState('');
  const [selectedTankProduct, setSelectedTankProduct] = useState<any>(null);
  const [tankCode, setTankCode] = useState('');
  const [tankStatus, setTankStatus] = useState('Active');
  const [tankSubmitting, setTankSubmitting] = useState(false);

  const { data: project, isLoading } = useQuery({
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
    queryFn: () => api.get(`/equipment-instances?project_id=${id}&page_size=200`).then(r => r.data),
    enabled: tab === 'equipment',
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

  if (isLoading) return <div className="p-8 text-slate-400">Loading...</div>;
  if (!project) return <div className="p-8 text-slate-400">Project not found</div>;

  const sysCols: Column<System>[] = [
    { key: 'system_code', header: 'Code', render: r => <EntityCode code={r.system_code} /> },
    { key: 'system_name', header: 'System Name', render: r => <span className="font-medium">{r.system_name}</span> },
    { key: 'system_type', header: 'Type' },
    { key: 'water_type', header: 'Water Type' },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
  ];

  const eqCols: Column<EquipmentInstance>[] = [
    { key: 'equipment_code', header: 'Code', render: r => <EntityCode code={r.equipment_code} /> },
    { key: 'equipment_name', header: 'Equipment Name', render: r => <span className="font-medium">{r.equipment_name}</span> },
    { key: 'equipment_type', header: 'Type' },
    { key: 'system_code', header: 'System', render: r => r.system_code ? <EntityCode code={r.system_code} /> : <span className="text-slate-300">—</span> },
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

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        code={project.project_code} title={project.project_name} status={project.project_status}
        subtitle={`${project.client_name || ''} ${project.country ? '· ' + project.country : ''}`}
        breadcrumb={<Link to="/projects" className="hover:underline">Projects</Link>}
        actions={
          <Button size="sm" onClick={() => navigate(`/graph?start=${project.id}&type=project`)}>
            <Network className="w-3.5 h-3.5" />Graph
          </Button>
        }
      />

      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="col-span-2">
            <MetadataPanel fields={[
              { label: 'Client', value: project.client_name },
              { label: 'Site', value: project.site_name },
              { label: 'Location', value: [project.city, project.country].filter(Boolean).join(', ') },
              { label: 'Start Date', value: project.start_date?.split('T')[0] },
              { label: 'Target Completion', value: project.target_completion_date?.split('T')[0] },
              { label: 'Project Manager', value: project.project_manager },
              { label: 'Engineering Manager', value: project.engineering_manager },
              { label: 'QA Owner', value: project.qa_owner },
            ]} />
          </div>
          <div className="space-y-3">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Status</div>
              <StatusBadge status={project.project_status} className="text-sm px-3 py-1" />
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg">
          <div className="flex border-b border-slate-200">
            {([
              { key: 'systems', label: 'Systems' },
              { key: 'equipment', label: 'Equipment' },
              { key: 'tanks', label: 'Tanks' },
              { key: 'documents', label: 'Documents' },
              { key: 'changes', label: 'Changes' },
            ] as { key: Tab; label: string }[]).map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? 'border-[#3E5C76] text-[#3E5C76]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {t.label}
              </button>
            ))}
            <div className="ml-auto p-2">
              {tab === 'systems' && <Button size="sm" variant="primary" onClick={() => setShowNewSystem(true)}><Plus className="w-3.5 h-3.5" />System</Button>}
              {tab === 'tanks' && <Button size="sm" variant="primary" onClick={() => { setSelectedTankProduct(null); setTankProductSearch(''); setTankCode(''); setTankStatus('Active'); setShowNewTank(true); }}><Plus className="w-3.5 h-3.5" />Add Tank</Button>}
            </div>
          </div>

          {tab === 'systems' && <DataTable columns={sysCols} data={systems?.items || []} onRowClick={r => navigate(`/systems/${r.id}`)} />}
          {tab === 'equipment' && <DataTable columns={eqCols} data={equipment?.items || []} onRowClick={r => navigate(`/equipment/${r.id}`)} />}
          {tab === 'tanks' && <DataTable columns={tankCols} data={tanks?.items || []} emptyMessage="No tanks added to this project yet — click Add Tank above" />}
          {tab === 'documents' && <DataTable columns={docCols} data={documents?.items || []} onRowClick={r => navigate(`/documents/${r.id}`)} />}
          {tab === 'changes' && <DataTable columns={crCols} data={changes?.items || []} />}
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
    </div>
  );
}
