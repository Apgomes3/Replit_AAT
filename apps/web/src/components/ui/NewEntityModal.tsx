import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import Button from './Button';

interface Field {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  onCreateOption?: (label: string) => Promise<string>;
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
  const [values, setValues] = useState<Record<string, any>>(initialValues || {});
  const [loading, setLoading] = useState(false);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [createInput, setCreateInput] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try { await onSubmit(values); } finally { setLoading(false); }
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
      const newValue = await field.onCreateOption(createInput.trim());
      setValues(v => ({ ...v, [field.name]: newValue }));
      setCreatingFor(null);
      setCreateInput('');
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {fields.map(field => (
            <div key={field.name}>
              <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
                {field.label}{field.required && <span className="text-red-400 ml-1">*</span>}
              </label>
              {field.options ? (
                creatingFor === field.name ? (
                  <div className="space-y-1.5">
                    <input
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
                    value={values[field.name] || ''}
                    onChange={e => handleSelectChange(field, e.target.value)}
                    required={field.required}
                    className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-600"
                  >
                    <option value="">Select...</option>
                    {field.options.map(o => <option key={o}>{o}</option>)}
                    {field.onCreateOption && (
                      <option value={CREATE_SENTINEL}>＋ Add new {field.label}…</option>
                    )}
                  </select>
                )
              ) : (
                <input
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
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={loading}>{loading ? 'Saving...' : (submitLabel || 'Create')}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
