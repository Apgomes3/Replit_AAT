import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X, Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../lib/api';
import { useModalFocus } from '../../../hooks/useModalFocus';
import { apiError, Attribute, DATA_TYPE_LABELS, DataType, pimKeys, useGroups, useUnits } from './pimAttributesApi';

const label = 'text-xs font-semibold text-slate-600';
const input = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500';

const toCode = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'a_$1').slice(0, 60);

/** Create or edit an attribute. Engineering (system) attributes only allow label, group and description. */
export default function AttributeModal({ attribute, onClose }: { attribute: Attribute | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: measures = [] } = useUnits();
  const { data: groups = [] } = useGroups();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useModalFocus<HTMLDivElement>({ onClose, initialFocusRef: closeRef });
  const creating = !attribute;
  const locked = !!attribute?.is_system;

  const [form, setForm] = useState({
    label: attribute?.label ?? '',
    code: attribute?.code ?? '',
    data_type: (attribute?.data_type ?? 'text') as DataType,
    default_unit: attribute?.default_unit ?? '',
    group_code: attribute?.group_code ?? 'general',
    options: (attribute?.options ?? []).join('\n'),
    min_value: attribute?.min_value ?? '',
    max_value: attribute?.max_value ?? '',
    description: attribute?.description ?? '',
    active: attribute?.active ?? true,
  });
  const [codeTouched, setCodeTouched] = useState(!creating);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { label: form.label, group_code: form.group_code, description: form.description || null };
    if (!locked) {
      Object.assign(body, {
        data_type: form.data_type,
        default_unit: form.data_type === 'number' ? form.default_unit || null : null,
        options: form.data_type === 'list' ? form.options.split('\n').map(s => s.trim()).filter(Boolean) : [],
        min_value: form.data_type === 'number' && form.min_value !== '' ? Number(form.min_value) : null,
        max_value: form.data_type === 'number' && form.max_value !== '' ? Number(form.max_value) : null,
        active: form.active,
      });
    }
    if (creating) body.code = form.code;
    setSaving(true);
    try {
      if (creating) await api.post('/pim/attributes', body);
      else await api.patch(`/pim/attributes/${attribute!.id}`, body);
      toast.success(creating ? 'Attribute created' : 'Attribute saved');
      await qc.invalidateQueries({ queryKey: ['pim'] });
      onClose();
    } catch (err) {
      toast.error(apiError(err, 'Could not save the attribute'));
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="attr-modal-title" tabIndex={-1}
        className="max-h-[92vh] w-full max-w-xl overflow-auto rounded-xl bg-white shadow-2xl">
        <form onSubmit={submit}>
          <div className="flex justify-between gap-4 border-b border-slate-200 p-5">
            <div>
              <h2 id="attr-modal-title" className="font-semibold text-slate-900">{creating ? 'New attribute' : `Edit ${attribute!.label}`}</h2>
              {locked && <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Lock className="h-3 w-3" />
                Engineering value stored in {attribute!.typed_source} — type and unit are fixed because calculators read it.</p>}
            </div>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close"><X className="h-5 w-5 text-slate-400" /></button>
          </div>

          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <label className={label}>Label
              <input className={input} required maxLength={150} value={form.label}
                onChange={e => set({ label: e.target.value, ...(codeTouched ? {} : { code: toCode(e.target.value) }) })} />
            </label>
            <label className={label}>Code
              <input className={`${input} font-mono`} required disabled={!creating} pattern="[a-z][a-z0-9_]{1,59}" value={form.code}
                title="Lower-case letters, digits and _" onChange={e => { setCodeTouched(true); set({ code: e.target.value }); }} />
            </label>
            <label className={label}>Type
              <select className={input} disabled={locked} value={form.data_type} onChange={e => set({ data_type: e.target.value as DataType })}>
                {Object.entries(DATA_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className={label}>Group
              <select className={input} value={form.group_code} onChange={e => set({ group_code: e.target.value })}>
                {groups.map(g => <option key={g.code} value={g.code}>{g.name}</option>)}
              </select>
            </label>

            {form.data_type === 'number' && <>
              <label className={`${label} sm:col-span-2`}>Unit
                <select className={input} disabled={locked} value={form.default_unit} onChange={e => set({ default_unit: e.target.value })}>
                  <option value="">No unit (a count or plain number)</option>
                  {measures.map(m => <optgroup key={m.code} label={m.name}>
                    {m.units.map(u => <option key={u.code} value={u.code}>{u.symbol}</option>)}
                  </optgroup>)}
                </select>
                <span className="mt-1 block font-normal text-slate-400">Values can be typed in any unit of the same measure and are converted.</span>
              </label>
              <label className={label}>Minimum
                <input className={input} type="number" step="any" disabled={locked} value={form.min_value} onChange={e => set({ min_value: e.target.value })} />
              </label>
              <label className={label}>Maximum
                <input className={input} type="number" step="any" disabled={locked} value={form.max_value} onChange={e => set({ max_value: e.target.value })} />
              </label>
            </>}

            {form.data_type === 'list' && (
              <label className={`${label} sm:col-span-2`}>Options (one per line)
                <textarea className={`${input} h-28`} disabled={locked} value={form.options} onChange={e => set({ options: e.target.value })} />
              </label>
            )}

            <label className={`${label} sm:col-span-2`}>Description
              <textarea className={`${input} h-20`} value={form.description} onChange={e => set({ description: e.target.value })} />
            </label>
            {!creating && !locked && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.active} onChange={e => set({ active: e.target.checked })} /> Active
              </label>
            )}
          </div>

          <div className="flex justify-end gap-2 bg-slate-50 p-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600">Cancel</button>
            <button disabled={saving} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {saving ? 'Saving…' : creating ? 'Create attribute' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
