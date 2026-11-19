import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Mail, Phone, Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import ClientPicker from './ClientPicker';
import ClientPersonSelect from './ClientPersonSelect';
import {
  apiError, ProjectParty, useCanManageProjectParties, useCompany, useProjectParties, useProjectPartyActions,
} from '../../pages/clients/clientsApi';

interface Props { projectId: string; clientId?: string | null; clientName?: string | null }

/** The client and every other company and person on a project, each with their role. */
export default function ProjectPartiesPanel({ projectId, clientId, clientName }: Props) {
  const canManage = useCanManageProjectParties();
  const parties = useProjectParties(projectId);
  const { add, remove } = useProjectPartyActions(projectId);
  const mainClient = useCompany(clientId ?? undefined);
  const mainContact = mainClient.data?.contacts.find(p => p.is_primary && !p.left_on);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ client_id: '', client_name: '', contact_id: '', role: '' });
  const listId = useId();
  const rows = parties.data?.data ?? [];
  const byCompany = rows.reduce<Record<string, { name: string; id: string; rows: ProjectParty[] }>>((acc, p) => {
    (acc[p.client_id] ??= { name: p.client_name, id: p.client_id, rows: [] }).rows.push(p);
    return acc;
  }, {});
  const roleOptions = form.contact_id ? parties.data?.person_roles ?? [] : parties.data?.company_roles ?? [];

  const startAdding = () => {
    setForm({ client_id: clientId ?? '', client_name: clientName ?? '', contact_id: '', role: '' });
    setAdding(true);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.client_id) return toast.error('Choose a company');
    if (!form.role.trim()) return toast.error('Choose or type a role');
    try {
      await add.mutateAsync({ client_id: form.client_id, contact_id: form.contact_id || null, role: form.role.trim() });
      toast.success('Added');
      setForm(f => ({ ...f, contact_id: '', role: '' }));
    } catch (err) { toast.error(apiError(err, 'Could not add')); }
  };
  const drop = async (p: ProjectParty) => {
    try { await remove.mutateAsync(p.id); toast.success(`${p.contact_name ?? p.client_name} removed`); }
    catch (err) { toast.error(apiError(err, 'Could not remove')); }
  };

  return <section className="bg-white border border-slate-200 rounded-lg mt-3" aria-labelledby="project-parties-title">
    <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-slate-100">
      <h2 id="project-parties-title" className="text-xs font-medium text-slate-400 uppercase tracking-wide">People &amp; companies</h2>
      {canManage && !adding && <button onClick={startAdding} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600"><Plus className="w-3.5 h-3.5" /> Add</button>}
    </div>

    <div className="px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[11px] uppercase tracking-wide text-slate-400 w-28 shrink-0">Client</span>
        {clientId ? <Link to={`/clients/${clientId}`} className="font-semibold text-teal-700 hover:underline inline-flex items-center gap-1"><Building2 className="w-3.5 h-3.5" />{clientName}</Link>
          : <span className="text-slate-400">{clientName ? `${clientName} (not in the directory)` : 'Not set — choose it in Edit'}</span>}
        {mainContact && <span className="text-xs text-slate-500">main contact {mainContact.name}{mainContact.job_title ? `, ${mainContact.job_title}` : ''}</span>}
      </div>

      {Object.values(byCompany).map(group => <div key={group.id} className="mt-3 pt-3 border-t border-slate-100">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/clients/${group.id}`} className="font-semibold text-teal-700 hover:underline inline-flex items-center gap-1"><Building2 className="w-3.5 h-3.5" />{group.name}</Link>
          {group.rows.filter(p => !p.contact_id).map(p => <span key={p.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-xs text-slate-600">
            {p.role}{canManage && <button onClick={() => drop(p)} aria-label={`Remove ${group.name} as ${p.role}`} className="text-slate-400 hover:text-rose-600"><X className="w-3 h-3" /></button>}
          </span>)}
        </div>
        <ul className="mt-1.5 space-y-1.5">
          {group.rows.filter(p => p.contact_id).map(p => <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-5">
            <span className={`font-medium ${p.left_on ? 'line-through text-slate-400' : 'text-slate-800'}`}>{p.contact_name}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-teal-50 text-teal-700">{p.role}</span>
            {p.job_title && <span className="text-xs text-slate-500">{p.job_title}</span>}
            {p.email && <a href={`mailto:${p.email}`} className="text-xs text-slate-500 hover:text-teal-700 inline-flex items-center gap-1"><Mail className="w-3 h-3" />{p.email}</a>}
            {p.phone && <a href={`tel:${p.phone}`} className="text-xs text-slate-500 hover:text-teal-700 inline-flex items-center gap-1"><Phone className="w-3 h-3" />{p.phone}</a>}
            {p.left_on && <span className="text-xs text-slate-400">left the company</span>}
            {canManage && <button onClick={() => drop(p)} aria-label={`Remove ${p.contact_name} as ${p.role}`} className="text-slate-300 hover:text-rose-600 ml-auto"><X className="w-3.5 h-3.5" /></button>}
          </li>)}
        </ul>
      </div>)}

      {!parties.isLoading && rows.length === 0 && !adding && <p className="mt-3 text-xs text-slate-400">No one else recorded yet: add the client's people, consultants, contractors…</p>}

      {adding && <form onSubmit={submit} className="mt-3 pt-3 border-t border-slate-100 grid sm:grid-cols-2 gap-3">
        <div className="text-xs font-bold text-stone-600">Company
          <ClientPicker className="mt-1.5" value={form.client_id || null} valueLabel={form.client_name || null} placeholder="Search or add a company…"
            onChange={c => setForm(f => ({ ...f, client_id: c?.id ?? '', client_name: c?.name ?? '', contact_id: '' }))} />
        </div>
        {form.client_id ? <ClientPersonSelect clientId={form.client_id} value={form.contact_id} label="Person" emptyLabel="The company as a whole"
          onChange={p => setForm(f => ({ ...f, contact_id: p?.id ?? '' }))} /> : <div />}
        <label className="text-xs font-bold text-stone-600">Role
          <input list={listId} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
            placeholder={form.contact_id ? 'e.g. Client project manager' : 'e.g. Consultant'} className="mt-1.5 w-full border border-stone-200 rounded-lg px-3 py-2 text-sm font-normal" />
          <datalist id={listId}>{roleOptions.map(r => <option key={r} value={r} />)}</datalist>
        </label>
        <div className="flex items-end justify-end gap-2">
          <button type="button" onClick={() => setAdding(false)} className="px-3 py-2 text-sm">Done</button>
          <button disabled={add.isPending} className="px-3 py-2 rounded-lg bg-teal-700 text-white text-sm font-bold disabled:opacity-60">{add.isPending ? 'Adding…' : 'Add to project'}</button>
        </div>
        <p className="sm:col-span-2 text-[11px] text-slate-400">New people are added on the company's page (Clients &amp; contacts), then chosen here.</p>
      </form>}
    </div>
  </section>;
}
