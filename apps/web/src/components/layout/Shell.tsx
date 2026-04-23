import { Outlet } from 'react-router-dom';
import LeftNav from './LeftNav';
import TopBar from './TopBar';
import { usePageTitle } from '../../hooks/usePageTitle';

export default function Shell() {
  usePageTitle();
  return (
    <div className="flex h-screen overflow-hidden bg-[#fafaf9]">
      <LeftNav />
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
