import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import StatusBadge from './StatusBadge';
import EntityCode from './EntityCode';
import { ArrowLeft } from 'lucide-react';
import Breadcrumb, { CrumbItem } from './Breadcrumb';
import { safeReturnTo } from '../../lib/navigation';

interface PageHeaderProps {
  code?: string;
  title: ReactNode;
  status?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  crumbs?: CrumbItem[];
  back?: string;
  onBack?: () => void;
  returnTo?: string;
  returnLabel?: string;
}

export default function PageHeader({ code, title, status, subtitle, actions, breadcrumb, crumbs, back, onBack, returnTo, returnLabel = 'Back' }: PageHeaderProps) {
  const location = useLocation();
  const stateReturnTo = safeReturnTo(location.state?.returnTo, '');
  const contextualReturnTo = returnTo || stateReturnTo || undefined;
  const contextualReturnLabel = returnTo
    ? returnLabel
    : (typeof location.state?.returnLabel === 'string' ? location.state.returnLabel : returnLabel);
  return (
    <div className="bg-white border-b border-stone-200 px-6 py-4">
      {(crumbs || breadcrumb || back || onBack) && (
        <div className="mb-3">
          {crumbs ? (
            <div className="flex items-center gap-3">
              {contextualReturnTo && (
                <Link
                  to={contextualReturnTo}
                  aria-label={`Return to ${contextualReturnLabel}`}
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> {contextualReturnLabel}
                </Link>
              )}
              <Breadcrumb items={crumbs} />
            </div>
          ) : onBack ? (
            <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-blue-600 transition-colors duration-150">
              <ArrowLeft className="w-3 h-3" /> Back
            </button>
          ) : back ? (
            <Link to={back} className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-blue-600 transition-colors duration-150">
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
