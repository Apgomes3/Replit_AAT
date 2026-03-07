import { useQuery } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import MetadataPanel from '../../components/ui/MetadataPanel';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import DataTable, { Column } from '../../components/ui/DataTable';
import { VendorOption, BOMLine, ProductVariant } from '../../types';
import { useState } from 'react';
import { Network } from 'lucide-react';
import Button from '../../components/ui/Button';

type Tab = 'bom' | 'variants' | 'vendors' | 'projects';

export default function ProductMasterDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('bom');

  const { data: product, isLoading } = useQuery({
    queryKey: ['product-master', id],
    queryFn: () => api.get(`/product-masters/${id}`).then(r => r.data),
  });

  if (isLoading) return <div className="p-8 text-slate-400">Loading...</div>;
  if (!product) return <div className="p-8 text-slate-400">Product not found</div>;

  const bom = product.boms?.[0];
  const bomLines: BOMLine[] = bom?.lines || [];

  const bomCols: Column<BOMLine>[] = [
    { key: 'line_number', header: '#', className: 'w-12' },
    { key: 'component_type', header: 'Type' },
    { key: 'component_reference_code', header: 'Code', render: r => r.component_reference_code ? <EntityCode code={r.component_reference_code} /> : <span className="text-slate-300">—</span> },
    { key: 'component_name', header: 'Component Name', render: r => <span className="font-medium">{r.component_name}</span> },
    { key: 'quantity', header: 'Qty' },
    { key: 'unit', header: 'Unit' },
    { key: 'is_optional', header: 'Optional', render: r => r.is_optional ? <span className="text-amber-600 text-xs">Optional</span> : null },
    { key: 'remarks', header: 'Remarks' },
  ];

  const variantCols: Column<ProductVariant>[] = [
    { key: 'variant_code', header: 'Code', render: r => <EntityCode code={r.variant_code} /> },
    { key: 'variant_name', header: 'Variant Name', render: r => <span className="font-medium">{r.variant_name}</span> },
    { key: 'variant_reason', header: 'Reason' },
    { key: 'override_material_code', header: 'Material Override', render: r => r.override_material_code ? <EntityCode code={r.override_material_code} /> : <span className="text-slate-300">—</span> },
    { key: 'override_power_kw', header: 'Power Override' },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
  ];

  const vendorCols: Column<VendorOption>[] = [
    { key: 'vendor_option_code', header: 'Code', render: r => <EntityCode code={r.vendor_option_code} /> },
    { key: 'vendor_name', header: 'Vendor' },
    { key: 'manufacturer_name', header: 'Manufacturer' },
    { key: 'vendor_item_code', header: 'Item Code', render: r => r.vendor_item_code ? <EntityCode code={r.vendor_item_code} /> : <span className="text-slate-300">—</span> },
    { key: 'approved_status', header: 'Status', render: r => <StatusBadge status={r.approved_status} /> },
    { key: 'lead_time_days', header: 'Lead Time', render: r => r.lead_time_days ? `${r.lead_time_days} days` : '—' },
    { key: 'region_scope', header: 'Region' },
  ];

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        code={product.product_code} title={product.product_name} status={product.standard_status}
        subtitle={`${product.product_category || ''} ${product.application_type ? '· ' + product.application_type : ''}`}
        breadcrumb={<><Link to="/products" className="hover:underline">Families</Link> / <Link to="/products/masters" className="hover:underline">Products</Link></>}
        actions={
          <Button size="sm" onClick={() => navigate(`/graph?start=${product.id}&type=product`)}>
            <Network className="w-3.5 h-3.5" />Graph
          </Button>
        }
      />

      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="col-span-2">
            <MetadataPanel fields={[
              { label: 'Family', value: product.product_family_name },
              { label: 'Category', value: product.product_category },
              { label: 'Application', value: product.application_type },
              { label: 'Design Flow', value: product.design_flow_m3h ? `${product.design_flow_m3h} m³/h` : null },
              { label: 'Design Head', value: product.design_head_m ? `${product.design_head_m} m` : null },
              { label: 'Power', value: product.power_kw ? `${product.power_kw} kW` : null },
              { label: 'Primary Material', value: product.primary_material_code ? <><EntityCode code={product.primary_material_code} /> {product.material_name && <span className="text-slate-500 text-xs ml-1">{product.material_name}</span>}</> : null },
              { label: 'Notes', value: product.notes },
            ]} />
          </div>
          <div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Used in Projects</div>
              {product.projects?.length === 0 ? <div className="text-sm text-slate-400">No project usage</div> : product.projects?.map((p: any) => (
                <div key={p.project_code} className="flex items-center gap-2 mb-1.5">
                  <Link to={`/projects/${p.project_code}`}><EntityCode code={p.project_code} /></Link>
                  <span className="text-xs text-slate-500 truncate">{p.project_name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg">
          <div className="flex border-b border-slate-200">
            {(['bom', 'variants', 'vendors', 'projects'] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-3 text-sm capitalize font-medium border-b-2 transition-colors ${tab === t ? 'border-[#3E5C76] text-[#3E5C76]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {t === 'bom' ? `BOM (${bom ? bom.revision_code : '—'})` : t}
              </button>
            ))}
          </div>
          {tab === 'bom' && (
            bom ? <DataTable columns={bomCols} data={bomLines} emptyMessage="No BOM lines" /> : <div className="p-8 text-slate-400 text-center">No BOM defined</div>
          )}
          {tab === 'variants' && <DataTable columns={variantCols} data={product.variants || []} emptyMessage="No variants" />}
          {tab === 'vendors' && <DataTable columns={vendorCols} data={product.vendors || []} emptyMessage="No vendor options" />}
          {tab === 'projects' && (
            <div className="p-4">
              {product.projects?.length === 0 ? <div className="text-slate-400">Not used in any projects</div> : product.projects?.map((p: any) => (
                <Link key={p.project_code} to={`/projects/${p.project_code}`} className="flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg">
                  <EntityCode code={p.project_code} />
                  <span className="text-sm">{p.project_name}</span>
                  <StatusBadge status={p.project_status} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
