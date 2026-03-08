import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, X, ShieldCheck } from 'lucide-react';
import ContextMenu, { ContextMenuItem } from '../../components/ui/ContextMenu';

interface TankFamily {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_system: boolean;
  product_count: number;
}

const inputCls = 'border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76] w-full';

export default function AdminTankFamilies() {
  const qc = useQueryClient();

  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ name: '', code: '', description: '', sort_order: '' });
  const [saving, setSaving] = useState(false);

  const [showEdit, setShowEdit] = useState(false);
  const [editTarget, setEditTarget] = useState<TankFamily | null>(null);
  const [editForm, setEditForm] = useState({ name: '', code: '', description: '', sort_order: '' });

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; fam: TankFamily } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-tank-families'],
    queryFn: () => api.get('/admin/tank-families').then(r => r.data),
  });

  const families: TankFamily[] = data?.items || [];

  const openEdit = (fam: TankFamily) => {
    setEditTarget(fam);
    setEditForm({ name: fam.name, code: fam.code, description: fam.description || '', sort_order: String(fam.sort_order) });
    setShowEdit(true);
    setCtxMenu(null);
  };

  const handleCreate = async () => {
    if (!newForm.name.trim() || !newForm.code.trim()) { toast.error('Name and code are required'); return; }
    setSaving(true);
    try {
      await api.post('/admin/tank-families', {
        name: newForm.name.trim(),
        code: newForm.code.trim().toUpperCase(),
        description: newForm.description.trim() || null,
        sort_order: newForm.sort_order ? parseInt(newForm.sort_order) : 0,
      });
      toast.success('Tank family created');
      setShowNew(false);
      setNewForm({ name: '', code: '', description: '', sort_order: '' });
      qc.invalidateQueries({ queryKey: ['admin-tank-families'] });
      qc.invalidateQueries({ queryKey: ['tank-families'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to create tank family');
    } finally { setSaving(false); }
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    setSaving(true);
    try {
      await api.put(`/admin/tank-families/${editTarget.id}`, {
        name: editForm.name.trim(),
        description: editForm.description.trim() || null,
        sort_order: editForm.sort_order ? parseInt(editForm.sort_order) : 0,
      });
      toast.success('Tank family updated');
      setShowEdit(false);
      setEditTarget(null);
      qc.invalidateQueries({ queryKey: ['admin-tank-families'] });
      qc.invalidateQueries({ queryKey: ['tank-families'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to update tank family');
    } finally { setSaving(false); }
  };

  const handleDelete = async (fam: TankFamily) => {
    if (fam.is_system) { toast.error('Built-in tank families cannot be deleted'); return; }
    if (!confirm(`Delete tank family "${fam.name}"? Products linked to it will be unlinked.`)) return;
    try {
      await api.delete(`/admin/tank-families/${fam.id}`);
      toast.success('Tank family deleted');
      qc.invalidateQueries({ queryKey: ['admin-tank-families'] });
      qc.invalidateQueries({ queryKey: ['tank-families'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to delete');
    }
    setCtxMenu(null);
  };

  const getMenuItems = (fam: TankFamily): ContextMenuItem[] => [
    { label: 'Edit', icon: <Pencil className="w-3.5 h-3.5" />, onClick: () => openEdit(fam) },
    ...(!fam.is_system ? [{
      label: 'Delete', icon: <Trash2 className="w-3.5 h-3.5" />, onClick: () => handleDelete(fam), danger: true, divider: true,
    }] : []),
  ];

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Tank Families"
        subtitle="Distinct family classifications for tank types in the library"
        actions={<Button variant="primary" onClick={() => setShowNew(true)}><Plus className="w-4 h-4" />New Family</Button>}
      />

      <div className="flex-1 overflow-auto p-4">
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-32">Code</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Description</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-20">Order</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-20">Products</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide w-24">Type</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="text-center py-12 text-slate-400">Loading...</td></tr>
              )}
              {!isLoading && families.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-slate-400">No tank families yet</td></tr>
              )}
              {families.map(fam => (
                <tr
                  key={fam.id}
                  onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, fam }); }}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-context-menu select-none"
                >
                  <td className="px-4 py-3 font-medium text-slate-800">{fam.name}</td>
                  <td className="px-4 py-3"><span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-600">{fam.code}</span></td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{fam.description || <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3 text-slate-500">{fam.sort_order}</td>
                  <td className="px-4 py-3 text-slate-600">{fam.product_count}</td>
                  <td className="px-4 py-3">
                    {fam.is_system
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
          items={getMenuItems(ctxMenu.fam)}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {showNew && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-800">New Tank Family</h2>
              <button onClick={() => setShowNew(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
                <input value={newForm.name}
                  onChange={e => setNewForm(f => ({ ...f, name: e.target.value, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '_') }))}
                  placeholder="e.g. Drum Filters" className={inputCls} autoFocus />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Code * <span className="text-slate-400 font-normal">(unique identifier)</span></label>
                <input value={newForm.code}
                  onChange={e => setNewForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="e.g. DRUM_FILTERS" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                <input value={newForm.description}
                  onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Brief description" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Sort Order <span className="text-slate-400 font-normal">(lower = higher in list)</span></label>
                <input type="number" value={newForm.sort_order}
                  onChange={e => setNewForm(f => ({ ...f, sort_order: e.target.value }))}
                  placeholder="0" className={inputCls} />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <Button variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={saving || !newForm.name.trim() || !newForm.code.trim()}>
                {saving ? 'Creating...' : 'Create Family'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showEdit && editTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-800">Edit Tank Family</h2>
              <button onClick={() => setShowEdit(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
                <input value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  className={inputCls} autoFocus
                  disabled={editTarget.is_system} />
                {editTarget.is_system && <p className="text-xs text-amber-600 mt-1">Built-in family name cannot be changed</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Code</label>
                <input value={editForm.code} className={inputCls} disabled />
                <p className="text-xs text-slate-400 mt-1">Code cannot be changed after creation</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                <input value={editForm.description}
                  onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Sort Order</label>
                <input type="number" value={editForm.sort_order}
                  onChange={e => setEditForm(f => ({ ...f, sort_order: e.target.value }))}
                  className={inputCls} />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <Button variant="ghost" onClick={() => setShowEdit(false)}>Cancel</Button>
              <Button onClick={handleEdit} disabled={saving || !editForm.name.trim()}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
