import { Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import LeftNav from './LeftNav';
import TopBar from './TopBar';
import { usePageTitle } from '../../hooks/usePageTitle';

const NAV_COLLAPSED_KEY = 'nav-sidebar-collapsed';

export default function Shell() {
  usePageTitle();
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem(NAV_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(NAV_COLLAPSED_KEY, String(navCollapsed));
    } catch {
      // Persistence is best effort; navigation remains usable if storage is unavailable.
    }
  }, [navCollapsed]);

  return (
    <div className="flex h-screen overflow-hidden bg-[#fafaf9]">
      <LeftNav collapsed={navCollapsed} onToggleCollapsed={() => setNavCollapsed(value => !value)} />
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
