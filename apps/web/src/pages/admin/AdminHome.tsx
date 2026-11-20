import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { AlertTriangle, Search, Star } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';
import clsx from 'clsx';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import { useAuthStore } from '../../store/authStore';
import {
  ADMIN_DOMAIN_LABELS, AdminDomain, AdminEntry, adminDomainFromSlug, adminDomainSlug, loadPinnedAdmin, loadRecentAdmin, matchesAdminSearch,
  rememberAdminPage, togglePinnedAdmin, visibleAdminEntries,
} from '../../lib/adminRegistry';

const DOMAIN_ORDER = Object.keys(ADMIN_DOMAIN_LABELS) as AdminDomain[];

/** Settings & Data: every admin page, grouped by department, with search, pins and recents.
 *  At /admin/<department> it shows only that department. */
export default function AdminHome() {
  const { domain: slug } = useParams();
  const onlyDomain = adminDomainFromSlug(slug);
  const user = useAuthStore(state => state.user);
  const entries = useMemo(() => visibleAdminEntries(user).filter(e => !onlyDomain || e.domain === onlyDomain), [user, onlyDomain]);
  const [query, setQuery] = useState('');
  const [pinned, setPinned] = useState(loadPinnedAdmin);
  const recent = useMemo(loadRecentAdmin, []);
  const byId = useMemo(() => new Map(entries.map(e => [e.id, e])), [entries]);
  const shortcuts = (ids: string[]) => ids.map(id => byId.get(id)).filter((e): e is AdminEntry => !!e);

  const matches = entries.filter(e => matchesAdminSearch(e, query));
  const searching = query.trim().length > 0;
  const summary = useQuery<{ counts: Record<string, number>; alerts: Array<{ id: string; message: string }> }>({
    queryKey: ['admin-settings-summary'],
    queryFn: () => api.get('/admin/settings-summary').then(r => r.data),
    staleTime: 60_000,
    retry: false,
  });
  const counts = summary.data?.counts ?? {};
  const alertFor = (id: string) => summary.data?.alerts.find(a => a.id === id);

  // Plain render functions (not inner components) so tiles keep their DOM nodes when data arrives.
  const renderTile = (entry: AdminEntry) => {
    const Icon = entry.icon;
    const isPinned = pinned.includes(entry.id);
    const alert = alertFor(entry.id);
    return (
      <div key={entry.id} title={entry.description}
        className="group relative flex items-center gap-2.5 rounded-lg border border-stone-200 bg-white px-3 py-2 hover:border-blue-200 hover:bg-blue-50/40">
        <Icon className="h-4 w-4 shrink-0 text-stone-400 group-hover:text-blue-500" />
        <Link to={entry.to} onClick={() => rememberAdminPage(entry.id)}
          className="min-w-0 flex-1 truncate text-sm font-medium text-stone-800 hover:text-blue-600 after:absolute after:inset-0">{entry.label}</Link>
        {alert && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label={alert.message} />}
        {counts[entry.id] !== undefined && <span className="shrink-0 rounded-full bg-stone-100 px-1.5 text-[11px] tabular-nums text-stone-500"
          title={`${counts[entry.id]} records`}>{counts[entry.id]}</span>}
        <button type="button" onClick={() => setPinned(togglePinnedAdmin(entry.id))}
          aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${entry.label}`} aria-pressed={isPinned}
          className={clsx('relative z-10 shrink-0 rounded p-0.5 hover:bg-stone-100', isPinned ? 'text-amber-500' : 'text-stone-300 opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}>
          <Star className={clsx('h-3.5 w-3.5', isPinned && 'fill-current')} />
        </button>
      </div>
    );
  };

  const TILE_GRID = 'grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

  /** One department (or result set): group headings, each with a compact tile grid. */
  const renderSection = (title: string, items: AdminEntry[], href?: string, grouped = true) => {
    const groups = grouped ? [...new Set(items.map(e => e.group))] : [null];
    return (
      <section key={title} aria-label={title}>
        <h2 className="mb-2 text-sm font-semibold text-stone-800">{href ? <Link to={href} className="hover:text-blue-600">{title}</Link> : title}</h2>
        {items.length === 0 ? <p className="text-xs text-stone-400">Nothing to configure yet</p>
          : groups.map(group => (
            <div key={group ?? 'all'} className="mb-3">
              {group && <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-stone-400">{group}</div>}
              <div className={TILE_GRID}>{items.filter(e => !group || e.group === group).map(renderTile)}</div>
            </div>
          ))}
      </section>
    );
  };

  const pinnedEntries = shortcuts(pinned);
  const recentEntries = shortcuts(recent);
  const isAdmin = user?.role === 'admin';
  const attention = (summary.data?.alerts ?? []).map(a => ({ alert: a, entry: byId.get(a.id) })).filter(x => x.entry);
  const shownDomains = DOMAIN_ORDER.filter(d => isAdmin || entries.some(e => e.domain === d));
  const [chip, setChip] = useState<AdminDomain | 'all' | null>(null);
  // Open on the person's own department; management, admins without one, and everyone else see all.
  const ownDomain = user?.department && user.department !== 'management' ? adminDomainFromSlug(user.department) : null;
  const activeChip = chip ?? (ownDomain && entries.some(e => e.domain === ownDomain) ? ownDomain : 'all');
  if (slug && !onlyDomain) return <Navigate to="/admin" replace />;
  const domains = onlyDomain ? [onlyDomain] : activeChip === 'all' ? shownDomains : [activeChip];
  const pageTitle = onlyDomain ? ADMIN_DOMAIN_LABELS[onlyDomain] : 'Settings & Data';

  return <div>
    <PageHeader crumbs={onlyDomain ? [{ label: 'Settings & Data', href: '/admin' }, { label: pageTitle }] : [{ label: 'Settings & Data' }]} title={pageTitle}
      subtitle={onlyDomain ? `Reference data and rules for ${pageTitle}.` : 'Reference data, rules and access for every department.'} />
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
        <label htmlFor="admin-search" className="sr-only">Search settings</label>
        <input id="admin-search" autoFocus value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search settings, e.g. pump, currency, roles…"
          className="w-full rounded-lg border border-stone-200 bg-white py-2 pl-9 pr-3 text-sm" />
      </div>

      {searching ? (
        matches.length === 0
          ? <EmptyState icon={Search} title={`No settings match “${query.trim()}”`} actionLabel="Clear search" onAction={() => setQuery('')} />
          : renderSection(`${matches.length} result${matches.length === 1 ? '' : 's'}`, matches, undefined, false)
      ) : <>
        {attention.length > 0 && (
          <section aria-label="Needs attention" className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-800"><AlertTriangle className="h-4 w-4" aria-hidden /> Needs attention</h2>
            <ul className="flex flex-wrap gap-2">
              {attention.map(({ alert, entry }) => (
                <li key={alert.id}>
                  <Link to={entry!.to} onClick={() => rememberAdminPage(entry!.id)}
                    className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-sm hover:border-amber-300">
                    <span className="font-medium text-stone-800">{entry!.label}</span>
                    <span className="text-xs text-amber-700">{alert.message}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!onlyDomain && pinnedEntries.length > 0 && renderSection('Pinned', pinnedEntries, undefined, false)}
        {!onlyDomain && recentEntries.length > 0 && renderSection('Recently opened', recentEntries, undefined, false)}
        {!onlyDomain && shownDomains.length > 1 && (
          <div role="group" aria-label="Department" className="flex flex-wrap gap-1.5 border-t border-stone-200 pt-4">
            {(['all', ...shownDomains] as const).map(d => (
              <button key={d} type="button" onClick={() => setChip(d)} aria-pressed={activeChip === d}
                className={clsx('rounded-full border px-3 py-1.5 text-xs font-bold',
                  activeChip === d ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700' : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50')}>
                {d === 'all' ? 'All' : ADMIN_DOMAIN_LABELS[d]}
              </button>
            ))}
          </div>
        )}
        <div className="space-y-6">
          {domains.map(domain => renderSection(ADMIN_DOMAIN_LABELS[domain], entries.filter(e => e.domain === domain),
            onlyDomain ? undefined : `/admin/${adminDomainSlug(domain)}`))}
        </div>
      </>}
    </div>
  </div>;
}
