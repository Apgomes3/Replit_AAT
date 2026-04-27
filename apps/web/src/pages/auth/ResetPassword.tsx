import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../lib/api';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { toast.error('Passwords do not match'); return; }
    if (password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'linear-gradient(145deg, #fafaf9 0%, #f0ede9 40%, #e8e3dc 100%)' }}>

      <div className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(37,99,235,0.07) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(29,78,216,0.05) 0%, transparent 40%)',
        }} />

      <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 39px, #78716c 39px, #78716c 40px), repeating-linear-gradient(90deg, transparent, transparent 39px, #78716c 39px, #78716c 40px)',
        }} />

      <div className="w-full max-w-sm relative">
        <div className="flex justify-center mb-8">
          <img src="/shark-os-logo.png" alt="Shark OS" className="h-36 w-auto" />
        </div>

        <div
          className="rounded-2xl border border-white/80 p-7"
          style={{
            background: 'rgba(255,255,255,0.75)',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 20px 60px -10px rgba(0,0,0,0.12), 0 0 0 1px rgba(255,255,255,0.5) inset',
          }}>
          {!token ? (
            <div className="text-center space-y-3">
              <p className="text-sm text-red-600 font-medium">Invalid or missing reset link.</p>
              <button onClick={() => navigate('/login')} className="text-xs text-blue-600 hover:underline">Back to login</button>
            </div>
          ) : done ? (
            <div className="text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-stone-800 mb-1">Password updated</p>
                <p className="text-xs text-stone-500">Your password has been reset. You can now sign in with your new password.</p>
              </div>
              <button
                onClick={() => navigate('/login')}
                className="w-full text-white rounded-xl py-2.5 text-sm font-semibold transition-all duration-200 shadow-md hover:shadow-lg"
                style={{ background: 'linear-gradient(135deg, #2563EB 0%, #1d4ed8 100%)' }}
              >
                Go to login
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-stone-800 mb-0.5">Set a new password</h2>
                <p className="text-xs text-stone-500">Choose a strong password for your account.</p>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.12em] mb-1.5">New Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm bg-white/60 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15 transition-all duration-200 text-stone-800"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.12em] mb-1.5">Confirm Password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  className="w-full border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm bg-white/60 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15 transition-all duration-200 text-stone-800"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full text-white rounded-xl py-2.5 text-sm font-semibold transition-all duration-200 disabled:opacity-50 active:scale-[0.98] shadow-md hover:shadow-lg"
                style={{ background: loading ? '#2563EB' : 'linear-gradient(135deg, #2563EB 0%, #1d4ed8 100%)' }}
              >
                {loading ? 'Saving…' : 'Reset Password'}
              </button>
              <div className="text-center">
                <button type="button" onClick={() => navigate('/login')} className="text-xs text-stone-400 hover:text-stone-600 hover:underline">
                  Back to login
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
