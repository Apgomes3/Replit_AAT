import { useMemo, useState } from 'react';
import { Pencil, Plus, Search, UsersRound } from 'lucide-react';
import toast from 'react-hot-toast';
import DraftingModal, { fieldInput, fieldLabel } from './DraftingModal';
import { apiErrorMessage, initials, Person, Team, TeamPayload, useCanManageDrafting, usePeople, useSaveTeam, useTeams } from './draftingApi';

type FormState = TeamPayload & { id?: string };

const emptyForm = (): FormState => ({ name: '', description: '', manager_user_id: null, member_ids: [], active: true });

export function Avatar({ person, size = 'sm' }: { person: Pick<Person, 'name'>; size?: 'sm' | 'md' }) {
  const cls = size === 'md' ? 'w-9 h-9 text-xs' : 'w-7 h-7 text-[10px]';
  return <span title={person.name} className={`${cls} inline-flex items-center justify-center rounded-full bg-[#e4f2ee] text-[#087f73] font-extrabold ring-2 ring-white`}>{initials(person.name)}</span>;
}

export default function TeamsPanel() {
  const canManage = useCanManageDrafting();
  const teams = useTeams();
  const [form, setForm] = useState<FormState | null>(null);

  const openEdit = (team: Team) => setForm({
    id: team.id,
    name: team.name,
    description: team.description ?? '',
    manager_user_id: team.manager?.id ?? null,
    member_ids: team.members.map(m => m.id),
    active: team.active,
  });

  if (teams.isError) return <div className="p-8 text-sm text-rose-700">Teams could not be loaded. <button className="underline font-bold" onClick={() => teams.refetch()}>Try again</button></div>;

  return <div>
    <div className="flex items-center justify-between mb-4">
      <p className="text-sm text-[#6f8082]">Each team has a manager and the drafters whose work they oversee.</p>
      {canManage && <button onClick={() => setForm(emptyForm())} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#087f73] text-white text-sm font-bold"><Plus className="w-4 h-4" /> New team</button>}
    </div>

    {teams.isLoading ? <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{[1, 2, 3].map(i => <div key={i} className="h-40 skeleton rounded-xl" />)}</div>
      : !teams.data?.length ? <div className="bg-white rounded-xl border border-dashed border-[#c9d9d2] p-16 text-center">
        <UsersRound className="mx-auto w-9 h-9 text-[#b8d9d0] mb-3" />
        <p className="font-bold">No drafting teams yet</p>
        <p className="text-sm text-[#6f8082] mt-1">Create a team, choose its manager and add the drafters.</p>
      </div>
      : <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {teams.data.map(team => <article key={team.id} className={`bg-white rounded-xl border border-[#dce7e2] p-5 shadow-sm ${team.active ? '' : 'opacity-60'}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-extrabold truncate">{team.name}</h3>
              {team.description && <p className="text-xs text-[#6f8082] mt-1 line-clamp-2">{team.description}</p>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {!team.active && <span className="px-2 py-1 rounded-md text-[10px] uppercase font-extrabold bg-stone-100 text-stone-500">Inactive</span>}
              {canManage && <button onClick={() => openEdit(team)} className="p-2 text-[#80908f] hover:text-[#087f73]" aria-label={`Edit ${team.name}`}><Pencil className="w-4 h-4" /></button>}
            </div>
          </div>
          <div className="mt-4 text-[10px] uppercase tracking-[.13em] text-[#6f8082] font-extrabold">Manager</div>
          <div className="mt-1.5 flex items-center gap-2 text-sm">{team.manager ? <><Avatar person={team.manager} /> <span className="font-semibold">{team.manager.name}</span></> : <span className="text-[#8a9b9a]">Not assigned</span>}</div>
          <div className="mt-4 text-[10px] uppercase tracking-[.13em] text-[#6f8082] font-extrabold">Team · {team.members.length} {team.members.length === 1 ? 'person' : 'people'}</div>
          <div className="mt-1.5 flex -space-x-1.5 flex-wrap">{team.members.length ? team.members.map(m => <Avatar key={m.id} person={m} />) : <span className="text-sm text-[#8a9b9a]">No members yet</span>}</div>
          <div className="mt-4 pt-3 border-t border-[#edf2ef] text-xs text-[#53686b]"><b>{team.plan_count}</b> open {team.plan_count === 1 ? 'plan' : 'plans'}</div>
        </article>)}
      </div>}

    {form && canManage && <TeamForm form={form} setForm={setForm} onClose={() => setForm(null)} />}
  </div>;
}

function TeamForm({ form, setForm, onClose }: { form: FormState; setForm: (f: FormState) => void; onClose: () => void }) {
  const people = usePeople();
  const save = useSaveTeam();
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
    const { id, ...body } = form;
    try {
      await save.mutateAsync({ id, body: { ...body, name: body.name.trim(), description: body.description?.trim() || null } });
      toast.success(id ? 'Team updated' : 'Team created');
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not save team'));
    }
  };

  return <DraftingModal title={form.id ? 'Edit team' : 'New drafting team'} subtitle="The manager sees all plans and work assigned to this team."
    saving={save.isPending} submitLabel={form.id ? 'Save team' : 'Create team'} onClose={onClose} onSubmit={submit}>
    <label className={fieldLabel}>Team name<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Fabrication Drawing Team" className={fieldInput} /></label>
    <label className={fieldLabel}>Manager<select value={form.manager_user_id ?? ''} onChange={e => setForm({ ...form, manager_user_id: e.target.value || null })} className={fieldInput}>
      <option value="">Not assigned</option>
      {(people.data ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></label>
    <label className={`sm:col-span-2 ${fieldLabel}`}>Description<textarea value={form.description ?? ''} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} className={fieldInput} /></label>
    {form.id && <label className={`${fieldLabel} flex items-center gap-2`}><input type="checkbox" checked={form.active !== false} onChange={e => setForm({ ...form, active: e.target.checked })} /> Team is active</label>}

    <fieldset className="sm:col-span-2 border-t border-[#edf2ef] pt-4">
      <legend className="sr-only">Team members</legend>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div><h3 className="font-extrabold text-sm">Members</h3><p className="text-xs text-[#6f8082]">{form.member_ids.length} selected. Drafters need a Shark OS user account (Admin › Users).</p></div>
        <div className="relative w-48"><Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-[#8da09d]" /><input aria-label="Filter people" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter people…" className="w-full pl-8 pr-2 py-1.5 border border-[#dce7e2] rounded-lg text-xs" /></div>
      </div>
      <div className="max-h-56 overflow-auto rounded-lg border border-[#dce7e2] divide-y divide-[#edf2ef]">
        {people.isLoading ? <div className="p-3 text-xs text-[#6f8082]">Loading people…</div>
          : candidates.length === 0 ? <div className="p-3 text-xs text-[#6f8082]">No matching people.</div>
          : candidates.map(p => <label key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-[#f4faf7] cursor-pointer">
            <input type="checkbox" aria-label={`${p.name} (${p.email})`} checked={form.member_ids.includes(p.id)} onChange={() => toggleMember(p.id)} />
            <Avatar person={p} />
            <span className="font-semibold">{p.name}</span>
            <span className="text-xs text-[#8a9b9a] truncate">{p.email}</span>
          </label>)}
      </div>
    </fieldset>
  </DraftingModal>;
}
