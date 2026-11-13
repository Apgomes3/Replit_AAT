import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Lock, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../lib/api';
import AttributeModal from './AttributeModal';
import { apiError, Attribute, DATA_TYPE_LABELS, unitSymbols, useAttributes, useCanManagePim, useUnits } from './pimAttributesApi';

/** The attribute library: every attribute with its type, unit, group and where it is used. */
export default function AttributesPanel() {
  const qc = useQueryClient();
  const canManage = useCanManagePim();
  const { data: attributes = [], isLoading, isError } = useAttributes();
  const { data: measures } = useUnits();
  const symbols = unitSymbols(measures);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Attribute | 'new' | null>(null);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = attributes.filter(a => !q || a.label.toLowerCase().includes(q) || a.code.includes(q));
    const map = new Map<string, Attribute[]>();
    for (const a of rows) map.set(a.group_name, [...(map.get(a.group_name) ?? []), a]);
    return [...map.entries()];
  }, [attributes, search]);

  async function remove(a: Attribute) {
    if (!confirm(`Delete attribute "${a.label}"?`)) return;
    try {
      await api.delete(`/pim/attributes/${a.id}`);
      toast.success('Attribute deleted');
      await qc.invalidateQueries({ queryKey: ['pim'] });
    } catch (e) { toast.error(apiError(e, 'Could not delete the attribute')); }
  }

  if (isError) return <p className="p-6 text-sm text-red-600">Could not load the attribute library.</p>;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search attributes" aria-label="Search attributes"
            className="w-64 rounded-md border border-slate-300 py-2 pl-8 pr-3 text-sm" />
        </div>
        <span className="text-xs text-slate-500">{attributes.length} attributes · <Lock className="inline h-3 w-3" /> = engineering value read by the calculators</span>
        {canManage && <button onClick={() => setEditing('new')} className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white">
          <Plus className="h-4 w-4" /> New attribute
        </button>}
      </div>

      {isLoading ? <p className="text-sm text-slate-500">Loading…</p> : groups.map(([group, rows]) => (
        <section key={group} className="mb-5 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <h3 className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">{group} · {rows.length}</h3>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="px-4 py-2 font-medium">Attribute</th><th className="px-4 py-2 font-medium">Code</th><th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Unit</th><th className="px-4 py-2 font-medium">Families</th><th className="px-4 py-2 font-medium">Values</th><th className="w-20" /></tr>
            </thead>
            <tbody>
              {rows.map(a => (
                <tr key={a.id} className={`border-t border-slate-100 ${a.active ? '' : 'text-slate-400'}`}>
                  <td className="px-4 py-2 font-medium">
                    {a.is_system && <Lock className="mr-1.5 inline h-3 w-3 text-slate-400" aria-label="Engineering value" />}
                    {a.label}{!a.active && <span className="ml-2 text-xs">(inactive)</span>}
                    {a.description && <div className="text-xs font-normal text-slate-500">{a.description}</div>}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{a.code}</td>
                  <td className="px-4 py-2">{DATA_TYPE_LABELS[a.data_type]}{a.data_type === 'list' && <span className="text-xs text-slate-500"> ({a.options.length})</span>}</td>
                  <td className="px-4 py-2">{a.default_unit ? symbols[a.default_unit] ?? a.default_unit : '—'}</td>
                  <td className="px-4 py-2">{a.family_count || '—'}</td>
                  <td className="px-4 py-2">{a.is_system ? <span className="text-xs text-slate-400">technical data</span> : a.value_count || '—'}</td>
                  <td className="px-4 py-2 text-right">
                    {canManage && <div className="flex justify-end gap-1">
                      <button onClick={() => setEditing(a)} aria-label={`Edit ${a.label}`} className="rounded p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600"><Pencil className="h-4 w-4" /></button>
                      {!a.is_system && <button onClick={() => void remove(a)} aria-label={`Delete ${a.label}`} disabled={a.value_count > 0}
                        title={a.value_count > 0 ? 'Products have values — deactivate it instead' : 'Delete'}
                        className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>}
                    </div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {!isLoading && !groups.length && <p className="text-sm text-slate-500">No attributes match “{search}”.</p>}
      {editing && <AttributeModal attribute={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
