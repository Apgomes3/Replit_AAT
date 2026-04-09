import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useState, useRef } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import MetadataPanel from '../../components/ui/MetadataPanel';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import LifecycleHistory from '../../components/ui/LifecycleHistory';
import DataTable, { Column } from '../../components/ui/DataTable';
import Button from '../../components/ui/Button';
import toast from 'react-hot-toast';
import { Network, FileText, FileCheck, FileSearch, Wrench, Award, Upload, Plus, X } from 'lucide-react';
import { Document } from '../../types';

type Tab = 'specs' | 'documents';

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

export default function EquipmentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('specs');
  const [showTransition, setShowTransition] = useState(false);
  const [newState, setNewState] = useState('');
  const [showDocModal, setShowDocModal] = useState(false);
  const [docForm, setDocForm] = useState({ document_type: 'Technical Data Sheet', document_title: '', discipline: '', notes: '' });
  const [docFile, setDocFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: equipment, isLoading, refetch } = useQuery({
    queryKey: ['equipment', id],
    queryFn: () => api.get(`/equipment-instances/${id}`).then(r => r.data),
  });

  const { data: history } = useQuery({
    queryKey: ['lifecycle', 'equipment', id],
    queryFn: () => api.get(`/lifecycle/equipment/${id}`).then(r => r.data),
  });

  if (isLoading) return <div className="p-8 text-slate-400">Loading...</div>;
  if (!equipment) return <div className="p-8 text-slate-400">Equipment not found</div>;

  const documents: Document[] = equipment.documents || [];
  const transitions = ['Draft', 'Internal Review', 'Approved', 'Released', 'Superseded', 'Obsolete'];

  const handleAddDocument = async () => {
    if (!docForm.document_title || !docForm.document_type) {
      toast.error('Title and type are required');
      return;
    }
    setSubmitting(true);
    try {
      const abbr = DOC_TYPES.find(t => t.value === docForm.document_type)?.abbr || 'DOC';
      const code = `${equipment.equipment_code}-${abbr}-${Date.now().toString(36).toUpperCase()}`;
      const docRes = await api.post('/documents', {
        document_code: code,
        document_title: docForm.document_title,
        document_type: docForm.document_type,
        discipline: docForm.discipline || null,
        equipment_id: equipment.id,
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
      refetch();
    } catch {
      toast.error('Failed to add document');
    } finally {
      setSubmitting(false);
    }
  };

  const docCols: Column<Document>[] = [
    { key: 'document_type', header: 'Type', render: r => (
      <div className="flex items-center gap-2">
        {docTypeIcon(r.document_type)}
        <span className="text-xs text-slate-600">{r.document_type}</span>
      </div>
    )},
    { key: 'document_code', header: 'Code', render: r => <EntityCode code={r.document_code} /> },
    { key: 'document_title', header: 'Title', render: r => (
      <Link to={`/documents/${r.id}`} className="font-medium text-amber-600 hover:underline">{r.document_title}</Link>
    )},
    { key: 'current_revision', header: 'Rev', render: r => r.current_revision
      ? <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{r.current_revision}</span>
      : <span className="text-slate-300">—</span> },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
  ];

  const tabs: { key: Tab; label: string }[] = [
    { key: 'specs', label: 'Specifications' },
    { key: 'documents', label: `Documents (${documents.length})` },
  ];

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        code={equipment.equipment_code} title={equipment.equipment_name} status={equipment.status}
        subtitle={equipment.equipment_type}
        breadcrumb={<>
          <Link to="/projects" className="hover:underline">Projects</Link> /
          <Link to={`/projects/${equipment.project_id}`} className="hover:underline ml-1">{equipment.project_code}</Link> /
          {equipment.system_id && <Link to={`/systems/${equipment.system_id}`} className="hover:underline ml-1">{equipment.system_code}</Link>}
        </>}
        actions={
          <div className="flex gap-2">
            <Button size="sm" onClick={() => navigate(`/graph?start=${equipment.id}&type=equipment`)}>
              <Network className="w-3.5 h-3.5" />Graph
            </Button>
            <Button size="sm" onClick={() => setShowTransition(true)}>Transition State</Button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-4">
        {equipment.product_code ? (
          <Link to={`/products/masters/${equipment.product_code}`}
            className="flex items-center gap-3 mb-4 px-4 py-3 bg-amber-600/5 border border-amber-600/20 rounded-lg hover:bg-amber-600/10 transition-colors group">
            <div className="w-8 h-8 rounded-md bg-amber-600/10 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 uppercase tracking-wide">Product</span>
                <EntityCode code={equipment.product_code} />
              </div>
              <div className="text-sm font-medium text-slate-800 truncate">{equipment.product_name}</div>
            </div>
            <svg className="w-4 h-4 text-slate-400 group-hover:text-amber-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </Link>
        ) : (
          <div className="flex items-center justify-between mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
            <span className="text-sm text-amber-700">No product linked — this equipment has no reference in the ASW Library</span>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 space-y-4">
            <div className="bg-white border border-slate-200 rounded-lg">
              <div className="flex border-b border-slate-200">
                {tabs.map(t => (
                  <button key={t.key} onClick={() => setTab(t.key)}
                    className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? 'border-amber-600 text-amber-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                    {t.label}
                  </button>
                ))}
              </div>

              {tab === 'specs' && (
                <div className="p-4 space-y-4">
                  <MetadataPanel title="Technical Specifications" fields={[
                    { label: 'Equipment Type', value: equipment.equipment_type },
                    { label: 'Subtype', value: equipment.equipment_subtype },
                    { label: 'Operational Duty', value: equipment.operational_duty },
                    { label: 'Design Flow', value: equipment.design_flow_m3h ? `${equipment.design_flow_m3h} m³/h` : null },
                    { label: 'Design Head', value: equipment.design_head_m ? `${equipment.design_head_m} m` : null },
                    { label: 'Power', value: equipment.power_kw ? `${equipment.power_kw} kW` : null },
                    { label: 'Material', value: equipment.material_code ? <><EntityCode code={equipment.material_code} /> {equipment.material_name && <span className="text-slate-500 text-xs ml-1">{equipment.material_name}</span>}</> : null },
                    { label: 'Location', value: equipment.location_reference },
                  ]} />

                  <MetadataPanel title="Installation" fields={[
                    { label: 'Serial Number', value: equipment.serial_number },
                    { label: 'Installation Date', value: equipment.installation_date?.split('T')[0] },
                    { label: 'Commissioning Date', value: equipment.commissioning_date?.split('T')[0] },
                    { label: 'PO Reference', value: equipment.po_reference },
                  ]} />
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

          <div className="space-y-3">
            <LifecycleHistory items={history?.items || []} />
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Project Context</div>
              <div className="space-y-1.5 text-sm">
                {equipment.project_code && <div><span className="text-slate-400">Project:</span> <Link to={`/projects/${equipment.project_id}`} className="text-amber-600 hover:underline ml-1"><EntityCode code={equipment.project_code} /></Link></div>}
                {equipment.system_code && <div><span className="text-slate-400">System:</span> <Link to={`/systems/${equipment.system_id}`} className="text-amber-600 hover:underline ml-1"><EntityCode code={equipment.system_code} /></Link></div>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showTransition && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-80 p-5">
            <h3 className="font-semibold mb-3">Transition State</h3>
            <select value={newState} onChange={e => setNewState(e.target.value)} className="w-full border rounded px-3 py-2 text-sm mb-3 focus:outline-none">
              <option value="">Select new state...</option>
              {transitions.map(t => <option key={t}>{t}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setShowTransition(false)}>Cancel</Button>
              <Button variant="primary" onClick={async () => {
                if (!newState) return;
                await api.post('/lifecycle/transition', { entity_type: 'equipment', entity_id: equipment.id, to_state: newState });
                toast.success(`State → ${newState}`);
                refetch();
                qc.invalidateQueries({ queryKey: ['lifecycle'] });
                setShowTransition(false);
              }}>Apply</Button>
            </div>
          </div>
        </div>
      )}

      {showDocModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-semibold text-slate-800">Add Document to {equipment.equipment_code}</h2>
              <button onClick={() => setShowDocModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Document Type *</label>
                <select value={docForm.document_type} onChange={e => setDocForm(f => ({ ...f, document_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
                  {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Title *</label>
                <input type="text" placeholder={`e.g. ${equipment.equipment_name} O&M Manual`}
                  value={docForm.document_title} onChange={e => setDocForm(f => ({ ...f, document_title: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Discipline</label>
                <input type="text" placeholder="e.g. Mechanical, Electrical"
                  value={docForm.discipline} onChange={e => setDocForm(f => ({ ...f, discipline: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                <textarea rows={2} placeholder="Optional notes"
                  value={docForm.notes} onChange={e => setDocForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">File (optional)</label>
                <div onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 rounded-lg p-4 text-center cursor-pointer hover:border-amber-600 transition-colors">
                  {docFile
                    ? <div className="flex items-center justify-center gap-2 text-sm text-slate-700"><FileText className="w-4 h-4 text-amber-600" />{docFile.name} <span className="text-slate-400">({(docFile.size / 1024).toFixed(0)} KB)</span></div>
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
