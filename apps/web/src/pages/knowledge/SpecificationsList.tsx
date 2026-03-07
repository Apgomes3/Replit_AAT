import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import api from '../../lib/api';
import { Specification } from '../../types';
import DataTable, { Column } from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import NewEntityModal from '../../components/ui/NewEntityModal';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';

export default function SpecificationsList() {
  const [showNew, setShowNew] = useState(false);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['specifications'],
    queryFn: () => api.get('/specifications').then(r => r.data),
  });

  const columns: Column<Specification>[] = [
    { key: 'spec_code', header: 'Code', render: r => <EntityCode code={r.spec_code} /> },
    { key: 'spec_name', header: 'Specification Name', render: r => <span className="font-medium">{r.spec_name}</span> },
    { key: 'spec_type', header: 'Type' },
    { key: 'standard_reference', header: 'Standard Ref', render: r => <span className="font-mono text-xs text-slate-600">{r.standard_reference || '—'}</span> },
    { key: 'discipline', header: 'Discipline' },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Specifications" subtitle="Engineering standards and specifications"
        actions={<Button variant="primary" onClick={() => setShowNew(true)}><Plus className="w-4 h-4" />New Spec</Button>}
      />
      <div className="flex-1 bg-white overflow-auto">
        <DataTable columns={columns} data={data?.items || []} loading={isLoading} />
      </div>
      {showNew && (
        <NewEntityModal title="New Specification" onClose={() => setShowNew(false)}
          fields={[
            { name: 'spec_code', label: 'Spec Code', required: true, placeholder: 'SPEC-XX-001' },
            { name: 'spec_name', label: 'Specification Name', required: true },
            { name: 'spec_type', label: 'Type', options: ['Design', 'Material', 'Testing', 'Installation', 'Operations', 'Other'] },
            { name: 'standard_reference', label: 'Standard Reference' },
            { name: 'discipline', label: 'Discipline', options: ['Mechanical', 'Piping', 'Electrical', 'Structural', 'Civil', 'Instrumentation', 'General'] },
            { name: 'description', label: 'Description' },
          ]}
          onSubmit={async (data) => {
            await api.post('/specifications', data);
            toast.success('Specification created');
            refetch();
            setShowNew(false);
          }}
        />
      )}
    </div>
  );
}
