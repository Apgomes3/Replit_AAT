import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { Database } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Login() {
  const { user, login } = useAuthStore();
  const [email, setEmail] = useState('admin@edp.com');
  const [password, setPassword] = useState('admin123');
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
    } catch {
      toast.error('Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'linear-gradient(145deg, #fafaf9 0%, #f0ede9 40%, #e8e3dc 100%)' }}>

      <div className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(217,119,6,0.07) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(180,83,9,0.05) 0%, transparent 40%)',
        }} />

      <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 39px, #78716c 39px, #78716c 40px), repeating-linear-gradient(90deg, transparent, transparent 39px, #78716c 39px, #78716c 40px)',
        }} />

      <div className="w-full max-w-sm relative animate-fade-in-up">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-lg"
            style={{ background: 'linear-gradient(135deg, #d97706 0%, #92400e 100%)' }}>
            <Database className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-stone-800 text-xl font-bold tracking-tight">Shark OS</h1>
            <p className="text-stone-400 text-sm">Sign in to continue</p>
          </div>
        </div>

        <form onSubmit={handleSubmit}
          className="rounded-2xl border border-white/80 p-7 space-y-4"
          style={{
            background: 'rgba(255,255,255,0.75)',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 20px 60px -10px rgba(0,0,0,0.12), 0 0 0 1px rgba(255,255,255,0.5) inset',
          }}>
          <div>
            <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.12em] mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm bg-white/60 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/15 transition-all duration-200 text-stone-800 placeholder-stone-300"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.12em] mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm bg-white/60 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-500/15 transition-all duration-200 text-stone-800 placeholder-stone-300"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full text-white rounded-xl py-2.5 text-sm font-semibold transition-all duration-200 disabled:opacity-50 active:scale-[0.98] shadow-md hover:shadow-lg"
            style={{ background: loading ? '#d97706' : 'linear-gradient(135deg, #d97706 0%, #b45309 100%)' }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Signing in…
              </span>
            ) : 'Sign In'}
          </button>
          <div className="text-xs text-stone-400 space-y-1 pt-2 border-t border-stone-100">
            <div><strong className="text-stone-500">Admin:</strong> admin@edp.com / admin123</div>
            <div><strong className="text-stone-500">Engineer:</strong> engineer@edp.com / engineer123</div>
            <div><strong className="text-stone-500">Viewer:</strong> viewer@edp.com / viewer123</div>
          </div>
        </form>
      </div>
    </div>
  );
}
