import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { TaskLinkKey, useLinkedTasks } from './myWorkApi';

const fmt = (iso: string | null) => iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—';

/**
 * Everyone's own tasks (from My Work) for one enquiry, design book, project or initiative.
 * People add them on Home › My work, choosing this record under "For".
 */
export default function LinkedTasks({ link, id, title = 'Tasks' }: { link: TaskLinkKey; id: string; title?: string }) {
  const tasks = useLinkedTasks(link, id);
  const rows = tasks.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const done = rows.filter(t => t.status === 'done').length;
  return <section className="bg-white border border-stone-200 rounded-xl p-5" aria-label={title}>
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="font-extrabold">{title} {rows.length > 0 && <span className="text-xs font-normal text-stone-400">{done}/{rows.length} done</span>}</h2>
      <Link to="/" className="text-xs font-bold text-blue-600">Add in My work →</Link>
    </div>
    {tasks.isLoading ? <div className="h-10 skeleton mt-3" />
      : tasks.isError ? <p className="mt-2 text-sm text-rose-700">Tasks could not be loaded.</p>
      : rows.length === 0 ? <p className="mt-2 text-sm text-stone-500">No tasks yet. In My work on the Home page, add a task and choose this record under “For”.</p>
      : <ul className="mt-3 divide-y divide-stone-100 text-sm">{rows.map(t => {
          const late = t.status !== 'done' && !!t.due_date && t.due_date < today;
          return <li key={t.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${t.status === 'done' ? 'bg-blue-600 border-blue-600 text-white' : 'border-stone-300'}`}>{t.status === 'done' && <Check className="w-3 h-3" />}</span>
            <span className={`flex-1 min-w-[160px] ${t.status === 'done' ? 'line-through text-stone-400' : 'text-stone-800'}`}>{t.title}</span>
            <Link to={`/people/${t.user_id}`} className="text-xs text-stone-500 hover:text-blue-600">{t.user_name}</Link>
            {t.planned_hours ? <span className="text-xs text-stone-500">{t.planned_hours} h</span> : null}
            <span className={`text-xs w-20 text-right ${late ? 'text-rose-600 font-semibold' : 'text-stone-500'}`}>{fmt(t.due_date ?? t.start_date)}</span>
            <span className="text-xs w-10 text-right text-stone-500">{t.progress_pct}%</span>
          </li>;
        })}</ul>}
  </section>;
}
