import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, X, Check, ShieldCheck, Settings2, Eye, EyeOff } from 'lucide-react';
import ModalDialog from '../../components/ui/ModalDialog';

interface Role {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  sort_order: number;
}

interface RoleModule {
  key: string;
  label: string;
  access_level: 'manage' | 'view' | 'hidden';
  visible: boolean;
}

const inputCls = 'border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 w-full';

export default function AdminRoles() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ name: '', description: '', sort_order: '' });
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', sort_order: '' });
  const [moduleRole, setModuleRole] = useState<Role | null>(null);
  const [moduleVisibility, setModuleVisibility] = useState<Record<string, boolean>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => api.get('/admin/roles').then(r => r.data),
  });

  const roles: Role[] = data?.items || [];
  const { data: moduleData, isLoading: modulesLoading } = useQuery({
    queryKey: ['admin-role-modules', moduleRole?.id],
    queryFn: () => api.get(`/admin/roles/${moduleRole!.id}/modules`).then(r => r.data),
    enabled: !!moduleRole,
  });
  const roleModules: RoleModule[] = moduleData?.items || [];

  useEffect(() => {
    if (!moduleData?.items) return;
    setModuleVisibility(Object.fromEntries(
      (moduleData.items as RoleModule[]).map(item => [item.key, item.visible]),
    ));
  }, [moduleData]);

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

  const saveModuleVisibility = async () => {
    if (!moduleRole) return;
    setSaving(true);
    try {
      await api.put(`/admin/roles/${moduleRole.id}/modules`, { modules: moduleVisibility });
      toast.success(`Module visibility updated for ${moduleRole.name}`);
      qc.invalidateQueries({ queryKey: ['admin-role-modules', moduleRole.id] });
      qc.invalidateQueries({ queryKey: ['admin-roles'] });
      setModuleRole(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to update module visibility');
    } finally {
      setSaving(false);
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
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Role Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Description</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-20">Order</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-24">Type</th>
                <th className="w-40" />
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
                        {role.is_system && <p className="text-xs text-blue-600 mt-1">Built-in role names cannot be changed</p>}
                      </td>
                      <td className="px-3 py-2"><input value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} className={inputCls} placeholder="Optional description" /></td>
                      <td className="px-3 py-2"><input type="number" value={editForm.sort_order} onChange={e => setEditForm(f => ({ ...f, sort_order: e.target.value }))} className={inputCls} /></td>
                      <td />
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <button aria-label={`Save ${role.name}`} title="Save role" onClick={() => handleEdit(role.id, role.is_system)} disabled={saving} className="p-1.5 text-green-600 hover:bg-green-50 rounded"><Check className="w-4 h-4" /></button>
                          <button aria-label={`Cancel editing ${role.name}`} title="Cancel editing" onClick={() => setEditId(null)} className="p-1.5 text-slate-400 hover:bg-slate-50 rounded"><X className="w-4 h-4" /></button>
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
                          ? <span className="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full"><ShieldCheck className="w-3 h-3" />Built-in</span>
                          : <span className="text-xs text-slate-400">Custom</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            aria-label={`Configure modules for ${role.name}`}
                            title="Configure module visibility"
                            onClick={() => setModuleRole(role)}
                            className="inline-flex items-center gap-1.5 px-2 py-1 text-xs text-violet-600 hover:bg-violet-50 rounded"
                          >
                            <Settings2 className="w-3.5 h-3.5" /> Modules
                          </button>
                          <button aria-label={`Edit ${role.name}`} title="Edit role" onClick={() => startEdit(role)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded"><Pencil className="w-3.5 h-3.5" /></button>
                          {!role.is_system && (
                            <button aria-label={`Delete ${role.name}`} title="Delete role" onClick={() => handleDelete(role)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
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
          <ModalDialog onClose={() => setShowNew(false)} labelledBy="new-role-title" className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 id="new-role-title" className="text-lg font-semibold text-slate-800">New Role</h2>
              <button aria-label="Close new role form" title="Close dialog" onClick={() => setShowNew(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
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
          </ModalDialog>
        </div>
      )}

      {moduleRole && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <ModalDialog onClose={() => setModuleRole(null)} labelledBy="role-modules-title" className="bg-white rounded-xl shadow-2xl w-full max-w-xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <h2 id="role-modules-title" className="text-lg font-semibold text-slate-800 capitalize">{moduleRole.name} modules</h2>
                <p className="text-xs text-slate-500 mt-0.5">Choose which main areas users with this role can see.</p>
              </div>
              <button aria-label="Close module visibility" onClick={() => setModuleRole(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6">
              {moduleRole.name === 'admin' && (
                <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                  Administrators always retain access to every module so permissions can be recovered safely.
                </div>
              )}
              {modulesLoading ? (
                <div className="py-10 text-center text-sm text-slate-400">Loading modules...</div>
              ) : (
                <div className="space-y-2">
                  {roleModules.map(module => {
                    const visible = moduleVisibility[module.key] ?? module.visible;
                    const locked = moduleRole.name === 'admin';
                    return (
                      <button
                        key={module.key}
                        type="button"
                        disabled={locked}
                        onClick={() => setModuleVisibility(current => ({ ...current, [module.key]: !visible }))}
                        className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                          visible ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-slate-50'
                        } ${locked ? 'cursor-not-allowed opacity-75' : 'hover:border-blue-300'}`}
                      >
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${visible ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                          {visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-slate-800">{module.label}</p>
                          <p className="text-xs text-slate-500">{visible ? 'Visible in navigation and accessible' : 'Hidden from navigation and blocked'}</p>
                        </div>
                        <span className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${visible ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                          <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5 ${visible ? 'translate-x-5 ml-0.5' : 'translate-x-0.5'}`} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="text-xs text-slate-400 mt-4">
                This controls module visibility. View-only and create/edit permissions can be added as the next level without changing this role setup.
              </p>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
              <Button variant="ghost" onClick={() => setModuleRole(null)}>Cancel</Button>
              <Button onClick={saveModuleVisibility} disabled={saving || modulesLoading || moduleRole.name === 'admin'}>
                {saving ? 'Saving...' : 'Save Visibility'}
              </Button>
            </div>
          </ModalDialog>
        </div>
      )}
    </div>
  );
}
