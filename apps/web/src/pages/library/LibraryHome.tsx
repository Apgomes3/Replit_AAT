// Knowledge Library home: search across every pool you may read, what waits for you (procedures to
// approve, articles due for review), the pools, and the latest published articles.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, CheckCircle2, Library, Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import ModalDialog from '../../components/ui/ModalDialog';
import { useAuthStore } from '../../store/authStore';
import { apiError, fmtDate, useArticles, useCreatePool, useOverview, usePools } from './libraryApi';
import { ArticleRow, KindChip, PoolIcon, Restricted } from './LibraryParts';
import { ROUTES } from '../../lib/navigation';

export default function LibraryHome() {
  const isAdmin = useAuthStore(s => s.user?.role === 'admin');
  const pools = usePools();
  const overview = useOverview();
  const [q, setQ] = useState('');
  const results = useArticles({ q: q.trim() }, q.trim().length >= 2);
  const [adding, setAdding] = useState(false);
  const o = overview.data;

  return <div className="p-6 max-w-7xl mx-auto">
    <PageHeader title="Knowledge Library" subtitle="One library for how we work, divided into pools. Search covers every pool you can read."
      actions={isAdmin ? <Button onClick={() => setAdding(true)}><Plus className="w-4 h-4" /> New pool</Button> : undefined} />

    <div className="relative max-w-2xl mt-2 mb-6">
      <Search className="absolute left-3 top-3 w-4 h-4 text-stone-400" />
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search articles: title, text, tags…" aria-label="Search the library"
        className="w-full pl-9 pr-3 py-2.5 border border-stone-300 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
    </div>

    {q.trim().length >= 2 ? <section className="bg-white rounded-2xl border border-stone-200 shadow-sm">
      <h2 className="px-4 pt-3 pb-2 text-[11px] font-bold uppercase tracking-[.12em] text-stone-500">Results for “{q.trim()}”</h2>
      {results.isLoading ? <div className="p-4"><div className="h-16 skeleton rounded-lg" /></div>
        : !results.data?.length ? <p className="px-4 pb-6 text-sm text-stone-500">No articles match. Try fewer or different words.</p>
        : <ul className="divide-y divide-stone-100">{results.data.map(a => <ArticleRow key={a.id} a={a} showPool />)}</ul>}
    </section> : <>
      {(o?.awaiting_approval.length || o?.due_for_review.length) ? <div className="grid md:grid-cols-2 gap-4 mb-6">
        {o.awaiting_approval.length > 0 && <section className="bg-white rounded-2xl border border-violet-200 shadow-sm">
          <h2 className="flex items-center gap-1.5 px-4 pt-3 pb-1 text-sm font-bold text-violet-900"><CheckCircle2 className="w-4 h-4" />Procedures waiting for your approval</h2>
          <ul>{o.awaiting_approval.map(a => <li key={a.id}><Link to={`/knowledge/articles/${a.id}`} className="flex items-center gap-2 px-4 py-2 hover:bg-violet-50/50 text-sm">
            <span className="font-medium text-stone-800 truncate">{a.title}</span><span className="text-xs text-stone-400 truncate">{a.pool_name}{a.submitted_by ? ` · from ${a.submitted_by}` : ''}</span>
          </Link></li>)}</ul>
        </section>}
        {o.due_for_review.length > 0 && <section className="bg-white rounded-2xl border border-amber-200 shadow-sm">
          <h2 className="flex items-center gap-1.5 px-4 pt-3 pb-1 text-sm font-bold text-amber-900"><CalendarClock className="w-4 h-4" />Due for review</h2>
          <ul>{o.due_for_review.map(a => <li key={a.id}><Link to={`/knowledge/articles/${a.id}`} className="flex items-center gap-2 px-4 py-2 hover:bg-amber-50/50 text-sm">
            <span className="font-medium text-stone-800 truncate">{a.title}</span><span className="ml-auto text-xs text-amber-800 shrink-0">{fmtDate(a.review_by)}</span>
          </Link></li>)}</ul>
        </section>}
      </div> : null}

      <h2 className="text-[11px] font-bold uppercase tracking-[.12em] text-stone-500 mb-2">Pools</h2>
      {pools.isLoading ? <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">{[1, 2, 3, 4].map(i => <div key={i} className="h-32 skeleton rounded-2xl" />)}</div>
        : pools.isError ? <p className="text-sm text-rose-700">The library could not be loaded.</p>
        : <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {pools.data!.map(p => <Link key={p.id} to={`/knowledge/pools/${p.slug}`} className="group block rounded-2xl border border-stone-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm">
            <div className="flex items-center gap-2">
              <span className="w-9 h-9 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center"><PoolIcon icon={p.icon} /></span>
              <div className="min-w-0">
                <div className="font-bold text-stone-800 group-hover:text-blue-700 truncate">{p.name}</div>
                <div className="text-[11px] text-stone-400 truncate">{p.owner_name ? `Owner: ${p.owner_name}` : 'No owner yet'}</div>
              </div>
            </div>
            {p.restricted && <div className="mt-2"><Restricted /></div>}
            <p className="text-xs text-stone-500 mt-2 line-clamp-2 min-h-[2rem]">{p.description}</p>
            <div className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-stone-500">
              <span><b className="text-stone-700">{p.counts?.published ?? 0}</b> articles</span>
              {p.structured && <span>+ {p.structured.materials + p.structured.specifications + p.structured.design_rules} engineering records</span>}
              {!!p.counts?.drafts && <span>{p.counts.drafts} draft{p.counts.drafts === 1 ? '' : 's'}</span>}
              {!!p.counts?.in_review && <span className="text-violet-700">{p.counts.in_review} to approve</span>}
              {!!p.counts?.overdue_review && <span className="text-rose-700">{p.counts.overdue_review} review overdue</span>}
            </div>
          </Link>)}
        </div>}

      <section className="mt-8">
        <h2 className="text-[11px] font-bold uppercase tracking-[.12em] text-stone-500 mb-2">Recently published</h2>
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm">
          {overview.isLoading ? <div className="p-4"><div className="h-16 skeleton rounded-lg" /></div>
            : !o?.recent.length ? <div className="p-8 text-center text-sm text-stone-500"><Library className="mx-auto w-8 h-8 text-stone-300 mb-2" />Nothing published yet. Open a pool and write the first article.</div>
            : <ul className="divide-y divide-stone-100">{o.recent.map(a => <li key={a.id}><Link to={`/knowledge/articles/${a.id}`} className="flex items-center gap-2 px-4 py-2.5 hover:bg-stone-50">
              <KindChip kind={a.kind} /><span className="font-medium text-stone-800 truncate">{a.title}</span>
              <span className="ml-auto text-xs text-stone-400 shrink-0">{a.pool_name} · {fmtDate(a.updated_at)}</span></Link></li>)}</ul>}
        </div>
        <p className="text-xs text-stone-400 mt-3">Engineering records keep their own pages: <Link className="underline" to={ROUTES.materials}>Materials</Link>, <Link className="underline" to={ROUTES.specifications}>Specifications</Link>, <Link className="underline" to={ROUTES.designRules}>Design rules</Link>.</p>
      </section>
    </>}

    {adding && <NewPoolModal onClose={() => setAdding(false)} />}
  </div>;
}

function NewPoolModal({ onClose }: { onClose: () => void }) {
  const create = useCreatePool();
  const [f, setF] = useState({ name: '', description: '', restricted: false });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await create.mutateAsync(f); toast.success(`${f.name} pool added`); onClose(); }
    catch (err) { toast.error(apiError(err, 'Could not add the pool')); }
  };
  return <div className="fixed inset-0 z-50 bg-stone-900/40 flex items-center justify-center p-4">
    <ModalDialog onClose={onClose} labelledBy="new-pool-title" className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
      <form onSubmit={submit} className="p-5 space-y-3">
        <h2 id="new-pool-title" className="font-bold text-stone-800">New pool</h2>
        <label className="block text-xs font-bold text-stone-600">Name<input autoFocus required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className="mt-1 w-full border border-stone-300 rounded-lg px-3 py-2 text-sm font-normal" /></label>
        <label className="block text-xs font-bold text-stone-600">What it holds<textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })} rows={2} className="mt-1 w-full border border-stone-300 rounded-lg px-3 py-2 text-sm font-normal" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.restricted} onChange={e => setF({ ...f, restricted: e.target.checked })} />Restricted: only chosen people and teams can read it</label>
        <div className="flex justify-end gap-2 pt-2"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={create.isPending || !f.name.trim()}>Add pool</Button></div>
      </form>
    </ModalDialog>
  </div>;
}
