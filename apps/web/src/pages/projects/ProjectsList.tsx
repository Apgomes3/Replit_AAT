import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useState, lazy, Suspense } from 'react';
import api from '../../lib/api';
import { Project } from '../../types';
import DataTable, { Column } from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import { Plus, List, Map } from 'lucide-react';
import NewEntityModal from '../../components/ui/NewEntityModal';
import toast from 'react-hot-toast';

const ProjectsMap = lazy(() => import('../../components/ui/ProjectsMap'));

export default function ProjectsList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [view, setView] = useState<'table' | 'map'>('table');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['projects', search],
    queryFn: () => api.get(`/projects${search ? `?q=${search}` : ''}`).then(r => r.data),
  });

  const columns: Column<Project>[] = [
    { key: 'project_code', header: 'Code', render: r => <EntityCode code={r.project_code} /> },
    { key: 'project_name', header: 'Project Name', render: r => <span className="font-medium">{r.project_name}</span> },
    { key: 'client_name', header: 'Client' },
    { key: 'country', header: 'Country' },
    { key: 'project_status', header: 'Status', render: r => <StatusBadge status={r.project_status} /> },
    { key: 'project_manager', header: 'PM' },
    { key: 'target_completion_date', header: 'Target', render: r => r.target_completion_date ? r.target_completion_date.split('T')[0] : '—' },
  ];

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Projects" crumbs={[{ label: 'Project Management', href: '/project-management' }, { label: 'Projects' }]} subtitle={`${data?.pagination?.total ?? 0} projects`}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setView('table')}
                className={`px-3 py-1.5 text-sm flex items-center gap-1.5 transition-colors ${view === 'table' ? 'bg-amber-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                <List className="w-3.5 h-3.5" /> List
              </button>
              <button
                onClick={() => setView('map')}
                className={`px-3 py-1.5 text-sm flex items-center gap-1.5 transition-colors ${view === 'map' ? 'bg-amber-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                <Map className="w-3.5 h-3.5" /> Map
              </button>
            </div>
            <Button variant="primary" onClick={() => setShowNew(true)}><Plus className="w-4 h-4" />New Project</Button>
          </div>
        }
      />

      {view === 'table' && (
        <>
          <div className="p-4 border-b border-slate-200 bg-white">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or code..."
              className="border border-slate-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-amber-600" />
          </div>
          <div className="flex-1 bg-white overflow-auto">
            <DataTable columns={columns} data={data?.items || []} loading={isLoading} onRowClick={r => navigate(`/projects/${r.id}`)} />
          </div>
        </>
      )}

      {view === 'map' && (
        <div className="flex-1 overflow-auto p-4">
          <Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading map...</div>}>
            <ProjectsMap projects={data?.items || []} height="calc(100vh - 180px)" />
          </Suspense>
        </div>
      )}

      {showNew && (
        <NewEntityModal title="New Project" onClose={() => setShowNew(false)}
          fields={[
            { name: 'project_code', label: 'Project Code', required: true, placeholder: 'PRJ-TY-002' },
            { name: 'project_name', label: 'Project Name', required: true },
            { name: 'client_name', label: 'Client' },
            { name: 'country', label: 'Country' },
            { name: 'city', label: 'City' },
            { name: 'project_manager', label: 'Project Manager' },
          ]}
          onSubmit={async (data) => {
            await api.post('/projects', data);
            toast.success('Project created');
            refetch();
            setShowNew(false);
          }}
        />
      )}
    </div>
  );
}
