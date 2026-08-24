import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import { ChevronDown, ChevronRight, ClipboardList, RefreshCw, Download, AlertCircle, ChevronUp } from 'lucide-react';
import clsx from 'clsx';
import { exportCsv } from '../../lib/exportCsv';

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
  summary?: string | null;
}

// Maps entity_type values to their front-end route patterns.
// Entity types without a registered detail page are omitted — those render as plain text.
const ENTITY_ROUTE_MAP: Record<string, (id: string) => string> = {
  purchase_order: (id) => `/purchase-orders/${id}`,
  project:        (id) => `/projects/${id}`,
  system:         (id) => `/systems/${id}`,
  document:       (id) => `/documents/${id}`,
  product:        (id) => `/products/masters/${id}`,
  component:      (id) => `/products/components/${id}`,
};

/** Maximum rows the export fetches in a single request. Shown in the UI so admins know the bound. */
const EXPORT_MAX_ROWS = 10_000;

const ACTION_META: Record<string, { label: string; color: string; dot: string }> = {
  CREATE:           { label: 'Create',          color: 'bg-emerald-50 text-emerald-700 ring-emerald-200',     dot: 'bg-emerald-400' },
  UPDATE:           { label: 'Update',           color: 'bg-blue-50 text-blue-700 ring-blue-200',             dot: 'bg-blue-400' },
  DELETE:           { label: 'Delete',           color: 'bg-red-50 text-red-700 ring-red-200',                dot: 'bg-red-400' },
  STATE_TRANSITION: { label: 'Transition',       color: 'bg-blue-50 text-blue-700 ring-blue-200',             dot: 'bg-blue-400' },
  APPROVE:          { label: 'Approve',          color: 'bg-emerald-50 text-emerald-700 ring-emerald-200',    dot: 'bg-emerald-400' },
  REJECT:           { label: 'Reject',           color: 'bg-red-50 text-red-700 ring-red-200',                dot: 'bg-red-400' },
  SUBMIT:           { label: 'Submit',           color: 'bg-purple-50 text-purple-700 ring-purple-200',       dot: 'bg-purple-400' },
  IMPORT:           { label: 'Import',           color: 'bg-stone-50 text-stone-600 ring-stone-200',          dot: 'bg-stone-400' },
  BLOCK:            { label: 'Block',            color: 'bg-red-50 text-red-700 ring-red-200',                dot: 'bg-red-400' },
  UNBLOCK:          { label: 'Unblock',          color: 'bg-emerald-50 text-emerald-700 ring-emerald-200',    dot: 'bg-emerald-400' },
  RESET_PASSWORD:   { label: 'Reset Password',   color: 'bg-violet-50 text-violet-700 ring-violet-200',       dot: 'bg-violet-400' },
  INVITE:           { label: 'Invite',           color: 'bg-sky-50 text-sky-700 ring-sky-200',                dot: 'bg-sky-400' },
  SEND_RESET_LINK:  { label: 'Send Reset Link',  color: 'bg-violet-50 text-violet-700 ring-violet-200',       dot: 'bg-violet-400' },
};

const ENTITY_TYPES = ['project', 'system', 'product', 'component', 'document', 'material', 'purchase_order', 'user'];
const ACTIONS = Object.keys(ACTION_META);

/** Simple debounce hook — delays a value by `delay` ms after it stops changing. */
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/** Generates a page number sequence with ellipsis for smart pagination. */
function buildPageSequence(current: number, total: number): (number | '…')[] {
  const show = new Set<number>([1, total]);
  for (let p = Math.max(1, current - 2); p <= Math.min(total, current + 2); p++) show.add(p);
  const sorted = [...show].sort((a, b) => a - b);
  const result: (number | '…')[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('…');
    result.push(sorted[i]);
  }
  return result;
}

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
    <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0 ring-1 ring-blue-200">
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

/** Renders the entity type + ID, linking to the detail page when a route is known. */
function EntityCell({ entityType, entityId }: { entityType: string; entityId: string }) {
  const routeFn = ENTITY_ROUTE_MAP[entityType];
  const shortId = entityId.length > 8 ? `…${entityId.slice(-8)}` : entityId;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs px-1.5 py-0.5 bg-stone-100 text-stone-500 rounded font-mono capitalize">
        {entityType.replace(/_/g, ' ')}
      </span>
      {routeFn ? (
        <Link
          to={routeFn(entityId)}
          title={entityId}
          onClick={e => e.stopPropagation()}
          className="text-xs text-blue-600 hover:text-blue-800 font-mono truncate max-w-[120px] hover:underline underline-offset-2 transition-colors"
        >
          {shortId}
        </Link>
      ) : (
        <span className="text-xs text-stone-400 font-mono truncate max-w-[120px]" title={entityId}>
          {shortId}
        </span>
      )}
    </div>
  );
}

/** Expanded details panel: summary at top, raw JSON in collapsible section. */
function DetailsPanel({ log }: { log: AuditLog }) {
  const [rawOpen, setRawOpen] = useState(false);

  const summary = log.summary ?? log.details?.summary ?? null;
  const hasDetails = log.details && Object.keys(log.details).length > 0;

  if (!hasDetails && !summary) {
    return <span className="text-stone-300 text-xs">—</span>;
  }

  return (
    <div className="space-y-2">
      {/* Human-readable summary — shown prominently */}
      {summary && (
        <p className="text-sm font-medium text-stone-700">{summary}</p>
      )}

      {/* Key-value pairs from details (excluding internal `summary` key) */}
      {hasDetails && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {Object.entries(log.details!).filter(([k]) => k !== 'summary').map(([k, v]) => (
            <span key={k} className="text-xs text-stone-500">
              <span className="text-stone-400">{k}:</span>{' '}
              <span className="font-medium text-stone-700">{String(v ?? '—')}</span>
            </span>
          ))}
        </div>
      )}

      {/* Collapsible raw JSON payload */}
      {hasDetails && (
        <div>
          <button
            type="button"
            onClick={() => setRawOpen(v => !v)}
            className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-stone-600 transition-colors"
          >
            {rawOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Raw payload
          </button>
          {rawOpen && (
            <pre className="mt-1.5 text-xs text-stone-600 font-mono bg-white border border-stone-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(log.details, null, 2)}
            </pre>
          )}
        </div>
      )}

      {log.ip_address && (
        <div className="text-[11px] text-stone-400">IP: {log.ip_address}</div>
      )}
    </div>
  );
}

/** Compact key-value summary shown inline in the table row (before expansion). */
function InlineDetails({ details }: { details: Record<string, any> | null }) {
  if (!details || Object.keys(details).length === 0) return <span className="text-stone-300 text-xs">—</span>;
  // Show summary string if present, otherwise key-value pairs
  if (details.summary) {
    return (
      <span className="text-xs text-stone-600 truncate max-w-xs block" title={details.summary}>
        {details.summary}
      </span>
    );
  }
  const entries = Object.entries(details).slice(0, 3);
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
  const hasDetails = (log.details && Object.keys(log.details).length > 0) || !!log.summary;

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
          <EntityCell entityType={log.entity_type} entityId={log.entity_id} />
        </td>
        <td className="px-3 py-3 max-w-xs">
          <InlineDetails details={log.details} />
        </td>
        <td className="px-4 py-3 whitespace-nowrap text-right">
          <span className="text-xs text-stone-400" title={new Date(log.created_at).toLocaleString()}>
            {relativeTime(log.created_at)}
          </span>
        </td>
      </tr>
      {expanded && hasDetails && (
        <tr className="bg-stone-50 border-b border-stone-100">
          <td colSpan={6} className="px-6 py-4">
            <DetailsPanel log={log} />
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

  // Raw (immediate) values for controlled inputs
  const [actorInput, setActorInput] = useState('');
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');

  // Debounced values (350 ms) — these drive the API query
  const actor = useDebounce(actorInput, 350);
  const from  = useDebounce(fromInput, 350);
  const to    = useDebounce(toInput, 350);

  // Reset to page 1 when debounced values change
  const prevFilters = useRef({ actor, from, to });
  useEffect(() => {
    const prev = prevFilters.current;
    if (prev.actor !== actor || prev.from !== from || prev.to !== to) {
      setPage(1);
      prevFilters.current = { actor, from, to };
    }
  }, [actor, from, to]);

  const [exporting, setExporting] = useState(false);

  const params = new URLSearchParams({ page: String(page), page_size: '50' });
  if (entityType) params.set('entity_type', entityType);
  if (action) params.set('action', action);
  if (actor) params.set('actor', actor);
  if (from) params.set('from', from);
  if (to) params.set('to', to + 'T23:59:59Z');

  // Detect in-flight debounce (input differs from debounced value)
  const isDebouncing = actorInput !== actor || fromInput !== from || toInput !== to;

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['audit-logs', page, entityType, action, actor, from, to],
    queryFn: () => api.get(`/admin/audit-logs?${params}`).then(r => r.data),
  });

  const total: number = data?.pagination?.total ?? 0;
  const pages: number = data?.pagination?.pages ?? 1;
  const items: AuditLog[] = data?.items ?? [];

  const pageSize = 50;
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  const resetFilters = () => {
    setEntityType(''); setAction('');
    setActorInput(''); setFromInput(''); setToInput('');
    setPage(1);
  };

  const hasFilters = entityType || action || actorInput || fromInput || toInput;

  const handleExport = async () => {
    setExporting(true);
    try {
      // Fetch up to EXPORT_MAX_ROWS rows matching the current filters in one request.
      // The backend caps page_size at 10 000; if total > EXPORT_MAX_ROWS the download
      // will contain the EXPORT_MAX_ROWS most-recent matching events (shown in filename).
      const exportParams = new URLSearchParams(params);
      exportParams.set('page_size', String(EXPORT_MAX_ROWS));
      exportParams.set('page', '1');
      const res = await api.get(`/admin/audit-logs?${exportParams}`).then(r => r.data);
      const rows: AuditLog[] = res.items ?? [];
      const exportTotal: number = res.pagination?.total ?? rows.length;
      const capped = exportTotal > EXPORT_MAX_ROWS;
      const filename = capped
        ? `audit-log-first-${EXPORT_MAX_ROWS.toLocaleString()}.csv`
        : 'audit-log.csv';
      if (capped) {
        // Inform the admin that the result was truncated
        window.alert(
          `The filtered log contains ${exportTotal.toLocaleString()} events. ` +
          `The export is limited to the ${EXPORT_MAX_ROWS.toLocaleString()} most-recent matching events. ` +
          `Use date filters to narrow the range and re-export if you need the full set.`
        );
      }
      exportCsv(filename, [
        { header: 'Timestamp',   value: (r: AuditLog) => new Date(r.created_at).toISOString() },
        { header: 'Actor Email', value: (r: AuditLog) => r.actor_email || '' },
        { header: 'Actor Name',  value: (r: AuditLog) => r.actor_name || '' },
        { header: 'Action',      value: (r: AuditLog) => r.action },
        { header: 'Entity Type', value: (r: AuditLog) => r.entity_type },
        { header: 'Entity ID',   value: (r: AuditLog) => r.entity_id },
        { header: 'Summary',     value: (r: AuditLog) => r.summary ?? r.details?.summary ?? JSON.stringify(r.details) ?? '' },
      ], rows);
    } catch (e) {
      console.error('[export]', e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Audit Log"
        subtitle={`Platform activity trail · ${total.toLocaleString()} events`}
        crumbs={[{ label: 'Platform Admin' }, { label: 'Audit Log' }]}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              disabled={exporting || total === 0}
              className={clsx(
                'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-stone-200 text-stone-500 hover:border-blue-300 hover:text-blue-600 bg-white transition-all',
                (exporting || total === 0) && 'opacity-50 cursor-not-allowed'
              )}
            >
              <Download className={clsx('w-3.5 h-3.5', exporting && 'animate-pulse')} />
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
            <button
              onClick={() => refetch()}
              className={clsx(
                'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-stone-200 text-stone-500 hover:border-blue-300 hover:text-blue-600 bg-white transition-all',
                isFetching && 'opacity-60'
              )}
            >
              <RefreshCw className={clsx('w-3.5 h-3.5', isFetching && 'animate-spin')} />
              Refresh
            </button>
          </div>
        }
      />

      {/* Filter bar */}
      <div className="px-4 py-3 border-b border-stone-100 bg-stone-50/60 flex items-center gap-3 flex-wrap">
        <select
          value={entityType} onChange={e => { setEntityType(e.target.value); setPage(1); }}
          className="h-8 pl-2.5 pr-7 text-xs rounded-lg border border-stone-200 bg-white text-stone-700 focus:outline-none focus:border-blue-400 appearance-none"
        >
          <option value="">All Entities</option>
          {ENTITY_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>

        <select
          value={action} onChange={e => { setAction(e.target.value); setPage(1); }}
          className="h-8 pl-2.5 pr-7 text-xs rounded-lg border border-stone-200 bg-white text-stone-700 focus:outline-none focus:border-blue-400 appearance-none"
        >
          <option value="">All Actions</option>
          {ACTIONS.map(a => <option key={a} value={a}>{ACTION_META[a].label}</option>)}
        </select>

        {/* Actor search — debounced */}
        <div className="relative">
          <input
            value={actorInput}
            onChange={e => setActorInput(e.target.value)}
            placeholder="Filter by actor…"
            className="h-8 px-2.5 text-xs rounded-lg border border-stone-200 bg-white text-stone-700 placeholder:text-stone-400 focus:outline-none focus:border-blue-400 w-40"
          />
          {isDebouncing && actorInput !== actor && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          )}
        </div>

        {/* Date range — debounced */}
        <div className="flex items-center gap-1.5 relative">
          <input
            type="date" value={fromInput}
            onChange={e => setFromInput(e.target.value)}
            className="h-8 px-2.5 text-xs rounded-lg border border-stone-200 bg-white text-stone-700 focus:outline-none focus:border-blue-400"
          />
          <span className="text-xs text-stone-400">→</span>
          <input
            type="date" value={toInput}
            onChange={e => setToInput(e.target.value)}
            className="h-8 px-2.5 text-xs rounded-lg border border-stone-200 bg-white text-stone-700 focus:outline-none focus:border-blue-400"
          />
          {isDebouncing && (fromInput !== from || toInput !== to) && (
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          )}
        </div>

        {hasFilters && (
          <button onClick={resetFilters} className="text-xs text-stone-400 hover:text-blue-600 underline underline-offset-2 transition-colors">
            Clear filters
          </button>
        )}

        <span className="ml-auto text-xs text-stone-400">
          {total.toLocaleString()} event{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Main content area */}
      <div className="flex-1 bg-white overflow-auto">
        {isError ? (
          /* Error panel */
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-5 h-5" />
              <p className="text-sm font-medium">Failed to load audit log</p>
            </div>
            <p className="text-xs text-stone-400 max-w-sm text-center">
              {(error as any)?.message ?? 'An unexpected error occurred. Please try again.'}
            </p>
            <button
              onClick={() => refetch()}
              className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </button>
          </div>
        ) : isLoading ? (
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

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100 bg-white">
          <span className="text-xs text-stone-400">
            {total === 0
              ? 'No results'
              : `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${total.toLocaleString()}`}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="px-2.5 py-1 text-xs rounded-lg border border-stone-200 text-stone-600 hover:border-blue-300 hover:text-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              ← Prev
            </button>

            {buildPageSequence(page, pages).map((p, i) =>
              p === '…' ? (
                <span key={`ellipsis-${i}`} className="w-7 text-center text-xs text-stone-400 select-none">…</span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={clsx(
                    'w-7 h-7 text-xs rounded-lg border transition-all',
                    page === p
                      ? 'bg-blue-600 border-blue-600 text-white font-medium'
                      : 'border-stone-200 text-stone-600 hover:border-blue-300 hover:text-blue-600'
                  )}
                >
                  {p}
                </button>
              )
            )}

            <button
              onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages}
              className="px-2.5 py-1 text-xs rounded-lg border border-stone-200 text-stone-600 hover:border-blue-300 hover:text-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
