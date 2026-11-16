import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { SearchResult } from '../../types';
import EntityCode from '../../components/ui/EntityCode';
import StatusBadge from '../../components/ui/StatusBadge';
import { currentReturnContext } from '../../lib/navigation';
import QueryError from '../../components/ui/QueryError';
import { supportError } from '../../lib/supportError';

const labels: Record<string, string> = {
  person: 'Person', project: 'Project', system: 'System', equipment: 'Equipment', product: 'Product',
  component: 'Component', material: 'Material', document: 'Document', purchase_order: 'Purchase Order',
  client: 'Client', contact: 'Client contact', enquiry: 'Enquiry', design_book: 'Design Book',
  drafting_plan: 'Drafting plan', initiative: 'Initiative', notification: 'Notification', audit_event: 'Audit event',
};
const modules = [
  ['people', 'People'], ['projects', 'Projects'], ['initiatives', 'Initiatives'], ['clients', 'Clients & contacts'], ['orders', 'Orders'],
  ['design_books', 'Design Books'], ['drafting', 'Drafting'], ['pim', 'Products'],
  ['business_development', 'Business Development'], ['documents', 'Documents'], ['knowledge', 'Knowledge'],
  ['admin', 'Audit'],
];

type RecordRow = SearchResult & { href: string; module: string; due_date?: string; owner_id?: string; attention?: string };
export default function SearchPage({ work = false }: { work?: boolean }) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [draft, setDraft] = useState(params.get('q') ?? '');
  const q = params.get('q') ?? '';
  useEffect(() => setDraft(q), [q]);
  const page = Math.max(1, Number(params.get('page')) || 1);
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };
  const endpoint = work ? '/search/my-work' : '/search';
  const { data, isLoading, isError, error, refetch } = useQuery<{ results: RecordRow[]; total: number; page_size: number; query: string }>({
    queryKey: [endpoint, params.toString()],
    queryFn: () => api.get(`${endpoint}?${params}`).then(r => r.data),
    enabled: work || q.trim().length >= 2,
  });
  const title = work ? 'My Work' : 'Search';
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-semibold text-slate-800">{title}</h1>
        <Link className="text-sm text-blue-600 hover:underline" to={work ? '/search' : '/my-work'}>{work ? 'Search all records' : 'My Work'}</Link>
      </div>
      <form onSubmit={e => { e.preventDefault(); update('q', draft.trim()); }} className="flex gap-2 mb-4">
        <input aria-label="Search records" value={draft} onChange={e => setDraft(e.target.value)}
          placeholder={work ? 'Filter your work' : 'Search people, projects, clients, products… by name or code'}
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Search</button>
      </form>
      <div className="flex flex-wrap gap-3 mb-5">
        <label className="text-xs text-slate-600">Module
          <select aria-label="Module" value={params.get('module') ?? ''} onChange={e => update('module', e.target.value)} className="block border rounded p-2 mt-1 text-sm">
            <option value="">All modules</option>{modules.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">Type
          <select aria-label="Type" value={params.get('type') ?? ''} onChange={e => update('type', e.target.value)} className="block border rounded p-2 mt-1 text-sm">
            <option value="">All types</option>{Object.entries(labels).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">Status
          <input aria-label="Status" value={params.get('status') ?? ''} onChange={e => update('status', e.target.value)}
            placeholder="e.g. draft" className="block border rounded p-2 mt-1 text-sm w-32" />
        </label>
        <label className="text-xs text-slate-600">Owner or assignee
          <select aria-label="Owner or assignee" value={params.get('owner') ?? ''} onChange={e => update('owner', e.target.value)} className="block border rounded p-2 mt-1 text-sm">
            <option value="">All</option><option value="mine">Created by me</option><option value="assigned">Assigned to me</option>
          </select>
        </label>
        <label className="text-xs text-slate-600">Due date
          <select aria-label="Due date" value={params.get('due') ?? ''} onChange={e => update('due', e.target.value)} className="block border rounded p-2 mt-1 text-sm">
            <option value="">Any date</option><option value="overdue">Overdue</option><option value="today">Today</option><option value="upcoming">Upcoming</option>
          </select>
        </label>
      </div>
      {!work && q.trim().length < 2 ? <p className="text-sm text-slate-500">Enter at least 2 characters to search.</p> :
        isLoading ? <p className="text-sm text-slate-500">Loading…</p> :
        isError ? <QueryError message="Could not load records" detail={supportError(error, 'Search results may be out of date.')} onRetry={() => void refetch()} /> :
        <>
          <p className="text-sm text-slate-500 mb-3">{data?.total ?? 0} {work ? 'items needing attention' : 'results'}</p>
          {data?.total === 0 && <p className="border rounded-lg p-8 text-center text-slate-500">{work ? 'No work matches these filters.' : 'No records match this search.'}</p>}
          <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
            {data?.results.map(r => <Link key={`${r.type}-${r.id}`} to={r.href}
              state={currentReturnContext(location.pathname, location.search, title)}
              className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50">
              <span className="text-xs rounded bg-blue-50 text-blue-700 px-2 py-1">{labels[r.type] ?? r.type}</span>
              <EntityCode code={r.code} />
              <span className="text-sm text-slate-700 flex-1 min-w-32 truncate">{r.name}</span>
              {r.attention && <span className="text-xs text-amber-700">{r.attention}</span>}
              {r.status && <StatusBadge status={r.status} />}
              {r.due_date && <span className="text-xs text-slate-500">Due {String(r.due_date).slice(0, 10)}</span>}
              {r.project_code && <span className="text-xs text-slate-400">{r.project_code}</span>}
            </Link>)}
          </div>
          {(data?.total ?? 0) > (data?.page_size ?? 25) && <div className="flex justify-between items-center mt-5 text-sm">
            <button disabled={page <= 1} onClick={() => update('page', String(page - 1))} className="disabled:opacity-40 text-blue-600">Previous</button>
            <span>Page {page} of {Math.ceil((data?.total ?? 0) / (data?.page_size ?? 25))}</span>
            <button disabled={page * (data?.page_size ?? 25) >= (data?.total ?? 0)} onClick={() => update('page', String(page + 1))} className="disabled:opacity-40 text-blue-600">Next</button>
          </div>}
        </>}
    </div>
  );
}