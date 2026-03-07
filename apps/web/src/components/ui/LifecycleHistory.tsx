import { LifecycleTransition } from '../../types';
import StatusBadge from './StatusBadge';
import { History } from 'lucide-react';

export default function LifecycleHistory({ items }: { items: LifecycleTransition[] }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <History className="w-4 h-4 text-slate-400" />
        <span className="text-sm font-medium text-slate-700">Lifecycle History</span>
      </div>
      <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
        {items.length === 0 ? <div className="text-sm text-slate-400 py-2">No transitions recorded</div> : items.map(t => (
          <div key={t.id} className="text-xs">
            <div className="flex items-center gap-1.5">
              {t.from_state && <><span className="text-slate-400">{t.from_state}</span><span className="text-slate-300">→</span></>}
              <StatusBadge status={t.to_state} />
            </div>
            <div className="text-slate-400 mt-0.5">{t.actor_name} · {new Date(t.transitioned_at).toLocaleDateString()}</div>
            {t.comment && <div className="text-slate-500 mt-0.5 italic">{t.comment}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
