import { useMemo, useState } from 'react';
import { Pencil, Plus, Search, UsersRound } from 'lucide-react';
import toast from 'react-hot-toast';
import DraftingModal, { fieldInput, fieldLabel } from './DraftingModal';
import { apiErrorMessage, initials, Person, Team, TeamPayload, usePeople } from './draftingApi';
import { departmentLabels, useDepartmentOptions } from '../../lib/departments';
import { byDepartment, useCanManagePlanning, usePlanningScope, useSaveScopedTeam, useScopedTeams } from './planningApi';

type FormState = TeamPayload & { id?: string };

const emptyForm = (department?: string): FormState => ({
  name: '', description: '', manager_user_id: null, member_ids: [], active: true, ...(department !== undefined ? { department } : {}),
});

export function Avatar({ person, size = 'sm' }: { person: Pick<Person, 'name'>; size?: 'sm' | 'md' }) {
  const cls = size === 'md' ? 'w-9 h-9 text-xs' : 'w-7 h-7 text-[10px]';
  return <span title={person.name} className={`${cls} inline-flex items-center justify-center rounded-full bg-blue-50 text-blue-600 font-extrabold ring-2 ring-white`}>{initials(person.name)}</span>;
}

export default function TeamsPanel() {
  const company = usePlanningScope() === 'company';
  const canManage = useCanManagePlanning();
  const teams = useScopedTeams();
  const [form, setForm] = useState<FormState | null>(null);

  const openEdit = (team: Team) => setForm({
    id: team.id,
    name: team.name,
    description: team.description ?? '',
    manager_user_id: team.manager?.id ?? null,
    member_ids: team.members.map(m => m.id),
    active: team.active,
    ...(company ? { department: team.department } : {}),
  });

  if (teams.isError) return <div className="p-8 text-sm text-rose-700">Teams could not be loaded. <button className="underline font-bold" onClick={() => teams.refetch()}>Try again</button></div>;

  const groups = company ? byDepartment(teams.data ?? []) : [{ department: '', teams: teams.data ?? [] }];

  return <div>
    <div className="flex items-center justify-between mb-4">
      <p className="text-sm text-stone-500">{company
        ? 'Every team in the company, by department. A person can be in more than one team. Drafting teams are also managed from the Drafting screen.'
        : 'Each team has a manager and the drafters whose work they oversee.'}</p>
      {canManage && <button onClick={() => setForm(emptyForm(company ? '' : undefined))} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-bold shrink-0"><Plus className="w-4 h-4" /> New team</button>}
    </div>

    {teams.isLoading ? <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{[1, 2, 3].map(i => <div key={i} className="h-40 skeleton rounded-xl" />)}</div>
      : !teams.data?.length ? <div className="bg-white rounded-xl border border-dashed border-[#c9d9d2] p-16 text-center">
        <UsersRound className="mx-auto w-9 h-9 text-stone-300 mb-3" />
        <p className="font-bold">{company ? 'No teams yet' : 'No drafting teams yet'}</p>
        <p className="text-sm text-stone-500 mt-1">{company ? 'Create a team, put it in a department, choose its manager and add its people.' : 'Create a team, choose its manager and add the drafters.'}</p>
      </div>
      : groups.map(g => <section key={g.department || 'all'} className="mb-6">
        {company && <h2 className="text-[11px] font-extrabold uppercase tracking-[.14em] text-stone-500 mb-2">{g.department} · {g.teams.length} {g.teams.length === 1 ? 'team' : 'teams'}</h2>}
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {g.teams.map(team => <article key={team.id} className={`bg-white rounded-xl border border-stone-200 p-5 shadow-sm ${team.active ? '' : 'opacity-60'}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-extrabold truncate">{team.name}</h3>
              {team.description && <p className="text-xs text-stone-500 mt-1 line-clamp-2">{team.description}</p>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {!team.active && <span className="px-2 py-1 rounded-md text-[10px] uppercase font-extrabold bg-stone-100 text-stone-500">Inactive</span>}
              {canManage && <button onClick={() => openEdit(team)} className="p-2 text-stone-400 hover:text-blue-600" aria-label={`Edit ${team.name}`}><Pencil className="w-4 h-4" /></button>}
            </div>
          </div>
          <div className="mt-4 text-xs font-semibold text-stone-500 uppercase tracking-wide">Manager</div>
          <div className="mt-1.5 flex items-center gap-2 text-sm">{team.manager ? <><Avatar person={team.manager} /> <span className="font-semibold">{team.manager.name}</span></> : <span className="text-stone-400">Not assigned</span>}</div>
          <div className="mt-4 text-xs font-semibold text-stone-500 uppercase tracking-wide">Team · {team.members.length} {team.members.length === 1 ? 'person' : 'people'}</div>
          <div className="mt-1.5 flex -space-x-1.5 flex-wrap">{team.members.length ? team.members.map(m => <Avatar key={m.id} person={m} />) : <span className="text-sm text-stone-400">No members yet</span>}</div>
          <div className="mt-4 pt-3 border-t border-stone-100 text-xs text-stone-600"><b>{team.plan_count}</b> open {team.plan_count === 1 ? 'plan' : 'plans'}</div>
        </article>)}
        </div>
      </section>)}

    {form && canManage && <TeamForm form={form} setForm={setForm} onClose={() => setForm(null)} />}
  </div>;
}

function TeamForm({ form, setForm, onClose }: { form: FormState; setForm: (f: FormState) => void; onClose: () => void }) {
  const company = usePlanningScope() === 'company';
  const people = usePeople();
  const save = useSaveScopedTeam();
  const departmentList = departmentLabels(useDepartmentOptions(company).data ?? []);
  // Active departments, plus the team's current one if it has since been archived.
  const departmentOptions = departmentList.filter(d => d.is_active || d.name === form.department);
  const [filter, setFilter] = useState('');

  const candidates = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return (people.data ?? []).filter(p => !term || p.name.toLowerCase().includes(term) || p.email.toLowerCase().includes(term));
  }, [people.data, filter]);

  const toggleMember = (id: string) => setForm({
    ...form,
    member_ids: form.member_ids.includes(id) ? form.member_ids.filter(m => m !== id) : [...form.member_ids, id],
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Team name is required');
    if (company && !form.department?.trim()) return toast.error('Choose a department');
    const { id, ...body } = form;
    try {
      await save.mutateAsync({ id, body: {
        ...body, name: body.name.trim(), description: body.description?.trim() || null,
        ...(company ? { department: body.department!.trim() } : {}),
      } });
      toast.success(id ? 'Team updated' : 'Team created');
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not save team'));
    }
  };

  return <DraftingModal title={form.id ? 'Edit team' : company ? 'New team' : 'New drafting team'} subtitle="The manager sees all plans and work assigned to this team."
    saving={save.isPending} submitLabel={form.id ? 'Save team' : 'Create team'} onClose={onClose} onSubmit={submit}>
    <label className={fieldLabel}>Team name<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={company ? 'e.g. ASW Engineering' : 'e.g. Fabrication Drawing Team'} className={fieldInput} /></label>
    {company && <label className={fieldLabel}>Department<select required value={form.department ?? ''} onChange={e => setForm({ ...form, department: e.target.value })} className={fieldInput}>
        <option value="">Choose…</option>
        {departmentOptions.map(d => <option key={d.id} value={d.name}>{d.label}{d.is_active ? '' : ' (archived)'}</option>)}
      </select>
      <span className="block text-[11px] font-normal text-stone-400 mt-1">Departments are managed in Admin › Departments.</span>
      {form.id && form.department?.trim().toLowerCase() !== 'drafting' && <span className="block text-[11px] font-normal text-stone-400 mt-1">Only teams in Drafting show on the Drafting screen.</span>}
    </label>}
    <label className={fieldLabel}>Manager<select value={form.manager_user_id ?? ''} onChange={e => setForm({ ...form, manager_user_id: e.target.value || null })} className={fieldInput}>
      <option value="">Not assigned</option>
      {(people.data ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></label>
    <label className={`sm:col-span-2 ${fieldLabel}`}>Description<textarea value={form.description ?? ''} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} className={fieldInput} /></label>
    {form.id && <label className={`${fieldLabel} flex items-center gap-2`}><input type="checkbox" checked={form.active !== false} onChange={e => setForm({ ...form, active: e.target.checked })} /> Team is active</label>}

    <fieldset className="sm:col-span-2 border-t border-stone-100 pt-4">
      <legend className="sr-only">Team members</legend>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div><h3 className="font-extrabold text-sm">Members</h3><p className="text-xs text-stone-500">{form.member_ids.length} selected. Drafters need a Shark OS user account (Admin › Users).</p></div>
        <div className="relative w-48"><Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-stone-400" /><input aria-label="Filter people" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter people…" className="w-full pl-8 pr-2 py-1.5 border border-stone-200 rounded-lg text-xs" /></div>
      </div>
      <div className="max-h-56 overflow-auto rounded-lg border border-stone-200 divide-y divide-stone-100">
        {people.isLoading ? <div className="p-3 text-xs text-stone-500">Loading people…</div>
          : candidates.length === 0 ? <div className="p-3 text-xs text-stone-500">No matching people.</div>
          : candidates.map(p => <label key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-stone-50 cursor-pointer">
            <input type="checkbox" aria-label={`${p.name} (${p.email})`} checked={form.member_ids.includes(p.id)} onChange={() => toggleMember(p.id)} />
            <Avatar person={p} />
            <span className="font-semibold">{p.name}</span>
            <span className="text-xs text-stone-400 truncate">{p.email}</span>
          </label>)}
      </div>
    </fieldset>
  </DraftingModal>;
}
