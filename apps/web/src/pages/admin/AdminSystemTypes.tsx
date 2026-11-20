import { useQuery, useQueryClient } from '@tanstack/react-query';
import SkeletonTable from '../../components/ui/SkeletonTable';
import { useState } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react';

interface SystemType {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

const inputCls = 'border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 w-full';

export default function AdminSystemTypes() {
  const qc = useQueryClient();

  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ name: '', description: '', sort_order: '' });
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', sort_order: '' });
  const [editSaving, setEditSaving] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-system-types'],
    queryFn: () => api.get('/admin/system-types').then(r => r.data),
  });

  const types: SystemType[] = data?.items || [];

  const handleCreate = async () => {
    if (!newForm.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      await api.post('/admin/system-types', {
        name: newForm.name.trim(),
        description: newForm.description.trim() || null,
        sort_order: newForm.sort_order ? parseInt(newForm.sort_order) : 0,
      });
      toast.success('System type created');
      setShowNew(false);
      setNewForm({ name: '', description: '', sort_order: '' });
      qc.invalidateQueries({ queryKey: ['admin-system-types'] });
      qc.invalidateQueries({ queryKey: ['system-types'] });
    } catch (e: any) {
      toast.error(e.response?.data?.error?.message || 'Failed to create');
    } finally { setSaving(false); }
  };

  const startEdit = (t: SystemType) => {
    setEditId(t.id);
    setEditForm({ name: t.name, description: t.description || '', sort_order: String(t.sort_order) });
  };

  const handleEdit = async (id: string) => {
    if (!editForm.name.trim()) { toast.error('Name is required'); return; }
    setEditSaving(true);
    try {
      await api.put(`/admin/system-types/${id}`, {
        name: editForm.name.trim(),
        description: editForm.description.trim() || null,
        sort_order: editForm.sort_order ? parseInt(editForm.sort_order) : 0,
      });
      toast.success('Updated');
      setEditId(null);
      qc.invalidateQueries({ queryKey: ['admin-system-types'] });
      qc.invalidateQueries({ queryKey: ['system-types'] });
    } catch (e: any) {
      toast.error(e.response?.data?.error?.message || 'Failed to update');
    } finally { setEditSaving(false); }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/admin/system-types/${id}`);
      toast.success('Deleted');
      setDeletingId(null);
      qc.invalidateQueries({ queryKey: ['admin-system-types'] });
      qc.invalidateQueries({ queryKey: ['system-types'] });
    } catch {
      toast.error('Failed to delete');
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-stone-50/50">
      <PageHeader title="System Types" subtitle="Manage system classification types used across projects" />

      <div className="flex-1 overflow-auto p-6">
        <div className="space-y-4">

          <div className="flex justify-end">
            <Button variant="primary" size="sm" onClick={() => setShowNew(v => !v)}>
              <Plus className="w-3.5 h-3.5 mr-1" />New System Type
            </Button>
          </div>

          {showNew && (
            <div className="bg-white border border-blue-200 rounded-xl p-5 shadow-sm space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">New System Type</h3>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Name <span className="text-red-400">*</span></label>
                <input
                  autoFocus
                  value={newForm.name}
                  onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  placeholder="e.g. Single Exhibit LSS"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Description</label>
                <input
                  value={newForm.description}
                  onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional description"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Sort Order</label>
                <input
                  type="number"
                  value={newForm.sort_order}
                  onChange={e => setNewForm(f => ({ ...f, sort_order: e.target.value }))}
                  placeholder="0"
                  className={inputCls}
                />
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button onClick={() => setShowNew(false)} className="text-xs text-slate-400 hover:text-slate-600 px-3 py-1.5 rounded">Cancel</button>
                <Button variant="primary" size="sm" onClick={handleCreate} disabled={saving}>
                  {saving ? 'Saving…' : 'Create'}
                </Button>
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            {isLoading ? (
              <SkeletonTable rows={5} columns={4} />
            ) : types.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">No system types yet. Add one above.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Name</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">Description</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-20">Order</th>
                    <th className="px-4 py-3 w-24" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {types.map(t => (
                    <tr key={t.id} className="hover:bg-slate-50/60 transition-colors group">
                      {editId === t.id ? (
                        <>
                          <td className="px-4 py-2">
                            <input
                              autoFocus
                              value={editForm.name}
                              onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                              className="border border-slate-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:border-blue-400"
                            />
                          </td>
                          <td className="px-4 py-2 hidden md:table-cell">
                            <input
                              value={editForm.description}
                              onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                              className="border border-slate-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:border-blue-400"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <input
                              type="number"
                              value={editForm.sort_order}
                              onChange={e => setEditForm(f => ({ ...f, sort_order: e.target.value }))}
                              className="border border-slate-200 rounded px-2 py-1 text-sm w-16 focus:outline-none focus:border-blue-400"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex gap-1 justify-end">
                              <button aria-label={`Save ${t.name}`} title="Save changes" onClick={() => handleEdit(t.id)} disabled={editSaving} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded">
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button aria-label={`Cancel editing ${t.name}`} title="Cancel editing" onClick={() => setEditId(null)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3 font-medium text-slate-800">{t.name}</td>
                          <td className="px-4 py-3 text-slate-400 hidden md:table-cell">{t.description || <span className="italic">—</span>}</td>
                          <td className="px-4 py-3 text-slate-400">{t.sort_order}</td>
                          <td className="px-4 py-3">
                            {deletingId === t.id ? (
                              <div className="flex items-center gap-2 justify-end">
                                <span className="text-xs text-red-500">Delete?</span>
                                <button onClick={() => handleDelete(t.id)} className="text-xs text-red-600 font-semibold hover:underline">Yes</button>
                                <button onClick={() => setDeletingId(null)} className="text-xs text-slate-400 hover:underline">No</button>
                              </div>
                            ) : (
                              <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => startEdit(t)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded">
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => setDeletingId(t.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <p className="text-xs text-slate-400">
            These types populate the System Type dropdown when creating or editing systems within a project.
          </p>
        </div>
      </div>
    </div>
  );
}
