import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import api from '../../lib/api';
import DataTable, { Column } from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import NewEntityModal from '../../components/ui/NewEntityModal';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';

interface UserRow { id: string; email: string; first_name: string; last_name: string; role: string; is_active: boolean; created_at: string; }

export default function AdminUsers() {
  const [showNew, setShowNew] = useState(false);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get('/admin/users').then(r => r.data),
  });

  const { data: rolesData } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get('/admin/roles').then(r => r.data),
  });

  const roleOptions: string[] = rolesData?.items?.map((r: any) => r.name) || ['admin', 'engineer', 'viewer'];

  const columns: Column<UserRow>[] = [
    { key: 'email', header: 'Email', render: r => <span className="font-medium">{r.email}</span> },
    { key: 'first_name', header: 'Name', render: r => `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—' },
    { key: 'role', header: 'Role', render: r => <span className="bg-slate-100 text-slate-700 text-xs px-2 py-0.5 rounded capitalize">{r.role}</span> },
    { key: 'is_active', header: 'Status', render: r => <StatusBadge status={r.is_active ? 'Active' : 'Obsolete'} /> },
    { key: 'created_at', header: 'Created', render: r => new Date(r.created_at).toLocaleDateString() },
  ];

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="User Management" subtitle="Platform users and roles"
        actions={<Button variant="primary" onClick={() => setShowNew(true)}><Plus className="w-4 h-4" />New User</Button>}
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
    </div>
  );
}
