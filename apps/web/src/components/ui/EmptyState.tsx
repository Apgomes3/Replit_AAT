import { Link } from 'react-router-dom';

interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionHref?: string;
  className?: string;
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  actionHref,
  className = '',
}: EmptyStateProps) {
  const action = actionLabel && (onAction || actionHref) ? (
    actionHref ? (
      <Link
        to={actionHref}
        className="mt-1 inline-flex items-center rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700"
      >
        {actionLabel}
      </Link>
    ) : (
      <button
        type="button"
        onClick={onAction}
        className="mt-1 inline-flex items-center rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700"
      >
        {actionLabel}
      </button>
    )
  ) : null;

  return (
    <div className={`flex min-h-64 flex-col items-center justify-center gap-2 px-6 text-center ${className}`}>
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-stone-100 text-stone-400">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-stone-700">{title}</p>
      {description && <p className="max-w-sm text-xs leading-relaxed text-stone-500">{description}</p>}
      {action}
    </div>
  );
}