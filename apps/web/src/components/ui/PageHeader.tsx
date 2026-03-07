import { ReactNode } from 'react';
import StatusBadge from './StatusBadge';
import EntityCode from './EntityCode';

interface PageHeaderProps {
  code?: string;
  title: string;
  status?: string;
  subtitle?: string;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}

export default function PageHeader({ code, title, status, subtitle, actions, breadcrumb }: PageHeaderProps) {
  return (
    <div className="bg-white border-b border-slate-200 px-6 py-4">
      {breadcrumb && <div className="mb-2 text-xs text-slate-400">{breadcrumb}</div>}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {code && <EntityCode code={code} />}
            {status && <StatusBadge status={status} />}
          </div>
          <h1 className="mt-1 text-xl font-semibold text-slate-800 leading-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}
