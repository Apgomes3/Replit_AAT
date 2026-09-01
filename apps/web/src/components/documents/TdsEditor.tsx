import Button from '../ui/Button';
import { Plus, Save, Trash2 } from 'lucide-react';
import { tdsLabel } from './TdsRenderer';

type AnyRecord = Record<string, any>;

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

function InputField({
  label,
  value,
  onChange,
  multiline = false,
  numeric = false,
}: {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  multiline?: boolean;
  numeric?: boolean;
}) {
  const className = 'w-full border border-slate-300 rounded px-2.5 py-2 text-sm focus:outline-none focus:border-blue-600';
  if (typeof value === 'boolean') {
    return (
      <label className="block">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{label}</span>
        <select value={String(value)} onChange={event => onChange(event.target.value === 'true')} className={className}>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </label>
    );
  }
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{label}</span>
      {multiline ? (
        <textarea value={value == null ? '' : String(value)} onChange={event => onChange(event.target.value)} rows={4} className={`${className} resize-y`} />
      ) : (
        <input
          type={numeric || typeof value === 'number' ? 'number' : 'text'}
          value={value == null ? '' : String(value)}
          onChange={event => onChange(
            event.target.value === ''
              ? null
              : numeric || typeof value === 'number'
                ? Number(event.target.value)
                : event.target.value,
          )}
          className={className}
        />
      )}
    </label>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
      <h3 className="text-sm font-semibold text-slate-800 mb-3">{title}</h3>
      {children}
    </section>
  );
}

const setPath = (content: AnyRecord, path: string[], value: unknown) => {
  const next = clone(content);
  let cursor = next;
  path.slice(0, -1).forEach(part => { cursor = cursor[part] ?? (cursor[part] = {}); });
  cursor[path[path.length - 1]] = value === '' ? null : value;
  return next;
};

function ObjectFields({ values, onChange }: { values?: AnyRecord | null; onChange: (content: AnyRecord) => void }) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {Object.entries(values).filter(([, value]) => !Array.isArray(value) && (typeof value !== 'object' || value === null)).map(([key, value]) => (
        <InputField
          key={key}
          label={tdsLabel(key)}
          value={value}
          numeric={typeof value === 'number' || /(?:_mm|_m2|_m3h|_bar|_kw|_kg|_v|_a|_hz|density|temperature|pressure|power|flow|head|weight|length|width|height|capacity|efficiency|frequency|voltage|current)$/.test(key)}
          onChange={next => onChange(setPath(values as any, [key], next))}
        />
      ))}
    </div>
  );
}

export default function TdsEditor({
  content,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  content: AnyRecord;
  onChange: (content: AnyRecord) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const sections = content.sections || {};
  const update = (path: string[], value: unknown) => onChange(setPath(content, path, value));
  const updateRow = (path: string[], index: number, field: string, value: unknown) => {
    const next = clone(content);
    const rows = path.reduce((cursor, part) => cursor?.[part], next);
    if (rows?.[index]) rows[index][field] = value === '' ? null : value;
    onChange(next);
  };
  const addRow = (path: string[], row: AnyRecord) => {
    const next = clone(content);
    const rows = path.reduce((cursor, part) => cursor?.[part], next);
    if (Array.isArray(rows)) rows.push(row);
    onChange(next);
  };
  const removeRow = (path: string[], index: number) => {
    const next = clone(content);
    const rows = path.reduce((cursor, part) => cursor?.[part], next);
    if (Array.isArray(rows)) rows.splice(index, 1);
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <Card title="Document heading">
        <InputField label="Title" value={content.title} onChange={value => update(['title'], value)} />
      </Card>
      <Card title="Product identity">
        <ObjectFields values={sections.identity} onChange={next => update(['sections', 'identity'], next)} />
      </Card>
      <Card title="Classification">
        <ObjectFields values={sections.classification} onChange={next => update(['sections', 'classification'], next)} />
        {Array.isArray(sections.classification?.classifier_values) && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Classifier rows</span><button type="button" className="text-xs text-blue-600 flex items-center gap-1" onClick={() => addRow(['sections', 'classification', 'classifier_values'], { label: '', value_text: '', unit: '' })}><Plus className="w-3 h-3" />Add row</button></div>
            {sections.classification.classifier_values.map((row: AnyRecord, index: number) => (
              <div key={index} className="grid grid-cols-[1fr_1fr_0.6fr_auto] gap-2 items-end">
                <InputField label="Classifier" value={row.label || row.classifier_label} onChange={value => updateRow(['sections', 'classification', 'classifier_values'], index, 'label', value)} />
                <InputField label="Value" value={row.value_text ?? row.value} onChange={value => updateRow(['sections', 'classification', 'classifier_values'], index, 'value_text', value)} />
                <InputField label="Unit" value={row.unit} onChange={value => updateRow(['sections', 'classification', 'classifier_values'], index, 'unit', value)} />
                <button type="button" aria-label={`Remove classifier row ${index + 1}`} onClick={() => removeRow(['sections', 'classification', 'classifier_values'], index)} className="mb-1 p-2 text-red-500 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="Engineering values">
        <ObjectFields values={sections.engineering_values} onChange={next => update(['sections', 'engineering_values'], next)} />
      </Card>
      <Card title="Materials">
        <ObjectFields values={sections.materials} onChange={next => update(['sections', 'materials'], next)} />
      </Card>
      {(['dimensions', 'electrical', 'hydraulic', 'pneumatic'] as const).map(key => sections[key] && (
        <Card key={key} title={tdsLabel(key)}>
          <ObjectFields values={sections[key]} onChange={next => update(['sections', key], next)} />
        </Card>
      ))}
      {Array.isArray(sections.vendors) && (
        <Card title="Vendor options">
          <div className="space-y-3">
            {sections.vendors.map((row: AnyRecord, index: number) => (
              <div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end border-b border-slate-200 pb-3">
                <InputField label="Vendor / Manufacturer" value={row.vendor_name || row.manufacturer_name} onChange={value => updateRow(['sections', 'vendors'], index, 'vendor_name', value)} />
                <InputField label="Item code" value={row.vendor_item_code} onChange={value => updateRow(['sections', 'vendors'], index, 'vendor_item_code', value)} />
                <InputField label="Approval" value={row.approved_status} onChange={value => updateRow(['sections', 'vendors'], index, 'approved_status', value)} />
                <button type="button" aria-label={`Remove vendor row ${index + 1}`} onClick={() => removeRow(['sections', 'vendors'], index)} className="mb-1 p-2 text-red-500 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            <button type="button" className="text-xs text-blue-600 flex items-center gap-1" onClick={() => addRow(['sections', 'vendors'], { vendor_name: '', vendor_item_code: '', approved_status: '' })}><Plus className="w-3 h-3" />Add vendor</button>
          </div>
        </Card>
      )}
      {Array.isArray(sections.bill_of_materials) && (
        <Card title="Bill of materials">
          <div className="space-y-5">
            {sections.bill_of_materials.map((bom: AnyRecord, bomIndex: number) => (
              <div key={bomIndex} className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{bom.bom_code || `BOM ${bomIndex + 1}`}</div>
                {(bom.lines || []).map((row: AnyRecord, index: number) => (
                  <div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_0.45fr_0.45fr_1fr_auto] gap-2 items-end">
                    <InputField label="Component" value={row.component_name || row.sub_product_name} onChange={value => updateRow(['sections', 'bill_of_materials', String(bomIndex), 'lines'], index, 'component_name', value)} />
                    <InputField label="Quantity" numeric value={row.quantity} onChange={value => updateRow(['sections', 'bill_of_materials', String(bomIndex), 'lines'], index, 'quantity', value)} />
                    <InputField label="Unit" value={row.unit} onChange={value => updateRow(['sections', 'bill_of_materials', String(bomIndex), 'lines'], index, 'unit', value)} />
                    <InputField label="Remarks" value={row.remarks} onChange={value => updateRow(['sections', 'bill_of_materials', String(bomIndex), 'lines'], index, 'remarks', value)} />
                    <button type="button" aria-label={`Remove BOM row ${index + 1}`} onClick={() => removeRow(['sections', 'bill_of_materials', String(bomIndex), 'lines'], index)} className="mb-1 p-2 text-red-500 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
                <button type="button" className="text-xs text-blue-600 flex items-center gap-1" onClick={() => addRow(['sections', 'bill_of_materials', String(bomIndex), 'lines'], { component_name: '', quantity: '', unit: '', remarks: '' })}><Plus className="w-3 h-3" />Add component</button>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card title="Notes">
        <InputField label="Document notes" value={sections.notes} multiline onChange={value => update(['sections', 'notes'], value)} />
      </Card>
      <div className="flex justify-end gap-2 pt-1">
        <Button onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button variant="primary" onClick={onSave} disabled={saving}><Save className="w-3.5 h-3.5" />{saving ? 'Saving…' : 'Save Draft'}</Button>
      </div>
    </div>
  );
}