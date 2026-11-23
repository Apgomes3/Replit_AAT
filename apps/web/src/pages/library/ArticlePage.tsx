// Reading an article. Editors also see its newest version, approval state, history and can link it
// to projects, enquiries, design books, initiatives and clients, and attach files.
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, CheckCircle2, Download, History, Paperclip, Pencil, Plus, Printer, RotateCcw, Trash2, Undo2, X } from 'lucide-react';
import ArticlePrint from './ArticlePrint';
import toast from 'react-hot-toast';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import ModalDialog from '../../components/ui/ModalDialog';
import ClientPicker from '../../components/clients/ClientPicker';
import WorkForPicker from '../my-work/WorkForPicker';
import {
  apiError, Article, ArticleLink, downloadFile, fmtDate, LinkType, reviewState, useArticle, useArticleAction, useDeleteArticle,
  useDeleteFile, useRevision, useSaveLinks, useUploadFile,
} from './libraryApi';
import { KindChip, Restricted, StatusChips } from './LibraryParts';
import './library.css';

const LINK_LABELS: Record<LinkType, string> = {
  project: 'Project', initiative: 'Initiative', product: 'Product', client: 'Client', enquiry: 'Enquiry', design_book: 'Design book',
};
const LINK_HREF: Record<LinkType, (id: string) => string> = {
  project: id => `/projects/${id}`, initiative: id => `/initiatives/${id}`, product: id => `/products/masters/${id}`,
  client: id => `/clients/${id}`, enquiry: id => `/enquiries/${id}`, design_book: id => `/design-books/${id}`,
};
const EVENT_LABELS: Record<string, string> = {
  created: 'created it', edited: 'saved a new version', published: 'published it', submitted: 'sent it for approval',
  approved: 'approved and published it', sent_back: 'sent it back', archived: 'archived it', restored: 'restored it',
  moved: 'moved it', file_added: 'attached a file',
};
const size = (b: number) => b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

export default function ArticlePage() {
  const { id } = useParams();
  const article = useArticle(id);
  const a = article.data;
  const navigate = useNavigate();
  const act = useArticleAction(id ?? '');
  const remove = useDeleteArticle();
  const [sendingBack, setSendingBack] = useState(false);
  const [viewRev, setViewRev] = useState<string | null>(null);

  if (article.isLoading) return <div className="p-6 max-w-6xl mx-auto"><div className="h-96 skeleton rounded-2xl" /></div>;
  if (!a) return <div className="p-10 text-center text-sm text-stone-500">This article does not exist, or it is in a pool you cannot read. <Link to="/knowledge" className="underline">Back to the library</Link></div>;

  const run = async (action: 'approve' | 'archive' | 'restore', done: string) => {
    try { await act.mutateAsync({ action }); toast.success(done); } catch (err) { toast.error(apiError(err, 'That did not work')); }
  };
  const review = a.status === 'published' ? reviewState(a.review_by) : null;
  const showingDraft = a.rights.write && a.revision.id !== a.published_revision_id;

  return <div className="p-6 max-w-6xl mx-auto">
    <PageHeader crumbs={[{ label: 'Knowledge Library', href: '/knowledge' }, { label: a.pool.name, href: `/knowledge/pools/${a.pool.slug}` }, { label: a.code }]}
      code={a.code} title={a.revision.title}
      subtitle={<span className="inline-flex flex-wrap items-center gap-1.5"><KindChip kind={a.kind} />{a.pool.restricted && <Restricted />}<StatusChips a={a} /></span>}
      actions={<div className="flex flex-wrap gap-2">
        <Button onClick={() => window.print()} title="Print on AAT letterhead, or save as PDF"><Printer className="w-4 h-4" /> Print</Button>
        {a.rights.write && <>{a.status === 'archived'
          ? <Button onClick={() => run('restore', 'Restored')}><RotateCcw className="w-4 h-4" /> Restore</Button>
          : <Button variant="primary" onClick={() => navigate(`/knowledge/articles/${a.id}/edit`)}><Pencil className="w-4 h-4" /> Edit</Button>}
        {a.status !== 'archived' && a.published_revision_id && <Button onClick={() => confirm('Archive this article? Readers will no longer see it.') && run('archive', 'Archived')}><Archive className="w-4 h-4" /> Archive</Button>}
        {!a.published_revision_id && <Button variant="danger" onClick={async () => {
          if (!confirm('Delete this draft for good?')) return;
          try { await remove.mutateAsync(a.id); toast.success('Draft deleted'); navigate(`/knowledge/pools/${a.pool.slug}`); } catch (err) { toast.error(apiError(err, 'Could not delete')); }
        }}><Trash2 className="w-4 h-4" /> Delete draft</Button>}</>}
      </div>} />
    <ArticlePrint a={a} />

    {a.in_review && <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 flex flex-wrap items-center gap-3">
      <div className="text-sm text-violet-900 flex-1 min-w-[240px]"><b>Waiting for approval.</b> {a.rights.approve ? 'Read the new version below, then approve it or send it back with what to change.' : `${a.pool.owner_name ?? 'The pool owner'} approves it before readers see this version.`}</div>
      {a.rights.approve && <>
        <Button variant="primary" onClick={() => run('approve', 'Approved and published')}><CheckCircle2 className="w-4 h-4" /> Approve and publish</Button>
        <Button onClick={() => setSendingBack(true)}><Undo2 className="w-4 h-4" /> Send back</Button>
      </>}
    </div>}
    {a.review_note && !a.in_review && a.rights.write && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><b>Sent back:</b> {a.review_note}</div>}
    {showingDraft && a.published_revision_id && !a.in_review && <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-900">You are seeing the newest version (v{a.revisions[0]?.rev_no}). Readers still see the published one until it is published.</div>}
    {review === 'overdue' && a.rights.write && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">Review overdue since {fmtDate(a.review_by)}. Check it is still right, then set a new review date in Edit.</div>}

    <div className="grid lg:grid-cols-[1fr_300px] gap-5">
      <article className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 min-w-0">
        {a.revision.summary && <p className="text-base text-stone-600 mb-4 pb-4 border-b border-stone-100">{a.revision.summary}</p>}
        {a.revision.body_html
          // The HTML is cleaned on the server (rules.ts cleanHtml) before it is stored.
          ? <div className="kb-prose" dangerouslySetInnerHTML={{ __html: a.revision.body_html }} />
          : <p className="text-sm text-stone-400">No text yet.</p>}
      </article>

      <aside className="space-y-4 text-sm">
        <section className="bg-white rounded-2xl border border-stone-200 p-4 space-y-1.5">
          <Row label="Pool"><Link to={`/knowledge/pools/${a.pool.slug}`} className="text-blue-700 hover:underline">{a.pool.name}</Link></Row>
          <Row label="Owner">{a.owner_name ?? '—'}</Row>
          {a.category && <Row label="Category">{a.category}</Row>}
          {a.tags.length > 0 && <Row label="Tags">{a.tags.map(t => `#${t}`).join(' ')}</Row>}
          <Row label="Published">{a.published_at ? fmtDate(a.published_at) : 'Not yet'}</Row>
          <Row label="Review by"><span className={review === 'overdue' ? 'text-rose-700 font-semibold' : review === 'soon' ? 'text-amber-800' : ''}>{a.review_by ? fmtDate(a.review_by) : '—'}</span></Row>
        </section>
        <Links article={a} />
        <Files article={a} />
        {a.rights.write && <section className="bg-white rounded-2xl border border-stone-200 p-4">
          <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[.1em] text-stone-500 mb-2"><History className="w-3.5 h-3.5" />Versions</h3>
          <ul className="space-y-1">{a.revisions.map(r => <li key={r.id}>
            <button onClick={() => setViewRev(r.id)} className="w-full text-left text-xs hover:bg-stone-50 rounded px-1 py-0.5">
              <b>v{r.rev_no}</b>{r.id === a.published_revision_id && <span className="ml-1 text-emerald-700">published</span>} · {r.created_by_name ?? '—'} · {fmtDate(r.created_at)}
              {r.note && <span className="block text-stone-500">{r.note}</span>}
            </button></li>)}</ul>
          <h3 className="text-xs font-bold uppercase tracking-[.1em] text-stone-500 mt-3 mb-1">Activity</h3>
          <ul className="space-y-0.5">{a.events.slice(0, 12).map((e, i) => <li key={i} className="text-xs text-stone-600">
            <b>{e.actor_name ?? 'Someone'}</b> {EVENT_LABELS[e.action] ?? e.action}{e.note ? `: ${e.note}` : ''} <span className="text-stone-400">· {fmtDate(e.created_at)}</span></li>)}</ul>
        </section>}
      </aside>
    </div>

    {sendingBack && <SendBack id={a.id} onClose={() => setSendingBack(false)} />}
    {viewRev && <RevisionView articleId={a.id} revId={viewRev} onClose={() => setViewRev(null)} />}
  </div>;
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) =>
  <div className="flex gap-2"><span className="w-20 shrink-0 text-stone-500 text-xs pt-0.5">{label}</span><span className="text-stone-800 min-w-0">{children}</span></div>;

const LINK_FROM_PREFIX: Record<string, LinkType> = { p: 'project', e: 'enquiry', d: 'design_book', i: 'initiative' };

function Links({ article }: { article: Article }) {
  const save = useSaveLinks(article.id);
  const [adding, setAdding] = useState(false);
  const [pickClient, setPickClient] = useState(false);
  const setLinks = async (links: Array<Pick<ArticleLink, 'entity_type' | 'entity_id'>>) => {
    try { await save.mutateAsync(links.map(l => ({ entity_type: l.entity_type, entity_id: l.entity_id }))); }
    catch (err) { toast.error(apiError(err, 'Could not change the links')); }
  };
  const add = (type: LinkType, id: string) => {
    if (!article.links.some(l => l.entity_type === type && l.entity_id === id)) setLinks([...article.links, { entity_type: type, entity_id: id }]);
    setAdding(false); setPickClient(false);
  };
  if (!article.links.length && !article.rights.write) return null;
  return <section className="bg-white rounded-2xl border border-stone-200 p-4">
    <h3 className="text-xs font-bold uppercase tracking-[.1em] text-stone-500 mb-2">About</h3>
    {!article.links.length && <p className="text-xs text-stone-400">Not linked to a project, enquiry or other record yet.</p>}
    <ul className="space-y-1">{article.links.map(l => <li key={`${l.entity_type}:${l.entity_id}`} className="flex items-start gap-1.5 text-xs">
      <span className="text-stone-400 w-16 shrink-0">{LINK_LABELS[l.entity_type]}</span>
      <Link to={LINK_HREF[l.entity_type](l.entity_id)} className="text-blue-700 hover:underline min-w-0">{l.label}</Link>
      {article.rights.write && <button aria-label={`Remove link to ${l.label}`} onClick={() => setLinks(article.links.filter(x => x !== l))} className="ml-auto text-stone-300 hover:text-rose-600"><X className="w-3.5 h-3.5" /></button>}
    </li>)}</ul>
    {article.rights.write && (adding
      ? <div className="mt-2 space-y-2">
          <WorkForPicker value="" onChange={v => { const [k, id] = v.split(':'); if (k && id) add(LINK_FROM_PREFIX[k], id); }} />
          {pickClient ? <ClientPicker value={null} onChange={c => c && add('client', c.id)} placeholder="Search a company…" />
            : <button onClick={() => setPickClient(true)} className="text-xs text-blue-700 hover:underline">…or a client company</button>}
          <button onClick={() => { setAdding(false); setPickClient(false); }} className="block text-xs text-stone-500">Cancel</button>
        </div>
      : <button onClick={() => setAdding(true)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700"><Plus className="w-3.5 h-3.5" />Link to a project, enquiry, client…</button>)}
  </section>;
}

function Files({ article }: { article: Article }) {
  const upload = useUploadFile(article.id);
  const remove = useDeleteFile();
  const input = useRef<HTMLInputElement>(null);
  if (!article.files.length && !article.rights.write) return null;
  return <section className="bg-white rounded-2xl border border-stone-200 p-4">
    <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[.1em] text-stone-500 mb-2"><Paperclip className="w-3.5 h-3.5" />Attachments</h3>
    {!article.files.length && <p className="text-xs text-stone-400">No files attached.</p>}
    <ul className="space-y-1">{article.files.map(f => <li key={f.id} className="flex items-center gap-1.5 text-xs">
      <button onClick={() => downloadFile(f.id, f.file_name).catch(() => toast.error('Could not download'))} className="flex items-center gap-1 text-blue-700 hover:underline min-w-0 text-left">
        <Download className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{f.file_name}</span></button>
      <span className="text-stone-400 shrink-0">{size(f.size_bytes)}</span>
      {article.rights.write && <button aria-label={`Remove ${f.file_name}`} onClick={() => confirm(`Remove ${f.file_name}?`) && remove.mutateAsync(f.id).catch(err => toast.error(apiError(err, 'Could not remove')))} className="ml-auto text-stone-300 hover:text-rose-600"><X className="w-3.5 h-3.5" /></button>}
    </li>)}</ul>
    {article.rights.write && <>
      <button onClick={() => input.current?.click()} disabled={upload.isPending} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700"><Plus className="w-3.5 h-3.5" />{upload.isPending ? 'Uploading…' : 'Attach a file (up to 50 MB)'}</button>
      <input ref={input} type="file" hidden onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (!file) return;
        try { await upload.mutateAsync(file); toast.success(`${file.name} attached`); } catch (err) { toast.error(apiError(err, 'Could not attach the file')); }
      }} />
    </>}
  </section>;
}

function SendBack({ id, onClose }: { id: string; onClose: () => void }) {
  const act = useArticleAction(id);
  const [note, setNote] = useState('');
  const submit = async () => {
    if (!note.trim()) return toast.error('Say what needs changing');
    try { await act.mutateAsync({ action: 'send-back', note }); toast.success('Sent back to the writer'); onClose(); }
    catch (err) { toast.error(apiError(err, 'Could not send it back')); }
  };
  return <div className="fixed inset-0 z-50 bg-stone-900/40 flex items-center justify-center p-4">
    <ModalDialog onClose={onClose} labelledBy="send-back-title" className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3">
      <h2 id="send-back-title" className="font-bold text-stone-800">Send back with changes</h2>
      <textarea autoFocus value={note} onChange={e => setNote(e.target.value)} rows={4} placeholder="What needs changing before it can be published?" className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm" />
      <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit} disabled={act.isPending}>Send back</Button></div>
    </ModalDialog>
  </div>;
}

function RevisionView({ articleId, revId, onClose }: { articleId: string; revId: string; onClose: () => void }) {
  const rev = useRevision(articleId, revId);
  return <div className="fixed inset-0 z-50 bg-stone-900/40 flex items-center justify-center p-4">
    <ModalDialog onClose={onClose} labelledBy="rev-title" className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-auto">
      <div className="sticky top-0 bg-white border-b border-stone-100 px-5 py-3 flex items-center gap-2">
        <h2 id="rev-title" className="font-bold text-stone-800">{rev.data ? `v${rev.data.rev_no}: ${rev.data.title}` : 'Version'}</h2>
        <span className="text-xs text-stone-400">{rev.data && `${rev.data.created_by_name ?? ''} · ${fmtDate(rev.data.created_at)}`}</span>
        <button aria-label="Close" onClick={onClose} className="ml-auto p-1 text-stone-400 hover:text-stone-700"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-5">{rev.isLoading ? <div className="h-40 skeleton rounded-lg" /> : rev.data && <>
        {rev.data.summary && <p className="text-stone-600 mb-3">{rev.data.summary}</p>}
        <div className="kb-prose" dangerouslySetInnerHTML={{ __html: rev.data.body_html }} />
      </>}</div>
    </ModalDialog>
  </div>;
}
