import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { useState, useRef } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import MetadataPanel from '../../components/ui/MetadataPanel';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import LifecycleHistory from '../../components/ui/LifecycleHistory';
import Button from '../../components/ui/Button';
import toast from 'react-hot-toast';
import { Upload, CheckCircle, XCircle, ArrowRight, Download } from 'lucide-react';

export default function DocumentDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [showIssue, setShowIssue] = useState(false);
  const [showApproval, setShowApproval] = useState(false);
  const [issueRev, setIssueRev] = useState('');
  const [issuePurpose, setIssuePurpose] = useState('');
  const [approvalAction, setApprovalAction] = useState('Approved');
  const [approvalComment, setApprovalComment] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: document, isLoading, refetch } = useQuery({
    queryKey: ['document', id],
    queryFn: () => api.get(`/documents/${id}`).then(r => r.data),
  });

  const { data: history } = useQuery({
    queryKey: ['lifecycle', 'document', id],
    queryFn: () => api.get(`/lifecycle/document/${id}`).then(r => r.data),
  });

  if (isLoading) return <div className="p-8 text-slate-400">Loading...</div>;
  if (!document) return <div className="p-8 text-slate-400">Document not found</div>;

  const handleIssueRevision = async () => {
    if (!issueRev) return;
    const form = new FormData();
    form.append('revision_code', issueRev);
    form.append('revision_purpose', issuePurpose);
    if (uploadFile) form.append('file', uploadFile);
    await api.post(`/documents/${id}/revisions`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
    toast.success(`Revision ${issueRev} issued`);
    refetch();
    qc.invalidateQueries({ queryKey: ['lifecycle'] });
    setShowIssue(false);
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

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        code={document.document_code} title={document.document_title} status={document.status}
        subtitle={`${document.document_type || ''} ${document.discipline ? '· ' + document.discipline : ''}`}
        breadcrumb={<Link to="/documents" className="hover:underline">Documents</Link>}
        actions={
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setShowIssue(true)}><Upload className="w-3.5 h-3.5" />Issue Revision</Button>
            <Button size="sm" variant="primary" onClick={() => setShowApproval(true)}><CheckCircle className="w-3.5 h-3.5" />Approve/Release</Button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 space-y-4">
            <MetadataPanel fields={[
              { label: 'Document Type', value: document.document_type },
              { label: 'Discipline', value: document.discipline },
              { label: 'Project', value: document.project_code ? <Link to={`/projects/${document.project_id}`}><EntityCode code={document.project_code} /></Link> : null },
              { label: 'Current Revision', value: <span className="font-mono font-medium">{document.current_revision}</span> },
              { label: 'Owner', value: document.owner },
            ]} />

            <div className="bg-white border border-slate-200 rounded-lg">
              <div className="px-4 py-3 border-b border-slate-200 text-sm font-medium text-slate-700">Revision History</div>
              <div className="divide-y divide-slate-100">
                {document.revisions?.length === 0 ? (
                  <div className="p-4 text-slate-400 text-sm">No revisions issued yet</div>
                ) : document.revisions?.map((rev: any) => (
                  <div key={rev.id} className="px-4 py-3 flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium">Rev {rev.revision_code}</span>
                        <StatusBadge status={rev.status} />
                      </div>
                      {rev.revision_purpose && <div className="text-sm text-slate-600 mt-0.5">{rev.revision_purpose}</div>}
                      <div className="text-xs text-slate-400 mt-0.5">{new Date(rev.created_at).toLocaleDateString()}{rev.issued_by_name ? ` · ${rev.issued_by_name}` : ''}</div>
                    </div>
                    {rev.file_path && (
                      <a href={rev.file_path} target="_blank" rel="noreferrer" className="text-[#3E5C76] hover:underline text-sm flex items-center gap-1">
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
                <input value={issueRev} onChange={e => setIssueRev(e.target.value)} placeholder="B" className="w-full border rounded px-3 py-2 text-sm mt-1 focus:outline-none focus:border-[#3E5C76]" />
              </div>
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wide">Purpose</label>
                <input value={issuePurpose} onChange={e => setIssuePurpose(e.target.value)} placeholder="For Construction" className="w-full border rounded px-3 py-2 text-sm mt-1 focus:outline-none focus:border-[#3E5C76]" />
              </div>
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wide">Attach File (optional)</label>
                <input ref={fileRef} type="file" onChange={e => setUploadFile(e.target.files?.[0] || null)} className="w-full text-sm mt-1" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button onClick={() => setShowIssue(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleIssueRevision}>Issue</Button>
            </div>
          </div>
        </div>
      )}

      {showApproval && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-80 p-5">
            <h3 className="font-semibold mb-3">Record Approval Action</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wide">Action</label>
                <select value={approvalAction} onChange={e => setApprovalAction(e.target.value)} className="w-full border rounded px-3 py-2 text-sm mt-1 focus:outline-none">
                  <option>Approved</option>
                  <option>Released</option>
                  <option>Rejected</option>
                  <option>Review Commented</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 uppercase tracking-wide">Comment</label>
                <textarea value={approvalComment} onChange={e => setApprovalComment(e.target.value)} rows={3} className="w-full border rounded px-3 py-2 text-sm mt-1 focus:outline-none resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button onClick={() => setShowApproval(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleApproval}>Submit</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
