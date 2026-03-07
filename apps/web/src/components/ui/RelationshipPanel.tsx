import { ReactNode } from 'react';
import { Link2 } from 'lucide-react';

interface RelItem { label: string; href?: string; content: ReactNode; }

export default function RelationshipPanel({ title, items }: { title: string; items: RelItem[] }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <Link2 className="w-4 h-4 text-slate-400" />
        <span className="text-sm font-medium text-slate-700">{title}</span>
      </div>
      <div className="divide-y divide-slate-100">
        {items.length === 0 ? (
          <div className="px-4 py-4 text-sm text-slate-400">No relationships</div>
        ) : items.map((item, i) => (
          <div key={i} className="px-4 py-2.5">
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">{item.label}</div>
            <div className="text-sm text-slate-700">{item.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
