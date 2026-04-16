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
import toast from 'react-hot-toast';
import { Plus, Copy, Pencil, Container } from 'lucide-react';

const TANK_TYPES = ['Display Tank', 'Sump', 'Refugium', 'Quarantine', 'Acclimation', 'Holding', 'Treatment', 'Header Tank', 'Buffer Tank', 'Other'];
const TANK_SHAPES = ['Rectangular', 'Cylindrical', 'Oval', 'Hexagonal', 'Custom'];
const TANK_MATERIALS = ['Acrylic', 'Glass', 'FRP', 'HDPE', 'GRP', 'Stainless Steel', 'Concrete', 'Other'];

export default function TanksList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null);

  const { data: familiesData } = useQuery({
    queryKey: ['tank-families'],
    queryFn: () => api.get('/tank-families').then(r => r.data),
  });

  const tankFamilies: any[] = familiesData?.items || [];

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['product-masters-tanks', search, selectedFamilyId],
    queryFn: () => {
      let url = `/product-masters?category=Tank&page_size=200`;
      if (search) url += `&q=${search}`;
      if (selectedFamilyId) url += `&tank_family_id=${selectedFamilyId}`;
      return api.get(url).then(r => r.data);
    },
  });

  const fmtMm = (v: any) => v != null ? <span>{v} mm</span> : <span className="text-slate-300">—</span>;
  const fmtM3 = (v: any) => v != null ? <span>{v} m³</span> : <span className="text-slate-300">—</span>;

  const columns: Column<ProductMaster>[] = [
    { key: 'product_code', header: 'Code', render: r => <EntityCode code={r.product_code} /> },
    { key: 'product_name', header: 'Tank Name / Model', render: r => <span className="font-medium">{r.product_name}</span> },
    { key: 'application_type', header: 'Type', render: r => r.application_type ? <span>{r.application_type}</span> : <span className="text-slate-300">—</span> },
    { key: 'shape_type' as any, header: 'Shape', render: (r: any) => r.shape_type ? <span>{r.shape_type}</span> : <span className="text-slate-300">—</span> },
    { key: 'length_mm' as any, header: 'L (mm)', render: (r: any) => fmtMm(r.length_mm) },
    { key: 'width_mm' as any, header: 'W (mm)', render: (r: any) => fmtMm(r.width_mm) },
    { key: 'height_mm' as any, header: 'H (mm)', render: (r: any) => fmtMm(r.height_mm) },
    { key: 'gross_volume_m3' as any, header: 'Gross Vol (m³)', render: (r: any) => fmtM3(r.gross_volume_m3) },
    { key: 'operating_volume_m3' as any, header: 'Op. Vol (m³)', render: (r: any) => fmtM3(r.operating_volume_m3) },
    { key: 'primary_material_code', header: 'Material', render: r => r.primary_material_code ? <EntityCode code={r.primary_material_code} /> : <span className="text-slate-300">—</span> },
    { key: 'standard_status', header: 'Status', render: r => <StatusBadge status={r.standard_status} /> },
  ];

  const selectedFamily = tankFamilies.find(f => f.id === selectedFamilyId);

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title={selectedFamily ? selectedFamily.name : 'Tanks'}
        crumbs={[{ label: 'PIM', href: '/pim' }, { label: 'Tanks' }]}
        subtitle={selectedFamily ? selectedFamily.description || `${data?.pagination?.total ?? 0} tank types` : `${data?.pagination?.total ?? 0} tank types in library`}
        actions={<Button variant="primary" onClick={() => setShowNew(true)}><Plus className="w-4 h-4" />New Tank Type</Button>}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Family sidebar */}
        <div className="w-52 flex-shrink-0 bg-white border-r border-slate-200 overflow-auto">
          <div className="px-3 py-2.5 border-b border-slate-100">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Families</span>
          </div>
          <div className="py-1">
            <button
              onClick={() => setSelectedFamilyId(null)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded-none transition-colors ${
                selectedFamilyId === null
                  ? 'bg-amber-600/10 text-amber-600 font-medium'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Container className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">All Tanks</span>
              <span className="ml-auto text-xs text-slate-400">{data?.pagination?.total ?? ''}</span>
            </button>
            {tankFamilies.map((fam: any) => (
              <button
                key={fam.id}
                onClick={() => setSelectedFamilyId(fam.id === selectedFamilyId ? null : fam.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                  selectedFamilyId === fam.id
                    ? 'bg-amber-600/10 text-amber-600 font-medium'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Container className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                <span className="truncate">{fam.name}</span>
                <span className="ml-auto text-xs text-slate-400">{fam.product_count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0 bg-white overflow-hidden">
          <div className="p-3 border-b border-slate-200">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or code..."
              className="border border-slate-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-amber-600"
            />
          </div>
          <div className="flex-1 overflow-auto">
            <DataTable
              columns={columns} data={data?.items || []} loading={isLoading} tableId="tanks-list"
              onRowClick={r => navigate(`/products/masters/${r.id}`)}
              emptyMessage="No tank types — add a tank model above or select a different family"
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
                      toast.success('Tank duplicated');
                      refetch();
                      navigate(`/products/masters/${res.data.id}`);
                    } catch { toast.error('Duplicate failed'); }
                  },
                },
              ]}
            />
          </div>
        </div>
      </div>

      {showNew && (
        <NewEntityModal title="New Tank Type" onClose={() => setShowNew(false)}
          fields={[
            { name: 'product_code', label: 'Product Code', required: true, placeholder: 'PM-TNK-ACR-001' },
            { name: 'product_name', label: 'Tank Name / Model', required: true },
            { name: 'tank_family_id', label: 'Tank Family', options: tankFamilies.map((f: any) => f.name) },
            { name: 'application_type', label: 'Tank Type', options: TANK_TYPES },
            { name: 'shape_type', label: 'Shape', options: TANK_SHAPES },
            { name: 'length_mm', label: 'Length (mm)', placeholder: 'e.g. 2000' },
            { name: 'width_mm', label: 'Width (mm)', placeholder: 'e.g. 800' },
            { name: 'height_mm', label: 'Height (mm)', placeholder: 'e.g. 600' },
            { name: 'design_water_level_mm', label: 'Design Water Level (mm)', placeholder: 'e.g. 550' },
            { name: 'gross_volume_m3', label: 'Gross Volume (m³)', placeholder: 'e.g. 0.96' },
            { name: 'operating_volume_m3', label: 'Operating Volume (m³)', placeholder: 'e.g. 0.88' },
            { name: 'primary_material_code', label: 'Primary Material', options: TANK_MATERIALS },
            { name: 'standard_status', label: 'Status', options: ['Concept', 'Development', 'ApprovedStandard', 'Active', 'Deprecated', 'Obsolete'] },
          ]}
          onSubmit={async (formData) => {
            const familyObj = tankFamilies.find((f: any) => f.name === formData.tank_family_id);
            await api.post('/product-masters', {
              ...formData,
              product_category: 'Tank',
              tank_family_id: familyObj?.id ?? undefined,
              product_family_id: undefined,
              length_mm: formData.length_mm ? Number(formData.length_mm) : null,
              width_mm: formData.width_mm ? Number(formData.width_mm) : null,
              height_mm: formData.height_mm ? Number(formData.height_mm) : null,
              design_water_level_mm: formData.design_water_level_mm ? Number(formData.design_water_level_mm) : null,
              gross_volume_m3: formData.gross_volume_m3 ? Number(formData.gross_volume_m3) : null,
              operating_volume_m3: formData.operating_volume_m3 ? Number(formData.operating_volume_m3) : null,
            });
            toast.success('Tank type created');
            refetch();
            setShowNew(false);
          }}
        />
      )}
    </div>
  );
}
