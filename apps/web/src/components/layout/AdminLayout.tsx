import { NavLink, Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { useAuthStore } from '../../store/authStore';
import { ADMIN_DOMAIN_LABELS, adminDomainSlug, adminEntryForPath, visibleAdminEntries } from '../../lib/adminRegistry';

/**
 * Wraps every admin page: a side list of the other pages in the same department,
 * with links back to the department and to Settings & Data. Pages keep their own headers.
 */
export default function AdminLayout() {
  const { pathname } = useLocation();
  const user = useAuthStore(state => state.user);
  const current = adminEntryForPath(pathname);
  if (!current) return <Outlet />;

  const siblings = visibleAdminEntries(user).filter(e => e.domain === current.domain);
  const groups = [...new Set(siblings.map(e => e.group))];

  return (
    <div className="flex min-h-full">
      <aside aria-label={`${ADMIN_DOMAIN_LABELS[current.domain]} settings`}
        className="hidden lg:block w-56 shrink-0 border-r border-stone-200 bg-white">
        <div className="sticky top-0 max-h-screen overflow-y-auto px-2 py-4">
          <NavLink to="/admin" end className="block px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-stone-400 hover:text-blue-600">
            Settings &amp; Data
          </NavLink>
          <NavLink to={`/admin/${adminDomainSlug(current.domain)}`} className="mt-1 block px-3 pb-2 text-sm font-semibold text-stone-800 hover:text-blue-600">
            {ADMIN_DOMAIN_LABELS[current.domain]}
          </NavLink>
          {groups.map(group => (
            <div key={group} className="mb-2">
              <div className="px-3 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-stone-400">{group}</div>
              {siblings.filter(e => e.group === group).map(e => (
                <NavLink key={e.id} to={e.to} end
                  className={({ isActive }) => clsx('block rounded-md px-3 py-1.5 text-sm',
                    isActive ? 'bg-blue-50 font-medium text-blue-700' : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900')}>
                  {e.label}
                </NavLink>
              ))}
            </div>
          ))}
        </div>
      </aside>
      <div className="min-w-0 flex-1"><Outlet /></div>
    </div>
  );
}
