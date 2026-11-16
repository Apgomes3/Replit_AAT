import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import Button from './Button';
import { useModalFocus } from '../../hooks/useModalFocus';

interface Field {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  /** Plain values, or { value, label } when the stored value differs from what is shown (e.g. an id). */
  options?: Array<string | { value: string; label: string }>;
  onCreateOption?: (label: string, currentValues?: Record<string, any>) => Promise<string>;
  visibleWhen?: (currentValues: Record<string, any>) => boolean;
}

interface NewEntityModalProps {
  title: string;
  fields: Field[];
  onSubmit: (data: Record<string, any>) => Promise<void>;
  onClose: () => void;
  initialValues?: Record<string, any>;
  submitLabel?: string;
}

const CREATE_SENTINEL = '__CREATE_NEW__';

export default function NewEntityModal({ title, fields, onSubmit, onClose, initialValues, submitLabel }: NewEntityModalProps) {
  const modalRef = useModalFocus<HTMLDivElement>({ onClose });
  const [values, setValues] = useState<Record<string, any>>(initialValues || {});
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [createInput, setCreateInput] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSubmitError(null);
    try {
      await onSubmit(values);
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.message || 'Something went wrong. Please try again.';
      setSubmitError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectChange = (field: Field, value: string) => {
    if (value === CREATE_SENTINEL) {
      setCreatingFor(field.name);
      setCreateInput('');
    } else {
      setValues(v => ({ ...v, [field.name]: value }));
    }
  };

  const handleCreate = async (field: Field) => {
    if (!createInput.trim() || !field.onCreateOption) return;
    setCreateLoading(true);
    try {
      const newValue = await field.onCreateOption(createInput.trim(), values);
      setValues(v => ({ ...v, [field.name]: newValue }));
      setCreatingFor(null);
      setCreateInput('');
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="new-entity-modal-title" tabIndex={-1} className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h2 id="new-entity-modal-title" className="text-base font-semibold text-slate-800">{title}</h2>
          <button aria-label="Close dialog" title="Close dialog" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {fields.filter(field => field.visibleWhen?.(values) !== false).map(field => (
            <div key={field.name}>
              <label htmlFor={`new-entity-${field.name}`} className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
                {field.label}{field.required && <span className="text-red-400 ml-1">*</span>}
              </label>
              {field.options ? (
                creatingFor === field.name ? (
                  <div className="space-y-1.5">
                    <input
                      id={`new-entity-${field.name}`}
                      autoFocus
                      type="text"
                      value={createInput}
                      onChange={e => setCreateInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreate(field); } if (e.key === 'Escape') { setCreatingFor(null); } }}
                      placeholder={`New ${field.label} name…`}
                      className="w-full border border-blue-400 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={createLoading || !createInput.trim()}
                        onClick={() => handleCreate(field)}
                        className="flex items-center gap-1 text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
                      >
                        <Plus className="w-3 h-3" />
                        {createLoading ? 'Creating…' : 'Create'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCreatingFor(null)}
                        className="text-xs text-slate-400 hover:text-slate-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <select
                    id={`new-entity-${field.name}`}
                    value={values[field.name] || ''}
                    onChange={e => handleSelectChange(field, e.target.value)}
                    required={field.required}
                    className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-600"
                  >
                    <option value="">Select...</option>
                    {field.options.map(o => typeof o === 'string'
                      ? <option key={o}>{o}</option>
                      : <option key={o.value} value={o.value}>{o.label}</option>)}
                    {field.onCreateOption && (
                      <option value={CREATE_SENTINEL}>＋ Add new {field.label}…</option>
                    )}
                  </select>
                )
              ) : (
                <input
                  id={`new-entity-${field.name}`}
                  type={field.type || 'text'}
                  value={values[field.name] || ''}
                  onChange={e => setValues(v => ({ ...v, [field.name]: e.target.value }))}
                  required={field.required}
                  placeholder={field.placeholder}
                  className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-600"
                />
              )}
            </div>
          ))}
          {submitError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {submitError}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={loading}>{loading ? 'Saving...' : (submitLabel || 'Create')}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
