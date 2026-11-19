// A table of plans with progress, plus "New plan". Used by My plans and by the Plans panel on
// project, design book and enquiry pages.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarRange, Lock, Pencil, Plus, Users, Globe } from 'lucide-react';
import { StatusBadge } from '../drafting/PlansPanel';
import type { Plan, PlanVisibility } from '../drafting/draftingApi';
import { useAuthStore } from '../../store/authStore';
import GlobalPlanForm from './GlobalPlanForm';
import { GlobalPlanPayload, planLinkLabel } from './plansApi';

const VISIBILITY_ICON: Record<PlanVisibility, typeof Lock> = { private: Lock, team: Users, everyone: Globe };
const VISIBILITY_TITLE: Record<PlanVisibility, string> = { private: 'Private', team: 'Team', everyone: 'Everyone' };

const formatDate = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function PlanList({ plans, loading, error, onRetry, defaults, showLink = true, emptyText, compact = false }: {
  plans: Plan[] | undefined;
  loading: boolean;
  error?: boolean;
  onRetry?: () => void;
  /** Links preset on new plans (project page → that project, etc.). */
  defaults?: Partial<GlobalPlanPayload>;
  showLink?: boolean;
  emptyText: string;
  compact?: boolean;
}) {
  const user = useAuthStore(s => s.user);
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Plan | null | 'new'>(null);
  // The server decides; this only hides the pencil from people who clearly cannot edit.
  const mayEdit = (p: Plan) => user?.role === 'admin' || p.owner?.id === user?.id || p.members.some(m => m.id === user?.id);

  return <div>
    <div className="flex justify-end mb-3">
      <button onClick={() => setEditing('new')} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-bold">
        <Plus className="w-4 h-4" /> New plan
      </button>
    </div>
    {error ? <div className="p-6 text-sm text-rose-700">Plans could not be loaded. {onRetry && <button className="underline font-bold" onClick={onRetry}>Try again</button>}</div>
      : loading ? <div className="space-y-2">{[1, 2].map(i => <div key={i} className="h-12 skeleton rounded-xl" />)}</div>
      : !plans?.length ? <div className={`bg-white rounded-xl border border-dashed border-[#c9d9d2] ${compact ? 'p-6' : 'p-14'} text-center`}>
        <CalendarRange className="mx-auto w-8 h-8 text-stone-300 mb-2" />
        <p className="text-sm text-stone-500">{emptyText}</p>
      </div>
      : <div className="bg-white rounded-xl border border-stone-200 overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-stone-100">{['Plan', ...(showLink ? ['Linked to'] : []), 'Team / owner', 'Status', 'Progress', 'Target', ''].map(h =>
            <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-stone-500 uppercase tracking-wide">{h}</th>)}</tr></thead>
          <tbody>{plans.map(p => {
            const Icon = VISIBILITY_ICON[p.visibility];
            return <tr key={p.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50">
              <td className="px-4 py-2.5">
                <Link to={`/plans/${p.id}`} className="font-bold hover:text-blue-600 hover:underline">{p.name}</Link>
                <div className="text-xs text-stone-500 font-mono mt-0.5 flex items-center gap-1.5">{p.plan_code}
                  <Icon className="w-3 h-3" aria-label={VISIBILITY_TITLE[p.visibility]}><title>{VISIBILITY_TITLE[p.visibility]}</title></Icon></div>
              </td>
              {showLink && <td className="px-4 py-2.5 text-stone-600">{planLinkLabel(p)}</td>}
              <td className="px-4 py-2.5 text-stone-600">{p.team?.name ?? <span className="text-stone-400">Personal</span>}
                {p.owner && <div className="text-xs text-stone-400">Owner: {p.owner.name}</div>}</td>
              <td className="px-4 py-2.5"><StatusBadge status={p.status} /></td>
              <td className="px-4 py-2.5 whitespace-nowrap">{p.task_count
                ? <span className="text-xs text-stone-600"><b className="text-stone-800">{p.done_count}/{p.task_count}</b> done
                    {p.late_count > 0 && <span className="ml-2 px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 font-bold">{p.late_count} late</span>}</span>
                : <span className="text-xs text-[#a3b1af]">No tasks</span>}</td>
              <td className="px-4 py-2.5 text-stone-600 whitespace-nowrap">{formatDate(p.target_date)}</td>
              <td className="px-4 py-2.5 text-right">{mayEdit(p) && <button onClick={() => setEditing(p)} className="p-2 text-stone-400 hover:text-blue-600" aria-label={`Edit ${p.name}`}><Pencil className="w-4 h-4" /></button>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
    {editing && <GlobalPlanForm plan={editing === 'new' ? null : editing} defaults={defaults}
      onClose={() => setEditing(null)} onSaved={saved => { if (editing === 'new') navigate(`/plans/${saved.id}`); }} />}
  </div>;
}
