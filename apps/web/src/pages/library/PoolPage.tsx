// One pool: its articles (filter by type, category, status), who owns and edits it, and, for the
// owner or an admin, who may read it (restricted pools) and who may write.
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Search, Settings2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import ModalDialog from '../../components/ui/ModalDialog';
import { ROUTES } from '../../lib/navigation';
import { usePeople } from '../initiatives/initiativesApi';
import { useTeams } from '../drafting/draftingApi';
import { apiError, KINDS, PoolDetail, PoolMember, useArticles, usePool, useSaveMembers, useSavePool } from './libraryApi';
import { ArticleRow, PoolIcon, Restricted } from './LibraryParts';

const STATUS_FILTERS = [['', 'Current'], ['draft', 'Drafts'], ['in_review', 'Waiting for approval'], ['archived', 'Archived']] as const;

export default function PoolPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const pool = usePool(slug);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [due, setDue] = useState(false);
  const [managing, setManaging] = useState(false);
  const articles = useArticles({ pool: slug, q: q.trim() || undefined, kind: kind || undefined, category: category || undefined, status: status || undefined, due }, !!pool.data);
  const p = pool.data;

  if (pool.isLoading) return <div className="p-6 max-w-7xl mx-auto"><div className="h-40 skeleton rounded-2xl" /></div>;
  if (!p) return <div className="p-10 text-center text-sm text-stone-500">This pool does not exist, or it is restricted. <Link to="/knowledge" className="underline">Back to the library</Link></div>;
  const editors = p.members.filter(m => m.role === 'editor');
  const readers = p.members.filter(m => m.role === 'reader');

  return <div className="p-6 max-w-7xl mx-auto">
    <PageHeader crumbs={[{ label: 'Knowledge Library', href: '/knowledge' }, { label: p.name }]}
      title={<span className="inline-flex items-center gap-2"><span className="w-9 h-9 rounded-xl bg-blue-50 text-blue-700 inline-flex items-center justify-center"><PoolIcon icon={p.icon} /></span>{p.name}{p.restricted && <Restricted />}</span>}
      subtitle={p.description ?? undefined}
      actions={<div className="flex gap-2">
        {(p.rights.members || p.rights.settings) && <Button onClick={() => setManaging(true)}><Settings2 className="w-4 h-4" /> Owner, editors{p.restricted ? ' & readers' : ''}</Button>}
        {p.rights.write && <Button variant="primary" onClick={() => navigate(`/knowledge/pools/${p.slug}/new`)}><Plus className="w-4 h-4" /> New article</Button>}
      </div>} />

    <div className="grid lg:grid-cols-[1fr_280px] gap-5 mt-2">
      <div className="space-y-4 min-w-0">
        {p.slug === 'engineering' && <div className="grid grid-cols-3 gap-3">
          {[[ROUTES.materials, 'Materials'], [ROUTES.specifications, 'Specifications'], [ROUTES.designRules, 'Design rules']].map(([to, label]) =>
            <Link key={to} to={to} className="rounded-xl border border-stone-200 bg-white px-4 py-3 hover:border-blue-300 text-sm font-semibold text-stone-700">{label} →</Link>)}
        </div>}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-stone-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${p.name}…`} aria-label="Search this pool"
              className="w-full pl-9 pr-3 py-2 border border-stone-300 rounded-lg bg-white text-sm" />
          </div>
          <select aria-label="Type" value={kind} onChange={e => setKind(e.target.value)} className="border border-stone-300 rounded-lg px-2.5 py-2 text-sm bg-white">
            <option value="">All types</option>{KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          {p.rights.write && <select aria-label="Status" value={status} onChange={e => setStatus(e.target.value)} className="border border-stone-300 rounded-lg px-2.5 py-2 text-sm bg-white">
            {STATUS_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>}
          {p.rights.write && <label className="text-xs text-stone-600 flex items-center gap-1"><input type="checkbox" checked={due} onChange={e => setDue(e.target.checked)} />Due for review</label>}
        </div>
        {category && <button onClick={() => setCategory('')} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-800 rounded-full px-2.5 py-1">{category}<X className="w-3 h-3" /></button>}

        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm">
          {articles.isLoading ? <div className="p-4"><div className="h-20 skeleton rounded-lg" /></div>
            : !articles.data?.length ? <div className="p-10 text-center text-sm text-stone-500">
                {q || kind || category || status || due ? 'No articles match these filters.' : p.rights.write ? 'No articles yet. Write the first one.' : 'No articles published here yet.'}
              </div>
            : <ul className="divide-y divide-stone-100">{articles.data.map(a => <ArticleRow key={a.id} a={a} />)}</ul>}
        </div>
      </div>

      <aside className="space-y-4">
        {p.categories.length > 0 && <section className="bg-white rounded-2xl border border-stone-200 p-4">
          <h3 className="text-xs font-bold uppercase tracking-[.1em] text-stone-500 mb-2">Categories</h3>
          <ul className="space-y-0.5">{p.categories.map(c => <li key={c.category}>
            <button onClick={() => setCategory(c.category === category ? '' : c.category)} className={`w-full flex justify-between text-sm px-2 py-1 rounded ${c.category === category ? 'bg-blue-50 text-blue-800' : 'hover:bg-stone-50 text-stone-700'}`}>
              <span className="truncate">{c.category}</span><span className="text-stone-400">{c.count}</span></button>
          </li>)}</ul>
        </section>}
        <section className="bg-white rounded-2xl border border-stone-200 p-4 text-sm">
          <h3 className="text-xs font-bold uppercase tracking-[.1em] text-stone-500 mb-2">Who looks after it</h3>
          <div className="text-stone-500 text-xs">Owner</div>
          <div className="font-medium text-stone-800 mb-2">{p.owner_name ?? <span className="text-stone-400">No owner yet{p.rights.settings ? ' — choose one' : ''}</span>}</div>
          <div className="text-stone-500 text-xs">Editors</div>
          <MemberList list={editors} empty="Only the owner and admins write here." />
          {p.restricted && p.rights.members && <>
            <div className="text-stone-500 text-xs mt-2">Readers</div>
            <MemberList list={readers} empty="Nobody else can read this pool yet." />
          </>}
          <p className="text-[11px] text-stone-400 mt-3">{p.restricted ? 'Restricted: only the owner, editors and chosen readers see it.' : 'Everyone with the library can read it.'}
            {' '}Procedures need the owner's approval before each version is published.</p>
        </section>
      </aside>
    </div>

    {managing && <ManagePool pool={p} onClose={() => setManaging(false)} />}
  </div>;
}

const MemberList = ({ list, empty }: { list: PoolMember[]; empty: string }) => !list.length
  ? <p className="text-xs text-stone-400">{empty}</p>
  : <ul className="mb-1">{list.map(m => <li key={m.id} className="text-stone-700">{m.team_name ? <><span className="text-[10px] uppercase font-bold text-stone-400 mr-1">Team</span>{m.team_name}</> : m.user_name}</li>)}</ul>;

type Pick = { kind: 'user' | 'team'; id: string; label: string };
const fromMembers = (list: PoolMember[]): Pick[] => list.map(m => m.team_id
  ? { kind: 'team', id: m.team_id, label: m.team_name ?? 'Team' } : { kind: 'user', id: m.user_id!, label: m.user_name ?? 'Person' });

function ManagePool({ pool, onClose }: { pool: PoolDetail; onClose: () => void }) {
  const people = usePeople();
  const teams = useTeams();
  const saveMembers = useSaveMembers(pool.slug);
  const savePool = useSavePool(pool.slug);
  const [editors, setEditors] = useState<Pick[]>(fromMembers(pool.members.filter(m => m.role === 'editor')));
  const [readers, setReaders] = useState<Pick[]>(fromMembers(pool.members.filter(m => m.role === 'reader')));
  const [owner, setOwner] = useState(pool.owner_user_id ?? '');
  const [restricted, setRestricted] = useState(pool.restricted);
  const [description, setDescription] = useState(pool.description ?? '');
  const options: Pick[] = useMemo(() => [
    ...(teams.data ?? []).filter((t: any) => t.active !== false).map((t: any) => ({ kind: 'team' as const, id: t.id, label: t.name })),
    ...(people.data ?? []).map(p => ({ kind: 'user' as const, id: p.id, label: `${p.name}${p.job_title ? ` — ${p.job_title}` : ''}` })),
  ], [people.data, teams.data]);

  const save = async () => {
    try {
      if (pool.rights.settings) await savePool.mutateAsync({ owner_user_id: owner || null, restricted, description: description.trim() || null });
      else if (description !== (pool.description ?? '')) await savePool.mutateAsync({ description: description.trim() || null });
      const body = (l: Pick[]) => l.map(x => x.kind === 'team' ? { team_id: x.id } : { user_id: x.id });
      await saveMembers.mutateAsync({ editors: body(editors), ...(restricted ? { readers: body(readers) } : {}) });
      toast.success('Pool updated'); onClose();
    } catch (err) { toast.error(apiError(err, 'Could not update the pool')); }
  };

  return <div className="fixed inset-0 z-50 bg-stone-900/40 flex items-center justify-center p-4">
    <ModalDialog onClose={onClose} labelledBy="manage-pool-title" className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] overflow-auto">
      <div className="p-5 space-y-4">
        <h2 id="manage-pool-title" className="font-bold text-stone-800">{pool.name}: owner, editors{restricted ? ' and readers' : ''}</h2>
        <label className="block text-xs font-bold text-stone-600">What it holds<textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="mt-1 w-full border border-stone-300 rounded-lg px-3 py-2 text-sm font-normal" /></label>
        {pool.rights.settings && <>
          <label className="block text-xs font-bold text-stone-600">Owner <span className="font-normal text-stone-400">(keeps it current and approves procedures)</span>
            <select value={owner} onChange={e => setOwner(e.target.value)} className="mt-1 w-full border border-stone-300 rounded-lg px-3 py-2 text-sm font-normal bg-white">
              <option value="">No owner</option>{(people.data ?? []).map(p => <option key={p.id} value={p.id}>{p.name}{p.job_title ? ` — ${p.job_title}` : ''}</option>)}
            </select></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={restricted} onChange={e => setRestricted(e.target.checked)} />Restricted: only the owner, editors and chosen readers can see it</label>
        </>}
        <PickList title="Editors" hint="Write and edit articles here." value={editors} onChange={setEditors} options={options} />
        {restricted && <PickList title="Readers" hint="Can read this restricted pool." value={readers} onChange={setReaders} options={options} />}
        {teams.isError && <p className="text-[11px] text-stone-400">Teams could not be listed for you; you can still choose people.</p>}
        <div className="flex justify-end gap-2 pt-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={saveMembers.isPending || savePool.isPending}>Save</Button></div>
      </div>
    </ModalDialog>
  </div>;
}

function PickList({ title, hint, value, onChange, options }: { title: string; hint: string; value: Pick[]; onChange: (v: Pick[]) => void; options: Pick[] }) {
  const [q, setQ] = useState('');
  const chosen = new Set(value.map(v => `${v.kind}:${v.id}`));
  const matches = q.trim() ? options.filter(o => !chosen.has(`${o.kind}:${o.id}`) && o.label.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : [];
  return <div>
    <div className="text-xs font-bold text-stone-600">{title} <span className="font-normal text-stone-400">{hint}</span></div>
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {value.map(v => <span key={`${v.kind}:${v.id}`} className="inline-flex items-center gap-1 text-xs bg-stone-100 rounded-full pl-2.5 pr-1 py-0.5">
        {v.kind === 'team' && <b className="text-[9px] uppercase text-stone-500">Team</b>}{v.label}
        <button type="button" aria-label={`Remove ${v.label}`} onClick={() => onChange(value.filter(x => !(x.kind === v.kind && x.id === v.id)))} className="p-0.5 text-stone-400 hover:text-rose-600"><X className="w-3 h-3" /></button>
      </span>)}
      {!value.length && <span className="text-xs text-stone-400">Nobody yet.</span>}
    </div>
    <div className="relative mt-1.5">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Add a person or team…" aria-label={`Add to ${title}`}
        className="w-full border border-stone-300 rounded-lg px-3 py-1.5 text-sm" />
      {matches.length > 0 && <ul className="absolute z-10 mt-1 w-full bg-white border border-stone-200 rounded-lg shadow-lg max-h-56 overflow-auto">
        {matches.map(o => <li key={`${o.kind}:${o.id}`}><button type="button" onClick={() => { onChange([...value, o]); setQ(''); }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50">
          {o.kind === 'team' && <b className="text-[9px] uppercase text-stone-500 mr-1">Team</b>}{o.label}</button></li>)}
      </ul>}
    </div>
  </div>;
}
