import clsx from 'clsx';

const statusColors: Record<string, string> = {
  'Draft': 'bg-slate-100 text-slate-600 border-slate-200',
  'Internal Review': 'bg-amber-50 text-amber-700 border-amber-200',
  'Review Commented': 'bg-orange-50 text-orange-700 border-orange-200',
  'Resubmitted': 'bg-blue-50 text-blue-700 border-blue-200',
  'Approved': 'bg-blue-100 text-blue-700 border-blue-200',
  'Released': 'bg-green-100 text-green-700 border-green-200',
  'As-Built': 'bg-green-200 text-green-800 border-green-300',
  'Superseded': 'bg-gray-200 text-gray-600 border-gray-300',
  'Obsolete': 'bg-red-100 text-red-700 border-red-200',
  'Active': 'bg-green-100 text-green-700 border-green-200',
  'Concept': 'bg-purple-100 text-purple-700 border-purple-200',
  'Design': 'bg-blue-100 text-blue-700 border-blue-200',
  'Handover': 'bg-amber-100 text-amber-700 border-amber-200',
  'Complete': 'bg-teal-100 text-teal-700 border-teal-200',
  'Development': 'bg-yellow-100 text-yellow-700 border-yellow-200',
  'Completed': 'bg-teal-100 text-teal-700 border-teal-200',
  'On Hold': 'bg-orange-100 text-orange-700 border-orange-200',
  'Archived': 'bg-gray-100 text-gray-600 border-gray-200',
  'Proposed': 'bg-purple-100 text-purple-700 border-purple-200',
  'Under Review': 'bg-amber-50 text-amber-700 border-amber-200',
  'Implemented': 'bg-green-100 text-green-700 border-green-200',
  'Closed': 'bg-gray-200 text-gray-600 border-gray-300',
  'Rejected': 'bg-red-100 text-red-700 border-red-200',
  'Deprecated': 'bg-orange-100 text-orange-700 border-orange-200',
  'ApprovedStandard': 'bg-blue-100 text-blue-700 border-blue-200',
};

export default function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border', statusColors[status] || 'bg-gray-100 text-gray-600 border-gray-200', className)}>
      {status}
    </span>
  );
}
