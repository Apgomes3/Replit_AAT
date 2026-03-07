import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import api from '../../lib/api';
import { Document } from '../../types';
import DataTable, { Column } from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import NewEntityModal from '../../components/ui/NewEntityModal';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';

export default function DocumentsList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['documents', search],
    queryFn: () => api.get(`/documents${search ? `?q=${search}` : ''}`).then(r => r.data),
  });

  const { data: projects } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => api.get('/projects?page_size=200').then(r => r.data),
  });

  const columns: Column<Document>[] = [
    { key: 'document_code', header: 'Code', render: r => <EntityCode code={r.document_code} /> },
    { key: 'document_title', header: 'Title', render: r => <span className="font-medium">{r.document_title}</span> },
    { key: 'document_type', header: 'Type' },
    { key: 'discipline', header: 'Discipline' },
    { key: 'project_code', header: 'Project', render: r => r.project_code ? <EntityCode code={r.project_code} /> : <span className="text-slate-300">—</span> },
    { key: 'current_revision', header: 'Rev', render: r => <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{r.current_revision}</span> },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
    { key: 'owner', header: 'Owner' },
  ];

  const projectOptions = projects?.items?.map((p: any) => p.project_code) || [];

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Document Register" subtitle={`${data?.pagination?.total ?? 0} documents`}
        actions={<Button variant="primary" onClick={() => setShowNew(true)}><Plus className="w-4 h-4" />Register Document</Button>}
      />
      <div className="p-4 border-b border-slate-200 bg-white">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by code or title..."
          className="border border-slate-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-[#3E5C76]" />
      </div>
      <div className="flex-1 bg-white overflow-auto">
        <DataTable columns={columns} data={data?.items || []} loading={isLoading} onRowClick={r => navigate(`/documents/${r.id}`)} />
      </div>
      {showNew && (
        <NewEntityModal title="Register Document" onClose={() => setShowNew(false)}
          fields={[
            { name: 'document_code', label: 'Document Code', required: true, placeholder: 'DOC-PID-001' },
            { name: 'document_title', label: 'Document Title', required: true },
            { name: 'document_type', label: 'Document Type', options: ['PID', 'Drawing', 'Calculation', 'Specification', 'Datasheet', 'Report', 'Procedure', 'Other'] },
            { name: 'discipline', label: 'Discipline', options: ['Mechanical', 'Piping', 'Electrical', 'Structural', 'Civil', 'General'] },
            { name: 'owner', label: 'Owner / Author' },
          ]}
          onSubmit={async (formData) => {
            await api.post('/documents', formData);
            toast.success('Document registered');
            refetch();
            setShowNew(false);
          }}
        />
      )}
    </div>
  );
}
