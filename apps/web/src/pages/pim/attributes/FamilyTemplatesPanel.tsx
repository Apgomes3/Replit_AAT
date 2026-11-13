import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Lock, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../lib/api';
import { apiError, pimKeys, unitSymbols, useAttributes, useCanManagePim, useFamilies, useTemplate, useUnits } from './pimAttributesApi';

type Row = { attribute_id: string; required: boolean; variant_axis: boolean };

/** Family templates: which attributes each product family has, which are required, and its variant axes. */
export default function FamilyTemplatesPanel() {
  const qc = useQueryClient();
  const canManage = useCanManagePim();
  const { data: families = [] } = useFamilies();
  const { data: attributes = [] } = useAttributes();
  const { data: measures } = useUnits();
  const symbols = unitSymbols(measures);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const { data: template, isLoading } = useTemplate(familyId);
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!familyId && families.length) setFamilyId(families[0]!.id); }, [families, familyId]);
  useEffect(() => {
    setRows((template ?? []).map(t => ({ attribute_id: t.id, required: t.required, variant_axis: t.variant_axis })));
    setDirty(false);
  }, [template]);

  const byId = useMemo(() => new Map(attributes.map(a => [a.id, a])), [attributes]);
  const available = attributes.filter(a => a.active && !rows.some(r => r.attribute_id === a.id));
  const family = families.find(f => f.id === familyId);

  const change = (next: Row[]) => { setRows(next); setDirty(true); };
  const move = (i: number, d: number) => { const n = [...rows]; [n[i], n[i + d]] = [n[i + d]!, n[i]!]; change(n); };

  function selectFamily(id: string) {
    if (dirty && !confirm('Discard unsaved changes to this template?')) return;
    setFamilyId(id);
  }

  async function save() {
    setSaving(true);
    try {
      await api.put(`/pim/families/${familyId}/attributes`, { attributes: rows });
      toast.success('Template saved');
      await Promise.all([
        qc.invalidateQueries({ queryKey: pimKeys.template(familyId!) }),
        qc.invalidateQueries({ queryKey: pimKeys.families }),
        qc.invalidateQueries({ queryKey: pimKeys.attributes }),
        qc.invalidateQueries({ queryKey: ['pim', 'item'] }),
      ]);
    } catch (e) { toast.error(apiError(e, 'Could not save the template')); } finally { setSaving(false); }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
      <nav aria-label="Product families" className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {families.map(f => (
          <button key={f.id} onClick={() => selectFamily(f.id)} aria-current={f.id === familyId}
            className={`flex w-full items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 text-left text-sm ${f.id === familyId ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50'}`}>
            <span><span className="block font-medium">{f.name}</span><span className="font-mono text-xs text-slate-500">{f.code} · {f.product_count} products</span></span>
            <span className="whitespace-nowrap text-xs text-slate-500">{f.attribute_count ? `${f.attribute_count} attr` : '—'}</span>
          </button>
        ))}
      </nav>

      <section className="rounded-lg border border-slate-200 bg-white">
        <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-3">
          <div>
            <h3 className="font-semibold text-slate-900">{family?.name ?? 'Select a family'}</h3>
            <p className="text-xs text-slate-500">Required attributes count towards completeness. Missing values only warn — they do not block release.</p>
          </div>
          {canManage && <button disabled={!dirty || saving} onClick={() => void save()}
            className="ml-auto rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{saving ? 'Saving…' : 'Save template'}</button>}
        </header>

        {isLoading ? <p className="p-5 text-sm text-slate-500">Loading…</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="px-5 py-2 font-medium">Attribute</th><th className="px-3 py-2 font-medium">Group</th><th className="px-3 py-2 font-medium">Unit</th>
                <th className="px-3 py-2 text-center font-medium">Required</th><th className="px-3 py-2 text-center font-medium" title="Variants of one parent differ along these attributes">Variant axis</th><th className="w-28" /></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const a = byId.get(r.attribute_id);
                if (!a) return null;
                return (
                  <tr key={r.attribute_id} className="border-t border-slate-100">
                    <td className="px-5 py-2 font-medium">{a.is_system && <Lock className="mr-1.5 inline h-3 w-3 text-slate-400" />}{a.label}</td>
                    <td className="px-3 py-2 text-slate-600">{a.group_name}</td>
                    <td className="px-3 py-2 text-slate-600">{a.default_unit ? symbols[a.default_unit] : '—'}</td>
                    <td className="px-3 py-2 text-center"><input type="checkbox" aria-label={`${a.label} required`} disabled={!canManage} checked={r.required}
                      onChange={e => change(rows.map((x, j) => j === i ? { ...x, required: e.target.checked } : x))} /></td>
                    <td className="px-3 py-2 text-center"><input type="checkbox" aria-label={`${a.label} variant axis`} disabled={!canManage} checked={r.variant_axis}
                      onChange={e => change(rows.map((x, j) => j === i ? { ...x, variant_axis: e.target.checked } : x))} /></td>
                    <td className="px-3 py-2 text-right">{canManage && <span className="inline-flex gap-0.5">
                      <button aria-label={`Move ${a.label} up`} disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                      <button aria-label={`Move ${a.label} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)} className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                      <button aria-label={`Remove ${a.label}`} onClick={() => change(rows.filter((_, j) => j !== i))} className="rounded p-1 text-slate-400 hover:text-red-600"><X className="h-4 w-4" /></button>
                    </span>}</td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">No attributes in this family yet.</td></tr>}
            </tbody>
          </table>
        )}

        {canManage && familyId && (
          <div className="border-t border-slate-200 px-5 py-3">
            <label className="text-xs font-semibold text-slate-600">Add attribute
              <select className="ml-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-normal" value=""
                onChange={e => e.target.value && change([...rows, { attribute_id: e.target.value, required: false, variant_axis: false }])}>
                <option value="">Choose…</option>
                {[...new Set(available.map(a => a.group_name))].map(g => <optgroup key={g} label={g}>
                  {available.filter(a => a.group_name === g).map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                </optgroup>)}
              </select>
            </label>
          </div>
        )}
      </section>
    </div>
  );
}
