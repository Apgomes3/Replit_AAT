import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, X, Check, ShieldCheck } from 'lucide-react';

interface Role {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  sort_order: number;
}

const inputCls = 'border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76] w-full';

export default function AdminRoles() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ name: '', description: '', sort_order: '' });
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', sort_order: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => api.get('/admin/roles').then(r => r.data),
  });

  const roles: Role[] = data?.items || [];

  const handleCreate = async () => {
    if (!newForm.name.trim()) { toast.error('Role name is required'); return; }
    setSaving(true);
    try {
      await api.post('/admin/roles', {
        name: newForm.name.trim().toLowerCase(),
        description: newForm.description.trim() || null,
        sort_order: newForm.sort_order ? parseInt(newForm.sort_order) : 0,
      });
      toast.success('Role created');
      setShowNew(false);
      setNewForm({ name: '', description: '', sort_order: '' });
      qc.invalidateQueries({ queryKey: ['admin-roles'] });
      qc.invalidateQueries({ queryKey: ['roles'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to create role');
    } finally { setSaving(false); }
  };

  const startEdit = (role: Role) => {
    setEditId(role.id);
    setEditForm({ name: role.name, description: role.description || '', sort_order: String(role.sort_order) });
  };

  const handleEdit = async (id: string, isSystem: boolean) => {
    setSaving(true);
    try {
      await api.put(`/admin/roles/${id}`, {
        name: editForm.name.trim().toLowerCase(),
        description: editForm.description.trim() || null,
        sort_order: editForm.sort_order ? parseInt(editForm.sort_order) : 0,
      });
      toast.success('Role updated');
      setEditId(null);
      qc.invalidateQueries({ queryKey: ['admin-roles'] });
      qc.invalidateQueries({ queryKey: ['roles'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to update role');
    } finally { setSaving(false); }
  };

  const handleDelete = async (role: Role) => {
    if (role.is_system) { toast.error('Built-in roles cannot be deleted'); return; }
    if (!confirm(`Delete role "${role.name}"? Users with this role will be unaffected but the role will no longer appear as an option.`)) return;
    try {
      await api.delete(`/admin/roles/${role.id}`);
      toast.success('Role deleted');
      qc.invalidateQueries({ queryKey: ['admin-roles'] });
      qc.invalidateQueries({ queryKey: ['roles'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to delete role');
    }
  };

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Roles"
        subtitle="Manage user roles available when creating or editing platform users"
        actions={<Button variant="primary" onClick={() => setShowNew(true)}><Plus className="w-4 h-4" />New Role</Button>}
      />

      <div className="flex-1 overflow-auto p-4">
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Role Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Description</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-20">Order</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-24">Type</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={5} className="text-center py-12 text-slate-400">Loading...</td></tr>
              )}
              {!isLoading && roles.length === 0 && (
                <tr><td colSpan={5} className="text-center py-12 text-slate-400">No roles defined</td></tr>
              )}
              {roles.map(role => (
                <tr key={role.id} className="border-b border-slate-100 last:border-0">
                  {editId === role.id ? (
                    <>
                      <td className="px-3 py-2">
                        <input
                          value={editForm.name}
                          onChange={e => setEditForm(f => ({ ...f, name: e.target.value.toLowerCase() }))}
                          className={inputCls}
                          disabled={role.is_system}
                        />
                        {role.is_system && <p className="text-xs text-amber-600 mt-1">Built-in role names cannot be changed</p>}
                      </td>
                      <td className="px-3 py-2"><input value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} className={inputCls} placeholder="Optional description" /></td>
                      <td className="px-3 py-2"><input type="number" value={editForm.sort_order} onChange={e => setEditForm(f => ({ ...f, sort_order: e.target.value }))} className={inputCls} /></td>
                      <td />
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => handleEdit(role.id, role.is_system)} disabled={saving} className="p-1.5 text-green-600 hover:bg-green-50 rounded"><Check className="w-4 h-4" /></button>
                          <button onClick={() => setEditId(null)} className="p-1.5 text-slate-400 hover:bg-slate-50 rounded"><X className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 font-medium text-slate-800 capitalize">{role.name}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{role.description || <span className="text-slate-300">—</span>}</td>
                      <td className="px-4 py-3 text-slate-500">{role.sort_order}</td>
                      <td className="px-4 py-3">
                        {role.is_system
                          ? <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full"><ShieldCheck className="w-3 h-3" />Built-in</span>
                          : <span className="text-xs text-slate-400">Custom</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => startEdit(role)} className="p-1.5 text-slate-400 hover:text-[#3E5C76] hover:bg-slate-50 rounded"><Pencil className="w-3.5 h-3.5" /></button>
                          {!role.is_system && (
                            <button onClick={() => handleDelete(role)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                          )}
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-800">New Role</h2>
              <button onClick={() => setShowNew(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Role Name *</label>
                <input
                  value={newForm.name}
                  onChange={e => setNewForm(f => ({ ...f, name: e.target.value.toLowerCase() }))}
                  placeholder="e.g. contractor"
                  className={inputCls}
                  autoFocus
                />
                <p className="text-xs text-slate-400 mt-1">Lowercase letters only. This is the value stored on user accounts.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                <input
                  value={newForm.description}
                  onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="What can this role do?"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Sort Order <span className="text-slate-400 font-normal">(lower = higher up the list)</span></label>
                <input
                  type="number"
                  value={newForm.sort_order}
                  onChange={e => setNewForm(f => ({ ...f, sort_order: e.target.value }))}
                  placeholder="0"
                  className={inputCls}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <Button variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={saving || !newForm.name.trim()}>
                {saving ? 'Creating...' : 'Create Role'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
