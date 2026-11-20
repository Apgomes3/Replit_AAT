import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, History } from 'lucide-react';
import api from '../../lib/api';
import { loadRecentRecords } from '../../lib/recentRecords';

type WorkRow = {
  id: string;
  type: string;
  code?: string | null;
  name?: string | null;
  status?: string | null;
  due_date?: string | null;
  href: string;
  attention?: string;
};

const TYPE_LABEL: Record<string, string> = {
  purchase_order: 'Purchase order',
  design_book: 'Design book',
  enquiry: 'Enquiry',
  document: 'Document',
};

function isOverdue(due?: string | null) {
  return !!due && due.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

function Panel({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b border-stone-100 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-800">{icon}{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function NeedsAttentionPanel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['work-summary', 'home'],
    queryFn: () => api.get('/search/my-work?page_size=6').then(r => r.data as { results: WorkRow[]; total: number }),
  });
  const rows = data?.results ?? [];
  const total = data?.total ?? 0;

  return (
    <Panel
      title={total > 0 ? `Needs your attention (${total})` : 'Needs your attention'}
      icon={<AlertCircle className="h-4 w-4 text-amber-500" />}
      action={total > 0 && (
        <Link to="/my-work" className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800">
          See all <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    >
      {isLoading ? (
        <div className="space-y-2 p-4">{[0, 1, 2].map(i => <div key={i} className="h-9 animate-pulse rounded-lg bg-stone-100" />)}</div>
      ) : isError ? (
        <p className="px-4 py-6 text-sm text-stone-500">Couldn't load your work items. Refresh to try again.</p>
      ) : rows.length === 0 ? (
        <p className="flex items-center gap-2 px-4 py-6 text-sm text-stone-500">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Nothing waiting on you right now.
        </p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {rows.map(row => (
            <li key={`${row.type}-${row.id}`}>
              <Link to={row.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-stone-800">
                    {row.code && <span className="mr-2 whitespace-nowrap font-mono text-xs text-stone-500">{row.code}</span>}
                    {row.name || TYPE_LABEL[row.type] || row.type}
                  </span>
                  <span className="block text-xs text-stone-500">
                    {TYPE_LABEL[row.type] ?? row.type}
                    {row.due_date && (
                      <span className={isOverdue(row.due_date) ? 'text-red-600 font-medium' : ''}> · due {row.due_date.slice(0, 10)}</span>
                    )}
                  </span>
                </span>
                {row.attention && (
                  <span className="shrink-0 whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 border border-amber-200">
                    {row.attention}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function RecentRecordsPanel() {
  const recent = loadRecentRecords().slice(0, 3);
  return (
    <Panel title="Recently opened" icon={<History className="h-4 w-4 text-stone-400" />}>
      {recent.length === 0 ? (
        <p className="px-4 py-6 text-sm text-stone-500">Projects, products, orders and documents you open will appear here.</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {recent.map(record => (
            <li key={record.path}>
              <Link to={record.path} className="block px-4 py-2.5 hover:bg-stone-50">
                <span className="block truncate text-sm font-medium text-stone-800">{record.name}</span>
                <span className="block text-xs text-stone-500">{record.kind}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
