import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pencil, Ban, Trash2, Plus, CheckCircle, KeyRound, Mail, Eye, EyeOff } from 'lucide-react';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import DataTable, { Column } from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import NewEntityModal from '../../components/ui/NewEntityModal';
import toast from 'react-hot-toast';

interface UserRow { id: string; email: string; first_name: string; last_name: string; role: string; is_active: boolean; can_see_all_pos: boolean; created_at: string; }

export default function AdminUsers() {
  const currentUser = useAuthStore(s => s.user);
  const isAdmin = currentUser?.role === 'admin';
  const [showNew, setShowNew] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [deleteUser, setDeleteUser] = useState<UserRow | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get('/admin/users').then(r => r.data),
  });

  const { data: rolesData } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get('/admin/roles').then(r => r.data),
  });

  const roleOptions: string[] = rolesData?.items?.map((r: any) => r.name) || ['admin', 'engineer', 'viewer'];

  const handleBlock = async (user: UserRow) => {
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

  const handleResetPassword = async (user: UserRow, password: string) => {
    setLoadingId(user.id);
    try {
      await api.patch(`/admin/users/${user.id}/password`, { password });
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
    setLoadingId(user.id);
    try {
      await api.delete(`/admin/users/${user.id}`);
      toast.success('User deleted');
      setDeleteUser(null);
      refetch();
    } catch {
      toast.error('Failed to delete user');
    } finally {
      setLoadingId(null);
    }
  };

  const columns: Column<UserRow>[] = [
    { key: 'email', header: 'Email', render: r => <span className="font-medium">{r.email}</span> },
    { key: 'first_name', header: 'Name', render: r => `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—' },
    { key: 'role', header: 'Role', render: r => <span className="bg-slate-100 text-slate-700 text-xs px-2 py-0.5 rounded capitalize">{r.role?.replace(/_/g, ' ')}</span> },
    { key: 'is_active', header: 'Status', render: r => <StatusBadge status={r.is_active ? 'Active' : 'Blocked'} /> },
    {
      key: 'can_see_all_pos', header: 'See All POs', render: r => {
        const isSelf = r.id === currentUser?.id;
        const busy = loadingId === r.id;
        const clickable = isAdmin && !isSelf && !busy;
        return (
          <button
            onClick={() => clickable && handleTogglePOVisibility(r)}
            disabled={!clickable}
            title={isAdmin ? (r.can_see_all_pos ? 'Click to restrict — will only see own POs' : 'Click to grant — will see all POs') : undefined}
            className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium transition-colors disabled:opacity-40
              ${isAdmin && !isSelf ? 'cursor-pointer' : 'cursor-default'}
              ${r.can_see_all_pos
                ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}
          >
            {r.can_see_all_pos ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            {r.can_see_all_pos ? 'All POs' : 'Own only'}
          </button>
        );
      }
    },
    { key: 'created_at', header: 'Created', render: r => new Date(r.created_at).toLocaleDateString() },
    ...(isAdmin ? [{
      key: 'id' as keyof UserRow, header: '', render: (r: UserRow) => {
        const isSelf = r.id === currentUser?.id;
        const busy = loadingId === r.id;
        return (
          <div className="flex items-center gap-1 justify-end">
            <button
              onClick={() => !isSelf && setEditUser(r)}
              disabled={isSelf}
              className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Edit user"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => { if (!isSelf) { setResetPasswordUser(r); setNewPassword(''); } }}
              disabled={isSelf}
              className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Set password directly"
            >
              <KeyRound className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => { if (!isSelf && !busy) handleSendResetLink(r); }}
              disabled={isSelf || busy}
              className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Send password reset link by email"
            >
              <Mail className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => !isSelf && !busy && handleBlock(r)}
              disabled={isSelf || busy}
              className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={r.is_active ? 'Block user' : 'Unblock user'}
            >
              {r.is_active ? <Ban className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5 text-green-600" />}
            </button>
            <button
              onClick={() => !isSelf && setDeleteUser(r)}
              disabled={isSelf || busy}
              className="p-1.5 rounded hover:bg-red-50 text-slate-500 hover:text-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Delete user"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      }
    }] : []),
  ];

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="User Management" subtitle="Platform users and roles"
        actions={isAdmin ? <Button variant="primary" onClick={() => setShowNew(true)}><Plus className="w-4 h-4" />New User</Button> : undefined}
      />
      <div className="flex-1 bg-white overflow-auto">
        <DataTable columns={columns} data={data?.items || []} loading={isLoading} />
      </div>

      {showNew && (
        <NewEntityModal title="New User" onClose={() => setShowNew(false)}
          fields={[
            { name: 'email', label: 'Email', required: true, type: 'email' },
            { name: 'password', label: 'Password', required: true, type: 'password' },
            { name: 'first_name', label: 'First Name' },
            { name: 'last_name', label: 'Last Name' },
            { name: 'role', label: 'Role', options: roleOptions },
          ]}
          onSubmit={async (data) => {
            await api.post('/admin/users', data);
            toast.success('User created');
            refetch();
            setShowNew(false);
          }}
        />
      )}

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

      {resetPasswordUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="p-5">
              <h2 className="text-base font-semibold text-slate-800 mb-1">Reset Password</h2>
              <p className="text-sm text-slate-600 mb-4">
                Set a new password for <strong>{resetPasswordUser.email}</strong>. Their existing sessions will be signed out.
              </p>
              <label className="block text-xs font-medium text-slate-700 mb-1">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <Button onClick={() => { setResetPasswordUser(null); setNewPassword(''); }}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => handleResetPassword(resetPasswordUser, newPassword)}
                disabled={loadingId === resetPasswordUser.id || newPassword.length < 8}
              >
                {loadingId === resetPasswordUser.id ? 'Saving...' : 'Reset Password'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {deleteUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
            <div className="p-5">
              <h2 className="text-base font-semibold text-slate-800 mb-1">Delete User</h2>
              <p className="text-sm text-slate-600">
                Are you sure you want to permanently delete <strong>{deleteUser.email}</strong>? This action cannot be undone.
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <Button onClick={() => setDeleteUser(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => handleDelete(deleteUser)}
                disabled={loadingId === deleteUser.id}
              >
                {loadingId === deleteUser.id ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
