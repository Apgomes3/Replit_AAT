import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, LogOut, Bell, KeyRound, ChevronDown, X, Check, CheckCheck, ShoppingCart, ThumbsUp, ThumbsDown, ArrowRightLeft, Info, Menu } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import { useModalFocus } from '../../hooks/useModalFocus';
import { entityHref } from '../../lib/navigation';

// ── Types ──────────────────────────────────────────────────────────────────────
interface Notification {
  id: string;
  type: 'po_submitted' | 'po_approved' | 'po_rejected' | 'po_transitioned' | 'system';
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  href?: string | null;
  action_required?: boolean;
  is_read: boolean;
  created_at: string;
}

interface NotificationsResponse {
  notifications: Notification[];
  unread_count: number;
  total?: number;
}

type NotificationFilter = 'all' | 'unread' | 'action';
const NOTIFICATIONS_PAGE_SIZE = 20;

// ── Helpers ────────────────────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function notifIcon(type: Notification['type']) {
  const base = 'w-7 h-7 rounded-full flex items-center justify-center shrink-0';
  switch (type) {
    case 'po_submitted':   return <span className={`${base} bg-blue-100`}><ShoppingCart className="w-3.5 h-3.5 text-blue-600" /></span>;
    case 'po_approved':    return <span className={`${base} bg-green-100`}><ThumbsUp className="w-3.5 h-3.5 text-green-600" /></span>;
    case 'po_rejected':    return <span className={`${base} bg-red-100`}><ThumbsDown className="w-3.5 h-3.5 text-red-500" /></span>;
    case 'po_transitioned':return <span className={`${base} bg-violet-100`}><ArrowRightLeft className="w-3.5 h-3.5 text-violet-600" /></span>;
    default:               return <span className={`${base} bg-slate-100`}><Info className="w-3.5 h-3.5 text-slate-500" /></span>;
  }
}

// ── Change Password Modal ──────────────────────────────────────────────────────
function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const modalRef = useModalFocus<HTMLDivElement>({ onClose, initialFocusRef: currentPasswordRef });

  const mismatch = next.length > 0 && confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < 8;
  const canSubmit = current.length > 0 && next.length >= 8 && next === confirm && !saving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      await api.patch('/auth/change-password', { currentPassword: current, newPassword: next });
      toast.success('Password changed successfully');
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="change-password-title" tabIndex={-1} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 id="change-password-title" className="text-base font-semibold text-slate-800">Change Password</h2>
            <p className="text-xs text-slate-400 mt-0.5">Minimum 8 characters</p>
          </div>
          <button aria-label="Close change password dialog" title="Close dialog" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Current password</label>
            <input
              ref={currentPasswordRef}
              type="password"
              value={current}
              onChange={e => setCurrent(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">New password</label>
            <input
              type="password"
              value={next}
              onChange={e => setNext(e.target.value)}
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 transition-colors ${tooShort ? 'border-red-300 focus:border-red-400 focus:ring-red-500/15' : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500/15'}`}
            />
            {tooShort && <p className="text-xs text-red-500 mt-1">Must be at least 8 characters</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Confirm new password</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 transition-colors ${mismatch ? 'border-red-300 focus:border-red-400 focus:ring-red-500/15' : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500/15'}`}
            />
            {mismatch && <p className="text-xs text-red-500 mt-1">Passwords do not match</p>}
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-slate-200 text-slate-600 rounded-lg py-2 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg py-2 text-sm font-medium transition-colors"
            >
              {saving ? 'Saving…' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Notification Bell ──────────────────────────────────────────────────────────
function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [data, setData] = useState<NotificationsResponse>({ notifications: [], unread_count: 0, total: 0 });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const requestId = useRef(0);
  const consecutiveFailures = useRef(0);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const hasNotifications = useRef(false);
  hasNotifications.current = data.notifications.length > 0;

  const fetchNotifications = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const res = await api.get<NotificationsResponse>('/notifications', {
        params: { limit: NOTIFICATIONS_PAGE_SIZE, offset: 0, filter },
      });
      if (currentRequest !== requestId.current) return;
      setData({
        ...res.data,
        notifications: res.data.notifications || [],
        total: res.data.total ?? res.data.notifications?.length ?? 0,
      });
      setError(null);
      setStale(false);
      consecutiveFailures.current = 0;
    } catch {
      if (currentRequest !== requestId.current) return;
      consecutiveFailures.current += 1;
      setError('Could not refresh notifications. Check your connection and try again.');
      setStale(hasNotifications.current);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [filter]);

  refreshRef.current = fetchNotifications;

  // Poll only while the page is visible and online; progressively back off on errors.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const pause = () => {
      clearTimeout(timer);
      setStale(true);
      setError(document.hidden
        ? 'Notifications are paused while this page is hidden.'
        : 'You are offline. Notifications may be out of date.');
    };
    const schedule = (delay: number) => {
      clearTimeout(timer);
      if (stopped || document.hidden || !navigator.onLine) return;
      timer = setTimeout(async () => {
        if (stopped || document.hidden || !navigator.onLine) return;
        await refreshRef.current();
        const failures = consecutiveFailures.current;
        schedule(failures ? Math.min(30_000 * (2 ** (failures - 1)), 5 * 60_000) : 30_000);
      }, delay);
    };
    const resume = () => {
      if (document.hidden || !navigator.onLine) {
        pause();
        return;
      }
      void refreshRef.current().finally(() => {
        const failures = consecutiveFailures.current;
        schedule(failures ? Math.min(30_000 * (2 ** (failures - 1)), 5 * 60_000) : 30_000);
      });
    };
    schedule(30_000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', pause);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', pause);
    };
  }, []);

  useEffect(() => {
    void fetchNotifications();
  }, [filter, fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const markRead = async (n: Notification) => {
    if (!n.is_read) {
      try {
        await api.patch(`/notifications/${n.id}/read`);
        setData(prev => ({
          ...prev,
          notifications: prev.notifications.map(x => x.id === n.id ? { ...x, is_read: true } : x),
          unread_count: Math.max(0, prev.unread_count - 1),
        }));
        if (filter !== 'all') void fetchNotifications();
      } catch {
        setError('Could not mark this notification as read.');
        return;
      }
    }
    const href = n.href || (n.entity_type && n.entity_id
      ? entityHref({ type: n.entity_type, id: n.entity_id })
      : null);
    if (href) {
      setOpen(false);
      navigate(href);
    }
  };

  const markAllRead = async () => {
    try {
      await api.patch('/notifications/read-all', { filter });
      setData(prev => ({
        ...prev,
        notifications: prev.notifications.map(x => (
          filter === 'all' || (filter === 'unread' && !x.is_read) || (filter === 'action' && x.action_required)
            ? { ...x, is_read: true }
            : x
        )),
        unread_count: Math.max(0, prev.unread_count - prev.notifications.filter(x =>
          !x.is_read && (filter !== 'action' || x.action_required),
        ).length),
      }));
      void fetchNotifications();
    } catch {
      setError('Could not mark notifications as read.');
    }
  };

  const deleteNotif = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await api.delete(`/notifications/${id}`);
      setData(prev => {
        const n = prev.notifications.find(x => x.id === id);
        return {
          ...prev,
          notifications: prev.notifications.filter(x => x.id !== id),
          unread_count: n && !n.is_read ? Math.max(0, prev.unread_count - 1) : prev.unread_count,
          total: Math.max(0, (prev.total ?? prev.notifications.length) - 1),
        };
      });
      void fetchNotifications();
    } catch {
      setError('Could not dismiss this notification.');
    }
  };

  const loadMore = async () => {
    if (loadingMore || data.notifications.length >= (data.total ?? 0)) return;
    const requestedFilter = filter;
    const pageRequestId = requestId.current;
    setLoadingMore(true);
    try {
      const res = await api.get<NotificationsResponse>('/notifications', {
        params: { limit: NOTIFICATIONS_PAGE_SIZE, offset: data.notifications.length, filter: requestedFilter },
      });
      if (requestedFilter !== filterRef.current || pageRequestId !== requestId.current) return;
      setData(prev => ({
        ...res.data,
        notifications: [...prev.notifications, ...res.data.notifications.filter(
          item => !prev.notifications.some(existing => existing.id === item.id),
        )],
        total: res.data.total ?? prev.total,
      }));
      setError(null);
      setStale(false);
    } catch {
      setError('Could not load more notifications. Try again.');
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleOpen = () => {
    setOpen(v => !v);
    if (!open) {
      if (document.hidden || !navigator.onLine) {
        setStale(true);
        setError(document.hidden
          ? 'Notifications are paused while this page is hidden.'
          : 'You are offline. Showing saved notifications; updates are paused.');
      } else {
        void fetchNotifications();
      }
    }
  };
  const hasUnreadInFilter = filter === 'action'
    ? (data.total ?? 0) > 0
    : data.unread_count > 0;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={toggleOpen}
        className="relative p-2 text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-full transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {data.unread_count > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[8px] h-2 bg-blue-600 rounded-full border border-white" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[min(24rem,calc(100vw-1.5rem))] bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col max-h-[min(80vh,520px)]">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-800">Notifications</span>
              {data.unread_count > 0 && (
                <span className="text-xs bg-blue-600 text-white font-semibold rounded-full px-1.5 py-0.5 leading-none">
                  {data.unread_count}
                </span>
              )}
            </div>
            {hasUnreadInFilter && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark {filter === 'all' ? 'all' : 'filtered'} read
              </button>
            )}
          </div>

          <div className="flex gap-1 px-3 py-2 border-b border-slate-100 shrink-0" role="tablist" aria-label="Notification filters">
            {([
              ['all', 'All'],
              ['unread', 'Unread'],
              ['action', 'Action required'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                onClick={() => {
                  if (key !== filter) {
                    setData(prev => ({ ...prev, notifications: [], total: 0 }));
                    setError(null);
                    setStale(false);
                    setFilter(key);
                  }
                }}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${filter === key ? 'bg-blue-100 text-blue-700' : 'text-slate-500 hover:bg-slate-100'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {error && (
            <div role="alert" className="flex items-center justify-between gap-2 px-4 py-2 bg-amber-50 text-xs text-amber-800 border-b border-amber-100">
              <span>{stale ? 'Showing saved notifications. ' : ''}{error}</span>
              <button type="button" onClick={() => void fetchNotifications()} className="font-semibold underline shrink-0">Retry</button>
            </div>
          )}

          {/* List */}
          <div className="overflow-y-auto flex-1">
            {loading && data.notifications.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-400">Loading…</div>
            ) : data.notifications.length === 0 ? (
              <div className="py-10 text-center">
                <Bell className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-sm text-slate-400">{filter === 'unread' ? 'No unread notifications' : filter === 'action' ? 'No action required' : 'No notifications yet'}</p>
              </div>
            ) : (
              data.notifications.map(n => (
                <div
                  key={n.id}
                  onClick={() => markRead(n)}
                  className={`flex gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0 group ${!n.is_read ? 'bg-blue-50/40' : ''}`}
                >
                  {notifIcon(n.type)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-xs font-medium leading-snug ${n.is_read ? 'text-slate-700' : 'text-slate-900'}`}>
                        {n.title}
                        {!n.is_read && <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-600 ml-1.5 mb-0.5 align-middle" />}
                      </p>
                      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!n.is_read && (
                          <button
                            onClick={e => { e.stopPropagation(); markRead(n); }}
                            title="Mark as read"
                            className="p-0.5 text-slate-400 hover:text-blue-600"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          onClick={e => deleteNotif(e, n.id)}
                          title="Dismiss"
                          className="p-0.5 text-slate-400 hover:text-red-500"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    {n.body && <p className="text-xs text-slate-500 mt-0.5 leading-snug line-clamp-2">{n.body}</p>}
                    <span className={`inline-flex mt-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${n.action_required ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                      {n.action_required ? 'Action required' : 'Informational'}
                    </span>
                    <p className="text-[10px] text-slate-400 mt-1">{timeAgo(n.created_at)}</p>
                  </div>
                </div>
              ))
            )}
            {data.notifications.length > 0 && data.notifications.length < (data.total ?? 0) && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full py-3 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
            {stale && <p className="px-4 py-2 text-[10px] text-slate-400">Last updated data may be out of date.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── TopBar ─────────────────────────────────────────────────────────────────────
export default function TopBar({ onOpenNavigation }: { onOpenNavigation?: () => void }) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) { navigate(`/search?q=${encodeURIComponent(q.trim())}`); setQ(''); }
  };

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const initials = [user?.firstName?.[0], user?.lastName?.[0]].filter(Boolean).join('').toUpperCase() || '?';

  return (
    <>
      <header className="h-16 bg-white border-b border-stone-200 flex items-center px-3 sm:px-6 gap-3 sm:gap-4 shrink-0">
        <button
          type="button"
          onClick={onOpenNavigation}
          aria-label="Open navigation"
          className="md:hidden rounded-lg p-2 text-stone-500 hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="hidden sm:block text-base font-semibold text-stone-800 shrink-0">Shark OS</h1>

        <div className="flex-1" />

        <form onSubmit={handleSearch} className="w-full max-w-64">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search products, POs..."
              className="w-full bg-stone-50 border border-stone-200 text-stone-800 text-sm pl-9 pr-4 py-2 rounded-full focus:outline-none focus:bg-white focus:border-blue-500 transition-colors placeholder-stone-400"
            />
          </div>
        </form>

        <NotificationBell />

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="flex items-center gap-2.5 rounded-xl px-2 py-1 hover:bg-stone-100 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-semibold shrink-0">
              {initials}
            </div>
            <div className="hidden sm:block text-left">
              <div className="text-sm font-medium text-stone-800 leading-tight">{user?.firstName} {user?.lastName}</div>
              <div className="text-xs text-stone-400 capitalize">{user?.role}</div>
            </div>
            <ChevronDown className={`w-3.5 h-3.5 text-stone-400 transition-transform duration-150 ${menuOpen ? 'rotate-180' : ''}`} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-50 w-52 py-1.5 overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-100 mb-1">
                <div className="text-sm font-medium text-slate-800">{user?.firstName} {user?.lastName}</div>
                <div className="text-xs text-slate-400">{user?.email}</div>
              </div>
              <button
                onClick={() => { setMenuOpen(false); setShowChangePassword(true); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
              >
                <KeyRound className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                Change Password
              </button>
              <div className="border-t border-slate-100 mt-1 pt-1">
                <button
                  onClick={() => { setMenuOpen(false); logout(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5 shrink-0" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
    </>
  );
}
