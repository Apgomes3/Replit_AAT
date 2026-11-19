import toast from 'react-hot-toast';
import { CalendarClock } from 'lucide-react';

type Change = { id: string; title: string; old_start_date: string | null; old_due_date: string | null };

/**
 * "Moved N later tasks · Undo" after the automatic scheduler pushed tasks. `changes[0]` may be the
 * task the user edited (the API lists it first so Undo restores it too); it is not counted as "moved".
 */
export function showRescheduleToast(changes: Change[], editedId: string | null, undo: (changes: Change[]) => Promise<void>) {
  const moved = changes.filter(c => c.id !== editedId);
  if (!moved.length) return;
  toast(t => (
    <div className="flex items-center gap-3 text-sm">
      <CalendarClock className="w-4 h-4 shrink-0 text-blue-600" />
      <span>
        Moved {moved.length} later {moved.length === 1 ? 'task' : 'tasks'}
        <span className="block text-xs text-stone-500 max-w-[260px] truncate">{moved.map(c => c.title).join(' · ')}</span>
      </span>
      <button className="ml-2 px-2.5 py-1 rounded-md border border-stone-200 text-xs font-bold text-blue-600 hover:bg-stone-50"
        onClick={() => { toast.dismiss(t.id); void undo(changes).then(() => toast.success('Undone')).catch(() => toast.error('Could not undo')); }}>
        Undo
      </button>
    </div>
  ), { duration: 8000 });
}
