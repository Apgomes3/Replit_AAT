import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarRange, FolderOpen, Pencil, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import DraftingModal, { fieldInput, fieldLabel } from './DraftingModal';
import {
  apiErrorMessage, Plan, PlanPayload, PLAN_STATUSES, PLAN_STATUS_LABELS, PlanStatus,
  useCanManageDrafting, usePlans, useProjectOptions, useSavePlan, useTeams,
} from './draftingApi';

type FormState = PlanPayload & { id?: string; plan_code?: string };

const STATUS_STYLE: Record<PlanStatus, string> = {
  planning: 'bg-sky-50 text-sky-700',
  active: 'bg-[#e4f2ee] text-[#087f73]',
  on_hold: 'bg-amber-50 text-amber-700',
  completed: 'bg-indigo-50 text-indigo-700',
  archived: 'bg-stone-100 text-stone-500',
};

const formatDate = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export function StatusBadge({ status }: { status: PlanStatus }) {
  return <span className={`px-2 py-1 rounded-md text-[10px] uppercase font-extrabold whitespace-nowrap ${STATUS_STYLE[status]}`}>{PLAN_STATUS_LABELS[status]}</span>;
}

export default function PlansPanel({ onGoToTeams }: { onGoToTeams: () => void }) {
  const canManage = useCanManageDrafting();
  const plans = usePlans();
  const teams = useTeams();
  const [projectFilter, setProjectFilter] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'open' | 'all' | PlanStatus>('open');
  const [form, setForm] = useState<FormState | null>(null);

  const activeTeams = (teams.data ?? []).filter(t => t.active);

  const filtered = useMemo(() => (plans.data ?? []).filter(p =>
    (!projectFilter || p.project.id === projectFilter)
    && (!teamFilter || p.team.id === teamFilter)
    && (statusFilter === 'all' || (statusFilter === 'open' ? p.status !== 'archived' && p.status !== 'completed' : p.status === statusFilter)),
  ), [plans.data, projectFilter, teamFilter, statusFilter]);

  // Group by project, like the project rows in Planner.
  const groups = useMemo(() => {
    const map = new Map<string, { project: Plan['project']; plans: Plan[] }>();
    for (const plan of filtered) {
      const g = map.get(plan.project.id) ?? { project: plan.project, plans: [] };
      g.plans.push(plan);
      map.set(plan.project.id, g);
    }
    return [...map.values()];
  }, [filtered]);

  const projectsInUse = useMemo(() => {
    const map = new Map<string, Plan['project']>();
    (plans.data ?? []).forEach(p => map.set(p.project.id, p.project));
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [plans.data]);

  const openNew = () => setForm({
    name: '', project_id: projectFilter, team_id: teamFilter || (activeTeams.length === 1 ? activeTeams[0]!.id : ''),
    status: 'active', start_date: null, target_date: null, description: '',
  });
  const openEdit = (p: Plan) => setForm({
    id: p.id, plan_code: p.plan_code, name: p.name, project_id: p.project.id, team_id: p.team.id,
    status: p.status, start_date: p.start_date, target_date: p.target_date, description: p.description ?? '',
  });

  if (plans.isError) return <div className="p-8 text-sm text-rose-700">Plans could not be loaded. <button className="underline font-bold" onClick={() => plans.refetch()}>Try again</button></div>;

  const noTeams = teams.isSuccess && activeTeams.length === 0;

  return <div>
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div className="flex flex-wrap gap-2">
        <select aria-label="Filter by project" value={projectFilter} onChange={e => setProjectFilter(e.target.value)} className="border border-[#dce7e2] rounded-lg px-3 py-2 text-sm bg-white">
          <option value="">All projects</option>
          {projectsInUse.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
        </select>
        <select aria-label="Filter by team" value={teamFilter} onChange={e => setTeamFilter(e.target.value)} className="border border-[#dce7e2] rounded-lg px-3 py-2 text-sm bg-white">
          <option value="">All teams</option>
          {(teams.data ?? []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select aria-label="Filter by status" value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="border border-[#dce7e2] rounded-lg px-3 py-2 text-sm bg-white">
          <option value="open">Open plans</option>
          <option value="all">All statuses</option>
          {PLAN_STATUSES.map(s => <option key={s} value={s}>{PLAN_STATUS_LABELS[s]}</option>)}
        </select>
      </div>
      {canManage && <button onClick={openNew} disabled={noTeams} title={noTeams ? 'Create a team first' : undefined}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#087f73] text-white text-sm font-bold disabled:opacity-50"><Plus className="w-4 h-4" /> New plan</button>}
    </div>

    {plans.isLoading ? <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-14 skeleton rounded-xl" />)}</div>
      : noTeams && !plans.data?.length ? <div className="bg-white rounded-xl border border-dashed border-[#c9d9d2] p-16 text-center">
        <CalendarRange className="mx-auto w-9 h-9 text-[#b8d9d0] mb-3" />
        <p className="font-bold">Start by creating a drafting team</p>
        <p className="text-sm text-[#6f8082] mt-1">Every plan belongs to a team and a project.</p>
        {canManage && <button onClick={onGoToTeams} className="mt-4 text-sm font-bold text-[#087f73] underline">Go to Teams</button>}
      </div>
      : groups.length === 0 ? <div className="bg-white rounded-xl border border-dashed border-[#c9d9d2] p-16 text-center">
        <CalendarRange className="mx-auto w-9 h-9 text-[#b8d9d0] mb-3" />
        <p className="font-bold">{plans.data?.length ? 'No plans match these filters' : 'No drafting plans yet'}</p>
        {!plans.data?.length && <p className="text-sm text-[#6f8082] mt-1">Create a plan for a project and assign it to a team.</p>}
      </div>
      : <div className="space-y-4">{groups.map(group => <section key={group.project.id} className="bg-white rounded-xl border border-[#dce7e2] overflow-hidden shadow-sm">
        <header className="px-5 py-3 bg-[#f2f7f4] border-b border-[#dce7e2] flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-[#087f73]" />
          <span className="font-mono text-xs text-[#6f8082]">{group.project.code}</span>
          <h3 className="font-extrabold text-sm">{group.project.name}</h3>
          <span className="ml-auto text-xs text-[#6f8082]">{group.plans.length} {group.plans.length === 1 ? 'plan' : 'plans'}</span>
        </header>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[#edf2ef]">{['Plan', 'Team', 'Status', 'Progress', 'Start', 'Target', ''].map(h => <th key={h} className="text-left px-5 py-2 text-[10px] uppercase tracking-[.13em] text-[#6f8082] font-extrabold">{h}</th>)}</tr></thead>
          <tbody>{group.plans.map(p => <tr key={p.id} className="border-b border-[#edf2ef] last:border-0 hover:bg-[#f4faf7]">
            <td className="px-5 py-3"><Link to={`/drafting/plans/${p.id}`} className="font-bold hover:text-[#087f73] hover:underline">{p.name}</Link><div className="text-xs text-[#6f8082] font-mono mt-0.5">{p.plan_code}</div></td>
            <td className="px-5 py-3 text-[#53686b]">{p.team.name}<div className="text-xs text-[#8a9b9a]">{p.team.manager_name ? `Manager: ${p.team.manager_name}` : 'No manager'}</div></td>
            <td className="px-5 py-3"><StatusBadge status={p.status} /></td>
            <td className="px-5 py-3 whitespace-nowrap">{p.task_count
              ? <div className="text-xs text-[#53686b]"><b className="text-[#20333a]">{p.done_count}/{p.task_count}</b> done
                  {p.late_count > 0 && <span className="ml-2 px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 font-bold">{p.late_count} late</span>}
                  <div className="mt-1 h-1 w-24 rounded-full bg-[#edf2ef] overflow-hidden"><div className="h-full bg-[#087f73]" style={{ width: `${Math.round((p.done_count / p.task_count) * 100)}%` }} /></div></div>
              : <span className="text-xs text-[#a3b1af]">No tasks</span>}</td>
            <td className="px-5 py-3 text-[#53686b] whitespace-nowrap">{formatDate(p.start_date)}</td>
            <td className="px-5 py-3 text-[#53686b] whitespace-nowrap">{formatDate(p.target_date)}</td>
            <td className="px-5 py-3 text-right">{canManage && <button onClick={() => openEdit(p)} className="p-2 text-[#80908f] hover:text-[#087f73]" aria-label={`Edit ${p.name}`}><Pencil className="w-4 h-4" /></button>}</td>
          </tr>)}</tbody>
        </table>
      </section>)}</div>}

    {form && canManage && <PlanForm form={form} setForm={setForm} onClose={() => setForm(null)} />}
  </div>;
}

function PlanForm({ form, setForm, onClose }: { form: FormState; setForm: (f: FormState) => void; onClose: () => void }) {
  const projects = useProjectOptions();
  const teams = useTeams();
  const save = useSavePlan();
  // Keep the current team selectable even if it was deactivated after the plan was created.
  const teamOptions = (teams.data ?? []).filter(t => t.active || t.id === form.team_id);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Plan name is required');
    if (!form.project_id) return toast.error('Choose the project this plan is for');
    if (!form.team_id) return toast.error('Choose the team doing the work');
    if (form.start_date && form.target_date && form.target_date < form.start_date) return toast.error('Target date cannot be before start date');
    const { id, plan_code: _code, ...body } = form;
    try {
      await save.mutateAsync({ id, body: { ...body, name: body.name.trim(), description: body.description?.trim() || null } });
      toast.success(id ? 'Plan updated' : 'Plan created');
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not save plan'));
    }
  };

  return <DraftingModal title={form.id ? `Edit plan ${form.plan_code}` : 'New drafting plan'} subtitle="A plan is the drafting work a team delivers for one project."
    saving={save.isPending} submitLabel={form.id ? 'Save plan' : 'Create plan'} onClose={onClose} onSubmit={submit}>
    <label className={`sm:col-span-2 ${fieldLabel}`}>Plan name<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Fabrication Drawings – LSS Package" className={fieldInput} /></label>
    <label className={fieldLabel}>Project<select required value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })} className={fieldInput}>
      <option value="">{projects.isLoading ? 'Loading…' : 'Select project'}</option>
      {(projects.data ?? []).map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
    </select></label>
    <label className={fieldLabel}>Team<select required value={form.team_id} onChange={e => setForm({ ...form, team_id: e.target.value })} className={fieldInput}>
      <option value="">Select team</option>
      {teamOptions.map(t => <option key={t.id} value={t.id}>{t.name}{t.manager ? ` · ${t.manager.name}` : ''}</option>)}
    </select></label>
    <label className={fieldLabel}>Start date<input type="date" value={form.start_date ?? ''} onChange={e => setForm({ ...form, start_date: e.target.value || null })} className={fieldInput} /></label>
    <label className={fieldLabel}>Target date<input type="date" value={form.target_date ?? ''} min={form.start_date ?? undefined} onChange={e => setForm({ ...form, target_date: e.target.value || null })} className={fieldInput} /></label>
    <label className={fieldLabel}>Status<select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as PlanStatus })} className={fieldInput}>
      {PLAN_STATUSES.map(s => <option key={s} value={s}>{PLAN_STATUS_LABELS[s]}</option>)}
    </select></label>
    <label className={`sm:col-span-2 ${fieldLabel}`}>Description<textarea value={form.description ?? ''} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} className={fieldInput} /></label>
  </DraftingModal>;
}
