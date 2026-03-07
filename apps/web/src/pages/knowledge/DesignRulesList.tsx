import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import api from '../../lib/api';
import { DesignRule } from '../../types';
import DataTable, { Column } from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import NewEntityModal from '../../components/ui/NewEntityModal';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';

export default function DesignRulesList() {
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<DesignRule | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['design-rules'],
    queryFn: () => api.get('/design-rules').then(r => r.data),
  });

  const columns: Column<DesignRule>[] = [
    { key: 'rule_code', header: 'Code', render: r => <EntityCode code={r.rule_code} /> },
    { key: 'rule_name', header: 'Rule Name', render: r => <span className="font-medium">{r.rule_name}</span> },
    { key: 'discipline', header: 'Discipline' },
    { key: 'applies_to', header: 'Applies To' },
    { key: 'reference_spec', header: 'Reference' },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader title="Design Rules" subtitle="Engineering governance rules and constraints"
          actions={<Button variant="primary" onClick={() => setShowNew(true)}><Plus className="w-4 h-4" />New Rule</Button>}
        />
        <div className="flex-1 bg-white overflow-auto">
          <DataTable columns={columns} data={data?.items || []} loading={isLoading} onRowClick={r => setSelected(r)} />
        </div>
      </div>

      {selected && (
        <div className="w-72 border-l border-slate-200 bg-white overflow-y-auto">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <EntityCode code={selected.rule_code} />
            <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
          </div>
          <div className="p-4 space-y-3 text-sm">
            <div className="font-medium text-slate-800">{selected.rule_name}</div>
            <div><span className="text-slate-400 text-xs uppercase">Discipline</span><div>{selected.discipline || '—'}</div></div>
            <div><span className="text-slate-400 text-xs uppercase">Applies To</span><div>{selected.applies_to || '—'}</div></div>
            <div><span className="text-slate-400 text-xs uppercase">Rule Description</span><div className="text-slate-700 leading-relaxed">{selected.rule_description || '—'}</div></div>
            {selected.reference_spec && <div><span className="text-slate-400 text-xs uppercase">Reference Spec</span><div><EntityCode code={selected.reference_spec} /></div></div>}
          </div>
        </div>
      )}

      {showNew && (
        <NewEntityModal title="New Design Rule" onClose={() => setShowNew(false)}
          fields={[
            { name: 'rule_code', label: 'Rule Code', required: true, placeholder: 'DR-XX-001' },
            { name: 'rule_name', label: 'Rule Name', required: true },
            { name: 'discipline', label: 'Discipline', options: ['Mechanical', 'Piping', 'Electrical', 'Structural', 'Civil', 'Instrumentation', 'General'] },
            { name: 'applies_to', label: 'Applies To', options: ['System', 'Equipment', 'Tank', 'Document', 'Material', 'General'] },
            { name: 'rule_description', label: 'Rule Description' },
            { name: 'reference_spec', label: 'Reference Spec Code' },
          ]}
          onSubmit={async (data) => {
            await api.post('/design-rules', data);
            toast.success('Design rule created');
            refetch();
            setShowNew(false);
          }}
        />
      )}
    </div>
  );
}
