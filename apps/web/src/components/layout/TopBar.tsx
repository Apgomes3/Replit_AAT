import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, LogOut } from 'lucide-react';
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
    <header className="h-14 bg-white border-b border-slate-200 flex items-center px-5 gap-4 shrink-0">
      <form onSubmit={handleSearch} className="flex-1 max-w-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search entities, codes, documents..."
            className="w-full bg-slate-100 text-slate-800 text-sm pl-9 pr-4 py-2 rounded-full border border-transparent focus:outline-none focus:bg-white focus:border-[#3E5C76] transition-colors placeholder-slate-400"
          />
        </div>
      </form>

      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-[#3E5C76] flex items-center justify-center text-white text-xs font-semibold shrink-0">
            {initials}
          </div>
          <div className="hidden sm:block">
            <div className="text-sm font-medium text-slate-800 leading-tight">{user?.firstName} {user?.lastName}</div>
            <div className="text-xs text-slate-400 capitalize">{user?.role}</div>
          </div>
        </div>
        <button
          onClick={logout}
          className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
          title="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
