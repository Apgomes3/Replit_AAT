import { ReactNode } from 'react';

interface MetadataField {
  label: string;
  value: ReactNode;
  action?: ReactNode;
}

export default function MetadataPanel({ title, fields }: { title?: string; fields: MetadataField[] }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      {title && <div className="px-4 py-3 border-b border-slate-100 text-sm font-medium text-slate-700">{title}</div>}
      <div className="p-4 grid grid-cols-1 gap-y-3">
        {fields.map(({ label, value, action }) => (
          <div key={label} className="flex gap-2 items-start">
            <span className="text-xs text-slate-400 font-medium uppercase tracking-wide w-36 shrink-0 pt-0.5">{label}</span>
            <span className="text-sm text-slate-700 flex-1">{value ?? <span className="text-slate-300">—</span>}</span>
            {action && <span className="shrink-0">{action}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
