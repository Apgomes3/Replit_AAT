import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import api from '../../lib/api';
import { Material } from '../../types';
import DataTable, { Column } from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import NewEntityModal from '../../components/ui/NewEntityModal';
import toast from 'react-hot-toast';
import { Plus, Pencil } from 'lucide-react';

export default function MaterialsList() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<Material | null>(null);
  const [editRow, setEditRow] = useState<Material | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['materials'],
    queryFn: () => api.get('/materials').then(r => r.data),
  });

  const { data: matDetail } = useQuery({
    queryKey: ['material', selected?.id],
    queryFn: () => api.get(`/materials/${selected!.id}`).then(r => r.data),
    enabled: !!selected,
  });

  const columns: Column<Material>[] = [
    { key: 'material_code', header: 'Code', render: r => <EntityCode code={r.material_code} /> },
    { key: 'material_name', header: 'Material Name', render: r => <span className="font-medium">{r.material_name}</span> },
    { key: 'material_category', header: 'Category' },
    { key: 'density', header: 'Density (kg/m³)' },
    { key: 'temperature_limit', header: 'Temp Limit (°C)' },
    { key: 'chemical_resistance', header: 'Chemical Resistance', render: r => <span className="text-sm text-slate-500 truncate max-w-xs block">{r.chemical_resistance || '—'}</span> },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
  ];

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader title="Materials" subtitle="Engineering material definitions"
          actions={<Button variant="primary" onClick={() => setShowNew(true)}><Plus className="w-4 h-4" />New Material</Button>}
        />
        <div className="flex-1 bg-white overflow-auto">
          <DataTable
            columns={columns} data={data?.items || []} loading={isLoading}
            onRowClick={r => setSelected(r)}
            contextMenuItems={row => [
              {
                label: 'Edit',
                icon: <Pencil className="w-3.5 h-3.5" />,
                onClick: () => setEditRow(row),
              },
            ]}
          />
        </div>
      </div>

      {selected && matDetail && (
        <div className="w-72 border-l border-slate-200 bg-white overflow-y-auto">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <EntityCode code={matDetail.material_code} />
            <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
          </div>
          <div className="p-4 space-y-3">
            <div className="font-medium text-slate-800">{matDetail.material_name}</div>
            <div className="space-y-2 text-sm">
              {[['Category', matDetail.material_category], ['Density', matDetail.density ? `${matDetail.density} kg/m³` : null],
                ['Temp Limit', matDetail.temperature_limit ? `${matDetail.temperature_limit} °C` : null],
                ['Chemical Resistance', matDetail.chemical_resistance]].map(([k, v]) => v && (
                <div key={k as string}><span className="text-slate-400 text-xs uppercase">{k}</span><div className="text-slate-700">{v as string}</div></div>
              ))}
            </div>
            {matDetail.products?.length > 0 && (
              <div>
                <div className="text-xs text-slate-400 uppercase tracking-wide mb-1.5">Used in Products</div>
                {matDetail.products.map((p: any) => (
                  <div key={p.product_code} className="flex items-center gap-1.5 mb-1">
                    <EntityCode code={p.product_code} />
                    <span className="text-xs text-slate-500 truncate">{p.product_name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showNew && (
        <NewEntityModal title="New Material" onClose={() => setShowNew(false)}
          fields={[
            { name: 'material_code', label: 'Material Code', required: true, placeholder: 'MAT-XX-YY' },
            { name: 'material_name', label: 'Material Name', required: true },
            { name: 'material_category', label: 'Category', options: ['Metal', 'Plastic', 'Composite', 'Rubber', 'Glass', 'Ceramic', 'Other'] },
            { name: 'density', label: 'Density (kg/m³)', type: 'number' },
            { name: 'temperature_limit', label: 'Temperature Limit (°C)', type: 'number' },
            { name: 'chemical_resistance', label: 'Chemical Resistance' },
          ]}
          onSubmit={async (data) => {
            await api.post('/materials', data);
            toast.success('Material created');
            refetch();
            setShowNew(false);
          }}
        />
      )}

      {editRow && (
        <NewEntityModal
          title={`Edit ${editRow.material_code}`}
          submitLabel="Save Changes"
          onClose={() => setEditRow(null)}
          initialValues={{
            material_name: editRow.material_name,
            material_category: (editRow as any).material_category || '',
            density: (editRow as any).density || '',
            temperature_limit: (editRow as any).temperature_limit || '',
            chemical_resistance: (editRow as any).chemical_resistance || '',
            status: (editRow as any).status || '',
            notes: (editRow as any).notes || '',
          }}
          fields={[
            { name: 'material_name', label: 'Material Name', required: true },
            { name: 'material_category', label: 'Category', options: ['Metal', 'Plastic', 'Composite', 'Rubber', 'Glass', 'Ceramic', 'Other'] },
            { name: 'density', label: 'Density (kg/m³)', type: 'number' },
            { name: 'temperature_limit', label: 'Temperature Limit (°C)', type: 'number' },
            { name: 'chemical_resistance', label: 'Chemical Resistance' },
            { name: 'status', label: 'Status', options: ['Active', 'Inactive', 'Draft'] },
            { name: 'notes', label: 'Notes' },
          ]}
          onSubmit={async (formData) => {
            await api.put(`/materials/${editRow.id}`, formData);
            toast.success('Material updated');
            qc.invalidateQueries({ queryKey: ['materials'] });
            if (selected?.id === editRow.id) qc.invalidateQueries({ queryKey: ['material', editRow.id] });
            setEditRow(null);
          }}
        />
      )}
    </div>
  );
}
