import { useState } from 'react';
import { X } from 'lucide-react';
import Button from './Button';

interface Field {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
}

interface NewEntityModalProps {
  title: string;
  fields: Field[];
  onSubmit: (data: Record<string, any>) => Promise<void>;
  onClose: () => void;
  initialValues?: Record<string, any>;
  submitLabel?: string;
}

export default function NewEntityModal({ title, fields, onSubmit, onClose, initialValues, submitLabel }: NewEntityModalProps) {
  const [values, setValues] = useState<Record<string, any>>(initialValues || {});
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try { await onSubmit(values); } finally { setLoading(false); }
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
                <select value={values[field.name] || ''} onChange={e => setValues(v => ({ ...v, [field.name]: e.target.value }))} required={field.required}
                  className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-amber-600">
                  <option value="">Select...</option>
                  {field.options.map(o => <option key={o}>{o}</option>)}
                </select>
              ) : (
                <input type={field.type || 'text'} value={values[field.name] || ''} onChange={e => setValues(v => ({ ...v, [field.name]: e.target.value }))}
                  required={field.required} placeholder={field.placeholder}
                  className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-amber-600" />
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
