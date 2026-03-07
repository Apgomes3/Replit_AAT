import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { useState, useRef } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import MetadataPanel from '../../components/ui/MetadataPanel';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import DataTable, { Column } from '../../components/ui/DataTable';
import Button from '../../components/ui/Button';
import toast from 'react-hot-toast';
import { Pencil, X, Check, FileText, FileCheck, FileSearch, Wrench, Award, Ruler, Box, Zap, Network, Upload, Plus, Tag } from 'lucide-react';
import { Document } from '../../types';

type Tab = 'specs' | 'drawings' | 'documents';

const DRAWING_TYPE_VALUES = new Set(['Drawing', 'GA Drawing', 'Assembly Drawing', 'Fabrication Drawing', 'As-Built Drawing', '3D Model', 'P&ID', 'Wiring Diagram']);

const COMPONENT_TYPES = ['Vessel', 'Pump', 'Blower', 'Motor', 'Valve', 'Instrument', 'Pipe', 'Fitting', 'Sensor', 'Controller', 'Frame', 'Filter', 'Heat Exchanger', 'Other'];
const CATEGORIES = ['Mechanical', 'Electrical', 'Instrumentation', 'Civil', 'Piping', 'Structural'];
const UNITS = ['EA', 'SET', 'm', 'kg', 'L', 'kW', 'mm', 'pcs'];
const STATUSES = ['Active', 'Draft', 'Obsolete'];

const DOC_TYPES = [
  { value: 'Drawing', label: 'Drawing (General)', abbr: 'DWG' },
  { value: 'GA Drawing', label: 'GA Drawing', abbr: 'GA' },
  { value: 'Assembly Drawing', label: 'Assembly Drawing', abbr: 'ASM' },
  { value: 'Fabrication Drawing', label: 'Fabrication Drawing', abbr: 'FAB' },
  { value: 'As-Built Drawing', label: 'As-Built Drawing', abbr: 'ABD' },
  { value: '3D Model', label: '3D Model', abbr: '3DM' },
  { value: 'P&ID', label: 'P&ID', abbr: 'PID' },
  { value: 'Wiring Diagram', label: 'Wiring Diagram', abbr: 'WD' },
  { value: 'Technical Data Sheet', label: 'Technical Data Sheet', abbr: 'TDS' },
  { value: 'Certificate', label: 'Certificate', abbr: 'CERT' },
  { value: 'Test Report', label: 'Test Report', abbr: 'TR' },
  { value: 'Specification', label: 'Specification', abbr: 'SPEC' },
];

const DISCIPLINES = ['Mechanical', 'Electrical', 'Instrumentation', 'Civil', 'Piping', 'Structural', 'General'];

const TYPE_COLORS: Record<string, string> = {
  Vessel: 'bg-blue-50 text-blue-700 border-blue-100',
  Pump: 'bg-green-50 text-green-700 border-green-100',
  Blower: 'bg-teal-50 text-teal-700 border-teal-100',
  Motor: 'bg-purple-50 text-purple-700 border-purple-100',
  Valve: 'bg-amber-50 text-amber-700 border-amber-100',
  Instrument: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  Pipe: 'bg-slate-50 text-slate-700 border-slate-200',
  Filter: 'bg-emerald-50 text-emerald-700 border-emerald-100',
};

const docTypeIcon = (type: string) => {
  switch (type) {
    case 'Technical Data Sheet': return <FileSearch className="w-4 h-4 text-blue-500" />;
    case 'O&M Manual': return <Wrench className="w-4 h-4 text-amber-500" />;
    case 'Certificate': return <Award className="w-4 h-4 text-purple-500" />;
    case 'Drawing':
    case 'GA Drawing':
    case 'Assembly Drawing':
    case 'Fabrication Drawing':
    case 'As-Built Drawing': return <Ruler className="w-4 h-4 text-indigo-500" />;
    case '3D Model': return <Box className="w-4 h-4 text-cyan-500" />;
    case 'P&ID': return <Network className="w-4 h-4 text-teal-500" />;
    case 'Wiring Diagram': return <Zap className="w-4 h-4 text-yellow-500" />;
    case 'Test Report': return <FileCheck className="w-4 h-4 text-red-500" />;
    default: return <FileText className="w-4 h-4 text-slate-400" />;
  }
};

export default function ComponentDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<Tab>('specs');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const [showDocModal, setShowDocModal] = useState(false);
  const [docModalContext, setDocModalContext] = useState<'documents' | 'drawings'>('drawings');
  const [docForm, setDocForm] = useState({ document_type: 'GA Drawing', document_title: '', discipline: '', notes: '' });
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docSubmitting, setDocSubmitting] = useState(false);

  const { data: component, isLoading } = useQuery({
    queryKey: ['component', id],
    queryFn: () => api.get(`/components/${id}`).then(r => r.data),
  });

  if (isLoading) return <div className="p-8 text-slate-400">Loading...</div>;
  if (!component) return <div className="p-8 text-slate-400">Component not found</div>;

  const documents: Document[] = component.documents || [];
  const drawings = documents.filter(d => DRAWING_TYPE_VALUES.has(d.document_type));
  const nonDrawingDocs = documents.filter(d => !DRAWING_TYPE_VALUES.has(d.document_type));
  const usedIn = component.used_in || [];

  const [synonymInput, setSynonymInput] = useState('');

  const startEdit = () => {
    setForm({
      component_name: component.component_name,
      component_type: component.component_type || 'Vessel',
      component_category: component.component_category || 'Mechanical',
      description: component.description || '',
      primary_material_code: component.primary_material_code || '',
      standard_size: component.standard_size || '',
      weight_kg: component.weight_kg?.toString() || '',
      unit: component.unit || 'EA',
      status: component.status,
      notes: component.notes || '',
      synonyms: component.synonyms || [],
    });
    setEditing(true);
  };

  const addSynonym = (raw: string) => {
    const terms = raw.split(',').map(s => s.trim()).filter(Boolean);
    setForm((f: any) => ({ ...f, synonyms: [...new Set([...(f.synonyms || []), ...terms])] }));
    setSynonymInput('');
  };

  const removeSynonym = (term: string) => {
    setForm((f: any) => ({ ...f, synonyms: (f.synonyms || []).filter((s: string) => s !== term) }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/components/${component.id}`, { ...form, weight_kg: form.weight_kg ? parseFloat(form.weight_kg) : null, synonyms: form.synonyms || [] });
      toast.success('Component updated');
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['component', id] });
    } catch {
      toast.error('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const handleAddDocument = async () => {
    if (!docForm.document_title) { toast.error('Title is required'); return; }
    setDocSubmitting(true);
    try {
      const abbr = DOC_TYPES.find(t => t.value === docForm.document_type)?.abbr || 'DOC';
      const code = `${component.component_code}-${abbr}-${Date.now().toString(36).toUpperCase()}`;
      const docRes = await api.post('/documents', {
        document_code: code,
        document_title: docForm.document_title,
        document_type: docForm.document_type,
        discipline: docForm.discipline || null,
        component_id: component.id,
        notes: docForm.notes || null,
      });
      if (docFile) {
        const fd = new FormData();
        fd.append('file', docFile);
        fd.append('revision_code', 'A');
        fd.append('revision_purpose', 'Initial issue');
        await api.post(`/documents/${docRes.data.id}/revisions`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
      toast.success('Document added');
      setShowDocModal(false);
      setDocForm(f => ({ ...f, document_title: '', discipline: '', notes: '' }));
      setDocFile(null);
      qc.invalidateQueries({ queryKey: ['component', id] });
    } catch {
      toast.error('Failed to add document');
    } finally {
      setDocSubmitting(false);
    }
  };

  const docCols: Column<Document>[] = [
    { key: 'document_type', header: 'Type', render: r => <div className="flex items-center gap-2">{docTypeIcon(r.document_type)}<span className="text-xs text-slate-600">{r.document_type}</span></div> },
    { key: 'document_code', header: 'Code', render: r => <EntityCode code={r.document_code} /> },
    { key: 'document_title', header: 'Title', render: r => <Link to={`/documents/${r.id}`} className="font-medium text-[#3E5C76] hover:underline">{r.document_title}</Link> },
    { key: 'current_revision', header: 'Rev', render: r => <span className="text-xs font-mono bg-slate-100 px-1.5 py-0.5 rounded">{r.current_revision}</span> },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
  ];

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'specs', label: 'Specifications' },
    { key: 'drawings', label: `Drawings (${drawings.length})` },
    { key: 'documents', label: `Documents (${nonDrawingDocs.length})` },
  ];

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        code={component.component_code}
        title={editing ? form.component_name : component.component_name}
        status={editing ? form.status : component.status}
        subtitle={component.component_type ? (
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${TYPE_COLORS[component.component_type] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
            {component.component_type}
          </span>
        ) : undefined}
        breadcrumb={<><Link to="/products" className="hover:underline">Families</Link> / <Link to="/products/components" className="hover:underline">Components</Link></>}
        actions={
          editing ? (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}><X className="w-3.5 h-3.5" /> Cancel</Button>
              <Button size="sm" onClick={handleSave} disabled={saving}><Check className="w-3.5 h-3.5" />{saving ? 'Saving...' : 'Save'}</Button>
            </div>
          ) : (
            <Button size="sm" onClick={startEdit}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
          )
        }
      />

      <div className="border-b border-slate-200 bg-white px-4">
        <div className="flex gap-0">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? 'border-[#3E5C76] text-[#3E5C76]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">

        {tab === 'specs' && (
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-4">
              {!editing ? (
                <MetadataPanel title="Component Specifications" fields={[
                  { label: 'Type', value: component.component_type },
                  { label: 'Category', value: component.component_category },
                  { label: 'Description', value: component.description },
                  { label: 'Primary Material', value: component.primary_material_code
                    ? <><EntityCode code={component.primary_material_code} />{component.material_name && <span className="text-slate-500 text-xs ml-1">{component.material_name}</span>}</>
                    : null },
                  { label: 'Standard Size', value: component.standard_size },
                  { label: 'Weight', value: component.weight_kg ? `${component.weight_kg} kg` : null },
                  { label: 'Unit', value: component.unit },
                  { label: 'Notes', value: component.notes },
                  { label: 'Synonyms', value: component.synonyms?.length
                    ? <div className="flex flex-wrap gap-1">{component.synonyms.map((s: string) => <span key={s} className="bg-[#3E5C76]/10 text-[#3E5C76] text-xs px-2 py-0.5 rounded-full">{s}</span>)}</div>
                    : null },
                ]} />
              ) : (
                <div className="bg-white border border-slate-200 rounded-lg p-4">
                  <div className="text-xs text-slate-400 uppercase tracking-wide mb-3">Edit Specifications</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
                      <input value={form.component_name} onChange={e => setForm((f: any) => ({ ...f, component_name: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
                      <select value={form.component_type} onChange={e => setForm((f: any) => ({ ...f, component_type: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]">
                        {COMPONENT_TYPES.map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                      <select value={form.component_category} onChange={e => setForm((f: any) => ({ ...f, component_category: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]">
                        {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                      <textarea rows={2} value={form.description} onChange={e => setForm((f: any) => ({ ...f, description: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Material Code</label>
                      <input value={form.primary_material_code} onChange={e => setForm((f: any) => ({ ...f, primary_material_code: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Standard Size</label>
                      <input value={form.standard_size} onChange={e => setForm((f: any) => ({ ...f, standard_size: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Weight (kg)</label>
                      <input type="number" value={form.weight_kg} onChange={e => setForm((f: any) => ({ ...f, weight_kg: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Unit</label>
                      <select value={form.unit} onChange={e => setForm((f: any) => ({ ...f, unit: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]">
                        {UNITS.map(u => <option key={u}>{u}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                      <select value={form.status} onChange={e => setForm((f: any) => ({ ...f, status: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]">
                        {STATUSES.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                      <input value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1"><Tag className="w-3 h-3" /> Synonyms <span className="text-slate-400 font-normal">(alternate names for search)</span></label>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {(form.synonyms || []).map((s: string) => (
                          <span key={s} className="inline-flex items-center gap-1 bg-[#3E5C76]/10 text-[#3E5C76] text-xs px-2 py-0.5 rounded-full">
                            {s}
                            <button type="button" onClick={() => removeSynonym(s)} className="hover:text-red-500"><X className="w-3 h-3" /></button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={synonymInput}
                          onChange={e => setSynonymInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); if (synonymInput.trim()) addSynonym(synonymInput); } }}
                          placeholder="Type a synonym and press Enter or comma"
                          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]"
                        />
                        <button type="button" onClick={() => { if (synonymInput.trim()) addSynonym(synonymInput); }}
                          className="px-3 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm hover:bg-slate-200">Add</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="text-xs text-slate-400 uppercase tracking-wide mb-3">Used in Products</div>
                {usedIn.length === 0
                  ? <div className="text-sm text-slate-400">Not referenced in any product BOM</div>
                  : usedIn.map((p: any) => (
                    <div key={p.product_code} className="flex items-center gap-2 mb-2">
                      <Link to={`/products/masters/${p.product_code}`}><EntityCode code={p.product_code} /></Link>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-slate-600 truncate">{p.product_name}</div>
                        <div className="text-xs text-slate-400">Qty: {p.quantity} {p.unit}</div>
                      </div>
                      <StatusBadge status={p.standard_status} />
                    </div>
                  ))
                }
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Details</div>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Code</span>
                    <EntityCode code={component.component_code} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Status</span>
                    <StatusBadge status={component.status} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Created</span>
                    <span className="text-xs text-slate-600">{new Date(component.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'drawings' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-slate-500">{drawings.length} drawing{drawings.length !== 1 ? 's' : ''} & model{drawings.length !== 1 ? 's' : ''} attached</span>
              <Button size="sm" onClick={() => { setDocModalContext('drawings'); setDocForm(f => ({ ...f, document_type: 'GA Drawing' })); setShowDocModal(true); }}>
                <Plus className="w-3.5 h-3.5" /> Add Drawing
              </Button>
            </div>
            <DataTable columns={docCols} data={drawings} emptyMessage="No drawings or models attached — add a GA drawing, fabrication drawing, 3D model or P&ID above" />
          </div>
        )}

        {tab === 'documents' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-slate-500">{nonDrawingDocs.length} document{nonDrawingDocs.length !== 1 ? 's' : ''} attached</span>
              <Button size="sm" onClick={() => { setDocModalContext('documents'); setDocForm(f => ({ ...f, document_type: 'Technical Data Sheet' })); setShowDocModal(true); }}>
                <Plus className="w-3.5 h-3.5" /> Add Document
              </Button>
            </div>
            <DataTable columns={docCols} data={nonDrawingDocs} emptyMessage="No documents attached — add a data sheet, certificate or test report above" />
          </div>
        )}
      </div>

      {showDocModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-semibold text-slate-800">
                {docModalContext === 'drawings' ? 'Add Drawing / Model' : 'Add Document'} — {component.component_code}
              </h2>
              <button onClick={() => setShowDocModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Type *</label>
                <select value={docForm.document_type} onChange={e => setDocForm(f => ({ ...f, document_type: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]">
                  {DOC_TYPES.filter(t => docModalContext === 'drawings' ? DRAWING_TYPE_VALUES.has(t.value) : !DRAWING_TYPE_VALUES.has(t.value))
                    .map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Title *</label>
                <input type="text" placeholder="e.g. Pump Assembly Drawing Rev A"
                  value={docForm.document_title} onChange={e => setDocForm(f => ({ ...f, document_title: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Discipline</label>
                <select value={docForm.discipline} onChange={e => setDocForm(f => ({ ...f, discipline: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]">
                  <option value="">— Select —</option>
                  {DISCIPLINES.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                <input type="text" placeholder="Optional notes or revision purpose"
                  value={docForm.notes} onChange={e => setDocForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">File (optional)</label>
                <input ref={fileRef} type="file" className="hidden" onChange={e => setDocFile(e.target.files?.[0] || null)} />
                <button onClick={() => fileRef.current?.click()}
                  className="w-full border-2 border-dashed border-slate-200 rounded-lg px-4 py-3 text-sm text-slate-400 hover:border-[#3E5C76] hover:text-[#3E5C76] transition-colors flex items-center justify-center gap-2">
                  {docFile
                    ? <div className="flex items-center justify-center gap-2 text-sm text-slate-700"><FileText className="w-4 h-4 text-[#3E5C76]" />{docFile.name} <span className="text-slate-400">({(docFile.size / 1024).toFixed(0)} KB)</span></div>
                    : <><Upload className="w-4 h-4" /> Click to upload drawing or model file</>}
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <Button variant="ghost" onClick={() => setShowDocModal(false)}>Cancel</Button>
              <Button onClick={handleAddDocument} disabled={docSubmitting}>
                {docSubmitting ? 'Saving...' : 'Add Document'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
