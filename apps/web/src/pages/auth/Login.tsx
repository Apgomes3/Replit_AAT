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
    <div className="min-h-screen bg-[#fafaf9] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-amber-600 flex items-center justify-center shadow-sm">
            <Database className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-stone-800 text-xl font-semibold">Shark OS</h1>
            <p className="text-stone-400 text-sm">Sign in to continue</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-xl border border-stone-200 p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-stone-500 uppercase tracking-wide mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 transition-colors" />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 uppercase tracking-wide mb-1">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 transition-colors" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-amber-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-amber-700 transition-colors disabled:opacity-50">
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
          <div className="text-xs text-stone-400 space-y-1 pt-2 border-t border-stone-100">
            <div><strong>Admin:</strong> admin@edp.com / admin123</div>
            <div><strong>Engineer:</strong> engineer@edp.com / engineer123</div>
            <div><strong>Viewer:</strong> viewer@edp.com / viewer123</div>
          </div>
        </form>
      </div>
    </div>
  );
}
