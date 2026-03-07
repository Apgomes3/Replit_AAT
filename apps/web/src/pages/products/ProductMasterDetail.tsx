import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import MetadataPanel from '../../components/ui/MetadataPanel';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import DataTable, { Column } from '../../components/ui/DataTable';
import { VendorOption, BOMLine, ProductVariant, Document } from '../../types';
import { useState, useRef } from 'react';
import { Network, FileText, FileCheck, FileSearch, Wrench, Award, Upload, Download, Plus, X } from 'lucide-react';
import Button from '../../components/ui/Button';
import toast from 'react-hot-toast';

type Tab = 'bom' | 'variants' | 'vendors' | 'projects' | 'documents';

const DOC_TYPES = [
  { value: 'Technical Data Sheet', label: 'Technical Data Sheet', abbr: 'TDS' },
  { value: 'O&M Manual', label: 'O&M Manual', abbr: 'OMM' },
  { value: 'Installation Manual', label: 'Installation Manual', abbr: 'IM' },
  { value: 'Certificate', label: 'Certificate', abbr: 'CERT' },
  { value: 'Drawing', label: 'Drawing', abbr: 'DWG' },
  { value: 'Test Report', label: 'Test Report', abbr: 'TR' },
  { value: 'Specification', label: 'Specification', abbr: 'SPEC' },
];

const docTypeIcon = (type: string) => {
  switch (type) {
    case 'Technical Data Sheet': return <FileSearch className="w-4 h-4 text-blue-500" />;
    case 'O&M Manual': return <Wrench className="w-4 h-4 text-amber-500" />;
    case 'Installation Manual': return <FileText className="w-4 h-4 text-green-500" />;
    case 'Certificate': return <Award className="w-4 h-4 text-purple-500" />;
    case 'Drawing': return <FileText className="w-4 h-4 text-slate-500" />;
    case 'Test Report': return <FileCheck className="w-4 h-4 text-red-500" />;
    default: return <FileText className="w-4 h-4 text-slate-400" />;
  }
};

export default function ProductMasterDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('bom');
  const [showDocModal, setShowDocModal] = useState(false);
  const [docForm, setDocForm] = useState({ document_type: 'Technical Data Sheet', document_title: '', discipline: '', notes: '' });
  const [docFile, setDocFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: product, isLoading } = useQuery({
    queryKey: ['product-master', id],
    queryFn: () => api.get(`/product-masters/${id}`).then(r => r.data),
  });

  if (isLoading) return <div className="p-8 text-slate-400">Loading...</div>;
  if (!product) return <div className="p-8 text-slate-400">Product not found</div>;

  const bom = product.boms?.[0];
  const bomLines: BOMLine[] = bom?.lines || [];
  const documents: Document[] = product.documents || [];

  const handleAddDocument = async () => {
    if (!docForm.document_title || !docForm.document_type) {
      toast.error('Title and type are required');
      return;
    }
    setSubmitting(true);
    try {
      const abbr = DOC_TYPES.find(t => t.value === docForm.document_type)?.abbr || 'DOC';
      const code = `${product.product_code}-${abbr}-${Date.now().toString(36).toUpperCase()}`;
      const docRes = await api.post('/documents', {
        document_code: code,
        document_title: docForm.document_title,
        document_type: docForm.document_type,
        discipline: docForm.discipline || null,
        product_id: product.id,
        notes: docForm.notes || null,
      });
      const newDoc = docRes.data;

      if (docFile) {
        const fd = new FormData();
        fd.append('file', docFile);
        fd.append('revision_code', 'A');
        fd.append('revision_purpose', 'Initial issue');
        await api.post(`/documents/${newDoc.id}/revisions`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }

      toast.success('Document added');
      setShowDocModal(false);
      setDocForm({ document_type: 'Technical Data Sheet', document_title: '', discipline: '', notes: '' });
      setDocFile(null);
      queryClient.invalidateQueries({ queryKey: ['product-master', id] });
    } catch {
      toast.error('Failed to add document');
    } finally {
      setSubmitting(false);
    }
  };

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

  const docCols: Column<Document>[] = [
    { key: 'document_type', header: 'Type', render: r => (
      <div className="flex items-center gap-2">
        {docTypeIcon(r.document_type)}
        <span className="text-xs text-slate-600">{r.document_type}</span>
      </div>
    )},
    { key: 'document_code', header: 'Code', render: r => <EntityCode code={r.document_code} /> },
    { key: 'document_title', header: 'Title', render: r => (
      <Link to={`/documents/${r.id}`} className="font-medium text-[#3E5C76] hover:underline">{r.document_title}</Link>
    )},
    { key: 'current_revision', header: 'Rev', render: r => r.current_revision ? <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{r.current_revision}</span> : <span className="text-slate-300">—</span> },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
    { key: 'id', header: '', render: r => (
      <div className="flex items-center gap-2 justify-end">
        {(r as any).file_path && (
          <a href={(r as any).file_path} target="_blank" rel="noreferrer"
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-[#3E5C76]">
            <Download className="w-3.5 h-3.5" /> File
          </a>
        )}
      </div>
    )},
  ];

  const tabs: { key: Tab; label: string }[] = [
    { key: 'bom', label: `BOM (${bom ? bom.revision_code : '—'})` },
    { key: 'variants', label: 'Variants' },
    { key: 'vendors', label: 'Vendors' },
    { key: 'documents', label: `Documents (${documents.length})` },
    { key: 'projects', label: 'Projects' },
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
              {product.projects?.length === 0
                ? <div className="text-sm text-slate-400">No project usage</div>
                : product.projects?.map((p: any) => (
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
            {tabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? 'border-[#3E5C76] text-[#3E5C76]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'bom' && (
            bom ? <DataTable columns={bomCols} data={bomLines} emptyMessage="No BOM lines" />
              : <div className="p-8 text-slate-400 text-center">No BOM defined</div>
          )}
          {tab === 'variants' && <DataTable columns={variantCols} data={product.variants || []} emptyMessage="No variants" />}
          {tab === 'vendors' && <DataTable columns={vendorCols} data={product.vendors || []} emptyMessage="No vendor options" />}
          {tab === 'projects' && (
            <div className="p-4">
              {product.projects?.length === 0
                ? <div className="text-slate-400">Not used in any projects</div>
                : product.projects?.map((p: any) => (
                  <Link key={p.project_code} to={`/projects/${p.project_code}`} className="flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg">
                    <EntityCode code={p.project_code} />
                    <span className="text-sm">{p.project_name}</span>
                    <StatusBadge status={p.project_status} />
                  </Link>
                ))}
            </div>
          )}
          {tab === 'documents' && (
            <div>
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <span className="text-sm text-slate-500">{documents.length} document{documents.length !== 1 ? 's' : ''} attached</span>
                <Button size="sm" onClick={() => setShowDocModal(true)}>
                  <Plus className="w-3.5 h-3.5" /> Add Document
                </Button>
              </div>
              <DataTable columns={docCols} data={documents} emptyMessage="No documents attached — add a manual, data sheet or certificate above" />
            </div>
          )}
        </div>
      </div>

      {showDocModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-semibold text-slate-800">Add Document to {product.product_code}</h2>
              <button onClick={() => setShowDocModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Document Type *</label>
                <select value={docForm.document_type} onChange={e => setDocForm(f => ({ ...f, document_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]">
                  {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Title *</label>
                <input type="text" placeholder={`e.g. ${product.product_name} Technical Data Sheet`}
                  value={docForm.document_title} onChange={e => setDocForm(f => ({ ...f, document_title: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Discipline</label>
                <input type="text" placeholder="e.g. Mechanical, Electrical"
                  value={docForm.discipline} onChange={e => setDocForm(f => ({ ...f, discipline: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                <textarea rows={2} placeholder="Optional notes"
                  value={docForm.notes} onChange={e => setDocForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">File (optional — PDF, DWG, etc.)</label>
                <div
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 rounded-lg p-4 text-center cursor-pointer hover:border-[#3E5C76] transition-colors">
                  {docFile
                    ? <div className="flex items-center justify-center gap-2 text-sm text-slate-700"><FileText className="w-4 h-4 text-[#3E5C76]" />{docFile.name} <span className="text-slate-400">({(docFile.size / 1024).toFixed(0)} KB)</span></div>
                    : <div className="flex flex-col items-center gap-1 text-slate-400"><Upload className="w-5 h-5" /><span className="text-sm">Click to upload file</span><span className="text-xs">PDF, DWG, XLSX, PNG — max 100MB</span></div>
                  }
                </div>
                <input ref={fileRef} type="file" className="hidden" onChange={e => setDocFile(e.target.files?.[0] || null)} />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <Button variant="ghost" onClick={() => setShowDocModal(false)}>Cancel</Button>
              <Button onClick={handleAddDocument} disabled={submitting}>
                {submitting ? 'Saving...' : 'Add Document'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
