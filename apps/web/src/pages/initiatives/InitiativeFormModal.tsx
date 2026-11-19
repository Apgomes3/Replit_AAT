import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useModalFocus } from '../../hooks/useModalFocus';
import { useAuthStore } from '../../store/authStore';
import { apiError, CURRENCIES, Initiative, InitiativeType, TYPES, usePeople, useSaveInitiative } from './initiativesApi';

const input = 'mt-1.5 w-full border border-stone-200 rounded-lg px-3 py-2 text-sm font-normal bg-white';
const label = 'text-xs font-bold text-stone-600';

/** Propose a new idea, or edit an initiative's details. */
export default function InitiativeFormModal({ initiative, onClose, onSaved }: { initiative?: Initiative; onClose: () => void; onSaved?: (i: Initiative) => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useModalFocus<HTMLDivElement>({ onClose, initialFocusRef: closeRef });
  const me = useAuthStore(s => s.user);
  const people = usePeople();
  const save = useSaveInitiative();
  const [f, setF] = useState({
    title: initiative?.title ?? '', goal: initiative?.goal ?? '', description: initiative?.description ?? '',
    type: (initiative?.type ?? 'process_improvement') as InitiativeType, priority: initiative?.priority ?? 'medium',
    owner_user_id: initiative ? initiative.owner_user_id ?? '' : me?.id ?? '', sponsor_user_id: initiative?.sponsor_user_id ?? '',
    start_date: initiative?.start_date?.slice(0, 10) ?? '', target_date: initiative?.target_date?.slice(0, 10) ?? '',
    estimated_hours: initiative?.estimated_hours != null ? String(initiative.estimated_hours) : '',
    budget_amount: initiative?.budget_amount != null ? String(initiative.budget_amount) : '', currency: initiative?.currency ?? 'USD',
    outcome: initiative?.outcome ?? '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) return toast.error('Give it a title');
    if (f.start_date && f.target_date && f.target_date < f.start_date) return toast.error('The target date cannot be before the start date');
    try {
      const saved = await save.mutateAsync({ id: initiative?.id, input: {
        title: f.title.trim(), goal: f.goal.trim() || null, description: f.description.trim() || null, type: f.type, priority: f.priority as any,
        owner_user_id: f.owner_user_id || null, sponsor_user_id: f.sponsor_user_id || null,
        start_date: f.start_date || null, target_date: f.target_date || null,
        estimated_hours: f.estimated_hours ? Number(f.estimated_hours) : null, budget_amount: f.budget_amount ? Number(f.budget_amount) : null,
        currency: f.currency, ...(initiative ? { outcome: f.outcome.trim() || null } : {}),
      } });
      toast.success(initiative ? 'Saved' : `${saved.code} proposed`);
      onSaved?.(saved);
      onClose();
    } catch (err) { toast.error(apiError(err, 'Could not save')); }
  };

  const personOptions = (people.data ?? []).map(p => <option key={p.id} value={p.id}>{p.name}{p.job_title ? ` — ${p.job_title}` : ''}</option>);
  return <div className="fixed inset-0 z-50 bg-stone-900/40 p-4 flex items-center justify-center">
    <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="initiative-form-title" tabIndex={-1} className="bg-white w-full max-w-2xl max-h-[92vh] overflow-auto rounded-2xl shadow-2xl">
      <form onSubmit={submit}>
        <div className="p-5 border-b border-stone-100 flex justify-between gap-4">
          <div>
            <h2 id="initiative-form-title" className="font-extrabold">{initiative ? `Edit ${initiative.code}` : 'Propose an initiative'}</h2>
            <p className="text-xs text-stone-500 mt-1">{initiative ? 'Internal work: details, effort and budget.' : 'Internal work that is not a client project. It starts as an idea; the sponsor approves it.'}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-stone-400" /></button>
        </div>
        <div className="p-5 grid sm:grid-cols-2 gap-4">
          <label className={`sm:col-span-2 ${label}`}>Title<input autoFocus value={f.title} onChange={set('title')} className={input} placeholder="e.g. Compact UV skid range" /></label>
          <label className={`sm:col-span-2 ${label}`}>Goal<input value={f.goal} onChange={set('goal')} className={input} placeholder="What will be better when it is done?" /></label>
          <label className={label}>Type<select value={f.type} onChange={set('type')} className={input}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className={label}>Priority<select value={f.priority} onChange={set('priority')} className={input}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
          <label className={label}>Owner (does the work)<select value={f.owner_user_id} onChange={set('owner_user_id')} className={input}><option value="">Not decided</option>{personOptions}</select></label>
          <label className={label}>Sponsor (approves it)<select value={f.sponsor_user_id} onChange={set('sponsor_user_id')} className={input}><option value="">Any manager</option>{personOptions}</select></label>
          <label className={label}>Start<input type="date" value={f.start_date} onChange={set('start_date')} className={input} /></label>
          <label className={label}>Target date<input type="date" value={f.target_date} onChange={set('target_date')} className={input} /></label>
          <label className={label}>Estimated hours<input type="number" min={0} step={1} value={f.estimated_hours} onChange={set('estimated_hours')} className={input} placeholder="h" /></label>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <label className={label}>Budget<input type="number" min={0} step={1} value={f.budget_amount} onChange={set('budget_amount')} className={input} /></label>
            <label className={label}>Currency<select value={f.currency} onChange={set('currency')} className={input}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></label>
          </div>
          <label className={`sm:col-span-2 ${label}`}>Description<textarea rows={4} value={f.description} onChange={set('description')} className={input} placeholder="Background, scope, how it will be done" /></label>
          {initiative && <label className={`sm:col-span-2 ${label}`}>Outcome<textarea rows={2} value={f.outcome} onChange={set('outcome')} className={input} placeholder="What it delivered (fill in when done)" /></label>}
        </div>
        <div className="p-5 bg-stone-50 flex justify-end gap-2 rounded-b-2xl">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm">Cancel</button>
          <button disabled={save.isPending} className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-bold disabled:opacity-60">{save.isPending ? 'Saving…' : initiative ? 'Save' : 'Propose'}</button>
        </div>
      </form>
    </div>
  </div>;
}
