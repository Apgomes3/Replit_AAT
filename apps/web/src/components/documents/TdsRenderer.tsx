import { useState } from 'react';

type AnyRecord = Record<string, any>;

export const tdsLabel = (key: string) =>
  key.replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());

export const tdsValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const isEmpty = (value: unknown) =>
  value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);

function FieldGrid({ values }: { values?: AnyRecord | null }) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
  const fields = Object.entries(values).filter(([, value]) => !Array.isArray(value) && (typeof value !== 'object' || value === null));
  if (!fields.length) return null;
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
      {fields.map(([key, value]) => (
        <div key={key} className="border-b border-slate-100 pb-2">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{tdsLabel(key)}</dt>
          <dd className={`mt-0.5 text-sm break-words ${isEmpty(value) ? 'italic text-slate-400' : 'text-slate-800'}`}>
            {tdsValue(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DataSection({ title, values }: { title: string; values?: AnyRecord | null }) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
  return (
    <section className="tds-section break-inside-avoid">
      <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500 border-b border-slate-200 pb-2 mb-3">{title}</h2>
      <FieldGrid values={values} />
    </section>
  );
}

function ClassifierTable({ values }: { values?: AnyRecord[] }) {
  if (!values?.length) return null;
  return (
    <section className="tds-section break-inside-avoid">
      <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500 border-b border-slate-200 pb-2 mb-3">Classification values</h2>
      <Table headers={['Classifier', 'Value', 'Unit']} rows={values.map(row => [
        row.label || row.classifier_label,
        row.value_text ?? row.value,
        row.unit,
      ])} />
    </section>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: unknown[][] }) {
  return (
    <div className="overflow-x-auto rounded border border-slate-200">
      <table className="w-full text-sm border-collapse">
        <thead className="bg-slate-50">
          <tr>{headers.map(header => <th key={header} className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">{header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((value, cellIndex) => (
                <td key={cellIndex} className={`px-3 py-2 align-top break-words ${isEmpty(value) ? 'italic text-slate-400' : 'text-slate-700'}`}>{tdsValue(value)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BillOfMaterials({ values }: { values?: AnyRecord[] }) {
  if (!values?.length) return null;
  return (
    <section className="tds-section">
      <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500 border-b border-slate-200 pb-2 mb-3">Bill of materials</h2>
      <div className="space-y-4">
        {values.map((bom, index) => (
          <div key={bom.id || index} className="break-inside-avoid">
            <div className="text-sm font-medium text-slate-800 mb-2">
              {tdsValue(bom.bom_code || bom.code)}
              {bom.revision_code && <span className="text-slate-400 font-normal"> · Rev {bom.revision_code}</span>}
            </div>
            <Table headers={['Component', 'Quantity', 'Unit', 'Remarks']} rows={(Array.isArray(bom.lines) ? bom.lines : []).map((line: AnyRecord) => [
              line.component_name || line.sub_product_name || line.component_reference_code,
              line.quantity,
              line.unit,
              line.remarks,
            ])} />
            {!bom.lines?.length && <p className="text-sm italic text-slate-400">Unavailable</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

function Vendors({ values }: { values?: AnyRecord[] }) {
  if (!values?.length) return null;
  return (
    <section className="tds-section break-inside-avoid">
      <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500 border-b border-slate-200 pb-2 mb-3">Vendor options</h2>
      <Table headers={['Vendor / Manufacturer', 'Item code', 'Approval', 'Lead time']} rows={values.map(row => [
        row.vendor_name || row.manufacturer_name,
        row.vendor_item_code,
        row.approved_status,
        row.lead_time_days == null ? null : `${row.lead_time_days} days`,
      ])} />
    </section>
  );
}

export default function TdsRenderer({
  content,
  document,
  revision,
}: {
  content: AnyRecord;
  document: AnyRecord;
  revision: AnyRecord;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const sections = content?.sections || {};
  const identity = sections.identity || {};
  const imageUrl = identity.image_url;
  const unavailable = Array.isArray(content?.unavailable_fields) ? content.unavailable_fields : [];

  return (
    <article className="tds-print-sheet mx-auto w-full max-w-4xl bg-white text-slate-900">
      <header className="border-b-2 border-slate-800 pb-5 mb-7 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Technical Data Sheet</p>
          <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight break-words">{content.title || document.document_title || 'Technical Data Sheet'}</h1>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-slate-500">
            <span><b className="block text-[10px] uppercase tracking-wide text-slate-400">Document</b>{tdsValue(document.document_code)}</span>
            <span><b className="block text-[10px] uppercase tracking-wide text-slate-400">Revision</b>{tdsValue(revision.revision_code)}</span>
            <span><b className="block text-[10px] uppercase tracking-wide text-slate-400">Status</b>{tdsValue(revision.status || document.status)}</span>
            <span><b className="block text-[10px] uppercase tracking-wide text-slate-400">Generated</b>{revision.generated_at || content.generated_at ? new Date(revision.generated_at || content.generated_at).toLocaleDateString() : 'Unavailable'}</span>
          </div>
        </div>
        {imageUrl && !imageFailed ? (
          <img src={imageUrl} alt="" onError={() => setImageFailed(true)} className="w-24 h-24 object-contain rounded border border-slate-200 shrink-0" />
        ) : (
          <div className="w-24 h-24 rounded border border-dashed border-slate-300 shrink-0 flex items-center justify-center text-center text-[10px] text-slate-400">Image unavailable</div>
        )}
      </header>

      <div className="space-y-7">
        <DataSection title="Product identity" values={identity} />
        <DataSection title="Classification" values={sections.classification} />
        <ClassifierTable values={sections.classification?.classifier_values} />
        <DataSection title="Engineering values" values={sections.engineering_values} />
        <DataSection title="Materials" values={sections.materials} />
        {(['dimensions', 'electrical', 'hydraulic', 'pneumatic'] as const).map(key => (
          <DataSection key={key} title={tdsLabel(key)} values={sections[key]} />
        ))}
        <BillOfMaterials values={sections.bill_of_materials} />
        <Vendors values={sections.vendors} />
        {sections.notes !== undefined && (
          <section className="tds-section break-inside-avoid">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500 border-b border-slate-200 pb-2 mb-3">Notes</h2>
            <p className={`text-sm whitespace-pre-wrap break-words ${isEmpty(sections.notes) ? 'italic text-slate-400' : 'text-slate-700'}`}>{tdsValue(sections.notes)}</p>
          </section>
        )}
        {unavailable.length > 0 && (
          <section className="tds-section break-inside-avoid rounded border border-amber-200 bg-amber-50 p-4">
            <h2 className="text-sm font-semibold text-amber-900 mb-1">Unavailable values</h2>
            <p className="text-sm text-amber-800">The following source fields were not provided: {unavailable.map(tdsLabel).join(', ')}.</p>
          </section>
        )}
      </div>
      <footer className="mt-10 pt-3 border-t border-slate-200 text-[10px] text-slate-400 flex justify-between gap-4">
        <span>Generated PIM Technical Data Sheet · document-owned presentation</span>
        <span>Rev {tdsValue(revision.revision_code)}</span>
      </footer>
    </article>
  );
}