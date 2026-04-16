import clsx from 'clsx';

type StatusConfig = { bg: string; text: string; border: string; dot: string };

const statusMap: Record<string, StatusConfig> = {
  'Draft':            { bg: 'bg-slate-50',   text: 'text-slate-600',  border: 'border-slate-200',  dot: 'bg-slate-400' },
  'Internal Review':  { bg: 'bg-amber-50',   text: 'text-amber-700',  border: 'border-amber-200',  dot: 'bg-amber-500' },
  'Review Commented': { bg: 'bg-orange-50',  text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-500' },
  'Resubmitted':      { bg: 'bg-blue-50',    text: 'text-blue-700',   border: 'border-blue-200',   dot: 'bg-blue-500' },
  'Approved':         { bg: 'bg-blue-50',    text: 'text-blue-700',   border: 'border-blue-200',   dot: 'bg-blue-500' },
  'Released':         { bg: 'bg-green-50',   text: 'text-green-700',  border: 'border-green-200',  dot: 'bg-green-500' },
  'As-Built':         { bg: 'bg-green-100',  text: 'text-green-800',  border: 'border-green-300',  dot: 'bg-green-600' },
  'Superseded':       { bg: 'bg-gray-100',   text: 'text-gray-500',   border: 'border-gray-200',   dot: 'bg-gray-400' },
  'Obsolete':         { bg: 'bg-red-50',     text: 'text-red-700',    border: 'border-red-200',    dot: 'bg-red-500' },
  'Active':           { bg: 'bg-green-50',   text: 'text-green-700',  border: 'border-green-200',  dot: 'bg-green-500' },
  'Concept':          { bg: 'bg-purple-50',  text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-500' },
  'Design':           { bg: 'bg-blue-50',    text: 'text-blue-700',   border: 'border-blue-200',   dot: 'bg-blue-500' },
  'Handover':         { bg: 'bg-amber-50',   text: 'text-amber-700',  border: 'border-amber-200',  dot: 'bg-amber-500' },
  'Complete':         { bg: 'bg-teal-50',    text: 'text-teal-700',   border: 'border-teal-200',   dot: 'bg-teal-500' },
  'Development':      { bg: 'bg-yellow-50',  text: 'text-yellow-700', border: 'border-yellow-200', dot: 'bg-yellow-500' },
  'Completed':        { bg: 'bg-teal-50',    text: 'text-teal-700',   border: 'border-teal-200',   dot: 'bg-teal-500' },
  'On Hold':          { bg: 'bg-orange-50',  text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-500' },
  'Archived':         { bg: 'bg-gray-50',    text: 'text-gray-500',   border: 'border-gray-200',   dot: 'bg-gray-400' },
  'Proposed':         { bg: 'bg-purple-50',  text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-500' },
  'Under Review':     { bg: 'bg-amber-50',   text: 'text-amber-700',  border: 'border-amber-200',  dot: 'bg-amber-500' },
  'Implemented':      { bg: 'bg-green-50',   text: 'text-green-700',  border: 'border-green-200',  dot: 'bg-green-500' },
  'Closed':           { bg: 'bg-gray-100',   text: 'text-gray-500',   border: 'border-gray-200',   dot: 'bg-gray-400' },
  'Rejected':         { bg: 'bg-red-50',     text: 'text-red-700',    border: 'border-red-200',    dot: 'bg-red-500' },
  'Deprecated':       { bg: 'bg-orange-50',  text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-500' },
  'ApprovedStandard': { bg: 'bg-blue-50',    text: 'text-blue-700',   border: 'border-blue-200',   dot: 'bg-blue-500' },
};

const fallback: StatusConfig = { bg: 'bg-stone-50', text: 'text-stone-500', border: 'border-stone-200', dot: 'bg-stone-400' };

export default function StatusBadge({ status, className }: { status: string; className?: string }) {
  const cfg = statusMap[status] ?? fallback;
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border',
      cfg.bg, cfg.text, cfg.border,
      className
    )}>
      <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', cfg.dot)} />
      {status}
    </span>
  );
}
