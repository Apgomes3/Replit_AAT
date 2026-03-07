import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import api from '../../lib/api';
import { ProductMaster } from '../../types';
import DataTable, { Column } from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import NewEntityModal from '../../components/ui/NewEntityModal';
import PipingCsvImport from './PipingCsvImport';
import toast from 'react-hot-toast';
import { Plus, Upload, Copy, Pencil } from 'lucide-react';

const FITTING_TYPES = ['Pipe', 'Fitting', 'Valve', 'Flange', 'Coupling', 'Reducer', 'Union', 'Elbow', 'Tee', 'Cap', 'Other'];
const BRACKET_TYPES = ['Bracket', 'Support', 'Clamp', 'Hanger', 'Saddle', 'Shoe', 'Strut'];
const ALL_PIPE_TYPES = [...FITTING_TYPES, ...BRACKET_TYPES];

const fittingTypeSet = new Set(FITTING_TYPES);
const bracketTypeSet = new Set(BRACKET_TYPES);

function isBracketing(item: ProductMaster) {
  return item.application_type ? bracketTypeSet.has(item.application_type) : false;
}

export default function PipingList() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'fittings' | 'bracketing'>('fittings');
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['product-masters-piping', search],
    queryFn: () => api.get(`/product-masters?category=Piping${search ? `&q=${search}` : ''}&page_size=200`).then(r => r.data),
  });

  const { data: families } = useQuery({
    queryKey: ['product-families'],
    queryFn: () => api.get('/product-families').then(r => r.data),
  });

  const pipingFamilies = families?.items?.filter((f: any) => f.category_code === 'PIPING') || [];
  const familyOptions = pipingFamilies.map((f: any) => f.product_family_code);

  const allItems: ProductMaster[] = data?.items || [];
  const fittings = allItems.filter(i => !isBracketing(i));
  const bracketing = allItems.filter(i => isBracketing(i));
  const displayed = tab === 'fittings' ? fittings : bracketing;

  const columns: Column<ProductMaster>[] = [
    { key: 'product_code', header: 'Code', render: r => <EntityCode code={r.product_code} /> },
    { key: 'product_name', header: 'Item Name', render: r => <span className="font-medium">{r.product_name}</span> },
    { key: 'product_family_name', header: 'Family' },
    { key: 'application_type', header: 'Type', render: r => r.application_type ? <span>{r.application_type}</span> : <span className="text-slate-300">—</span> },
    { key: 'primary_material_code', header: 'Material', render: r => r.primary_material_code ? <EntityCode code={r.primary_material_code} /> : <span className="text-slate-300">—</span> },
    { key: 'standard_status', header: 'Status', render: r => <StatusBadge status={r.standard_status} /> },
  ];

  const newItemTypeOptions = tab === 'fittings' ? FITTING_TYPES : BRACKET_TYPES;
  const total = displayed.length;

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Pipes & Fittings"
        subtitle={`${data?.pagination?.total ?? 0} items in piping library`}
        actions={
          <div className="flex gap-2">
            {tab === 'fittings' && (
              <Button variant="secondary" onClick={() => setShowImport(true)}>
                <Upload className="w-4 h-4" /> Import CSV
              </Button>
            )}
            <Button variant="primary" onClick={() => setShowNew(true)}>
              <Plus className="w-4 h-4" /> New Item
            </Button>
          </div>
        }
      />

      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-6">
        <div className="flex items-center gap-0.5 text-sm">
          <button onClick={() => setTab('fittings')}
            className={`px-3 py-1.5 transition-colors ${tab === 'fittings' ? 'text-[#3E5C76] font-semibold' : 'text-slate-400 hover:text-slate-600'}`}>
            Piping Fittings
            <span className={`ml-1.5 text-xs font-normal ${tab === 'fittings' ? 'text-[#3E5C76]/70' : 'text-slate-300'}`}>{fittings.length}</span>
          </button>
          <button onClick={() => setTab('bracketing')}
            className={`px-3 py-1.5 transition-colors ${tab === 'bracketing' ? 'text-[#3E5C76] font-semibold' : 'text-slate-400 hover:text-slate-600'}`}>
            Bracketing
            <span className={`ml-1.5 text-xs font-normal ${tab === 'bracketing' ? 'text-[#3E5C76]/70' : 'text-slate-300'}`}>{bracketing.length}</span>
          </button>
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or code..."
          className="border border-slate-300 rounded px-3 py-1.5 text-sm w-56 focus:outline-none focus:border-[#3E5C76]" />
        <span className="text-xs text-slate-400 ml-auto">{total} {tab === 'fittings' ? 'fitting' : 'bracket'}{total !== 1 ? 's' : ''}</span>
      </div>

      <div className="flex-1 bg-white overflow-auto">
        <DataTable
          columns={columns} data={displayed} loading={isLoading}
          tableId={tab === 'fittings' ? 'piping-fittings' : 'piping-bracketing'}
          onRowClick={r => navigate(`/products/masters/${r.id}`)}
          emptyMessage={tab === 'fittings'
            ? 'No piping fittings — add one manually or import from CSV'
            : 'No bracketing items — add a bracket, support or clamp'}
          contextMenuItems={row => [
            {
              label: 'Edit',
              icon: <Pencil className="w-3.5 h-3.5" />,
              onClick: () => navigate(`/products/masters/${row.id}`),
            },
            {
              label: 'Duplicate',
              icon: <Copy className="w-3.5 h-3.5" />,
              divider: true,
              onClick: async () => {
                try {
                  const res = await api.post(`/product-masters/${row.id}/duplicate`, {});
                  toast.success('Item duplicated');
                  refetch();
                  navigate(`/products/masters/${res.data.id}`);
                } catch { toast.error('Duplicate failed'); }
              },
            },
          ]}
        />
      </div>

      {showNew && (
        <NewEntityModal
          title={tab === 'fittings' ? 'New Pipe / Fitting' : 'New Bracket / Support'}
          onClose={() => setShowNew(false)}
          fields={[
            { name: 'product_code', label: 'Product Code', required: true, placeholder: tab === 'fittings' ? 'PM-FIT-SS-001' : 'PM-BKT-SS-001' },
            { name: 'product_name', label: 'Item Name', required: true },
            { name: 'product_family_id', label: 'Family', options: familyOptions },
            { name: 'application_type', label: 'Type', options: newItemTypeOptions },
            { name: 'primary_material_code', label: 'Primary Material Code' },
            { name: 'standard_status', label: 'Status', options: ['Concept', 'Development', 'ApprovedStandard', 'Active', 'Deprecated', 'Obsolete'] },
          ]}
          onSubmit={async (formData) => {
            const familyObj = pipingFamilies.find((f: any) => f.product_family_code === formData.product_family_id);
            await api.post('/product-masters', {
              ...formData,
              product_category: 'Piping',
              product_family_id: familyObj?.id ?? undefined,
            });
            toast.success('Item created');
            refetch();
            setShowNew(false);
          }}
        />
      )}

      {showImport && (
        <PipingCsvImport
          onClose={() => setShowImport(false)}
          onImported={() => { refetch(); setShowImport(false); }}
        />
      )}
    </div>
  );
}
