import { useQuery } from '@tanstack/react-query';
import PageHeader from '../../components/ui/PageHeader';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { BookMarked, ChevronLeft, ArrowUpRight, Plus, FolderOpen } from 'lucide-react';
import StatusBadge from '../../components/ui/StatusBadge';

function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div className="divide-y divide-stone-50">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="h-3 w-16 rounded bg-stone-100 animate-pulse shrink-0" />
            <div className="h-3 w-44 rounded bg-stone-100 animate-pulse" />
          </div>
          <div className="h-5 w-16 rounded-full bg-stone-100 animate-pulse shrink-0" />
        </div>
      ))}
    </div>
  );
}

const STATUS_ORDER = ['Draft', 'In Progress', 'For Review', 'Approved', 'Released'];

export default function DesignBookEngineDashboard() {
  const navigate = useNavigate();

  const { data: booksData, isLoading } = useQuery({
    queryKey: ['design-books-all'],
    queryFn: () => api.get('/design-books').then(r => r.data),
  });

  const books: any[] = booksData?.items ?? [];

  const byStatus: Record<string, number> = {};
  for (const b of books) {
    const s = b.status || 'Draft';
    byStatus[s] = (byStatus[s] || 0) + 1;
  }

  const recentBooks = [...books].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  ).slice(0, 8);

  const activeBooks = books.filter(b => ['In Progress', 'For Review'].includes(b.status));

  return (
    <div>
      <PageHeader crumbs={[{ label: 'Engineering' }, { label: 'Design Books', href: '/design-books' }, { label: 'Overview' }]} title="Design Books overview" subtitle="Engineering design books: exhibits, LSS and piping calculations."
        actions={<Link to="/design-books" className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50">All design books</Link>} />
    <div className="p-6 max-w-6xl">

      {/* Status counts */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-2">
              <div className="h-5 w-20 rounded-full bg-stone-100 animate-pulse" />
              <div className="h-8 w-10 mt-1 rounded bg-stone-100 animate-pulse" />
            </div>
          ))
        ) : STATUS_ORDER.map(status => {
          const count = byStatus[status] ?? 0;
          const styles: Record<string, { bg: string; text: string; dot: string; border: string }> = {
            'Draft':      { bg: 'bg-stone-50',   text: 'text-stone-600',   dot: 'bg-stone-400',   border: 'border-stone-200'  },
            'In Progress':{ bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500',    border: 'border-blue-200'   },
            'For Review': { bg: 'bg-sky-50',     text: 'text-sky-700',     dot: 'bg-sky-500',     border: 'border-sky-200'    },
            'Approved':   { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', border: 'border-emerald-200'},
            'Released':   { bg: 'bg-violet-50',  text: 'text-violet-700',  dot: 'bg-violet-500',  border: 'border-violet-200' },
          };
          const cfg = styles[status];
          return (
            <div key={status} className={`bg-white border rounded-xl p-4 flex flex-col gap-1 shadow-sm hover:shadow-md transition-all duration-200 ${cfg.border}`}>
              <span className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full w-fit ${cfg.bg} ${cfg.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                {status}
              </span>
              <span className="text-3xl font-bold text-stone-800 mt-1">{count}</span>
              <span className="text-xs text-stone-400">book{count !== 1 ? 's' : ''}</span>
            </div>
          );
        })}
      </div>

      {/* Active / In-progress books */}
      {activeBooks.length > 0 && (
        <div className="bg-white border border-blue-200/80 rounded-xl overflow-hidden mb-5 shadow-sm hover:shadow-md transition-shadow duration-200">
          <div className="flex items-center justify-between px-4 py-3 border-b border-blue-100 bg-blue-50/60">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-sm font-semibold text-blue-700">In Progress</span>
            </div>
            <span className="text-xs text-blue-500 font-medium bg-blue-100 rounded-full px-2.5 py-0.5">{activeBooks.length} active</span>
          </div>
          <div className="divide-y divide-stone-50/80">
            {activeBooks.slice(0, 5).map((b: any) => (
              <Link key={b.id} to={`/design-books/${b.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-stone-50/80 transition-all duration-150 group border-l-2 border-transparent hover:border-blue-400">
                <div className="flex items-center gap-3 min-w-0">
                  <BookMarked className="w-4 h-4 text-stone-300 shrink-0 group-hover:text-blue-500 transition-colors" />
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="font-mono text-xs text-stone-400 shrink-0">{b.book_code}</span>
                    <span className="text-sm text-stone-600 group-hover:text-blue-700 truncate transition-colors">{b.book_title}</span>
                  </div>
                  {b.project_code && (
                    <span className="hidden sm:flex items-center gap-1 text-xs text-stone-400 shrink-0">
                      <FolderOpen className="w-3 h-3" />{b.project_code}
                    </span>
                  )}
                </div>
                <StatusBadge status={b.status} />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* All recent design books */}
      <div className="bg-white border border-stone-200/80 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 bg-stone-50/50">
          <span className="text-sm font-semibold text-stone-700">All Design Books</span>
          <Link to="/design-books" className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 font-medium transition-colors">
            View all <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="divide-y divide-stone-50/80">
          {isLoading ? (
            <SkeletonRows />
          ) : recentBooks.length === 0 ? (
            <div className="px-4 py-12 flex flex-col items-center gap-3">
              <BookMarked className="w-10 h-10 text-stone-200" />
              <span className="text-sm text-stone-400">No design books yet</span>
              <Link
                to="/design-books"
                className="flex items-center gap-1.5 text-sm font-medium text-violet-600 hover:text-violet-700 border border-violet-200 bg-white px-3 py-1.5 rounded-lg transition-all"
              >
                <Plus className="w-3.5 h-3.5" /> Create your first Design Book
              </Link>
            </div>
          ) : (
            recentBooks.map((b: any) => (
              <Link key={b.id} to={`/design-books/${b.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-stone-50/80 transition-all duration-150 group border-l-2 border-transparent hover:border-violet-400">
                <div className="flex items-center gap-3 min-w-0">
                  <BookMarked className="w-4 h-4 text-stone-300 shrink-0 group-hover:text-violet-500 transition-colors" />
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="font-mono text-xs text-stone-400 shrink-0">{b.book_code}</span>
                    <span className="text-sm text-stone-600 group-hover:text-violet-700 truncate transition-colors">{b.book_title}</span>
                  </div>
                  {b.project_code && (
                    <span className="hidden sm:flex items-center gap-1 text-xs text-stone-400 shrink-0">
                      <FolderOpen className="w-3 h-3" />{b.project_code}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-xs bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded">Rev {b.revision}</span>
                  <StatusBadge status={b.status} />
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
    </div>
  );
}
