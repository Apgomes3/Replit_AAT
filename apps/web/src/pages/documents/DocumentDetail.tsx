import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import MetadataPanel from '../../components/ui/MetadataPanel';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import LifecycleHistory from '../../components/ui/LifecycleHistory';
import Button from '../../components/ui/Button';
import toast from 'react-hot-toast';
import { Upload, CheckCircle, XCircle, Download, Trash2, FolderOpen, FolderX, Plus, Package, PackageX } from 'lucide-react';
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

export default function DocumentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const [showIssue, setShowIssue] = useState(false);
  const [showApproval, setShowApproval] = useState(false);
  const [issueRev, setIssueRev] = useState('');
  const [issuePurpose, setIssuePurpose] = useState('');
  const [approvalAction, setApprovalAction] = useState('Approved');
  const [approvalComment, setApprovalComment] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isIssueSaving, setIsIssueSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const issueSavingRef = useRef(false);
  const [revCtxMenu, setRevCtxMenu] = useState<{ rev: any; x: number; y: number } | null>(null);
  const [showProjectLinks, setShowProjectLinks] = useState(false);
  const [addProjectId, setAddProjectId] = useState('');
  const [projectLinkSaving, setProjectLinkSaving] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [addProductId, setAddProductId] = useState('');
  const [productLinkSaving, setProductLinkSaving] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  useEffect(() => {
    const close = () => setRevCtxMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => { window.removeEventListener('click', close); window.removeEventListener('contextmenu', close); };
  }, []);

  const { data: document, isLoading, refetch } = useQuery({
    queryKey: ['document', id],
    queryFn: () => api.get(`/documents/${id}`).then(r => r.data),
  });

  const { data: history } = useQuery({
    queryKey: ['lifecycle', 'document', id],
    queryFn: () => api.get(`/lifecycle/document/${id}`).then(r => r.data),
  });

  const { data: allProjects } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => api.get('/projects?page_size=200').then(r => r.data),
  });

  const { data: allProducts } = useQuery({
    queryKey: ['products-list-doc'],
    queryFn: () => api.get('/product-masters?page_size=500').then(r => r.data),
  });

  if (isLoading) return <div className="p-8 text-slate-400">Loading...</div>;
  if (!document) return <div className="p-8 text-slate-400">Document not found</div>;

  const handleIssueRevision = async () => {
    if (!issueRev || !uploadFile || issueSavingRef.current) return;
    const existing = (document.revisions ?? []).map((r: any) => r.revision_code as string);
    if (existing.map(s => s.toUpperCase()).includes(issueRev.toUpperCase())) {
      toast.error(`Revision ${issueRev.toUpperCase()} already exists — next available is ${nextRevLetter(existing)}`);
      return;
    }
    issueSavingRef.current = true;
    setIsIssueSaving(true);
    try {
      const form = new FormData();
      form.append('revision_code', issueRev.toUpperCase());
      form.append('revision_purpose', issuePurpose);
      form.append('file', uploadFile);
      await api.post(`/documents/${id}/revisions`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(`Revision ${issueRev.toUpperCase()} issued`);
      refetch();
      qc.invalidateQueries({ queryKey: ['lifecycle'] });
      setShowIssue(false);
      setIssuePurpose('');
      setUploadFile(null);
    } finally {
      issueSavingRef.current = false;
      setIsIssueSaving(false);
    }
  };

  const handleApproval = async () => {
    const latestRev = document.revisions?.[0];
    await api.post(`/documents/${id}/approvals`, {
      revision_id: latestRev?.id,
      action: approvalAction,
      comment: approvalComment,
      role: 'Engineer',
    });
    toast.success(`Document ${approvalAction.toLowerCase()}`);
    refetch();
    qc.invalidateQueries({ queryKey: ['lifecycle'] });
    setShowApproval(false);
  };

  const handleDeleteRevision = async (rev: any) => {
    if (!window.confirm(`Delete revision ${rev.revision_code}? This cannot be undone.`)) return;
    await api.delete(`/documents/revisions/${rev.id}`);
    toast.success(`Revision ${rev.revision_code} deleted`);
    refetch();
  };

  const handleDeleteDocument = async () => {
    if (!window.confirm(`Permanently delete document ${document.document_code}? All revisions and files will be removed.`)) return;
    await api.delete(`/documents/${id}`);
    toast.success(`Document ${document.document_code} deleted`);
    navigate('/documents');
  };

  const handleAddProjectLink = async () => {
    if (!addProjectId || projectLinkSaving) return;
    setProjectLinkSaving(true);
    try {
      await api.post(`/documents/${id}/projects`, { project_id: addProjectId });
      setAddProjectId('');
      toast.success('Project linked');
      refetch();
    } finally {
      setProjectLinkSaving(false);
    }
  };

  const handleRemoveProjectLink = async (projectId: string) => {
    await api.delete(`/documents/${id}/projects/${projectId}`);
    toast.success('Project link removed');
    refetch();
  };

  const handleSetProductLink = async () => {
    if (!addProductId || productLinkSaving) return;
    setProductLinkSaving(true);
    try {
      await api.put(`/documents/${id}/product`, { product_id: addProductId });
      setAddProductId('');
      setProductSearch('');
      setShowProductPicker(false);
      toast.success('Product linked');
      refetch();
    } finally {
      setProductLinkSaving(false);
    }
  };

  const handleRemoveProductLink = async () => {
    if (!window.confirm('Remove the product link from this document?')) return;
    await api.delete(`/documents/${id}/product`);
    toast.success('Product link removed');
    refetch();
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        code={document.document_code} title={document.document_title} status={document.status}
        subtitle={`${document.document_type || ''} ${document.discipline ? '· ' + document.discipline : ''}`}
        crumbs={[{ label: 'Documents', href: '/documents' }, { label: document.document_code }]}
        actions={
          <div className="flex gap-2">
            <Button size="sm" onClick={() => {
              const latestRev = document.revisions?.[0];
              if (latestRev && latestRev.status === 'Draft') {
                toast.error(`Rev ${latestRev.revision_code} is pending review — approve or reject it first`);
                return;
              }
              const existing = (document.revisions ?? []).map((r: any) => r.revision_code as string);
              setIssueRev(nextRevLetter(existing));
              setShowIssue(true);
            }}><Upload className="w-3.5 h-3.5" />Issue Revision</Button>
            <Button size="sm" onClick={() => { setApprovalAction('Rejected'); setApprovalComment(''); setShowApproval(true); }}><XCircle className="w-3.5 h-3.5" />Reject</Button>
            <Button size="sm" variant="primary" onClick={() => { setApprovalAction('Approved'); setApprovalComment(''); setShowApproval(true); }}><CheckCircle className="w-3.5 h-3.5" />Approve / Release</Button>
            {isAdmin && <Button size="sm" variant="danger" onClick={handleDeleteDocument}><Trash2 className="w-3.5 h-3.5" />Delete</Button>}
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 space-y-4">
            <MetadataPanel fields={[
              { label: 'Document Type', value: document.document_type },
              { label: 'Discipline', value: document.discipline },
              { label: 'Current Revision', value: <span className="font-mono font-medium">{document.current_revision}</span> },
              { label: 'Owner', value: document.owner },
            ]} />

            <div className="bg-white border border-slate-200 rounded-lg">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">Project Links</span>
                <button
                  onClick={() => setShowProjectLinks(v => !v)}
                  className="text-xs text-amber-600 hover:underline flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />Add
                </button>
              </div>
              <div className="px-4 py-3 space-y-2">
                {(document.projects ?? []).length === 0 && !showProjectLinks && (
                  <p className="text-sm text-slate-400">Global — not linked to any project</p>
                )}
                {(document.projects ?? []).map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between">
                    <Link to={`/projects/${p.id}`} className="flex items-center gap-1.5 text-sm hover:underline">
                      <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
                      <EntityCode code={p.project_code} />
                      <span className="text-slate-500">{p.project_name}</span>
                    </Link>
                    <button onClick={() => handleRemoveProjectLink(p.id)} className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50">
                      <FolderX className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {showProjectLinks && (
                  <div className="flex gap-2 pt-1">
                    <select
                      value={addProjectId}
                      onChange={e => setAddProjectId(e.target.value)}
                      className="flex-1 border rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-amber-600"
                    >
                      <option value="">— Select project —</option>
                      {(allProjects?.items ?? []).filter((p: any) => !(document.projects ?? []).find((lp: any) => lp.id === p.id)).map((p: any) => (
                        <option key={p.id} value={p.id}>{p.project_code} — {p.project_name}</option>
                      ))}
                    </select>
                    <Button size="sm" variant="primary" onClick={handleAddProjectLink} disabled={!addProjectId || projectLinkSaving}>
                      {projectLinkSaving ? '…' : 'Link'}
                    </Button>
                    <Button size="sm" onClick={() => { setShowProjectLinks(false); setAddProjectId(''); }}>Cancel</Button>
                  </div>
                )}
              </div>
            </div>

            {/* Product Link */}
            <div className="bg-white border border-slate-200 rounded-lg">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5 text-slate-400" />Product Link
                </span>
                {document.product_id ? (
                  <button
                    onClick={() => { setShowProductPicker(v => !v); setProductSearch(''); setAddProductId(''); }}
                    className="text-xs text-amber-600 hover:underline flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />Change
                  </button>
                ) : (
                  <button
                    onClick={() => { setShowProductPicker(v => !v); setProductSearch(''); setAddProductId(''); }}
                    className="text-xs text-amber-600 hover:underline flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />Add
                  </button>
                )}
              </div>
              <div className="px-4 py-3 space-y-2">
                {document.product_id ? (
                  <div className="flex items-center justify-between">
                    <Link to={`/products/masters/${document.product_id}`} className="flex items-center gap-1.5 text-sm hover:underline">
                      <Package className="w-3.5 h-3.5 text-slate-400" />
                      <EntityCode code={document.product_code} />
                      <span className="text-slate-500">{document.product_name}</span>
                    </Link>
                    <button onClick={handleRemoveProductLink} className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50">
                      <PackageX className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  !showProductPicker && <p className="text-sm text-slate-400">Not linked to any product</p>
                )}
                {showProductPicker && (
                  <div className="space-y-2 pt-1">
                    <input
                      value={productSearch}
                      onChange={e => { setProductSearch(e.target.value); setAddProductId(''); }}
                      placeholder="Search by code or name…"
                      className="w-full border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-amber-600"
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
                              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-slate-50 ${addProductId === p.id ? 'bg-blue-50' : ''}`}
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
                      <Button size="sm" variant="primary" onClick={handleSetProductLink} disabled={!addProductId || productLinkSaving}>
                        {productLinkSaving ? '…' : 'Link'}
                      </Button>
                      <Button size="sm" onClick={() => { setShowProductPicker(false); setAddProductId(''); setProductSearch(''); }}>Cancel</Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg">
              <div className="px-4 py-3 border-b border-slate-200 text-sm font-medium text-slate-700">Revision History</div>
              <div className="divide-y divide-slate-100">
                {document.revisions?.length === 0 ? (
                  <div className="p-4 text-slate-400 text-sm">No revisions issued yet</div>
                ) : document.revisions?.map((rev: any) => (
                  <div
                    key={rev.id}
                    className="px-4 py-3 flex items-start justify-between gap-4 hover:bg-slate-50 select-none"
                    onContextMenu={isAdmin ? (e) => { e.preventDefault(); e.stopPropagation(); setRevCtxMenu({ rev, x: e.clientX, y: e.clientY }); } : undefined}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium">Rev {rev.revision_code}</span>
                        <StatusBadge status={rev.status} />
                      </div>
                      {rev.revision_purpose && <div className="text-sm text-slate-600 mt-0.5">{rev.revision_purpose}</div>}
                      <div className="text-xs text-slate-400 mt-0.5">{new Date(rev.created_at).toLocaleDateString()}{rev.issued_by_name ? ` · ${rev.issued_by_name}` : ''}</div>
                    </div>
                    {rev.file_path && (
                      <a href={rev.file_path} target="_blank" rel="noreferrer" className="text-amber-600 hover:underline text-sm flex items-center gap-1">
                        <Download className="w-3.5 h-3.5" />{rev.file_name || 'Download'}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {document.approvals?.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-lg">
                <div className="px-4 py-3 border-b border-slate-200 text-sm font-medium text-slate-700">Approval History</div>
                <div className="divide-y divide-slate-100">
                  {document.approvals.map((a: any) => (
                    <div key={a.id} className="px-4 py-3 flex items-center gap-3">
                      {a.action === 'Approved' || a.action === 'Released' ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-400" />}
                      <div>
                        <div className="text-sm font-medium">{a.action} <span className="text-slate-400 font-normal">by {a.approver_name}</span></div>
                        {a.comment && <div className="text-xs text-slate-500">{a.comment}</div>}
                        <div className="text-xs text-slate-400">{new Date(a.acted_at).toLocaleDateString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <LifecycleHistory items={history?.items || []} />
          </div>
        </div>
      </div>

      {showIssue && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-96 p-5">
            <h3 className="font-semibold mb-3">Issue New Revision</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wide">Revision Code</label>
                <input
                  value={issueRev}
                  onChange={e => setIssueRev(e.target.value.toUpperCase())}
                  maxLength={4}
                  className="w-full border rounded px-3 py-2 text-sm mt-1 font-mono focus:outline-none focus:border-amber-600"
                />
                {document.revisions?.length > 0 && (
                  <p className="text-xs text-slate-400 mt-1">Current: <span className="font-mono font-medium">{document.current_revision}</span> · Existing: {(document.revisions as any[]).map(r => r.revision_code).join(', ')}</p>
                )}
              </div>
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wide">Purpose</label>
                <input value={issuePurpose} onChange={e => setIssuePurpose(e.target.value)} placeholder="For Construction" className="w-full border rounded px-3 py-2 text-sm mt-1 focus:outline-none focus:border-amber-600" />
              </div>
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wide">
                  Document File <span className="text-red-500">*</span>
                </label>
                <input
                  ref={fileRef}
                  type="file"
                  onChange={e => setUploadFile(e.target.files?.[0] || null)}
                  className="w-full text-sm mt-1 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 cursor-pointer"
                />
                {uploadFile && (
                  <p className="text-xs text-slate-500 mt-1 truncate">{uploadFile.name} <span className="text-slate-400">({(uploadFile.size / 1024).toFixed(0)} KB)</span></p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button onClick={() => setShowIssue(false)} disabled={isIssueSaving}>Cancel</Button>
              <Button variant="primary" onClick={handleIssueRevision} disabled={!issueRev || !uploadFile || isIssueSaving}>
                {isIssueSaving ? 'Issuing…' : 'Issue'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showApproval && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-80 p-5">
            <h3 className="font-semibold mb-1">
              {approvalAction === 'Rejected' ? 'Reject Revision' : 'Approve / Release Revision'}
            </h3>
            {document.revisions?.[0] && (
              <p className="text-xs text-slate-400 mb-3">Rev <span className="font-mono font-medium">{document.revisions[0].revision_code}</span></p>
            )}
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wide">Action</label>
                <select value={approvalAction} onChange={e => setApprovalAction(e.target.value)} className="w-full border rounded px-3 py-2 text-sm mt-1 focus:outline-none focus:border-amber-600">
                  <option value="Approved">Approved</option>
                  <option value="Released">Released</option>
                  <option value="Review Commented">Review Commented</option>
                  <option value="Rejected">Rejected</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wide">
                  Comment{approvalAction === 'Rejected' ? ' (reason)' : ' (optional)'}
                </label>
                <textarea
                  value={approvalComment}
                  onChange={e => setApprovalComment(e.target.value)}
                  rows={3}
                  placeholder={approvalAction === 'Rejected' ? 'State reason for rejection…' : ''}
                  className="w-full border rounded px-3 py-2 text-sm mt-1 focus:outline-none focus:border-amber-600 resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button onClick={() => setShowApproval(false)}>Cancel</Button>
              <Button
                variant={approvalAction === 'Rejected' ? 'danger' : 'primary'}
                onClick={handleApproval}
                disabled={approvalAction === 'Rejected' && !approvalComment.trim()}
              >
                {approvalAction === 'Rejected' ? 'Confirm Reject' : 'Submit'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {revCtxMenu && (
        <div
          className="fixed z-50 bg-white border border-slate-200 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ top: revCtxMenu.y, left: revCtxMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          <button
            className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 text-red-600 hover:bg-red-50"
            onClick={() => { setRevCtxMenu(null); handleDeleteRevision(revCtxMenu.rev); }}
          >
            <Trash2 className="w-3.5 h-3.5" />Delete Revision {revCtxMenu.rev.revision_code}
          </button>
        </div>
      )}
    </div>
  );
}
