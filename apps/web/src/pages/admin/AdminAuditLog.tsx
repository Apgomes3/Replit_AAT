import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import { ChevronDown, ChevronRight, ClipboardList, RefreshCw } from 'lucide-react';
import clsx from 'clsx';

interface AuditLog {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_id: string;
  actor_name: string;
  actor_email: string;
  details: Record<string, any> | null;
  ip_address: string | null;
  created_at: string;
}

const ACTION_META: Record<string, { label: string; color: string; dot: string }> = {
  CREATE:           { label: 'Create',     color: 'bg-emerald-50 text-emerald-700 ring-emerald-200',  dot: 'bg-emerald-400' },
  UPDATE:           { label: 'Update',     color: 'bg-amber-50 text-amber-700 ring-amber-200',        dot: 'bg-amber-400' },
  DELETE:           { label: 'Delete',     color: 'bg-red-50 text-red-700 ring-red-200',              dot: 'bg-red-400' },
  STATE_TRANSITION: { label: 'Transition', color: 'bg-blue-50 text-blue-700 ring-blue-200',           dot: 'bg-blue-400' },
  APPROVE:          { label: 'Approve',    color: 'bg-emerald-50 text-emerald-700 ring-emerald-200',  dot: 'bg-emerald-400' },
  REJECT:           { label: 'Reject',     color: 'bg-red-50 text-red-700 ring-red-200',              dot: 'bg-red-400' },
  SUBMIT:           { label: 'Submit',     color: 'bg-purple-50 text-purple-700 ring-purple-200',     dot: 'bg-purple-400' },
  IMPORT:           { label: 'Import',     color: 'bg-stone-50 text-stone-600 ring-stone-200',        dot: 'bg-stone-400' },
};

const ENTITY_TYPES = ['project', 'system', 'product', 'component', 'document', 'material', 'purchase_order', 'user'];
const ACTIONS = Object.keys(ACTION_META);

function ActionBadge({ action }: { action: string }) {
  const meta = ACTION_META[action] ?? { label: action, color: 'bg-stone-50 text-stone-600 ring-stone-200', dot: 'bg-stone-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ring-1 ${meta.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function ActorAvatar({ name, email }: { name: string; email: string }) {
  const initials = name
    ? name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
    : email?.slice(0, 2).toUpperCase() ?? '?';
  return (
    <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center shrink-0 ring-1 ring-amber-200">
      {initials}
    </div>
  );
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function DetailsPanel({ details }: { details: Record<string, any> | null }) {
  if (!details || Object.keys(details).length === 0) return <span className="text-stone-300 text-xs">—</span>;
  const entries = Object.entries(details);
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
      {entries.map(([k, v]) => (
        <span key={k} className="text-xs text-stone-500">
          <span className="text-stone-400">{k}:</span>{' '}
          <span className="font-medium text-stone-700">{String(v ?? '—')}</span>
        </span>
      ))}
    </div>
  );
}

function AuditRow({ log }: { log: AuditLog }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = log.details && Object.keys(log.details).length > 0;

  return (
    <>
      <tr
        onClick={() => hasDetails && setExpanded(v => !v)}
        className={clsx(
          'border-b border-stone-100 transition-colors duration-100',
          hasDetails ? 'cursor-pointer hover:bg-stone-50/80' : '',
        )}
      >
        <td className="px-4 py-3 w-8">
          {hasDetails ? (
            expanded
              ? <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
              : <ChevronRight className="w-3.5 h-3.5 text-stone-300" />
          ) : null}
        </td>
        <td className="px-2 py-3 whitespace-nowrap">
          <div className="flex items-center gap-2">
            <ActorAvatar name={log.actor_name} email={log.actor_email} />
            <div className="min-w-0">
              <div className="text-xs font-medium text-stone-700 leading-tight truncate max-w-[120px]">
                {log.actor_name || log.actor_email || 'System'}
              </div>
            </div>
          </div>
        </td>
        <td className="px-3 py-3 whitespace-nowrap">
          <ActionBadge action={log.action} />
        </td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs px-1.5 py-0.5 bg-stone-100 text-stone-500 rounded font-mono capitalize">
              {log.entity_type}
            </span>
            <span className="text-xs text-stone-400 font-mono truncate max-w-[120px]" title={log.entity_id}>
              {log.entity_id.length > 8 ? `…${log.entity_id.slice(-8)}` : log.entity_id}
            </span>
          </div>
        </td>
        <td className="px-3 py-3 max-w-xs">
          <DetailsPanel details={log.details} />
        </td>
        <td className="px-4 py-3 whitespace-nowrap text-right">
          <span className="text-xs text-stone-400" title={new Date(log.created_at).toLocaleString()}>
            {relativeTime(log.created_at)}
          </span>
        </td>
      </tr>
      {expanded && hasDetails && (
        <tr className="bg-stone-50 border-b border-stone-100">
          <td colSpan={6} className="px-6 py-3">
            <pre className="text-xs text-stone-600 font-mono bg-white border border-stone-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(log.details, null, 2)}
            </pre>
            {log.ip_address && (
              <div className="mt-1.5 text-[11px] text-stone-400">IP: {log.ip_address}</div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function AdminAuditLog() {
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const params = new URLSearchParams({ page: String(page), page_size: '50' });
  if (entityType) params.set('entity_type', entityType);
  if (action) params.set('action', action);
  if (actor) params.set('actor', actor);
  if (from) params.set('from', from);
  if (to) params.set('to', to + 'T23:59:59Z');

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['audit-logs', page, entityType, action, actor, from, to],
    queryFn: () => api.get(`/admin/audit-logs?${params}`).then(r => r.data),
  });

  const total: number = data?.pagination?.total ?? 0;
  const pages: number = data?.pagination?.pages ?? 1;
  const items: AuditLog[] = data?.items ?? [];

  const resetFilters = () => {
    setEntityType(''); setAction(''); setActor(''); setFrom(''); setTo('');
    setPage(1);
  };

  const hasFilters = entityType || action || actor || from || to;

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Audit Log"
        subtitle={`Platform activity trail · ${total.toLocaleString()} events`}
        crumbs={[{ label: 'Platform Admin' }, { label: 'Audit Log' }]}
        actions={
          <button
            onClick={() => refetch()}
            className={clsx(
              'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-stone-200 text-stone-500 hover:border-amber-300 hover:text-amber-600 bg-white transition-all',
              isFetching && 'opacity-60'
            )}
          >
            <RefreshCw className={clsx('w-3.5 h-3.5', isFetching && 'animate-spin')} />
            Refresh
          </button>
        }
      />

      <div className="px-4 py-3 border-b border-stone-100 bg-stone-50/60 flex items-center gap-3 flex-wrap">
        <select
          value={entityType} onChange={e => { setEntityType(e.target.value); setPage(1); }}
          className="h-8 pl-2.5 pr-7 text-xs rounded-lg border border-stone-200 bg-white text-stone-700 focus:outline-none focus:border-amber-400 appearance-none"
        >
          <option value="">All Entities</option>
          {ENTITY_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </select>

        <select
          value={action} onChange={e => { setAction(e.target.value); setPage(1); }}
          className="h-8 pl-2.5 pr-7 text-xs rounded-lg border border-stone-200 bg-white text-stone-700 focus:outline-none focus:border-amber-400 appearance-none"
        >
          <option value="">All Actions</option>
          {ACTIONS.map(a => <option key={a} value={a}>{a.replace('_', ' ')}</option>)}
        </select>

        <input
          value={actor} onChange={e => { setActor(e.target.value); setPage(1); }}
          placeholder="Filter by actor…"
          className="h-8 px-2.5 text-xs rounded-lg border border-stone-200 bg-white text-stone-700 placeholder:text-stone-400 focus:outline-none focus:border-amber-400 w-40"
        />

        <div className="flex items-center gap-1.5">
          <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }}
            className="h-8 px-2.5 text-xs rounded-lg border border-stone-200 bg-white text-stone-700 focus:outline-none focus:border-amber-400" />
          <span className="text-xs text-stone-400">→</span>
          <input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }}
            className="h-8 px-2.5 text-xs rounded-lg border border-stone-200 bg-white text-stone-700 focus:outline-none focus:border-amber-400" />
        </div>

        {hasFilters && (
          <button onClick={resetFilters} className="text-xs text-stone-400 hover:text-amber-600 underline underline-offset-2 transition-colors">
            Clear filters
          </button>
        )}

        <span className="ml-auto text-xs text-stone-400">
          {total.toLocaleString()} event{total !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="flex-1 bg-white overflow-auto">
        {isLoading ? (
          <div className="divide-y divide-stone-100">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <div className="skeleton w-7 h-7 rounded-full" />
                <div className="skeleton h-3 w-24 rounded" />
                <div className="skeleton h-5 w-16 rounded-full" />
                <div className="skeleton h-3 w-20 rounded" />
                <div className="skeleton h-3 w-40 rounded" />
                <div className="skeleton h-3 w-16 rounded ml-auto" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-stone-400">
            <ClipboardList className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm font-medium">No audit events found</p>
            {hasFilters && <p className="text-xs mt-1">Try clearing the filters</p>}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-200">
                <th className="px-4 py-2.5 w-8" />
                <th className="px-2 py-2.5 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">Actor</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">Action</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">Entity</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-stone-500 uppercase tracking-wide">Details</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-stone-500 uppercase tracking-wide whitespace-nowrap">When</th>
              </tr>
            </thead>
            <tbody>
              {items.map(log => <AuditRow key={log.id} log={log} />)}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100 bg-white">
          <span className="text-xs text-stone-400">
            Page {page} of {pages} · {total.toLocaleString()} total
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="px-2.5 py-1 text-xs rounded-lg border border-stone-200 text-stone-600 hover:border-amber-300 hover:text-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              ← Prev
            </button>
            {Array.from({ length: Math.min(pages, 7) }).map((_, i) => {
              const p = i + 1;
              return (
                <button key={p} onClick={() => setPage(p)}
                  className={clsx(
                    'w-7 h-7 text-xs rounded-lg border transition-all',
                    page === p
                      ? 'bg-amber-600 border-amber-600 text-white font-medium'
                      : 'border-stone-200 text-stone-600 hover:border-amber-300 hover:text-amber-600'
                  )}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages}
              className="px-2.5 py-1 text-xs rounded-lg border border-stone-200 text-stone-600 hover:border-amber-300 hover:text-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
