import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Pencil, Ban, Trash2, Plus, CheckCircle, KeyRound, Mail,
  Eye, EyeOff, MoreHorizontal, Search, ChevronLeft, ChevronRight,
  ArrowUp, ArrowDown, ChevronsUpDown, UserPlus, AlertTriangle,
  Users,
} from 'lucide-react';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import StatusBadge from '../../components/ui/StatusBadge';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import NewEntityModal from '../../components/ui/NewEntityModal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import toast from 'react-hot-toast';
import QueryError from '../../components/ui/QueryError';
import EmptyState from '../../components/ui/EmptyState';
import SkeletonTable from '../../components/ui/SkeletonTable';

interface UserRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
  can_see_all_pos: boolean;
  created_at: string;
  last_login_at: string | null;
}

type SortKey = 'name' | 'email' | 'role' | 'status' | 'created' | 'last_login';
type SortDir = 'asc' | 'desc';

function SortIcon({ colKey, sortKey, sortDir }: { colKey: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (colKey !== sortKey) return <ChevronsUpDown className="w-3 h-3 opacity-0 group-hover:opacity-40 transition-opacity" />;
  return sortDir === 'asc'
    ? <ArrowUp className="w-3 h-3 text-blue-500" />
    : <ArrowDown className="w-3 h-3 text-blue-500" />;
}

function formatLastLogin(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return d.toLocaleDateString();
}

// ── Row kebab menu ────────────────────────────────────────────────────────────
interface ActionMenuProps {
  user: UserRow;
  isSelf: boolean;
  busy: boolean;
  onEdit: () => void;
  onResetPassword: () => void;
  onSendResetLink: () => void;
  onBlock: () => void;
  onDelete: () => void;
  onTogglePOVisibility: () => void;
}

function ActionMenu({ user, isSelf, busy, onEdit, onResetPassword, onSendResetLink, onBlock, onDelete, onTogglePOVisibility }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const item = (label: string, icon: React.ReactNode, onClick: () => void, danger = false, disabled = false) => (
    <button
      key={label}
      onClick={() => { if (!disabled) { onClick(); setOpen(false); } }}
      disabled={disabled}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left rounded transition-colors
        ${danger
          ? 'text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed'
          : 'text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed'}`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        disabled={busy}
        className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-40"
        title="Actions"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-50">
          {item('Edit', <Pencil className="w-3.5 h-3.5" />, onEdit, false, isSelf)}
          <div className="my-1 border-t border-slate-100" />
          {item('Set Password', <KeyRound className="w-3.5 h-3.5" />, onResetPassword, false, isSelf)}
          {item('Send Reset Link', <Mail className="w-3.5 h-3.5" />, onSendResetLink, false, isSelf)}
          <div className="my-1 border-t border-slate-100" />
          {item(
            user.can_see_all_pos ? 'Restrict PO Visibility' : 'Grant All PO Access',
            user.can_see_all_pos ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />,
            onTogglePOVisibility,
            false,
            isSelf,
          )}
          <div className="my-1 border-t border-slate-100" />
          {item(
            user.is_active ? 'Block User' : 'Unblock User',
            user.is_active ? <Ban className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />,
            onBlock,
            user.is_active,
            isSelf,
          )}
          {item('Delete User', <Trash2 className="w-3.5 h-3.5" />, onDelete, true, isSelf)}
        </div>
      )}
    </div>
  );
}

// ── Invite modal ─────────────────────────────────────────────────────────────
interface InviteModalProps {
  roleOptions: string[];
  smtpConfigured: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function InviteModal({ roleOptions, smtpConfigured, onClose, onSuccess }: InviteModalProps) {
  const [form, setForm] = useState({ email: '', first_name: '', last_name: '', role: roleOptions[0] || 'viewer' });
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const useInvite = smtpConfigured;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (useInvite) {
        await api.post('/admin/users/invite', form);
        toast.success(`Invite sent to ${form.email}`);
      } else {
        if (password.length < 8) { toast.error('Password must be at least 8 characters'); setSubmitting(false); return; }
        await api.post('/admin/users', { ...form, password });
        toast.success('User created');
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to create user');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-blue-600" />
            <h2 className="text-base font-semibold text-slate-800">
              {useInvite ? 'Invite New User' : 'Create New User'}
            </h2>
          </div>
          {useInvite ? (
            <p className="text-xs text-slate-500 mt-1">
              An email with a password-setup link will be sent to the address below.
            </p>
          ) : (
            <div className="mt-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700">
                Email (SMTP) is not configured, so invite links cannot be sent. You can set a temporary password manually — ask the user to change it after first login.
              </p>
            </div>
          )}
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Email <span className="text-red-500">*</span></label>
            <input
              type="email"
              required
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="user@example.com"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">First Name</label>
              <input
                type="text"
                value={form.first_name}
                onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Last Name</label>
              <input
                type="text"
                value={form.last_name}
                onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Role</label>
            <select
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {roleOptions.map(r => (
                <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          {!useInvite && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Password <span className="text-red-500">*</span></label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              variant="primary"
              disabled={submitting}
            >
              {submitting ? 'Sending…' : useInvite ? 'Send Invite' : 'Create User'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AdminUsers() {
  const currentUser = useAuthStore(s => s.user);
  const isAdmin = currentUser?.role === 'admin';

  // Filters / pagination / sort
  const [searchQ, setSearchQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>('created');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Modals
  const [showInvite, setShowInvite] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [confirmBlock, setConfirmBlock] = useState<UserRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UserRow | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showNewPass, setShowNewPass] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // Debounced search
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(searchQ); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchQ]);

  const sortParam = `${sortKey === 'name' ? 'name' : sortKey === 'email' ? 'email' : sortKey === 'role' ? 'role' : sortKey === 'status' ? 'status' : sortKey === 'last_login' ? 'last_login' : 'created'}_${sortDir}`;

  const { data, isLoading, isError, refetch } = useQuery<{ items: UserRow[]; pagination: { page: number; page_size: number; total: number; pages: number } }>({
    queryKey: ['admin-users', debouncedQ, roleFilter, page, sortParam],
    queryFn: () => api.get('/admin/users', {
      params: { q: debouncedQ || undefined, role: roleFilter || undefined, page, page_size: 25, sort: sortParam },
    }).then(r => r.data),
    placeholderData: keepPreviousData,
  });

  const { data: rolesData } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get('/admin/roles').then(r => r.data),
  });

  const { data: emailStatus } = useQuery({
    queryKey: ['admin-email-status'],
    queryFn: () => api.get('/admin/email-status').then(r => r.data),
    enabled: isAdmin,
  });

  const roleOptions: string[] = rolesData?.items?.map((r: any) => r.name) || ['admin', 'engineer', 'viewer'];
  const smtpConfigured = emailStatus?.smtp_configured ?? false;

  const pagination = data?.pagination;
  const users: UserRow[] = data?.items || [];

  const handleSort = useCallback((col: SortKey) => {
    if (sortKey === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(col);
      setSortDir('asc');
    }
    setPage(1);
  }, [sortKey]);

  const handleBlock = async (user: UserRow) => {
    setConfirmBlock(null);
    setLoadingId(user.id);
    try {
      await api.put(`/admin/users/${user.id}`, {
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        is_active: !user.is_active,
      });
      toast.success(user.is_active ? 'User blocked' : 'User unblocked');
      refetch();
    } catch {
      toast.error('Failed to update user');
    } finally {
      setLoadingId(null);
    }
  };

  const handleResetPassword = async (user: UserRow, pwd: string) => {
    setLoadingId(user.id);
    try {
      await api.patch(`/admin/users/${user.id}/password`, { password: pwd });
      toast.success('Password reset successfully');
      setResetPasswordUser(null);
      setNewPassword('');
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to reset password');
    } finally {
      setLoadingId(null);
    }
  };

  const handleSendResetLink = async (user: UserRow) => {
    setLoadingId(user.id);
    try {
      await api.post(`/admin/users/${user.id}/send-reset-link`);
      toast.success(`Reset link sent to ${user.email}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to send reset link');
    } finally {
      setLoadingId(null);
    }
  };

  const handleTogglePOVisibility = async (user: UserRow) => {
    setLoadingId(user.id);
    try {
      await api.patch(`/admin/users/${user.id}/po-visibility`, { can_see_all_pos: !user.can_see_all_pos });
      toast.success(user.can_see_all_pos ? 'PO visibility restricted' : 'Can now see all POs');
      refetch();
    } catch {
      toast.error('Failed to update PO visibility');
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (user: UserRow) => {
    setConfirmDelete(null);
    setLoadingId(user.id);
    try {
      await api.delete(`/admin/users/${user.id}`);
      toast.success('User deleted');
      refetch();
    } catch {
      toast.error('Failed to delete user');
    } finally {
      setLoadingId(null);
    }
  };

  const sortableHeader = (label: string, col: SortKey) => (
    <th
      onClick={() => handleSort(col)}
      className={`group text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wide whitespace-nowrap select-none cursor-pointer transition-colors
        ${sortKey === col ? 'text-blue-600 bg-blue-50/60' : 'text-slate-500 hover:bg-slate-100'}`}
    >
      <div className="flex items-center gap-1.5">
        <span>{label}</span>
        <SortIcon colKey={col} sortKey={sortKey} sortDir={sortDir} />
      </div>
    </th>
  );

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="User Management"
        subtitle="Platform users and roles"
        actions={isAdmin ? (
          <Button variant="primary" onClick={() => setShowInvite(true)}>
            <Plus className="w-4 h-4" />New User
          </Button>
        ) : undefined}
      />

      {/* Search & filter bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/60">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={roleFilter}
          onChange={e => { setRoleFilter(e.target.value); setPage(1); }}
          className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
        >
          <option value="">All roles</option>
          {roleOptions.map(r => (
            <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
          ))}
        </select>
        {(searchQ || roleFilter) && (
          <button
            onClick={() => { setSearchQ(''); setRoleFilter(''); setPage(1); }}
            className="text-xs text-slate-500 hover:text-slate-700 underline"
          >
            Clear
          </button>
        )}
        {pagination && (
          <span className="ml-auto text-xs text-slate-400 shrink-0">
            {pagination.total} user{pagination.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 bg-white overflow-auto">
        {isError ? (
          <QueryError message="Could not load users" onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonTable rows={6} columns={isAdmin ? 8 : 7} />
        ) : users.length === 0 && !debouncedQ && !roleFilter ? (
          <EmptyState
            icon={Users}
            title="No users"
            description="Invite teammates so they can access the platform and collaborate on projects."
            actionLabel={isAdmin ? 'Invite a user' : undefined}
            onAction={isAdmin ? () => setShowInvite(true) : undefined}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {sortableHeader('Email', 'email')}
                {sortableHeader('Name', 'name')}
                {sortableHeader('Role', 'role')}
                {sortableHeader('Status', 'status')}
                <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">See All POs</th>
                {sortableHeader('Last Login', 'last_login')}
                {sortableHeader('Created', 'created')}
                {isAdmin && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 8 : 7} className="text-center py-12 text-slate-400 text-sm">
                    {(debouncedQ || roleFilter) ? 'No users match the current filters' : 'No users found'}
                  </td>
                </tr>
              ) : users.map(user => {
                const isSelf = user.id === currentUser?.id;
                const busy = loadingId === user.id;
                return (
                  <tr key={user.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800">{user.email}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {`${user.first_name || ''} ${user.last_name || ''}`.trim() || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="bg-slate-100 text-slate-700 text-xs px-2 py-0.5 rounded capitalize">
                        {user.role?.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={user.is_active ? 'Active' : 'Blocked'} />
                    </td>
                    <td className="px-4 py-3">
                      {isAdmin && !isSelf ? (
                        <button
                          onClick={() => !busy && handleTogglePOVisibility(user)}
                          disabled={busy}
                          title={user.can_see_all_pos ? 'Click to restrict — will only see own POs' : 'Click to grant — will see all POs'}
                          className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium transition-colors disabled:opacity-40 cursor-pointer
                            ${user.can_see_all_pos
                              ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                              : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}
                        >
                          {user.can_see_all_pos ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                          {user.can_see_all_pos ? 'All POs' : 'Own only'}
                        </button>
                      ) : (
                        <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium
                          ${user.can_see_all_pos ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                          {user.can_see_all_pos ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                          {user.can_see_all_pos ? 'All POs' : 'Own only'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs" title={user.last_login_at ? new Date(user.last_login_at).toLocaleString() : undefined}>
                      {formatLastLogin(user.last_login_at)}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <ActionMenu
                            user={user}
                            isSelf={isSelf}
                            busy={busy}
                            onEdit={() => setEditUser(user)}
                            onResetPassword={() => { setResetPasswordUser(user); setNewPassword(''); setShowNewPass(false); }}
                            onSendResetLink={() => handleSendResetLink(user)}
                            onBlock={() => setConfirmBlock(user)}
                            onDelete={() => setConfirmDelete(user)}
                            onTogglePOVisibility={() => handleTogglePOVisibility(user)}
                          />
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-white">
          <span className="text-xs text-slate-500">
            Page {pagination.page} of {pagination.pages} · {pagination.total} users
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: Math.min(5, pagination.pages) }, (_, i) => {
              const p = pagination.pages <= 5
                ? i + 1
                : page <= 3 ? i + 1
                : page >= pagination.pages - 2 ? pagination.pages - 4 + i
                : page - 2 + i;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-8 h-8 text-xs rounded-lg border transition-colors
                    ${p === page
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(pagination.pages, p + 1))}
              disabled={page >= pagination.pages}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Invite / New User modal */}
      {showInvite && (
        <InviteModal
          roleOptions={roleOptions}
          smtpConfigured={smtpConfigured}
          onClose={() => setShowInvite(false)}
          onSuccess={() => refetch()}
        />
      )}

      {/* Edit user modal */}
      {editUser && (
        <NewEntityModal
          title="Edit User"
          submitLabel="Save Changes"
          onClose={() => setEditUser(null)}
          initialValues={{ first_name: editUser.first_name, last_name: editUser.last_name, role: editUser.role }}
          fields={[
            { name: 'first_name', label: 'First Name' },
            { name: 'last_name', label: 'Last Name' },
            { name: 'role', label: 'Role', options: roleOptions },
          ]}
          onSubmit={async (values) => {
            try {
              await api.put(`/admin/users/${editUser.id}`, {
                first_name: values.first_name,
                last_name: values.last_name,
                role: values.role,
                is_active: editUser.is_active,
              });
              toast.success('User updated');
              refetch();
              setEditUser(null);
            } catch {
              toast.error('Failed to update user');
            }
          }}
        />
      )}

      {/* Set password modal */}
      {resetPasswordUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="p-5">
              <h2 className="text-base font-semibold text-slate-800 mb-1">Set Password</h2>
              <p className="text-sm text-slate-600 mb-4">
                Set a new password for <strong>{resetPasswordUser.email}</strong>. Their existing sessions will be signed out.
              </p>
              <label className="block text-xs font-medium text-slate-700 mb-1">New Password</label>
              <div className="relative">
                <input
                  type={showNewPass ? 'text' : 'password'}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPass(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showNewPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <Button onClick={() => { setResetPasswordUser(null); setNewPassword(''); }}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => handleResetPassword(resetPasswordUser, newPassword)}
                disabled={loadingId === resetPasswordUser.id || newPassword.length < 8}
              >
                {loadingId === resetPasswordUser.id ? 'Saving…' : 'Set Password'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Block confirm */}
      {confirmBlock && (
        <ConfirmDialog
          title={confirmBlock.is_active ? 'Block User' : 'Unblock User'}
          message={confirmBlock.is_active
            ? `Block ${confirmBlock.first_name ? `${confirmBlock.first_name} ${confirmBlock.last_name}` : confirmBlock.email} (${confirmBlock.email})? They will be signed out immediately and unable to log in.`
            : `Unblock ${confirmBlock.first_name ? `${confirmBlock.first_name} ${confirmBlock.last_name}` : confirmBlock.email} (${confirmBlock.email})? They will be able to log in again.`}
          confirmLabel={confirmBlock.is_active ? 'Block User' : 'Unblock User'}
          danger={confirmBlock.is_active}
          onConfirm={() => handleBlock(confirmBlock)}
          onCancel={() => setConfirmBlock(null)}
        />
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete User"
          message={`Permanently delete ${confirmDelete.first_name ? `${confirmDelete.first_name} ${confirmDelete.last_name}` : confirmDelete.email} (${confirmDelete.email})? This cannot be undone.`}
          confirmLabel="Delete User"
          danger
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
