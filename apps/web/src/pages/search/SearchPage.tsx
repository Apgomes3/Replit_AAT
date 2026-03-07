import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import api from '../../lib/api';
import { SearchResult } from '../../types';
import EntityCode from '../../components/ui/EntityCode';
import StatusBadge from '../../components/ui/StatusBadge';
import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';

const typeLinks: Record<string, (r: SearchResult) => string> = {
  project: r => `/projects/${r.id}`,
  system: r => `/systems/${r.id}`,
  equipment: r => `/equipment/${r.id}`,
  product: r => `/products/masters/${r.id}`,
  material: r => `/knowledge/materials`,
  document: r => `/documents/${r.id}`,
};

const typeLabels: Record<string, string> = {
  project: 'Project', system: 'System', equipment: 'Equipment',
  product: 'Product', material: 'Material', document: 'Document',
};

const typeColors: Record<string, string> = {
  project: 'bg-blue-100 text-blue-700',
  system: 'bg-blue-50 text-blue-600',
  equipment: 'bg-indigo-100 text-indigo-700',
  product: 'bg-green-100 text-green-700',
  material: 'bg-gray-100 text-gray-600',
  document: 'bg-orange-100 text-orange-700',
};

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [q, setQ] = useState(searchParams.get('q') || '');

  useEffect(() => { setQ(searchParams.get('q') || ''); }, [searchParams]);

  const { data, isLoading } = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.get(`/search?q=${encodeURIComponent(q)}`).then(r => r.data),
    enabled: q.length >= 2,
  });

  const grouped = (data?.results || []).reduce((acc: Record<string, SearchResult[]>, r: SearchResult) => {
    (acc[r.type] = acc[r.type] || []).push(r);
    return acc;
  }, {});

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-semibold text-slate-800 mb-4">Search</h1>
      <form onSubmit={e => { e.preventDefault(); navigate(`/search?q=${encodeURIComponent(q)}`); }}>
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search across all entities..."
            className="w-full border border-slate-300 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-[#3E5C76] shadow-sm" />
        </div>
      </form>

      {q.length < 2 && <div className="text-slate-400 text-sm">Enter at least 2 characters to search</div>}
      {isLoading && <div className="text-slate-400 text-sm">Searching...</div>}
      {data && !isLoading && (
        <>
          <div className="text-sm text-slate-500 mb-4">{data.total} results for "{data.query}"</div>
          {data.total === 0 && <div className="text-slate-400">No results found</div>}
          {Object.entries(grouped).map(([type, items]) => (
            <div key={type} className="mb-6">
              <div className="text-xs text-slate-400 uppercase tracking-wide font-medium mb-2">{typeLabels[type] || type}</div>
              <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
                {(items as SearchResult[]).map(r => {
                  const href = typeLinks[r.type]?.(r) || '/';
                  return (
                    <Link key={r.id} to={href} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${typeColors[r.type] || 'bg-gray-100 text-gray-600'}`}>{typeLabels[r.type] || r.type}</span>
                      <EntityCode code={r.code} />
                      <span className="text-sm text-slate-700 flex-1 truncate">{r.name}</span>
                      {r.status && <StatusBadge status={r.status} />}
                      {r.project_code && <span className="text-xs text-slate-400">{r.project_code}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
