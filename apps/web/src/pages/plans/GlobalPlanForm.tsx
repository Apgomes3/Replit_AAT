// Create or edit a plan with the global planner: links (project / design book / enquiry / none),
// optional team, who can see it, and who it is shared with.
import { useState } from 'react';
import toast from 'react-hot-toast';
import DraftingModal, { fieldInput, fieldLabel } from '../drafting/DraftingModal';
import {
  apiErrorMessage, Plan, PLAN_STATUSES, PLAN_STATUS_LABELS, PLAN_VISIBILITIES, PLAN_VISIBILITY_LABELS, PlanStatus, PlanVisibility,
} from '../drafting/draftingApi';
import { GlobalPlanPayload, planToPayload, usePlannerOptions, useSaveGlobalPlan } from './plansApi';

type LinkKind = 'none' | 'project' | 'design_book' | 'enquiry' | 'initiative';

const linkKindOf = (f: GlobalPlanPayload): LinkKind =>
  f.initiative_id ? 'initiative' : f.design_book_id ? 'design_book' : f.enquiry_id ? 'enquiry' : f.project_id ? 'project' : 'none';

export default function GlobalPlanForm({ plan, defaults, onClose, onSaved }: {
  plan: Plan | null;
  /** Links preset when creating from a project, design book or enquiry page. */
  defaults?: Partial<GlobalPlanPayload>;
  onClose: () => void;
  onSaved?: (plan: Plan) => void;
}) {
  const options = usePlannerOptions();
  const save = useSaveGlobalPlan();
  const [form, setForm] = useState<GlobalPlanPayload>(() => planToPayload(plan, defaults));
  const [kind, setKind] = useState<LinkKind>(() => linkKindOf(planToPayload(plan, defaults)));
  const set = (patch: Partial<GlobalPlanPayload>) => setForm(f => ({ ...f, ...patch }));
  const o = options.data;

  const changeKind = (k: LinkKind) => {
    setKind(k);
    set({ project_id: null, design_book_id: null, enquiry_id: null, initiative_id: null });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Plan name is required');
    if (kind !== 'none' && !(form.project_id || form.design_book_id || form.enquiry_id || form.initiative_id)) return toast.error('Choose what this plan is linked to, or pick "Nothing"');
    if (form.visibility === 'team' && !form.team_id) return toast.error('Pick a team, or choose another visibility');
    if (form.start_date && form.target_date && form.target_date < form.start_date) return toast.error('Target date cannot be before start date');
    try {
      const saved = await save.mutateAsync({ id: plan?.id, body: { ...form, name: form.name.trim(), description: form.description?.trim() || null } });
      toast.success(plan ? 'Plan updated' : 'Plan created');
      onSaved?.(saved);
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not save plan'));
    }
  };

  const toggleMember = (id: string) =>
    set({ member_ids: form.member_ids.includes(id) ? form.member_ids.filter(m => m !== id) : [...form.member_ids, id] });

  return <DraftingModal title={plan ? `Edit plan ${plan.plan_code}` : 'New plan'}
    subtitle="A list of tasks with dates and people. Link it to a project, design book, enquiry or initiative, or keep it standalone."
    saving={save.isPending} submitLabel={plan ? 'Save plan' : 'Create plan'} onClose={onClose} onSubmit={submit}>
    <label className={`sm:col-span-2 ${fieldLabel}`}>Plan name<input required autoFocus value={form.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Site visit preparation" className={fieldInput} /></label>

    <label className={fieldLabel}>Linked to<select value={kind} onChange={e => changeKind(e.target.value as LinkKind)} className={fieldInput}>
      <option value="none">Nothing (standalone)</option>
      <option value="project">A project</option>
      <option value="design_book">A design book</option>
      <option value="enquiry">An enquiry</option>
      <option value="initiative">An initiative (internal work)</option>
    </select></label>
    {kind === 'project' && <label className={fieldLabel}>Project<select value={form.project_id ?? ''} onChange={e => set({ project_id: e.target.value || null })} className={fieldInput}>
      <option value="">{options.isLoading ? 'Loading…' : 'Select project'}</option>
      {o?.projects.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
    </select></label>}
    {kind === 'design_book' && <label className={fieldLabel}>Design book<select value={form.design_book_id ?? ''} onChange={e => set({ design_book_id: e.target.value || null, project_id: null })} className={fieldInput}>
      <option value="">{options.isLoading ? 'Loading…' : 'Select design book'}</option>
      {o?.design_books.map(b => <option key={b.id} value={b.id}>{b.code} · {b.title}</option>)}
    </select></label>}
    {kind === 'enquiry' && <label className={fieldLabel}>Enquiry<select value={form.enquiry_id ?? ''} onChange={e => set({ enquiry_id: e.target.value || null })} className={fieldInput}>
      <option value="">{options.isLoading ? 'Loading…' : 'Select enquiry'}</option>
      {o?.enquiries.map(q => <option key={q.id} value={q.id}>{q.number} · {q.title}</option>)}
    </select></label>}
    {kind === 'initiative' && <label className={fieldLabel}>Initiative<select value={form.initiative_id ?? ''} onChange={e => set({ initiative_id: e.target.value || null })} className={fieldInput}>
      <option value="">{options.isLoading ? 'Loading…' : 'Select initiative'}</option>
      {o?.initiatives?.map(i => <option key={i.id} value={i.id}>{i.code} · {i.title}</option>)}
    </select></label>}
    {kind === 'none' && <div />}

    <label className={fieldLabel}>Team (optional)<select value={form.team_id ?? ''} onChange={e => {
      const team_id = e.target.value || null;
      set({ team_id, visibility: !team_id && form.visibility === 'team' ? 'private' : form.visibility });
    }} className={fieldInput}>
      <option value="">No team (personal plan)</option>
      {o?.teams.map(t => <option key={t.id} value={t.id}>{t.name} · {t.department}</option>)}
    </select></label>
    <label className={fieldLabel}>Who can see it<select value={form.visibility} onChange={e => set({ visibility: e.target.value as PlanVisibility })} className={fieldInput}>
      {PLAN_VISIBILITIES.map(v => <option key={v} value={v} disabled={v === 'team' && !form.team_id}>{PLAN_VISIBILITY_LABELS[v]}</option>)}
    </select></label>

    <label className={fieldLabel}>Start date<input type="date" value={form.start_date ?? ''} onChange={e => set({ start_date: e.target.value || null })} className={fieldInput} /></label>
    <label className={fieldLabel}>Target date<input type="date" value={form.target_date ?? ''} min={form.start_date ?? undefined} onChange={e => set({ target_date: e.target.value || null })} className={fieldInput} /></label>
    <label className={fieldLabel}>Status<select value={form.status} onChange={e => set({ status: e.target.value as PlanStatus })} className={fieldInput}>
      {PLAN_STATUSES.map(s => <option key={s} value={s}>{PLAN_STATUS_LABELS[s]}</option>)}
    </select></label>
    <div />

    <fieldset className="sm:col-span-2">
      <legend className="text-xs font-bold text-[#53686b] mb-1">Share with (they can see and edit it)</legend>
      <div className="max-h-36 overflow-y-auto border border-[#dce7e2] rounded-lg p-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
        {o?.people.map(p => <label key={p.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.member_ids.includes(p.id)} onChange={() => toggleMember(p.id)} /> {p.name}
        </label>)}
      </div>
    </fieldset>
    <label className={`sm:col-span-2 ${fieldLabel}`}>Description<textarea value={form.description ?? ''} onChange={e => set({ description: e.target.value })} rows={3} className={fieldInput} /></label>
  </DraftingModal>;
}
