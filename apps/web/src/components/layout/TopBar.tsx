import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, LogOut, Bell } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

export default function TopBar() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) { navigate(`/search?q=${encodeURIComponent(q.trim())}`); setQ(''); }
  };

  const initials = [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join('').toUpperCase() || '?';

  return (
    <header className="h-16 bg-white border-b border-stone-200 flex items-center px-6 gap-4 shrink-0">
      <h1 className="text-base font-semibold text-stone-800 shrink-0">Dashboard</h1>

      <div className="flex-1" />

      <form onSubmit={handleSearch} className="w-64">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search products, POs..."
            className="w-full bg-stone-50 border border-stone-200 text-stone-800 text-sm pl-9 pr-4 py-2 rounded-full focus:outline-none focus:bg-white focus:border-amber-500 transition-colors placeholder-stone-400"
          />
        </div>
      </form>

      <button className="relative p-2 text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-full transition-colors">
        <Bell className="w-4 h-4" />
        <span className="absolute top-2 right-2 w-2 h-2 bg-amber-500 rounded-full border border-white" />
      </button>

      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-full bg-amber-600 flex items-center justify-center text-white text-xs font-semibold shrink-0">
          {initials}
        </div>
        <div className="hidden sm:block">
          <div className="text-sm font-medium text-stone-800 leading-tight">{user?.firstName} {user?.lastName}</div>
          <div className="text-xs text-stone-400 capitalize">{user?.role}</div>
        </div>
      </div>

      <button
        onClick={logout}
        className="p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors"
        title="Sign out"
      >
        <LogOut className="w-4 h-4" />
      </button>
    </header>
  );
}
