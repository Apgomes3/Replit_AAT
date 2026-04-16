import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import StatusBadge from './StatusBadge';
import EntityCode from './EntityCode';
import { ArrowLeft } from 'lucide-react';
import Breadcrumb, { CrumbItem } from './Breadcrumb';

interface PageHeaderProps {
  code?: string;
  title: ReactNode;
  status?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  crumbs?: CrumbItem[];
  back?: string;
}

export default function PageHeader({ code, title, status, subtitle, actions, breadcrumb, crumbs, back }: PageHeaderProps) {
  return (
    <div className="bg-white border-b border-stone-200 px-6 py-4">
      {(crumbs || breadcrumb || back) && (
        <div className="mb-3">
          {crumbs ? (
            <Breadcrumb items={crumbs} />
          ) : back ? (
            <Link to={back} className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-amber-600 transition-colors duration-150">
              <ArrowLeft className="w-3 h-3" /> Back
            </Link>
          ) : (
            <div className="text-xs text-stone-400">{breadcrumb}</div>
          )}
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {code && <EntityCode code={code} />}
            {status && <StatusBadge status={status} />}
          </div>
          <h1 className="mt-1 text-xl font-semibold text-stone-800 leading-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-stone-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}
