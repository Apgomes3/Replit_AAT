import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Search, Star } from 'lucide-react';
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

  const Tile = ({ entry }: { entry: AdminEntry }) => {
    const Icon = entry.icon;
    const isPinned = pinned.includes(entry.id);
    return (
      <div className="group relative flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-stone-50">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-stone-400 group-hover:text-blue-500" />
        <div className="min-w-0 flex-1">
          <Link to={entry.to} onClick={() => rememberAdminPage(entry.id)}
            className="text-sm font-medium text-stone-800 hover:text-blue-600 after:absolute after:inset-0">{entry.label}</Link>
          <p className="text-xs text-stone-500">{entry.description}</p>
        </div>
        <button type="button" onClick={() => setPinned(togglePinnedAdmin(entry.id))}
          aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${entry.label}`} aria-pressed={isPinned}
          className={clsx('relative z-10 rounded p-1 hover:bg-stone-100', isPinned ? 'text-amber-500' : 'text-stone-300 opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}>
          <Star className={clsx('h-3.5 w-3.5', isPinned && 'fill-current')} />
        </button>
      </div>
    );
  };

  const Card = ({ title, items, href }: { title: string; items: AdminEntry[]; href?: string }) => {
    const groups = [...new Set(items.map(e => e.group))];
    return (
      <section aria-label={title} className="rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
        <h2 className="px-3 pt-1 pb-2 text-sm font-semibold text-stone-800">{href ? <Link to={href} className="hover:text-blue-600">{title}</Link> : title}</h2>
        {items.length === 0 ? <p className="px-3 pb-2 text-xs text-stone-400">Nothing to configure yet</p>
          : groups.map(group => (
            <div key={group} className="mb-1">
              <div className="px-3 pt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-stone-400">{group}</div>
              {items.filter(e => e.group === group).map(e => <Tile key={e.id} entry={e} />)}
            </div>
          ))}
      </section>
    );
  };

  const pinnedEntries = shortcuts(pinned);
  const recentEntries = shortcuts(recent);
  const isAdmin = user?.role === 'admin';
  if (slug && !onlyDomain) return <Navigate to="/admin" replace />;
  const domains = onlyDomain ? [onlyDomain] : DOMAIN_ORDER;
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
          : <Card title={`${matches.length} result${matches.length === 1 ? '' : 's'}`} items={matches} />
      ) : <>
        {!onlyDomain && (pinnedEntries.length > 0 || recentEntries.length > 0) && (
          <div className="grid gap-4 md:grid-cols-2">
            {pinnedEntries.length > 0 && <Card title="Pinned" items={pinnedEntries} />}
            {recentEntries.length > 0 && <Card title="Recently opened" items={recentEntries} />}
          </div>
        )}
        <div className={clsx('grid items-start gap-4', onlyDomain ? 'max-w-3xl' : 'md:grid-cols-2 xl:grid-cols-3')}>
          {domains.map(domain => {
            const items = entries.filter(e => e.domain === domain);
            if (items.length === 0 && !isAdmin) return null;
            return <Card key={domain} title={ADMIN_DOMAIN_LABELS[domain]} items={items} href={onlyDomain ? undefined : `/admin/${adminDomainSlug(domain)}`} />;
          })}
        </div>
      </>}
    </div>
  </div>;
}
