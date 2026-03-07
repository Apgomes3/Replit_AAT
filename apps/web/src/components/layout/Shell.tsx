import { Outlet } from 'react-router-dom';
import LeftNav from './LeftNav';
import TopBar from './TopBar';

export default function Shell() {
  return (
    <div className="flex h-screen overflow-hidden bg-[#F8FAFC]">
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
