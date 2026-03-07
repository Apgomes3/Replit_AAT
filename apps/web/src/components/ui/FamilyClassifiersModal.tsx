import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import Button from './Button';
import toast from 'react-hot-toast';
import { Plus, Trash2, X, GripVertical } from 'lucide-react';

type Classifier = {
  id: string;
  family_id: string;
  label: string;
  unit: string | null;
  field_type: 'text' | 'number';
  sort_order: number;
};

type Props = {
  family: { id: string; product_family_code: string; product_family_name: string };
  onClose: () => void;
};

export default function FamilyClassifiersModal({ family, onClose }: Props) {
  const qc = useQueryClient();
  const [addForm, setAddForm] = useState({ label: '', unit: '', field_type: 'text' as 'text' | 'number' });
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ label: '', unit: '', field_type: 'text' as 'text' | 'number' });
  const [saving, setSaving] = useState(false);

  const { data, refetch } = useQuery({
    queryKey: ['family-classifiers', family.id],
    queryFn: () => api.get(`/product-families/${family.id}/classifiers`).then(r => r.data),
  });

  const classifiers: Classifier[] = data?.items || [];

  const handleAdd = async () => {
    if (!addForm.label.trim()) { toast.error('Label is required'); return; }
    setAdding(true);
    try {
      await api.post(`/product-families/${family.id}/classifiers`, {
        label: addForm.label.trim(),
        unit: addForm.unit.trim() || null,
        field_type: addForm.field_type,
        sort_order: classifiers.length,
      });
      toast.success('Classifier added');
      setAddForm({ label: '', unit: '', field_type: 'text' });
      refetch();
      qc.invalidateQueries({ queryKey: ['family-classifiers'] });
    } catch {
      toast.error('Failed to add classifier');
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (c: Classifier) => {
    setEditId(c.id);
    setEditForm({ label: c.label, unit: c.unit || '', field_type: c.field_type });
  };

  const handleEdit = async (id: string) => {
    if (!editForm.label.trim()) { toast.error('Label is required'); return; }
    setSaving(true);
    try {
      await api.put(`/family-classifiers/${id}`, {
        label: editForm.label.trim(),
        unit: editForm.unit.trim() || null,
        field_type: editForm.field_type,
        sort_order: classifiers.find(c => c.id === id)?.sort_order ?? 0,
      });
      toast.success('Classifier updated');
      setEditId(null);
      refetch();
      qc.invalidateQueries({ queryKey: ['family-classifiers'] });
    } catch {
      toast.error('Failed to update classifier');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, label: string) => {
    if (!confirm(`Delete classifier "${label}"? All values stored against products will also be removed.`)) return;
    try {
      await api.delete(`/family-classifiers/${id}`);
      toast.success('Classifier deleted');
      refetch();
      qc.invalidateQueries({ queryKey: ['family-classifiers'] });
    } catch {
      toast.error('Failed to delete classifier');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <div className="font-semibold text-slate-800">Family Classifiers</div>
            <div className="text-xs text-slate-400 mt-0.5">{family.product_family_code} · {family.product_family_name}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {classifiers.length === 0 && (
            <div className="px-6 py-8 text-center text-sm text-slate-400">No classifiers defined yet. Add one below.</div>
          )}
          {classifiers.map(c => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 hover:bg-slate-50 group">
              <GripVertical className="w-4 h-4 text-slate-200 shrink-0" />
              {editId === c.id ? (
                <div className="flex-1 flex items-center gap-2">
                  <input
                    value={editForm.label}
                    onChange={e => setEditForm(f => ({ ...f, label: e.target.value }))}
                    className="flex-1 border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-[#3E5C76]"
                    placeholder="Label"
                    autoFocus
                  />
                  <input
                    value={editForm.unit}
                    onChange={e => setEditForm(f => ({ ...f, unit: e.target.value }))}
                    className="w-20 border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-[#3E5C76]"
                    placeholder="Unit"
                  />
                  <select
                    value={editForm.field_type}
                    onChange={e => setEditForm(f => ({ ...f, field_type: e.target.value as 'text' | 'number' }))}
                    className="border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-[#3E5C76]"
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                  </select>
                  <button onClick={() => handleEdit(c.id)} disabled={saving}
                    className="text-xs px-2 py-1 bg-[#3E5C76] text-white rounded hover:bg-[#2d4a63] disabled:opacity-50">Save</button>
                  <button onClick={() => setEditId(null)} className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200">Cancel</button>
                </div>
              ) : (
                <>
                  <div className="flex-1">
                    <button onClick={() => startEdit(c)} className="text-sm font-medium text-slate-700 hover:text-[#3E5C76] text-left">{c.label}</button>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {c.field_type === 'number' ? 'Number' : 'Text'}{c.unit ? ` · ${c.unit}` : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(c.id, c.label)}
                    className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-opacity"
                  ><Trash2 className="w-4 h-4" /></button>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 shrink-0">
          <div className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">Add Classifier</div>
          <div className="flex gap-2">
            <input
              value={addForm.label}
              onChange={e => setAddForm(f => ({ ...f, label: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              placeholder="Label (e.g. Design Flow)"
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3E5C76] bg-white"
            />
            <input
              value={addForm.unit}
              onChange={e => setAddForm(f => ({ ...f, unit: e.target.value }))}
              placeholder="Unit"
              className="w-20 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3E5C76] bg-white"
            />
            <select
              value={addForm.field_type}
              onChange={e => setAddForm(f => ({ ...f, field_type: e.target.value as 'text' | 'number' }))}
              className="border border-slate-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-[#3E5C76] bg-white"
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
            </select>
            <Button size="sm" variant="primary" onClick={handleAdd} disabled={adding || !addForm.label.trim()}>
              <Plus className="w-3.5 h-3.5" />Add
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
