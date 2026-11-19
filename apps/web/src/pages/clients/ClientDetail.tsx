import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Mail, Pencil, Phone, Plus, Star, Trash2, UserMinus, UserPlus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useRecordTitle } from '../../hooks/usePageTitle';
import PageHeader from '../../components/ui/PageHeader';
import ClientFormModal from '../../components/clients/ClientFormModal';
import { useModalFocus } from '../../hooks/useModalFocus';
import {
  apiError, Contact, ContactInput, KIND_LABELS, placeOf, useCanManageClients, useCompany, useContactActions,
} from './clientsApi';

const card = 'bg-white rounded-xl border border-stone-200 shadow-sm';
const h2 = 'text-sm font-extrabold text-stone-800';

/** One company: details, the companies it belongs to or owns, its people, and the work with them. */
export default function ClientDetail() {
  const { id } = useParams();
  const canManage = useCanManageClients();
  const company = useCompany(id);
  const [editing, setEditing] = useState(false);
  const [person, setPerson] = useState<Contact | 'new' | null>(null);
  const [showLeft, setShowLeft] = useState(false);
  const actions = useContactActions(id ?? '');
  useRecordTitle(company.data?.name);

  if (company.isLoading) return <div className="p-6 text-sm text-stone-500">Loading company…</div>;
  if (company.isError || !company.data) return <div role="alert" className="p-6 text-sm text-rose-700">This company could not be loaded.</div>;
  const c = company.data;
  const current = c.contacts.filter(p => !p.left_on);
  const left = c.contacts.filter(p => p.left_on);

  const quick = async (p: Contact, input: ContactInput, message: string) => {
    try { await actions.save.mutateAsync({ contactId: p.id, input }); toast.success(message); }
    catch (err) { toast.error(apiError(err, 'Could not update this person')); }
  };
  const remove = async (p: Contact) => {
    if (!window.confirm(`Remove ${p.name} completely? Use "Left the company" instead to keep them in the history.`)) return;
    try { await actions.remove.mutateAsync(p.id); toast.success(`${p.name} removed`); }
    catch (err) { toast.error(apiError(err, 'Could not remove this person')); }
  };

  return <div>
    <PageHeader title={c.name} code={c.client_code} status={c.active ? 'Active' : 'Inactive'}
      crumbs={[{ label: 'Clients & contacts', href: '/clients' }, { label: c.name }]}
      actions={canManage ? <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-sm font-bold text-stone-800"><Pencil className="w-3.5 h-3.5" /> Edit</button> : undefined} />

    <div className="p-6 max-w-6xl grid lg:grid-cols-3 gap-5">
      <div className="space-y-5">
        <section className={`${card} p-5`} aria-labelledby="company-details">
          <h2 id="company-details" className={h2}>Company</h2>
          <div className="mt-2 flex flex-wrap gap-1">{c.kinds.map(k => <span key={k} className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 text-[10px] uppercase font-extrabold">{KIND_LABELS[k]}</span>)}</div>
          <dl className="mt-4 space-y-2.5 text-sm">
            {([
              ['Legal name', c.legal_name], ['Location', placeOf(c)], ['Address', c.address],
              ['Website', c.website ? <a href={/^https?:\/\//.test(c.website) ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer" className="text-blue-600 underline break-all">{c.website}</a> : null],
              ['Part of', c.parent_client_id ? <Link to={`/clients/${c.parent_client_id}`} className="text-blue-600 font-semibold hover:underline">{c.parent_name}</Link> : null],
            ] as const).filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="text-[11px] uppercase tracking-wide text-stone-400 font-bold">{k}</dt><dd className="text-stone-800">{v}</dd></div>)}
          </dl>
          {c.notes && <p className="mt-4 text-sm text-stone-600 whitespace-pre-line">{c.notes}</p>}
        </section>

        {c.children.length > 0 && <section className={`${card} p-5`} aria-labelledby="company-children">
          <h2 id="company-children" className={h2}>Sites and companies in this group</h2>
          <ul className="mt-3 space-y-2 text-sm">{c.children.map(ch => <li key={ch.id}>
            <Link to={`/clients/${ch.id}`} className="font-semibold text-blue-600 hover:underline">{ch.name}</Link>
            <span className="text-xs text-stone-400"> · {[placeOf(ch), ch.active ? null : 'inactive'].filter(Boolean).join(' · ') || ch.client_code}</span>
          </li>)}</ul>
        </section>}
      </div>

      <div className="lg:col-span-2 space-y-5">
        <section className={card} aria-labelledby="company-people">
          <div className="p-5 pb-3 flex items-center justify-between gap-3">
            <h2 id="company-people" className={h2}>People <span className="font-normal text-stone-400">({current.length})</span></h2>
            {canManage && <button onClick={() => setPerson('new')} className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600"><UserPlus className="w-4 h-4" /> Add person</button>}
          </div>
          {current.length === 0 ? <p className="px-5 pb-5 text-sm text-stone-500">No one recorded yet.</p>
            : <ul className="divide-y divide-stone-100">{current.map(p => <PersonRow key={p.id} p={p} canManage={canManage}
              onEdit={() => setPerson(p)}
              onPrimary={() => quick(p, { is_primary: true }, `${p.name} is now the main contact`)}
              onLeft={() => quick(p, { left: true }, `${p.name} marked as left`)} />)}</ul>}
          {left.length > 0 && <div className="border-t border-stone-100 px-5 py-3">
            <button onClick={() => setShowLeft(s => !s)} className="text-xs font-bold text-stone-500">{showLeft ? 'Hide' : 'Show'} {left.length} who left</button>
            {showLeft && <ul className="mt-2 space-y-2">{left.map(p => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-stone-500">
              <span><span className="line-through">{p.name}</span>{p.job_title && ` · ${p.job_title}`} · left {p.left_on?.slice(0, 10)}</span>
              {canManage && <span className="flex gap-3">
                <button onClick={() => quick(p, { left: false }, `${p.name} is back`)} className="text-xs font-bold text-blue-600">Mark as back</button>
                <button onClick={() => remove(p)} aria-label={`Remove ${p.name}`} className="text-stone-400 hover:text-rose-700"><Trash2 className="w-3.5 h-3.5" /></button>
              </span>}
            </li>)}</ul>}
          </div>}
        </section>

        <section className={`${card} p-5`} aria-labelledby="company-enquiries">
          <h2 id="company-enquiries" className={h2}>Enquiries <span className="font-normal text-stone-400">({c.enquiries.length})</span></h2>
          {c.enquiries.length === 0 ? <p className="mt-2 text-sm text-stone-500">No enquiries yet.</p>
            : <ul className="mt-3 divide-y divide-stone-100 text-sm">{c.enquiries.map(e => <li key={e.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <Link to={`/enquiries/${e.id}`} className="font-semibold hover:text-blue-600"><span className="font-mono text-xs text-stone-500 mr-2">{e.enquiry_number}</span>{e.title}</Link>
              <span className="text-xs text-stone-500">{[e.project_code, e.status.replace(/_/g, ' ')].filter(Boolean).join(' · ')}</span>
            </li>)}</ul>}
        </section>

        <section className={`${card} p-5`} aria-labelledby="company-projects">
          <h2 id="company-projects" className={h2}>Projects <span className="font-normal text-stone-400">({c.projects.length})</span></h2>
          {c.projects.length === 0 ? <p className="mt-2 text-sm text-stone-500">No projects yet.</p>
            : <ul className="mt-3 divide-y divide-stone-100 text-sm">{c.projects.map(p => <li key={p.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <Link to={`/projects/${p.id}`} className="font-semibold hover:text-blue-600"><span className="font-mono text-xs text-stone-500 mr-2">{p.project_code}</span>{p.project_name}</Link>
              <span className="text-xs text-stone-500">{[placeOf(p), p.project_manager, p.project_status].filter(Boolean).join(' · ')}</span>
            </li>)}</ul>}
        </section>

        {c.involvements.length > 0 && <section className={`${card} p-5`} aria-labelledby="company-involvements">
          <h2 id="company-involvements" className={h2}>Involved in other work <span className="font-normal text-stone-400">({c.involvements.length})</span></h2>
          <ul className="mt-3 divide-y divide-stone-100 text-sm">{c.involvements.map(i => <li key={i.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
            <Link to={`/projects/${i.project_id}`} className="font-semibold hover:text-blue-600"><span className="font-mono text-xs text-stone-500 mr-2">{i.project_code}</span>{i.project_name}</Link>
            <span className="text-xs text-stone-500">{i.contact_name ? `${i.contact_name}: ` : ''}{i.role}{i.client_name ? ` · for ${i.client_name}` : ''}</span>
          </li>)}</ul>
        </section>}

        {c.design_books.length > 0 && <section className={`${card} p-5`} aria-labelledby="company-books">
          <h2 id="company-books" className={h2}>Design books <span className="font-normal text-stone-400">({c.design_books.length})</span></h2>
          <ul className="mt-3 divide-y divide-stone-100 text-sm">{c.design_books.map(b => <li key={b.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
            <Link to={`/design-books/${b.id}`} className="font-semibold hover:text-blue-600"><span className="font-mono text-xs text-stone-500 mr-2">{b.book_code}</span>{b.book_title}</Link>
            <span className="text-xs text-stone-500">{[b.project_code, b.revision ? `rev ${b.revision}` : null, b.status].filter(Boolean).join(' · ')}</span>
          </li>)}</ul>
        </section>}
      </div>
    </div>

    {editing && <ClientFormModal company={c} onClose={() => setEditing(false)} />}
    {person && <PersonModal clientId={c.id} person={person === 'new' ? null : person} onClose={() => setPerson(null)} />}
  </div>;
}

function PersonRow({ p, canManage, onEdit, onPrimary, onLeft }: { p: Contact; canManage: boolean; onEdit: () => void; onPrimary: () => void; onLeft: () => void }) {
  return <li className="px-5 py-3 flex flex-wrap items-start justify-between gap-3">
    <div className="min-w-0">
      <div className="font-semibold text-stone-800">{p.name}{p.is_primary && <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] uppercase font-extrabold">Main contact</span>}</div>
      {p.job_title && <div className="text-xs text-stone-500">{p.job_title}</div>}
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
        {p.email && <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 hover:text-blue-600"><Mail className="w-3.5 h-3.5" />{p.email}</a>}
        {p.phone && <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 hover:text-blue-600"><Phone className="w-3.5 h-3.5" />{p.phone}</a>}
        {p.mobile && <a href={`tel:${p.mobile}`} className="inline-flex items-center gap-1 hover:text-blue-600"><Phone className="w-3.5 h-3.5" />{p.mobile} <span className="text-stone-400">mobile</span></a>}
      </div>
      {p.notes && <p className="mt-1 text-xs text-stone-500 whitespace-pre-line">{p.notes}</p>}
    </div>
    {canManage && <div className="flex items-center gap-3 text-xs font-bold">
      {!p.is_primary && <button onClick={onPrimary} className="inline-flex items-center gap-1 text-stone-500 hover:text-blue-600"><Star className="w-3.5 h-3.5" /> Make main</button>}
      <button onClick={onLeft} className="inline-flex items-center gap-1 text-stone-500 hover:text-blue-600"><UserMinus className="w-3.5 h-3.5" /> Left the company</button>
      <button onClick={onEdit} aria-label={`Edit ${p.name}`} className="text-stone-500 hover:text-blue-600"><Pencil className="w-3.5 h-3.5" /></button>
    </div>}
  </li>;
}

function PersonModal({ clientId, person, onClose }: { clientId: string; person: Contact | null; onClose: () => void }) {
  const modalRef = useModalFocus<HTMLDivElement>({ onClose });
  const { save } = useContactActions(clientId);
  const [form, setForm] = useState({
    name: person?.name ?? '', job_title: person?.job_title ?? '', email: person?.email ?? '',
    phone: person?.phone ?? '', mobile: person?.mobile ?? '', notes: person?.notes ?? '',
  });
  const field = (key: keyof typeof form, label: string, type = 'text') => <label className="text-xs font-bold text-stone-600">{label}
    <input type={type} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} className="mt-1.5 w-full border border-stone-200 rounded-lg px-3 py-2 text-sm font-normal" />
  </label>;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Name is required');
    if (!form.email.trim() && !form.phone.trim() && !form.mobile.trim()) return toast.error('Add an email, phone or mobile number');
    try {
      await save.mutateAsync({ contactId: person?.id, input: form });
      toast.success(person ? 'Saved' : `${form.name.trim()} added`);
      onClose();
    } catch (err) { toast.error(apiError(err, 'Could not save this person')); }
  };
  return <div className="fixed inset-0 z-50 bg-stone-800/40 p-4 flex items-center justify-center">
    <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="person-title" tabIndex={-1} className="bg-white w-full max-w-lg rounded-2xl shadow-2xl">
      <form onSubmit={submit}>
        <div className="p-5 border-b border-stone-100 flex justify-between"><h2 id="person-title" className="font-extrabold">{person ? `Edit ${person.name}` : 'Add a person'}</h2>
          <button type="button" onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-stone-400" /></button></div>
        <div className="p-5 grid sm:grid-cols-2 gap-4">
          {field('name', 'Name')}{field('job_title', 'Job title')}
          <div className="sm:col-span-2">{field('email', 'Email', 'email')}</div>
          {field('phone', 'Phone', 'tel')}{field('mobile', 'Mobile', 'tel')}
          <label className="sm:col-span-2 text-xs font-bold text-stone-600">Notes<textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="mt-1.5 w-full border border-stone-200 rounded-lg px-3 py-2 text-sm font-normal" /></label>
          <p className="sm:col-span-2 text-xs text-stone-400">An email, phone or mobile number is needed.</p>
        </div>
        <div className="p-5 bg-stone-50 flex justify-end gap-2 rounded-b-2xl">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm">Cancel</button>
          <button disabled={save.isPending} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-bold disabled:opacity-60">{!person && <Plus className="w-4 h-4" />}{save.isPending ? 'Saving…' : person ? 'Save' : 'Add person'}</button>
        </div>
      </form>
    </div>
  </div>;
}
