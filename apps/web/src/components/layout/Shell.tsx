import { Link, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import LeftNav from './LeftNav';
import TopBar from './TopBar';
import { usePageTitle } from '../../hooks/usePageTitle';
import { safeReturnTo } from '../../lib/navigation';

const NAV_COLLAPSED_KEY = 'nav-sidebar-collapsed';

export default function Shell() {
  usePageTitle();
  const location = useLocation();
  const returnTo = safeReturnTo(location.state?.returnTo, '');
  const isWorkReturn = returnTo.startsWith('/search?') || returnTo.startsWith('/my-work');
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem(NAV_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(NAV_COLLAPSED_KEY, String(navCollapsed));
    } catch {
      // Persistence is best effort; navigation remains usable if storage is unavailable.
    }
  }, [navCollapsed]);

  return (
    <div className="flex h-screen overflow-hidden bg-[#fafaf9]">
      {mobileNavOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <div className={`${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-40 transition-transform md:hidden`}>
        <LeftNav
          collapsed={false}
          onToggleCollapsed={() => setMobileNavOpen(false)}
          onNavigate={() => setMobileNavOpen(false)}
        />
      </div>
      <div className="hidden md:block">
        <LeftNav collapsed={navCollapsed} onToggleCollapsed={() => setNavCollapsed(value => !value)} />
      </div>
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar onOpenNavigation={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-auto">
          {isWorkReturn && <div className="bg-blue-50 border-b border-blue-100 px-6 py-2 text-sm">
            <Link to={returnTo} className="text-blue-700 hover:underline">← Return to {location.state?.returnLabel === 'My Work' ? 'My Work' : 'Search'}</Link>
          </div>}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
