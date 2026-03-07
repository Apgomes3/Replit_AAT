import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, LogOut, User } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

export default function TopBar() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) { navigate(`/search?q=${encodeURIComponent(q.trim())}`); setQ(''); }
  };

  return (
    <header className="h-12 bg-[#1F2A44] border-b border-[#2d3d5c] flex items-center px-4 gap-4 shrink-0">
      <form onSubmit={handleSearch} className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#748CAB]" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search entities, codes, documents..."
            className="w-full bg-[#2d3d5c] text-white text-sm pl-8 pr-3 py-1.5 rounded border border-[#3E5C76] focus:outline-none focus:border-[#748CAB] placeholder-[#748CAB]"
          />
        </div>
      </form>
      <div className="ml-auto flex items-center gap-3 text-sm">
        <div className="flex items-center gap-1.5 text-[#748CAB]">
          <User className="w-4 h-4" />
          <span className="text-white">{user?.firstName} {user?.lastName}</span>
          <span className="bg-[#3E5C76] text-[#A8C4E0] text-xs px-1.5 py-0.5 rounded capitalize">{user?.role}</span>
        </div>
        <button onClick={logout} className="text-[#748CAB] hover:text-white p-1 rounded hover:bg-[#2d3d5c] transition-colors">
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
