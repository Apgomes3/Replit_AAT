import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useState, useRef } from 'react';
import api from '../../lib/api';
import { Document } from '../../types';
import DataTable, { Column } from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import NewEntityModal from '../../components/ui/NewEntityModal';
import toast from 'react-hot-toast';
import { Plus, Upload, FolderOpen, FolderX, ExternalLink, Paperclip, Trash2, Package, PackageX } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

function nextRevLetter(existing: string[]): string {
  if (existing.length === 0) return 'A';
  const sorted = [...existing].map(s => s.toUpperCase()).sort();
  const last = sorted[sorted.length - 1];
  const chars = last.split('');
  let i = chars.length - 1;
  while (i >= 0) {
    if (chars[i] < 'Z') {
      chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
      return chars.join('');
    }
    chars[i] = 'A';
    i--;
  }
  return 'A' + chars.join('');
}

export default function DocumentsList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);

  const [issueTarget, setIssueTarget] = useState<Document | null>(null);
  const [issueRev, setIssueRev] = useState('');
  const [issuePurpose, setIssuePurpose] = useState('');
  const [issueFile, setIssueFile] = useState<File | null>(null);
  const [issueSaving, setIssueSaving] = useState(false);
  const issueSavingRef = useRef(false);

  const [linkTarget, setLinkTarget] = useState<Document | null>(null);
  const [addProjectId, setAddProjectId] = useState('');
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkDocProjects, setLinkDocProjects] = useState<Array<{ id: string; project_code: string; project_name: string }>>([]);

  const [productLinkTarget, setProductLinkTarget] = useState<any | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [addProductId, setAddProductId] = useState('');
  const [productLinkSaving, setProductLinkSaving] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['documents', search],
    queryFn: () => api.get(`/documents${search ? `?q=${search}` : ''}`).then(r => r.data),
  });

  const { data: projects } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => api.get('/projects?page_size=200').then(r => r.data),
  });

  const { data: allProducts } = useQuery({
    queryKey: ['products-list-doclist'],
    queryFn: () => api.get('/product-masters?page_size=500').then(r => r.data),
  });

  const openIssue = (doc: Document) => {
    const existing = (doc as any).current_revision ? [(doc as any).current_revision] : [];
    setIssueRev(nextRevLetter(existing));
    setIssuePurpose('');
    setIssueFile(null);
    setIssueTarget(doc);
  };

  const handleIssueRevision = async () => {
    if (!issueTarget || !issueRev || !issueFile || issueSavingRef.current) return;
    issueSavingRef.current = true;
    setIssueSaving(true);
    try {
      const form = new FormData();
      form.append('revision_code', issueRev.toUpperCase());
      form.append('revision_purpose', issuePurpose);
      form.append('file', issueFile);
      await api.post(`/documents/${issueTarget.id}/revisions`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(`Revision ${issueRev.toUpperCase()} issued for ${issueTarget.document_code}`);
      refetch();
      qc.invalidateQueries({ queryKey: ['document', issueTarget.id] });
      setIssueTarget(null);
    } finally {
      issueSavingRef.current = false;
      setIssueSaving(false);
    }
  };

  const openLink = async (doc: Document) => {
    const res = await api.get(`/documents/${doc.id}`);
    setLinkDocProjects(res.data.projects || []);
    setAddProjectId('');
    setLinkTarget(doc);
  };

  const handleAddProjectLink = async () => {
    if (!linkTarget || !addProjectId || linkSaving) return;
    setLinkSaving(true);
    try {
      const res = await api.post(`/documents/${linkTarget.id}/projects`, { project_id: addProjectId });
      setLinkDocProjects(res.data);
      setAddProjectId('');
      toast.success('Project linked');
      refetch();
      qc.invalidateQueries({ queryKey: ['document', linkTarget.id] });
    } finally {
      setLinkSaving(false);
    }
  };

  const handleRemoveProjectLink = async (projectId: string) => {
    if (!linkTarget) return;
    await api.delete(`/documents/${linkTarget.id}/projects/${projectId}`);
    setLinkDocProjects(prev => prev.filter(p => p.id !== projectId));
    toast.success('Project link removed');
    refetch();
    qc.invalidateQueries({ queryKey: ['document', linkTarget.id] });
  };

  const openProductLink = async (doc: any) => {
    const res = await api.get(`/documents/${doc.id}`);
    setProductLinkTarget({ ...doc, product_id: res.data.product_id, product_code: res.data.product_code, product_name: res.data.product_name });
    setProductSearch('');
    setAddProductId('');
  };

  const handleSetProductLink = async () => {
    if (!productLinkTarget || !addProductId || productLinkSaving) return;
    setProductLinkSaving(true);
    try {
      await api.put(`/documents/${productLinkTarget.id}/product`, { product_id: addProductId });
      const prod = (allProducts?.items ?? []).find((p: any) => p.id === addProductId);
      setProductLinkTarget((prev: any) => ({ ...prev, product_id: addProductId, product_code: prod?.product_code, product_name: prod?.product_name }));
      setAddProductId('');
      setProductSearch('');
      toast.success('Product linked');
      refetch();
    } finally {
      setProductLinkSaving(false);
    }
  };

  const handleRemoveProductLink = async () => {
    if (!productLinkTarget) return;
    await api.delete(`/documents/${productLinkTarget.id}/product`);
    setProductLinkTarget((prev: any) => ({ ...prev, product_id: null, product_code: null, product_name: null }));
    toast.success('Product link removed');
    refetch();
  };

  const handleDeleteDocument = async (doc: Document) => {
    if (!window.confirm(`Permanently delete ${doc.document_code}? All revisions and files will be removed.`)) return;
    await api.delete(`/documents/${doc.id}`);
    toast.success(`${doc.document_code} deleted`);
    refetch();
  };

  const columns: Column<Document>[] = [
    { key: 'document_code', header: 'Code', render: r => <EntityCode code={r.document_code} /> },
    { key: 'document_title', header: 'Title', render: r => <span className="font-medium">{r.document_title}</span> },
    { key: 'document_type', header: 'Type' },
    { key: 'discipline', header: 'Discipline' },
    { key: 'project_codes' as any, header: 'Projects', render: r => {
      const codes = ((r as any).project_codes || '').split(', ').filter(Boolean);
      if (!codes.length) return <span className="text-slate-300 text-xs">Global</span>;
      return <div className="flex flex-wrap gap-1">{codes.map((c: string) => <EntityCode key={c} code={c} />)}</div>;
    }},
    { key: 'current_revision', header: 'Rev', render: r => <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">{r.current_revision ?? '—'}</span> },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
    { key: 'owner', header: 'Owner' },
  ];

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Document Register" subtitle={`${data?.pagination?.total ?? 0} documents`}
        actions={<Button variant="primary" onClick={() => setShowNew(true)}><Plus className="w-4 h-4" />Register Document</Button>}
      />
      <div className="p-4 border-b border-slate-200 bg-white">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by code or title..."
          className="border border-slate-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-amber-600" />
      </div>
      <div className="flex-1 bg-white overflow-auto">
        <DataTable
          columns={columns}
          data={data?.items || []}
          loading={isLoading}
          onRowClick={r => navigate(`/documents/${r.id}`)}
          contextMenuItems={row => [
            {
              label: 'Open',
              icon: <ExternalLink className="w-3.5 h-3.5" />,
              onClick: () => navigate(`/documents/${row.id}`),
            },
            {
              label: 'Issue Revision',
              icon: <Upload className="w-3.5 h-3.5" />,
              onClick: () => openIssue(row),
              divider: true,
            },
            {
              label: 'Manage Project Links',
              icon: <FolderOpen className="w-3.5 h-3.5" />,
              onClick: () => openLink(row),
            },
            {
              label: 'Manage Product Links',
              icon: <Package className="w-3.5 h-3.5" />,
              onClick: () => openProductLink(row),
              divider: true,
            },
            ...(isAdmin ? [{
              label: 'Delete Document',
              icon: <Trash2 className="w-3.5 h-3.5" />,
              danger: true,
              divider: true,
              onClick: () => handleDeleteDocument(row),
            }] : []),
          ]}
        />
      </div>

      {showNew && (
        <NewEntityModal title="Register Document" onClose={() => setShowNew(false)}
          fields={[
            { name: 'document_code', label: 'Document Code', required: true, placeholder: 'DOC-PID-001' },
            { name: 'document_title', label: 'Document Title', required: true },
            { name: 'document_type', label: 'Document Type', options: ['PID', 'Drawing', 'Calculation', 'Specification', 'Datasheet', 'Report', 'Procedure', 'Other'] },
            { name: 'discipline', label: 'Discipline', options: ['Mechanical', 'Piping', 'Electrical', 'Structural', 'Civil', 'General'] },
            { name: 'owner', label: 'Owner / Author' },
            { name: 'project_code', label: 'Project (optional)', options: ['', ...(projects?.items?.map((p: any) => p.project_code) || [])] },
          ]}
          onSubmit={async (formData) => {
            const payload: any = { ...formData };
            if (formData.project_code) {
              const proj = projects?.items?.find((p: any) => p.project_code === formData.project_code);
              payload.project_id = proj?.id ?? null;
            }
            delete payload.project_code;
            await api.post('/documents', payload);
            toast.success('Document registered');
            refetch();
            setShowNew(false);
          }}
        />
      )}

      {issueTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-96 p-5">
            <h3 className="font-semibold mb-0.5">Issue Revision</h3>
            <p className="text-xs text-slate-400 mb-4"><span className="font-mono font-medium">{issueTarget.document_code}</span> — {issueTarget.document_title}</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wide">Revision Code</label>
                <input
                  value={issueRev}
                  onChange={e => setIssueRev(e.target.value.toUpperCase())}
                  maxLength={4}
                  className="w-full border rounded px-3 py-2 text-sm mt-1 font-mono focus:outline-none focus:border-amber-600"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wide">Purpose</label>
                <input
                  value={issuePurpose}
                  onChange={e => setIssuePurpose(e.target.value)}
                  placeholder="For Review"
                  className="w-full border rounded px-3 py-2 text-sm mt-1 focus:outline-none focus:border-amber-600"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wide flex items-center gap-1">
                  <Paperclip className="w-3 h-3" />Document File <span className="text-red-500 ml-0.5">*</span>
                </label>
                <input
                  type="file"
                  onChange={e => setIssueFile(e.target.files?.[0] || null)}
                  className="w-full text-sm mt-1 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 cursor-pointer"
                />
                {issueFile && (
                  <p className="text-xs text-slate-500 mt-1 truncate">{issueFile.name} <span className="text-slate-400">({(issueFile.size / 1024).toFixed(0)} KB)</span></p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button onClick={() => setIssueTarget(null)}>Cancel</Button>
              <Button variant="primary" onClick={handleIssueRevision} disabled={!issueRev || !issueFile || issueSaving}>
                {issueSaving ? 'Issuing…' : 'Issue'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {linkTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-[420px] p-5">
            <h3 className="font-semibold mb-0.5">Manage Project Links</h3>
            <p className="text-xs text-slate-400 mb-4"><span className="font-mono font-medium">{linkTarget.document_code}</span> — {linkTarget.document_title}</p>
            {linkDocProjects.length > 0 ? (
              <div className="mb-4 space-y-1.5">
                <label className="text-xs text-slate-500 uppercase tracking-wide">Linked Projects</label>
                {linkDocProjects.map(p => (
                  <div key={p.id} className="flex items-center justify-between bg-slate-50 rounded px-3 py-2 text-sm">
                    <span><span className="font-mono font-medium text-amber-600">{p.project_code}</span><span className="text-slate-400 ml-2">{p.project_name}</span></span>
                    <button onClick={() => handleRemoveProjectLink(p.id)} className="text-red-400 hover:text-red-600 ml-2"><FolderX className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400 mb-4">No projects linked yet — this document is global.</p>
            )}
            <div className="space-y-2">
              <label className="text-xs text-slate-500 uppercase tracking-wide">Add to Project</label>
              <div className="flex gap-2">
                <select
                  value={addProjectId}
                  onChange={e => setAddProjectId(e.target.value)}
                  className="flex-1 border rounded px-3 py-2 text-sm bg-white focus:outline-none focus:border-amber-600"
                >
                  <option value="">— Select project —</option>
                  {(projects?.items ?? []).filter((p: any) => !linkDocProjects.find(lp => lp.id === p.id)).map((p: any) => (
                    <option key={p.id} value={p.id}>{p.project_code} — {p.project_name}</option>
                  ))}
                </select>
                <Button variant="primary" onClick={handleAddProjectLink} disabled={!addProjectId || linkSaving}>
                  {linkSaving ? '…' : 'Add'}
                </Button>
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <Button onClick={() => setLinkTarget(null)}>Done</Button>
            </div>
          </div>
        </div>
      )}

      {productLinkTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-[420px] p-5">
            <h3 className="font-semibold mb-0.5">Manage Product Links</h3>
            <p className="text-xs text-slate-400 mb-4"><span className="font-mono font-medium">{productLinkTarget.document_code}</span> — {productLinkTarget.document_title}</p>
            {productLinkTarget.product_id ? (
              <div className="mb-4">
                <label className="text-xs text-slate-500 uppercase tracking-wide">Linked Product</label>
                <div className="flex items-center justify-between bg-slate-50 rounded px-3 py-2 text-sm mt-1.5">
                  <span>
                    <span className="font-mono font-medium text-amber-600">{productLinkTarget.product_code}</span>
                    <span className="text-slate-400 ml-2">{productLinkTarget.product_name}</span>
                  </span>
                  <button onClick={handleRemoveProductLink} className="text-red-400 hover:text-red-600 ml-2">
                    <PackageX className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400 mb-4">No product linked yet.</p>
            )}
            <div className="space-y-2">
              <label className="text-xs text-slate-500 uppercase tracking-wide">{productLinkTarget.product_id ? 'Change Product' : 'Link a Product'}</label>
              <input
                value={productSearch}
                onChange={e => { setProductSearch(e.target.value); setAddProductId(''); }}
                placeholder="Search by code or name…"
                className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-600"
              />
              {productSearch.length >= 1 && (
                <div className="border rounded max-h-40 overflow-y-auto divide-y divide-slate-100 bg-white">
                  {(allProducts?.items ?? [])
                    .filter((p: any) =>
                      p.product_code?.toLowerCase().includes(productSearch.toLowerCase()) ||
                      p.product_name?.toLowerCase().includes(productSearch.toLowerCase())
                    )
                    .slice(0, 20)
                    .map((p: any) => (
                      <button
                        key={p.id}
                        className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-slate-50 ${addProductId === p.id ? 'bg-blue-50 font-medium' : ''}`}
                        onClick={() => setAddProductId(p.id)}
                      >
                        <EntityCode code={p.product_code} />
                        <span className="text-slate-600 truncate">{p.product_name}</span>
                      </button>
                    ))}
                  {(allProducts?.items ?? []).filter((p: any) =>
                    p.product_code?.toLowerCase().includes(productSearch.toLowerCase()) ||
                    p.product_name?.toLowerCase().includes(productSearch.toLowerCase())
                  ).length === 0 && (
                    <div className="px-3 py-2 text-sm text-slate-400">No products match</div>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="primary" onClick={handleSetProductLink} disabled={!addProductId || productLinkSaving}>
                  {productLinkSaving ? '…' : 'Link'}
                </Button>
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <Button onClick={() => setProductLinkTarget(null)}>Done</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
