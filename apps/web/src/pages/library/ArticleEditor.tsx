// Write or edit an article. "Publish" makes it visible to readers at once, except a procedure,
// which goes to the pool owner for approval (unless the owner or an admin publishes it).
// Saving without publishing keeps the published version in front of readers.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import { usePeople } from '../initiatives/initiativesApi';
import { useAuthStore } from '../../store/authStore';
import RichTextEditor from './RichTextEditor';
import { apiError, ArticleKind, KINDS, useArticle, useCreateArticle, usePool, usePools, useSaveArticle } from './libraryApi';

const inYear = () => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d.toLocaleDateString('en-CA'); };
const field = 'mt-1 w-full border border-stone-300 rounded-lg px-3 py-2 text-sm font-normal bg-white';

export default function ArticleEditor() {
  const { slug, id } = useParams();
  const editing = !!id;
  const article = useArticle(id);
  const a = article.data;
  const poolSlug = editing ? a?.pool.slug : slug;
  const pool = usePool(poolSlug);
  const pools = usePools();
  const people = usePeople();
  const me = useAuthStore(s => s.user?.id);
  const navigate = useNavigate();
  const create = useCreateArticle();
  const save = useSaveArticle(id ?? '');
  const [f, setF] = useState({
    title: '', summary: '', body_html: '', kind: 'howto' as ArticleKind, category: '', tags: '', review_by: inYear(), owner_user_id: '', pool: slug ?? '', note: '',
  });
  const [loaded, setLoaded] = useState(!editing);
  useEffect(() => {
    if (!a || loaded) return;
    setF({
      title: a.revision.title, summary: a.revision.summary ?? '', body_html: a.revision.body_html, kind: a.kind, category: a.category ?? '',
      tags: a.tags.join(', '), review_by: a.review_by ?? '', owner_user_id: a.owner_user_id ?? '', pool: a.pool.slug, note: '',
    });
    setLoaded(true);
  }, [a, loaded]);

  const p = pool.data;
  if ((editing && article.isLoading) || pool.isLoading || !loaded) return <div className="p-6 max-w-5xl mx-auto"><div className="h-96 skeleton rounded-2xl" /></div>;
  if (!p || (editing && !a) || !p.rights.write || (editing && !a!.rights.write)) {
    return <div className="p-10 text-center text-sm text-stone-500">You cannot write here. <Link to="/knowledge" className="underline">Back to the library</Link></div>;
  }
  const needsApproval = f.kind === 'procedure' && !p.rights.approve;
  const busy = create.isPending || save.isPending;

  const submit = async (publish: boolean) => {
    if (!f.title.trim()) return toast.error('Give the article a title');
    const body = {
      title: f.title, summary: f.summary.trim() || null, body_html: f.body_html, kind: f.kind, category: f.category.trim() || null,
      tags: f.tags.split(',').map(t => t.trim()).filter(Boolean), review_by: f.review_by || null, owner_user_id: f.owner_user_id || (editing ? null : me ?? null), publish,
    };
    try {
      if (editing) {
        const r = await save.mutateAsync({ ...body, note: f.note.trim() || null, ...(f.pool !== a!.pool.slug ? { pool: f.pool } : {}) });
        toast.success(r.outcome === 'publish' ? 'Published' : r.outcome === 'review' ? 'Sent to the pool owner for approval' : 'Saved (not published)');
        navigate(`/knowledge/articles/${id}`);
      } else {
        const r = await create.mutateAsync({ ...body, pool: p.slug });
        toast.success(r.outcome === 'publish' ? `${r.code} published` : r.outcome === 'review' ? `${r.code} sent to the pool owner for approval` : `${r.code} saved as a draft`);
        navigate(`/knowledge/articles/${r.id}`);
      }
    } catch (err) { toast.error(apiError(err, 'Could not save the article')); }
  };

  const published = editing && a!.status === 'published';
  return <div className="p-6 max-w-5xl mx-auto">
    <PageHeader crumbs={[{ label: 'Knowledge Library', href: '/knowledge' }, { label: p.name, href: `/knowledge/pools/${p.slug}` }, { label: editing ? a!.code : 'New article' }]}
      title={editing ? `Edit ${a!.revision.title}` : `New article in ${p.name}`}
      actions={<div className="flex gap-2">
        <Button onClick={() => navigate(-1)}>Cancel</Button>
        <Button onClick={() => submit(false)} disabled={busy}>{published ? 'Save without publishing' : 'Save draft'}</Button>
        <Button variant="primary" onClick={() => submit(true)} disabled={busy}>{needsApproval ? 'Send for approval' : 'Publish'}</Button>
      </div>} />

    <div className="grid lg:grid-cols-[1fr_260px] gap-5">
      <div className="space-y-3 min-w-0">
        <input aria-label="Title" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Title"
          className="w-full text-xl font-bold border-0 border-b border-stone-200 bg-transparent px-1 py-2 focus:outline-none focus:border-blue-500" />
        <textarea aria-label="Summary" value={f.summary} onChange={e => setF({ ...f, summary: e.target.value })} rows={2}
          placeholder="One or two sentences: what this article answers (shown in lists and search)"
          className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 bg-white" />
        <RichTextEditor value={f.body_html} onChange={html => setF(s => ({ ...s, body_html: html }))} placeholder="Write here. Paste screenshots straight in; use the table button for data." />
        {editing && <label className="block text-xs font-bold text-stone-600">What changed <span className="font-normal text-stone-400">(optional, shown in the history)</span>
          <input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} className={field} placeholder="e.g. Updated annealing times for 100 mm panels" /></label>}
      </div>

      <aside className="space-y-3 text-xs">
        <fieldset>
          <legend className="font-bold text-stone-600 mb-1">Type</legend>
          <div className="space-y-1">{KINDS.map(k => <label key={k.value} className={`block rounded-lg border px-2.5 py-1.5 cursor-pointer ${f.kind === k.value ? 'border-blue-400 bg-blue-50' : 'border-stone-200 bg-white'}`}>
            <input type="radio" name="kind" className="sr-only" checked={f.kind === k.value} onChange={() => setF({ ...f, kind: k.value })} />
            <span className="font-semibold text-stone-800 text-sm">{k.label}</span><span className="block text-stone-500">{k.hint}</span>
          </label>)}</div>
        </fieldset>
        {needsApproval && <p className="rounded-lg bg-violet-50 text-violet-900 px-2.5 py-2">{p.owner_name ? `${p.owner_name} (pool owner)` : 'The pool owner'} approves each version before readers see it.</p>}
        <label className="block font-bold text-stone-600">Category
          <input list="pool-categories" value={f.category} onChange={e => setF({ ...f, category: e.target.value })} className={field} placeholder="e.g. Bonding" />
          <datalist id="pool-categories">{p.categories.map(c => <option key={c.category} value={c.category} />)}</datalist></label>
        <label className="block font-bold text-stone-600">Tags <span className="font-normal text-stone-400">(comma separated)</span>
          <input value={f.tags} onChange={e => setF({ ...f, tags: e.target.value })} className={field} placeholder="annealing, 100 mm" /></label>
        <label className="block font-bold text-stone-600">Review by <span className="font-normal text-stone-400">(flags it when stale)</span>
          <input type="date" value={f.review_by} onChange={e => setF({ ...f, review_by: e.target.value })} className={field} /></label>
        <label className="block font-bold text-stone-600">Article owner
          <select value={f.owner_user_id || (editing ? '' : me ?? '')} onChange={e => setF({ ...f, owner_user_id: e.target.value })} className={field}>
            <option value="">No owner</option>{(people.data ?? []).map(x => <option key={x.id} value={x.id}>{x.name}{x.id === me ? ' (me)' : ''}</option>)}
          </select></label>
        {editing && <label className="block font-bold text-stone-600">Pool
          <select value={f.pool} onChange={e => setF({ ...f, pool: e.target.value })} className={field}>
            {(pools.data ?? []).filter(x => x.rights.write).map(x => <option key={x.id} value={x.slug}>{x.name}</option>)}
          </select></label>}
      </aside>
    </div>
  </div>;
}
