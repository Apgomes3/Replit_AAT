import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, X, ShieldCheck } from 'lucide-react';
import ContextMenu, { ContextMenuItem } from '../../components/ui/ContextMenu';

interface Category {
  id: string;
  name: string;
  code: string;
  description: string | null;
  sort_order: number;
  is_system: boolean;
}

const inputCls = 'border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600 w-full';

export default function AdminCategories() {
  const qc = useQueryClient();

  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ name: '', code: '', description: '', sort_order: '' });
  const [saving, setSaving] = useState(false);

  const [showEdit, setShowEdit] = useState(false);
  const [editTarget, setEditTarget] = useState<Category | null>(null);
  const [editForm, setEditForm] = useState({ name: '', code: '', description: '', sort_order: '' });

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; cat: Category } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-categories'],
    queryFn: () => api.get('/admin/categories').then(r => r.data),
  });

  const categories: Category[] = data?.items || [];

  const openEdit = (cat: Category) => {
    setEditTarget(cat);
    setEditForm({ name: cat.name, code: cat.code, description: cat.description || '', sort_order: String(cat.sort_order) });
    setShowEdit(true);
  };

  const handleCreate = async () => {
    if (!newForm.name.trim() || !newForm.code.trim()) { toast.error('Name and code are required'); return; }
    setSaving(true);
    try {
      await api.post('/admin/categories', {
        name: newForm.name.trim(),
        code: newForm.code.trim().toUpperCase(),
        description: newForm.description.trim() || null,
        sort_order: newForm.sort_order ? parseInt(newForm.sort_order) : 0,
      });
      toast.success('Category created');
      setShowNew(false);
      setNewForm({ name: '', code: '', description: '', sort_order: '' });
      qc.invalidateQueries({ queryKey: ['admin-categories'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to create category');
    } finally { setSaving(false); }
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    setSaving(true);
    try {
      await api.put(`/admin/categories/${editTarget.id}`, {
        name: editForm.name.trim(),
        code: editForm.code.trim().toUpperCase(),
        description: editForm.description.trim() || null,
        sort_order: editForm.sort_order ? parseInt(editForm.sort_order) : 0,
      });
      toast.success('Category updated');
      setShowEdit(false);
      setEditTarget(null);
      qc.invalidateQueries({ queryKey: ['admin-categories'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to update category');
    } finally { setSaving(false); }
  };

  const handleDelete = async (cat: Category) => {
    if (cat.is_system) { toast.error('Built-in categories cannot be deleted'); return; }
    if (!confirm(`Delete category "${cat.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/admin/categories/${cat.id}`);
      toast.success('Category deleted');
      qc.invalidateQueries({ queryKey: ['admin-categories'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to delete category');
    }
  };

  const getMenuItems = (cat: Category): ContextMenuItem[] => [
    { label: 'Edit', icon: <Pencil className="w-3.5 h-3.5" />, onClick: () => openEdit(cat) },
    ...(!cat.is_system ? [{
      label: 'Delete', icon: <Trash2 className="w-3.5 h-3.5" />, onClick: () => handleDelete(cat), danger: true, divider: true,
    }] : []),
  ];

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Product Categories"
        subtitle="Manage categories used when classifying products in the ASW Library"
        actions={<Button variant="primary" onClick={() => setShowNew(true)}><Plus className="w-4 h-4" />New Category</Button>}
      />

      <div className="flex-1 overflow-auto p-4">
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Code</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Description</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-20">Order</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-24">Type</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={5} className="text-center py-12 text-slate-400">Loading...</td></tr>
              )}
              {!isLoading && categories.length === 0 && (
                <tr><td colSpan={5} className="text-center py-12 text-slate-400">No categories yet</td></tr>
              )}
              {categories.map(cat => (
                <tr
                  key={cat.id}
                  onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, cat }); }}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-context-menu select-none"
                >
                  <td className="px-4 py-3 font-medium text-slate-800">{cat.name}</td>
                  <td className="px-4 py-3"><span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-600">{cat.code}</span></td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{cat.description || <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3 text-slate-500">{cat.sort_order}</td>
                  <td className="px-4 py-3">
                    {cat.is_system
                      ? <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full"><ShieldCheck className="w-3 h-3" />Built-in</span>
                      : <span className="text-xs text-slate-400">Custom</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          items={getMenuItems(ctxMenu.cat)}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {showNew && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-800">New Product Category</h2>
              <button onClick={() => setShowNew(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
                <input value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '_') }))}
                  placeholder="e.g. Aeration" className={inputCls} autoFocus />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Code * <span className="text-slate-400 font-normal">(used in filters and reports)</span></label>
                <input value={newForm.code} onChange={e => setNewForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="e.g. AERATION" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                <input value={newForm.description} onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Brief description of this category" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Sort Order <span className="text-slate-400 font-normal">(lower = higher up the list)</span></label>
                <input type="number" value={newForm.sort_order} onChange={e => setNewForm(f => ({ ...f, sort_order: e.target.value }))}
                  placeholder="0" className={inputCls} />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <Button variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={saving || !newForm.name.trim() || !newForm.code.trim()}>
                {saving ? 'Creating...' : 'Create Category'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showEdit && editTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-800">Edit Category</h2>
              <button onClick={() => setShowEdit(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
                <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Aeration" className={inputCls} autoFocus
                  disabled={editTarget.is_system} />
                {editTarget.is_system && <p className="text-xs text-amber-600 mt-1">Built-in category name cannot be changed</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Code *</label>
                <input value={editForm.code} onChange={e => setEditForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="e.g. AERATION" className={inputCls}
                  disabled={editTarget.is_system} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                <input value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Brief description of this category" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Sort Order</label>
                <input type="number" value={editForm.sort_order} onChange={e => setEditForm(f => ({ ...f, sort_order: e.target.value }))}
                  placeholder="0" className={inputCls} />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <Button variant="ghost" onClick={() => setShowEdit(false)}>Cancel</Button>
              <Button onClick={handleEdit} disabled={saving || !editForm.name.trim() || !editForm.code.trim()}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
