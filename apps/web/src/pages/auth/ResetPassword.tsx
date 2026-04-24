import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import { KeyRound, CheckCircle, XCircle, Loader2 } from 'lucide-react';

type PageState = 'validating' | 'form' | 'success' | 'invalid';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';

  const [pageState, setPageState] = useState<PageState>('validating');
  const [userEmail, setUserEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setPageState('invalid');
      return;
    }
    api.get(`/auth/reset-password/validate?token=${encodeURIComponent(token)}`)
      .then(r => {
        setUserEmail(r.data.email || '');
        setPageState('form');
      })
      .catch(() => setPageState('invalid'));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast.error('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setPageState('success');
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || 'Failed to reset password';
      toast.error(msg);
      if (err?.response?.status === 400) {
        setPageState('invalid');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Reset Password</h1>
            <p className="text-xs text-slate-500">Engineering Data Platform</p>
          </div>
        </div>

        {pageState === 'validating' && (
          <div className="flex items-center justify-center py-8 gap-2 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Validating link…</span>
          </div>
        )}

        {pageState === 'invalid' && (
          <div className="text-center py-6">
            <XCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
            <h2 className="font-semibold text-slate-800 mb-1">Link invalid or expired</h2>
            <p className="text-sm text-slate-500 mb-6">
              This reset link has already been used or has expired.
              Ask an administrator to send you a new one.
            </p>
            <button
              onClick={() => navigate('/login')}
              className="text-sm text-blue-600 hover:underline"
            >
              Back to login
            </button>
          </div>
        )}

        {pageState === 'form' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {userEmail && (
              <p className="text-sm text-slate-600">
                Setting a new password for <strong>{userEmail}</strong>.
              </p>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">New Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                autoFocus
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Confirm Password</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Re-enter password"
                required
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="submit"
              disabled={submitting || password.length < 8 || password !== confirm}
              className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Saving…' : 'Set New Password'}
            </button>
          </form>
        )}

        {pageState === 'success' && (
          <div className="text-center py-6">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <h2 className="font-semibold text-slate-800 mb-1">Password updated</h2>
            <p className="text-sm text-slate-500 mb-6">
              Your password has been changed successfully. You can now log in with your new password.
            </p>
            <button
              onClick={() => navigate('/login')}
              className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 transition-colors"
            >
              Go to Login
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
