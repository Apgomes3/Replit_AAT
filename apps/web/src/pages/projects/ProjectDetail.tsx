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
import { Plus, Network } from 'lucide-react';

type Tab = 'systems' | 'equipment' | 'tanks' | 'documents' | 'changes';

type Tank = { id: string; tank_code: string; tank_name: string; tank_type?: string; shape_type?: string; length_mm?: number; width_mm?: number; height_mm?: number; design_water_level_mm?: number; gross_volume_m3?: number; operating_volume_m3?: number; primary_material?: string; status?: string; };

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('systems');
  const [showNewSystem, setShowNewSystem] = useState(false);
  const [showNewTank, setShowNewTank] = useState(false);

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
    queryFn: () => api.get(`/projects/${id}/equipment`).then(r => r.data),
    enabled: tab === 'equipment',
  });

  const { data: tanks } = useQuery({
    queryKey: ['project-tanks', id],
    queryFn: () => api.get(`/tanks?project_id=${id}`).then(r => r.data),
    enabled: tab === 'tanks',
  });

  const { data: documents } = useQuery({
    queryKey: ['project-documents', id],
    queryFn: () => api.get(`/projects/${id}/documents`).then(r => r.data),
    enabled: tab === 'documents',
  });

  const { data: changes } = useQuery({
    queryKey: ['project-changes', id],
    queryFn: () => api.get(`/projects/${id}/change-requests`).then(r => r.data),
    enabled: tab === 'changes',
  });

  if (isLoading) return <div className="p-8 text-slate-400">Loading...</div>;
  if (!project) return <div className="p-8 text-slate-400">Project not found</div>;

  const sysCols: Column<System>[] = [
    { key: 'system_code', header: 'Code', render: r => <EntityCode code={r.system_code} /> },
    { key: 'system_name', header: 'System Name', render: r => <span className="font-medium">{r.system_name}</span> },
    { key: 'system_type', header: 'Type' },
    { key: 'water_type', header: 'Water Type' },
    { key: 'design_flow_m3h', header: 'Flow (m³/h)' },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
  ];

  const eqCols: Column<EquipmentInstance>[] = [
    { key: 'equipment_code', header: 'Code', render: r => <EntityCode code={r.equipment_code} /> },
    { key: 'equipment_name', header: 'Equipment Name', render: r => <span className="font-medium">{r.equipment_name}</span> },
    { key: 'equipment_type', header: 'Type' },
    { key: 'system_code', header: 'System', render: r => r.system_code ? <EntityCode code={r.system_code} /> : <span className="text-slate-300">—</span> },
    { key: 'product_code', header: 'Product', render: r => r.product_code ? <EntityCode code={r.product_code} /> : <span className="text-slate-300">—</span> },
    { key: 'power_kw', header: 'Power (kW)' },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
  ];

  const docCols: Column<Document>[] = [
    { key: 'document_code', header: 'Code', render: r => <EntityCode code={r.document_code} /> },
    { key: 'document_title', header: 'Title', render: r => <span className="font-medium">{r.document_title}</span> },
    { key: 'document_type', header: 'Type' },
    { key: 'discipline', header: 'Discipline' },
    { key: 'current_revision', header: 'Rev', render: r => <span className="font-mono text-xs">{r.current_revision}</span> },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
  ];

  const fmt = (v?: number, unit = '') => v != null ? <span>{v}{unit}</span> : <span className="text-slate-300">—</span>;

  const tankCols: Column<Tank>[] = [
    { key: 'tank_code', header: 'Code', render: r => <EntityCode code={r.tank_code} /> },
    { key: 'tank_name', header: 'Tank Name', render: r => <span className="font-medium">{r.tank_name}</span> },
    { key: 'tank_type', header: 'Type', render: r => r.tank_type ? <span>{r.tank_type}</span> : <span className="text-slate-300">—</span> },
    { key: 'shape_type', header: 'Shape', render: r => r.shape_type ? <span>{r.shape_type}</span> : <span className="text-slate-300">—</span> },
    { key: 'length_mm', header: 'L (mm)', render: r => fmt(r.length_mm) },
    { key: 'width_mm', header: 'W (mm)', render: r => fmt(r.width_mm) },
    { key: 'height_mm', header: 'H (mm)', render: r => fmt(r.height_mm) },
    { key: 'design_water_level_mm', header: 'Water Level (mm)', render: r => fmt(r.design_water_level_mm) },
    { key: 'gross_volume_m3', header: 'Gross Vol (m³)', render: r => fmt(r.gross_volume_m3) },
    { key: 'operating_volume_m3', header: 'Op. Vol (m³)', render: r => fmt(r.operating_volume_m3) },
    { key: 'primary_material', header: 'Material', render: r => r.primary_material ? <span>{r.primary_material}</span> : <span className="text-slate-300">—</span> },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status || 'Active'} /> },
  ];

  const crCols: Column<ChangeRequest>[] = [
    { key: 'change_code', header: 'Code', render: r => <EntityCode code={r.change_code} /> },
    { key: 'title', header: 'Title', render: r => <span className="font-medium">{r.title}</span> },
    { key: 'risk_level', header: 'Risk' },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
    { key: 'requested_by_name', header: 'Requested By' },
  ];

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
              {tab === 'tanks' && <Button size="sm" variant="primary" onClick={() => setShowNewTank(true)}><Plus className="w-3.5 h-3.5" />Add Tank</Button>}
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
        <NewEntityModal title="Add Tank to Project" onClose={() => setShowNewTank(false)}
          fields={[
            { name: 'tank_code', label: 'Tank Code', required: true, placeholder: 'TNK-DIS-001' },
            { name: 'tank_name', label: 'Tank Name', required: true },
            { name: 'tank_type', label: 'Tank Type', options: ['Display Tank', 'Sump', 'Refugium', 'Quarantine', 'Acclimation', 'Holding', 'Treatment', 'Header Tank', 'Buffer Tank', 'Other'] },
            { name: 'shape_type', label: 'Shape', options: ['Rectangular', 'Cylindrical', 'Oval', 'Hexagonal', 'Custom'] },
            { name: 'gross_volume_m3', label: 'Gross Volume (m³)', type: 'number' },
            { name: 'operating_volume_m3', label: 'Operating Volume (m³)', type: 'number' },
            { name: 'length_mm', label: 'Length (mm)', type: 'number' },
            { name: 'width_mm', label: 'Width (mm)', type: 'number' },
            { name: 'height_mm', label: 'Total Height (mm)', type: 'number' },
            { name: 'design_water_level_mm', label: 'Design Water Level (mm)', type: 'number' },
            { name: 'primary_material', label: 'Material', options: ['Acrylic', 'Glass', 'FRP', 'HDPE', 'GRP', 'Stainless Steel', 'Concrete', 'Other'] },
            { name: 'status', label: 'Status', options: ['Active', 'Design', 'Procurement', 'Installation', 'Commissioning', 'Decommissioned'] },
          ]}
          onSubmit={async (data) => {
            await api.post('/tanks', { ...data, project_id: project.id });
            toast.success('Tank added');
            qc.invalidateQueries({ queryKey: ['project-tanks'] });
            setShowNewTank(false);
          }}
        />
      )}
    </div>
  );
}
