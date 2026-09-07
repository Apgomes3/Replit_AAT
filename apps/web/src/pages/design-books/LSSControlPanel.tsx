import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Save, SlidersHorizontal } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';

type Props = {
  bookId: string;
  systemId: string;
  readOnly: boolean;
  canOverrideProduct: boolean;
};

type DraftInstrument = {
  definition_id: string;
  quantity: number;
  product_master_id: string | null;
  /** Only send a product when the designer intentionally selected one. */
  product_supplied: boolean;
  control_logic: string | null;
  /** Retains an imported default until a designer intentionally edits it. */
  control_logic_supplied: boolean;
};

const inputClass = 'mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-blue-400/40 disabled:bg-stone-50 disabled:text-stone-400';

function definitionId(item: any) {
  return item?.definition_id || item?.field_instrument_definition_id || item?.id || item?.definition_snapshot?.id;
}

function productId(item: any) {
  return item?.product_master_id || item?.effective_product_master_id || item?.default_product_master_id || item?.product_snapshot?.id || null;
}

function productLabel(product: any) {
  if (!product) return '— No product linked —';
  const name = product.product_name || product.name || 'Product unavailable';
  return `${product.product_code ? `${product.product_code} — ` : ''}${name}${product.status ? ` (${product.status})` : ''}`;
}

export default function LSSControlPanel({ bookId, systemId, readOnly, canOverrideProduct }: Props) {
  const qc = useQueryClient();
  const [panelType, setPanelType] = useState<'GPO' | 'PLC'>('GPO');
  const [instruments, setInstruments] = useState<DraftInstrument[]>([]);
  const [saving, setSaving] = useState(false);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['lss-control', bookId, systemId],
    queryFn: () => api.get(`/systems/${systemId}/control`, { params: { design_book_id: bookId } }).then(response => response.data),
  });
  const { data: productData = { items: [] } } = useQuery({
    queryKey: ['field-instrument-product-picker'],
    queryFn: () => api.get('/products/masters', { params: { limit: 1000, status: 'Active' } }).then(response => response.data),
    // The PIM endpoint allows module view access. A hidden PIM module must not
    // trigger a picker request, while Design Book editors can still select a
    // product without being allowed to administer the PIM catalogue.
    enabled: !readOnly && canOverrideProduct,
  });
  const control = data;
  const savedInstruments: any[] = control?.instruments || control?.instrument_instances || [];
  const definitions: any[] = useMemo(() => {
    const active = control?.definitions || control?.field_instrument_definitions || [];
    const known = new Map(active.map((definition: any) => [definitionId(definition), definition]));
    // The API normally performs this merge. Retaining it here makes frozen
    // review/release evidence readable with older response payloads too.
    savedInstruments.forEach(item => {
      const id = definitionId(item);
      if (id && !known.has(id) && item.definition_snapshot) {
        known.set(id, { ...item.definition_snapshot, id });
      }
    });
    return [...known.values()];
  }, [control, savedInstruments]);
  const products: any[] = control?.products || control?.product_masters || productData?.items || productData || [];

  useEffect(() => {
    if (!control) return;
    setPanelType(control.control?.panel_type === 'PLC' ? 'PLC' : 'GPO');
    const grouped = new Map<string, DraftInstrument>();
    savedInstruments.forEach(item => {
      const id = definitionId(item);
      if (!id) return;
      const current = grouped.get(id);
      grouped.set(id, {
        definition_id: id,
        quantity: current ? current.quantity + 1 : Number(item.quantity || 1),
            product_master_id: productId(item),
        product_supplied: false,
        control_logic: item.control_logic || null,
        control_logic_supplied: false,
      });
    });
    setInstruments([...grouped.values()]);
  }, [control]);

  const drafts = useMemo(() => new Map(instruments.map(item => [item.definition_id, item])), [instruments]);
  const update = (id: string, changes: Partial<DraftInstrument>) => {
    setInstruments(current => {
      const currentItem = current.find(item => item.definition_id === id);
      return currentItem
        ? current.map(item => item.definition_id === id ? { ...item, ...changes } : item)
        : [...current, {
          definition_id: id, quantity: 1, product_master_id: null, product_supplied: false,
          control_logic: null, control_logic_supplied: false, ...changes,
        }];
    });
  };
  const minQuantity = (definition: any) => Number(definition.minimum_quantity ?? definition.required_quantity
    ?? (definition.requirement_rule === 'pump_linked' ? control?.pump_linked_fs_minimum
      : String(definition.requirement_rule).toLowerCase() === 'mandatory' ? 1 : 0));
  const currentQuantity = (definition: any) => drafts.get(definitionId(definition))?.quantity || 0;
  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/systems/${systemId}/control`, {
        design_book_id: bookId,
        panel_type: panelType,
        instruments: instruments
          .filter(item => item.quantity > 0)
          .map(({ product_supplied, control_logic_supplied, product_master_id, control_logic, ...item }) => ({
            ...item,
            ...(product_supplied ? { product_master_id } : {}),
            ...(control_logic_supplied ? { control_logic } : {}),
          })),
      });
      toast.success('Control configuration saved');
      qc.invalidateQueries({ queryKey: ['lss-control', bookId, systemId] });
      qc.invalidateQueries({ queryKey: ['design-book', bookId] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to save control configuration');
    } finally { setSaving(false); }
  };

  if (isLoading) return <div className="rounded-xl border border-stone-200 bg-white p-10 text-center text-sm text-stone-400" role="status">Loading control configuration…</div>;
  if (isError) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Control configuration could not be loaded: {(error as any)?.response?.data?.error?.message || 'Try again.'}</div>;

  return (
    <div id="control" className="space-y-5">
      {readOnly && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">This Control configuration is read-only because this system or Design Book is issued, retired, or you do not have edit permission.</div>}
      <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <div className="flex items-center gap-2 border-b border-stone-100 bg-stone-50/60 px-5 py-3.5"><SlidersHorizontal className="h-4 w-4 text-blue-600" /><div><h2 className="text-sm font-semibold text-stone-700">Control panel</h2><p className="mt-0.5 text-xs text-stone-400">Select the panel basis for this Life Support System.</p></div></div>
        <div className="grid gap-3 p-5 sm:grid-cols-2" role="radiogroup" aria-label="Control panel type">
          {(['GPO', 'PLC'] as const).map(type => <label key={type} className={`cursor-pointer rounded-lg border p-4 ${panelType === type ? 'border-blue-400 bg-blue-50/50' : 'border-stone-200'} ${readOnly ? 'cursor-default' : ''}`}><input type="radio" name="control-panel-type" value={type} checked={panelType === type} disabled={readOnly} onChange={() => setPanelType(type)} className="mr-2" /><span className="font-semibold text-stone-800">{type}</span><span className="mt-1 block pl-5 text-xs text-stone-500">{type === 'GPO' ? 'General purpose outlets and conventional local control.' : 'Programmable logic controller control panel.'}</span></label>)}
        </div>
      </section>
      <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <div className="border-b border-stone-100 bg-stone-50/60 px-5 py-3.5"><h2 className="text-sm font-semibold text-stone-700">Field instruments</h2><p className="mt-0.5 text-xs text-stone-400">Mandatory quantities are enforced by the governed catalog and pump configuration. Tags are allocated when saved.</p></div>
        {definitions.length === 0 ? <div className="p-8 text-center text-sm text-stone-400">No active field instrument definitions are available.</div> : <div className="divide-y divide-stone-100">
          {definitions.map(definition => {
            const id = definitionId(definition);
            const quantity = currentQuantity(definition);
            const minimum = minQuantity(definition);
            const instances = savedInstruments.filter(item => definitionId(item) === id);
            const selectedProduct = drafts.get(id)?.product_master_id ?? productId(definition) ?? '';
            const historicProduct = instances.find(item => productId(item) === selectedProduct)?.product_snapshot;
            const selectedProductMissing = Boolean(selectedProduct)
              && !products.some(product => product.id === selectedProduct)
              && !historicProduct;
            // A saved null is historic instance evidence, not permission to
            // display a subsequently edited catalogue default as its logic.
            const draft = drafts.get(id);
            const selectedLogic = draft ? draft.control_logic || '' : definition.default_control_logic || '';
            return <div key={id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_110px_minmax(190px,0.8fr)]">
              <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-stone-800">{definition.name || 'Historical field instrument'}</h3><span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[10px] text-stone-600">{definition.tag_code || '—'}</span><span className="text-[10px] uppercase tracking-wide text-stone-400">{definition.signal_type} {definition.signal_direction}</span>{minimum > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Required · min {minimum}</span>}</div><p className="mt-1 text-xs text-stone-500">{definition.description || 'No catalog description.'}</p>{control?.frozen && <p className="mt-1 text-[10px] font-medium text-stone-400">Frozen definition evidence</p>}{instances.length > 0 && <p className="mt-1 font-mono text-[11px] text-stone-500">Tags: {instances.map(item => item.tag || item.instrument_tag).filter(Boolean).join(', ') || 'Allocated on save'}</p>}</div>
              <label className="text-xs font-medium text-stone-500">Quantity<input aria-label={`Quantity for ${definition.name}`} type="number" min={minimum} step="1" disabled={readOnly} value={quantity} onChange={event => update(id, { quantity: Math.max(minimum, Number(event.target.value || 0)) })} className={inputClass} /></label>
              <label className="text-xs font-medium text-stone-500">Effective PIM product<select aria-label={`Product for ${definition.name}`} disabled={readOnly || !canOverrideProduct} value={selectedProduct || ''} onChange={event => update(id, { product_master_id: event.target.value || null, product_supplied: true })} className={inputClass}><option value="">— No product linked —</option>{historicProduct && !products.some(product => product.id === selectedProduct) && <option value={selectedProduct}>{productLabel(historicProduct)} (frozen snapshot)</option>}{selectedProductMissing && <option value={selectedProduct}>Historical product unavailable ({selectedProduct})</option>}{products.map(product => <option key={product.id} value={product.id}>{productLabel(product)}</option>)}</select>{control?.frozen && historicProduct && <span className="mt-1 block text-[10px] font-normal text-stone-400">Frozen product evidence</span>}{!canOverrideProduct && !readOnly && <span className="mt-1 block text-[10px] font-normal text-stone-400">PIM is hidden for your role, so the product cannot be changed.</span>}</label>
              <label className="text-xs font-medium text-stone-500 md:col-span-3">Control logic<textarea aria-label={`Control logic for ${definition.name}`} disabled={readOnly} value={selectedLogic} onChange={event => update(id, { control_logic: event.target.value || null, control_logic_supplied: true })} rows={2} placeholder="Describe the functional control logic" className={inputClass} />{!selectedLogic && quantity > 0 && <span className="mt-1 block text-[10px] font-normal text-amber-700">Control logic is required because this catalog definition has no default.</span>}{instances.length > 1 && <span className="mt-1 block text-[10px] font-normal text-stone-400">This logic applies to the {instances.length} saved instances of this type.</span>}</label>
            </div>;
          })}
        </div>}
        {!readOnly && <div className="flex justify-end border-t border-stone-100 bg-stone-50/40 px-5 py-3"><button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><Save className="h-3.5 w-3.5" />{saving ? 'Saving…' : 'Save control configuration'}</button></div>}
      </section>
    </div>
  );
}