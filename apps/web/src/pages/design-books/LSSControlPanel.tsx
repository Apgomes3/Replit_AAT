import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, LayoutGrid, List, Plus, RefreshCw, Save, SlidersHorizontal } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { exportCsv } from '../../lib/exportCsv';

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
  range_min: string;
  range_max: string;
  unit: string;
  range_supplied: boolean;
  calibration_required: boolean;
  calibration_interval_days: string;
  calibration_procedure: string;
  datasheet_reference: string;
  calibration_supplied: boolean;
};

type IOScheduleRow = {
  panel: string;
  direction: string;
  tag: string;
  instrument: string;
  signalType: string;
  product: string;
  controlLogic: string;
};

type InstrumentFieldProps = {
  id: string;
  definition: any;
  instrumentName: string;
  quantity: number;
  minimum: number;
  instances: any[];
  draft?: DraftInstrument;
  products: any[];
  readOnly: boolean;
  canOverrideProduct: boolean;
  frozen: boolean;
  update: (id: string, changes: Partial<DraftInstrument>) => void;
};

const inputClass = 'mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-blue-400/40 disabled:bg-stone-50 disabled:text-stone-400';
const CONTROL_LOAD_TIMEOUT_MS = 10_000;

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

function signalDirection(value: any) {
  return value || 'Unspecified';
}

function InstrumentQuantityField({ id, instrumentName, quantity, minimum, readOnly, update, compact = false }: Pick<InstrumentFieldProps, 'id' | 'instrumentName' | 'quantity' | 'minimum' | 'readOnly' | 'update'> & { compact?: boolean }) {
  const [displayValue, setDisplayValue] = useState(String(quantity));

  useEffect(() => {
    setDisplayValue(String(quantity));
  }, [quantity]);

  const commitMinimum = () => {
    if (displayValue !== '') return;
    setDisplayValue(String(minimum));
    update(id, { quantity: minimum });
  };

  return <input
    id={`instrument-quantity-${id}`}
    aria-label={`Quantity for ${instrumentName}`}
    type="number"
    min={minimum}
    step="1"
    disabled={readOnly}
    value={displayValue}
    onChange={event => {
      const nextValue = event.target.value;
      if (nextValue === '') {
        setDisplayValue('');
        return;
      }
      const governedValue = Math.max(minimum, Number(nextValue));
      setDisplayValue(String(governedValue));
      update(id, { quantity: governedValue });
    }}
    onBlur={commitMinimum}
    className={`${inputClass} ${compact ? 'mt-0 px-2 py-1.5' : ''}`}
  />;
}

function InstrumentProductField({ id, definition, instrumentName, instances, draft, products, readOnly, canOverrideProduct, frozen, update, compact = false, visibleLabel = false }: InstrumentFieldProps & { compact?: boolean; visibleLabel?: boolean }) {
  const selectedProduct = draft?.product_master_id ?? productId(definition) ?? '';
  const historicProduct = instances.find(item => productId(item) === selectedProduct)?.product_snapshot;
  const selectedProductMissing = Boolean(selectedProduct) && !products.some(product => product.id === selectedProduct) && !historicProduct;
  const labelClass = visibleLabel ? 'block text-xs font-medium text-stone-500' : 'sr-only';
  return <label className={labelClass} htmlFor={`instrument-product-${id}`}>{visibleLabel ? 'Effective PIM product' : `Product for ${instrumentName}`}
    <select id={`instrument-product-${id}`} aria-label={`Product for ${instrumentName}`} disabled={readOnly || !canOverrideProduct} value={selectedProduct || ''} onChange={event => update(id, { product_master_id: event.target.value || null, product_supplied: true })} className={`${inputClass} ${compact ? 'mt-0 px-2 py-1.5' : ''}`}><option value="">— No product linked —</option>{historicProduct && !products.some(product => product.id === selectedProduct) && <option value={selectedProduct}>{productLabel(historicProduct)} (frozen snapshot)</option>}{selectedProductMissing && <option value={selectedProduct}>Historical product unavailable ({selectedProduct})</option>}{products.map(product => <option key={product.id} value={product.id}>{productLabel(product)}</option>)}</select>
    {frozen && historicProduct && <span className="mt-1 block text-[10px] font-normal text-stone-400">Frozen product evidence</span>}
    {!canOverrideProduct && !readOnly && <span className="mt-1 block text-[10px] font-normal text-stone-400">PIM is hidden for your role, so the product cannot be changed.</span>}
  </label>;
}

function InstrumentDetailFields({ id, definition, instrumentName, quantity, instances, draft, readOnly, frozen, update, layout }: Pick<InstrumentFieldProps, 'id' | 'definition' | 'instrumentName' | 'quantity' | 'instances' | 'draft' | 'readOnly' | 'frozen' | 'update'> & { layout: 'list' | 'card' }) {
  const [showOptionalDetails, setShowOptionalDetails] = useState(false);
  const selectedLogic = draft ? draft.control_logic || '' : definition.default_control_logic || '';
  const rangeMin = draft ? draft.range_min : String(definition.default_range_min ?? '');
  const rangeMax = draft ? draft.range_max : String(definition.default_range_max ?? '');
  const unit = draft ? draft.unit : definition.default_unit || '';
  const calibrationRequired = draft ? draft.calibration_required : definition.default_calibration_required === true;
  const calibrationInterval = draft ? draft.calibration_interval_days : String(definition.default_calibration_interval_days ?? '');
  const calibrationProcedure = draft ? draft.calibration_procedure : definition.default_calibration_procedure || '';
  const datasheetReference = draft ? draft.datasheet_reference : definition.default_datasheet_reference || '';
  const columns = layout === 'list' ? 'md:grid-cols-3' : 'sm:grid-cols-3';
  const evidenceColumns = layout === 'list' ? 'md:grid-cols-3' : 'sm:grid-cols-2';
  const fullSpan = layout === 'list' ? 'md:col-span-3' : 'sm:col-span-2';
  return <>
    <div className={layout === 'list' ? 'md:col-span-3' : ''}>
      <button type="button" aria-expanded={showOptionalDetails} aria-controls={`instrument-evidence-${id}-${layout}`} onClick={() => setShowOptionalDetails(value => !value)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-dashed border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700">
        <Plus className={`h-3.5 w-3.5 transition-transform ${showOptionalDetails ? 'rotate-45' : ''}`} />
        {readOnly ? 'View' : showOptionalDetails ? 'Hide' : 'Add'} control details and evidence for {instrumentName}
      </button>
      {showOptionalDetails && <div id={`instrument-evidence-${id}-${layout}`} className="mt-3 grid gap-3">
        <label className="block text-xs font-medium text-stone-500">Control logic<textarea aria-label={`Control logic for ${instrumentName}`} disabled={readOnly} value={selectedLogic} onChange={event => update(id, { control_logic: event.target.value || null, control_logic_supplied: true })} rows={2} placeholder="Describe the functional control logic" className={inputClass} />{!selectedLogic && quantity > 0 && <span className="mt-1 block text-[10px] font-normal text-amber-700">Control logic is required because this catalog definition has no default.</span>}{instances.length > 1 && <span className="mt-1 block text-[10px] font-normal text-stone-400">This logic applies to the {instances.length} saved instances of this type.</span>}</label>
        <fieldset className={`grid gap-3 rounded-lg border border-stone-200 p-3 ${columns}`}><legend className="px-1 text-xs font-semibold text-stone-600">Effective measurement range</legend>
          <label className="text-xs font-medium text-stone-500">Minimum<input aria-label={`Range minimum for ${definition.name}`} type="number" step="any" disabled={readOnly || definition.allow_range_override === false} value={rangeMin} onChange={event => update(id, { range_min: event.target.value, range_supplied: true })} className={inputClass} /></label>
          <label className="text-xs font-medium text-stone-500">Maximum<input aria-label={`Range maximum for ${definition.name}`} type="number" step="any" disabled={readOnly || definition.allow_range_override === false} value={rangeMax} onChange={event => update(id, { range_max: event.target.value, range_supplied: true })} className={inputClass} /></label>
          <label className="text-xs font-medium text-stone-500">Unit<input aria-label={`Range unit for ${definition.name}`} disabled={readOnly || definition.allow_range_override === false} value={unit} onChange={event => update(id, { unit: event.target.value, range_supplied: true })} className={inputClass} /></label>
        </fieldset>
        <fieldset className={`grid gap-3 rounded-lg border border-stone-200 p-3 ${evidenceColumns}`}><legend className="px-1 text-xs font-semibold text-stone-600">Calibration and datasheet evidence</legend>
          <label className="flex items-center gap-2 text-xs text-stone-700"><input aria-label={`Calibration required for ${definition.name}`} type="checkbox" disabled={readOnly || definition.allow_calibration_override === false} checked={calibrationRequired} onChange={event => update(id, { calibration_required: event.target.checked, calibration_supplied: true })} />Calibration required</label>
          <label className="text-xs font-medium text-stone-500">Interval (days)<input aria-label={`Calibration interval for ${definition.name}`} type="number" min="1" disabled={readOnly || definition.allow_calibration_override === false} value={calibrationInterval} onChange={event => update(id, { calibration_interval_days: event.target.value, calibration_supplied: true })} className={inputClass} /></label>
          <label className={`text-xs font-medium text-stone-500 ${fullSpan}`}>Procedure<input aria-label={`Calibration procedure for ${definition.name}`} disabled={readOnly || definition.allow_calibration_override === false} value={calibrationProcedure} onChange={event => update(id, { calibration_procedure: event.target.value, calibration_supplied: true })} className={inputClass} /></label>
          <label className={`text-xs font-medium text-stone-500 ${fullSpan}`}>Datasheet reference<input aria-label={`Datasheet reference for ${definition.name}`} disabled={readOnly || definition.allow_calibration_override === false} value={datasheetReference} onChange={event => update(id, { datasheet_reference: event.target.value, calibration_supplied: true })} placeholder="Document number, URL, or unavailable historical reference" className={inputClass} />{frozen && <span className="mt-1 block text-[10px] font-normal text-stone-400">Frozen calibration and datasheet evidence</span>}</label>
        </fieldset>
      </div>}
    </div>
  </>;
}

function scheduleRows(control: any, savedInstruments: any[], definitions: any[], products: any[]): IOScheduleRow[] {
  const definitionsById = new Map(definitions.map(definition => [definitionId(definition), definition]));
  const rows = savedInstruments.flatMap(item => {
    const definition = definitionsById.get(definitionId(item)) || item.definition_snapshot || {};
    const quantity = Math.max(1, Number(item.quantity || 1));
    // Older responses can return an aggregated saved selection. Expand it so
    // the preview remains an instance schedule rather than a definition list.
    const tags = Array.isArray(item.tags) ? item.tags : [item.tag || item.instrument_tag || 'Unallocated'];
    const panel = item.panel_type || item.panel || control?.control?.panel_type || control?.panel_type || 'GPO';
    const direction = signalDirection(item.signal_direction || definition.signal_direction);
    const assignedProductId = productId(item);
    const product = item.product_snapshot || definition.product_snapshot
      || products.find(candidate => candidate.id === assignedProductId)
      || (item.product_name ? item : null);
    return Array.from({ length: quantity }, (_, index) => ({
      panel,
      direction,
      tag: tags[index] || (quantity === 1 ? tags[0] : `Unallocated ${index + 1}`),
      instrument: item.instrument_name || definition.name || 'Historical field instrument',
      signalType: item.signal_type || definition.signal_type || 'Unspecified',
      product: productLabel(product),
      // This is intentionally the instance value only: a catalogue default
      // may have changed since this saved/frozen instance was configured.
      controlLogic: item.control_logic || '—',
    }));
  });
  const directionOrder = (direction: string) => direction.toLowerCase() === 'input' ? 0 : direction.toLowerCase() === 'output' ? 1 : 2;
  return rows.sort((a, b) => a.panel.localeCompare(b.panel)
    || directionOrder(a.direction) - directionOrder(b.direction)
    || a.direction.localeCompare(b.direction)
    || a.tag.localeCompare(b.tag)
    || a.instrument.localeCompare(b.instrument));
}

export default function LSSControlPanel({ bookId, systemId, readOnly, canOverrideProduct }: Props) {
  const qc = useQueryClient();
  const [panelType, setPanelType] = useState<'GPO' | 'PLC'>('GPO');
  const [instruments, setInstruments] = useState<DraftInstrument[]>([]);
  const [instrumentView, setInstrumentView] = useState<'list' | 'card'>('list');
  const [saving, setSaving] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['lss-control', bookId, systemId],
    queryFn: ({ signal }) => api.get(`/systems/${systemId}/control`, {
      params: { design_book_id: bookId },
      signal,
      timeout: CONTROL_LOAD_TIMEOUT_MS,
    }).then(response => response.data),
    enabled: Boolean(bookId && systemId),
    retry: false,
  });
  const control = data;
  const { data: productData = { items: [] } } = useQuery({
    queryKey: ['field-instrument-product-picker'],
    queryFn: ({ signal }) => api.get('/products/masters', {
      params: { limit: 1000, status: 'Active' },
      signal,
      timeout: CONTROL_LOAD_TIMEOUT_MS,
    }).then(response => response.data),
    // The PIM endpoint allows module view access. A hidden PIM module must not
    // trigger a picker request, while Design Book editors can still select a
    // product without being allowed to administer the PIM catalogue.
    enabled: Boolean(control) && !readOnly && canOverrideProduct,
    retry: false,
  });
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
  const ioSchedule = useMemo(() => scheduleRows(control, savedInstruments, definitions, products), [control, savedInstruments, definitions, products]);

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
        range_min: String(item.range_min ?? ''),
        range_max: String(item.range_max ?? ''),
        unit: item.unit || '',
        range_supplied: false,
        calibration_required: item.calibration_required === true,
        calibration_interval_days: String(item.calibration_interval_days ?? ''),
        calibration_procedure: item.calibration_procedure || '',
        datasheet_reference: item.datasheet_reference || '',
        calibration_supplied: false,
      });
    });
    setInstruments([...grouped.values()]);
  }, [control]);

  const drafts = useMemo(() => new Map(instruments.map(item => [item.definition_id, item])), [instruments]);
  const update = (id: string, changes: Partial<DraftInstrument>) => {
    setInstruments(current => {
      const currentItem = current.find(item => item.definition_id === id);
      const definition = definitions.find(item => definitionId(item) === id) || {};
      return currentItem
        ? current.map(item => item.definition_id === id ? { ...item, ...changes } : item)
        : [...current, {
          definition_id: id, quantity: 1, product_master_id: null, product_supplied: false,
          control_logic: definition.default_control_logic || null, control_logic_supplied: false,
          range_min: String(definition.default_range_min ?? ''),
          range_max: String(definition.default_range_max ?? ''),
          unit: definition.default_unit || '',
          range_supplied: false,
          calibration_required: definition.default_calibration_required === true,
          calibration_interval_days: String(definition.default_calibration_interval_days ?? ''),
          calibration_procedure: definition.default_calibration_procedure || '',
          datasheet_reference: definition.default_datasheet_reference || '',
          calibration_supplied: false,
          ...changes,
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
          .map(({ product_supplied, control_logic_supplied, range_supplied, calibration_supplied,
            product_master_id, control_logic, range_min, range_max, unit, calibration_required,
            calibration_interval_days, calibration_procedure, datasheet_reference, ...item }) => ({
            ...item,
            ...(product_supplied ? { product_master_id } : {}),
            ...(control_logic_supplied ? { control_logic } : {}),
            ...(range_supplied ? {
              range_min: range_min === '' ? null : Number(range_min),
              range_max: range_max === '' ? null : Number(range_max),
              unit: unit || null,
            } : {}),
            ...(calibration_supplied ? {
              calibration_required,
              calibration_interval_days: calibration_interval_days === '' ? null : Number(calibration_interval_days),
              calibration_procedure: calibration_procedure || null,
              datasheet_reference: datasheet_reference || null,
            } : {}),
          })),
      });
      toast.success('Control configuration saved');
      qc.invalidateQueries({ queryKey: ['lss-control', bookId, systemId] });
      qc.invalidateQueries({ queryKey: ['design-book', bookId] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to save control configuration');
    } finally { setSaving(false); }
  };
  const downloadPdf = async () => {
    if (pdfLoading || ioSchedule.length === 0) return;
    setPdfLoading(true);
    try {
      const response = await api.get(`/systems/${systemId}/control/io-schedule.pdf`, {
        params: { design_book_id: bookId },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `io-schedule-${systemId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Could not download the I/O schedule PDF.');
    } finally {
      setPdfLoading(false);
    }
  };

  if (isLoading) return <div className="rounded-xl border border-stone-200 bg-white p-10 text-center text-sm text-stone-400" role="status">Loading control configuration…</div>;
  if (isError) return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800" role="alert">
      <p className="font-semibold">Control configuration could not be loaded</p>
      <p className="mt-1">{(error as any)?.response?.data?.error?.message || ((error as any)?.code === 'ECONNABORTED'
        ? 'The request took too long. Please retry.'
        : 'The request failed. Please retry.')}</p>
      <button
        type="button"
        onClick={() => void refetch()}
        disabled={isFetching}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
        {isFetching ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );

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
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 bg-stone-50/60 px-5 py-3.5">
          <div><h2 className="text-sm font-semibold text-stone-700">Field instruments</h2><p className="mt-0.5 text-xs text-stone-400">Mandatory quantities are enforced by the governed catalog and pump configuration. Tags are allocated when saved.</p></div>
          <div className="inline-flex rounded-lg border border-stone-200 bg-white p-1" role="group" aria-label="Field instrument view">
            <button type="button" onClick={() => setInstrumentView('list')} aria-pressed={instrumentView === 'list'}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium ${instrumentView === 'list' ? 'bg-blue-50 text-blue-700' : 'text-stone-500 hover:bg-stone-50'}`}>
              <List className="h-3.5 w-3.5" /> List
            </button>
            <button type="button" onClick={() => setInstrumentView('card')} aria-pressed={instrumentView === 'card'}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium ${instrumentView === 'card' ? 'bg-blue-50 text-blue-700' : 'text-stone-500 hover:bg-stone-50'}`}>
              <LayoutGrid className="h-3.5 w-3.5" /> Cards
            </button>
          </div>
        </div>
        {definitions.length === 0 ? <div className="p-8 text-center text-sm text-stone-400">No active field instrument definitions are available.</div> : instrumentView === 'list' ? <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] table-fixed text-left text-xs text-stone-600" aria-label="Field instrument definitions">
            <caption className="sr-only">Field instrument definitions and saved instance evidence</caption>
            <thead className="border-b border-stone-200 bg-stone-50 text-[10px] uppercase tracking-wide text-stone-400">
              <tr>
                <th scope="col" className="w-[28%] px-5 py-2.5 font-medium">Instrument</th>
                <th scope="col" className="w-[13%] px-3 py-2.5 font-medium">Signal</th>
                <th scope="col" className="w-[13%] px-3 py-2.5 font-medium">Requirement</th>
                <th scope="col" className="w-[10%] px-3 py-2.5 font-medium">Quantity</th>
                <th scope="col" className="w-[25%] px-3 py-2.5 font-medium">Effective PIM product</th>
                <th scope="col" className="w-[11%] px-3 py-2.5 font-medium">Saved tags</th>
              </tr>
            </thead>
            {definitions.map(definition => {
            const id = definitionId(definition);
            const quantity = currentQuantity(definition);
            const minimum = minQuantity(definition);
            const instances = savedInstruments.filter(item => definitionId(item) === id);
            const draft = drafts.get(id);
            const instrumentName = definition.name || 'Historical field instrument';
            const savedTags = instances.map(item => item.tag || item.instrument_tag).filter(Boolean);
            return <tbody key={id} className="border-b border-stone-100 last:border-0">
              <tr className="align-top">
                <th scope="row" className="px-5 py-3 font-normal"><div className="flex items-center gap-2"><span className="font-semibold text-stone-800">{instrumentName}</span><span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[10px] text-stone-600">{definition.tag_code || '—'}</span></div><p className="mt-1 line-clamp-2 text-[11px] text-stone-500">{definition.description || 'No catalog description.'}</p>{control?.frozen && <p className="mt-1 text-[10px] font-medium text-stone-400">Frozen definition evidence</p>}</th>
                <td className="px-3 py-3"><span className="block font-medium text-stone-700">{definition.signal_type || 'Unspecified'}</span><span className="text-[10px] uppercase tracking-wide text-stone-400">{signalDirection(definition.signal_direction)}</span></td>
                <td className="px-3 py-3">{minimum > 0 ? <span className="inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Required · min {minimum}</span> : <span className="text-stone-400">Optional</span>}</td>
                <td className="px-3 py-3"><label className="sr-only" htmlFor={`instrument-quantity-${id}`}>Quantity for {instrumentName}</label><InstrumentQuantityField id={id} instrumentName={instrumentName} quantity={quantity} minimum={minimum} readOnly={readOnly} update={update} compact /></td>
                <td className="px-3 py-3"><InstrumentProductField id={id} definition={definition} instrumentName={instrumentName} quantity={quantity} minimum={minimum} instances={instances} draft={draft} products={products} readOnly={readOnly} canOverrideProduct={canOverrideProduct} frozen={Boolean(control?.frozen)} update={update} compact /></td>
                <td className="break-words px-3 py-3 font-mono text-[11px] text-stone-500">{savedTags.join(', ') || (instances.length > 0 ? 'Allocated on save' : '—')}</td>
              </tr>
              <tr>
                <td colSpan={6} className="px-5 pb-3 pt-0">
                  <details className="group rounded-lg border border-stone-200 bg-stone-50/40" open={definitions.length === 1}>
                    <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40">Control, range, calibration &amp; datasheet details for {instrumentName}</summary>
                    <div className="grid gap-3 border-t border-stone-200 bg-white p-3 md:grid-cols-3">
              <InstrumentDetailFields id={id} definition={definition} instrumentName={instrumentName} quantity={quantity} instances={instances} draft={draft} readOnly={readOnly} frozen={Boolean(control?.frozen)} update={update} layout="list" />
                    </div>
                  </details>
                </td>
              </tr>
            </tbody>;
          })}
          </table>
        </div> : <div className="grid gap-4 p-3 sm:p-5 xl:grid-cols-2" aria-label="Field instrument cards">
          {definitions.map(definition => {
            const id = definitionId(definition);
            const quantity = currentQuantity(definition);
            const minimum = minQuantity(definition);
            const instances = savedInstruments.filter(item => definitionId(item) === id);
            const draft = drafts.get(id);
            const instrumentName = definition.name || 'Historical field instrument';
            const savedTags = instances.map(item => item.tag || item.instrument_tag).filter(Boolean);
            return <article key={id} className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm" aria-labelledby={`instrument-card-${id}`}>
              <div className="border-b border-stone-100 bg-stone-50/50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h3 id={`instrument-card-${id}`} className="break-words font-semibold text-stone-800">{instrumentName}</h3><span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[10px] text-stone-600">{definition.tag_code || '—'}</span></div>
                    <p className="mt-1 break-words text-xs text-stone-500">{definition.description || 'No catalog description.'}</p>
                    {control?.frozen && <p className="mt-1 text-[10px] font-medium text-stone-400">Frozen definition evidence</p>}
                  </div>
                  <div className="text-right text-xs"><span className="block font-medium text-stone-700">{definition.signal_type || 'Unspecified'}</span><span className="text-[10px] uppercase tracking-wide text-stone-400">{signalDirection(definition.signal_direction)}</span></div>
                </div>
              </div>
              <div className="space-y-4 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><span className="block text-xs font-medium text-stone-500">Requirement</span><div className="mt-2">{minimum > 0 ? <span className="inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Required · min {minimum}</span> : <span className="text-xs text-stone-400">Optional</span>}</div></div>
                  <label className="text-xs font-medium text-stone-500">Quantity<InstrumentQuantityField id={id} instrumentName={instrumentName} quantity={quantity} minimum={minimum} readOnly={readOnly} update={update} /></label>
                </div>
                <InstrumentProductField id={id} definition={definition} instrumentName={instrumentName} quantity={quantity} minimum={minimum} instances={instances} draft={draft} products={products} readOnly={readOnly} canOverrideProduct={canOverrideProduct} frozen={Boolean(control?.frozen)} update={update} visibleLabel />
                <div><span className="block text-xs font-medium text-stone-500">Saved tags</span><p className="mt-1 break-words font-mono text-xs text-stone-600">{savedTags.join(', ') || (instances.length > 0 ? 'Allocated on save' : '—')}</p></div>
                <InstrumentDetailFields id={id} definition={definition} instrumentName={instrumentName} quantity={quantity} instances={instances} draft={draft} readOnly={readOnly} frozen={Boolean(control?.frozen)} update={update} layout="card" />
              </div>
            </article>;
          })}
        </div>}
        {!readOnly && <div className="flex justify-end border-t border-stone-100 bg-stone-50/40 px-5 py-3"><button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><Save className="h-3.5 w-3.5" />{saving ? 'Saving…' : 'Save control configuration'}</button></div>}
      </section>
      <section className="overflow-hidden rounded-xl border border-stone-200 bg-white" aria-labelledby="io-schedule-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 bg-stone-50/60 px-5 py-3.5">
          <div className="min-w-0"><h2 id="io-schedule-heading" className="text-sm font-semibold text-stone-700">I/O schedule preview</h2><p className="mt-0.5 text-xs text-stone-400">Saved instrument instances, grouped by panel and signal direction.</p>{control?.frozen && <p className="mt-1 text-[10px] font-medium text-stone-400">Frozen saved-instance evidence</p>}</div>
          <div className="flex min-w-0 flex-wrap gap-2">
            <button type="button" onClick={() => exportCsv(`io-schedule-${systemId}.csv`, [
              { header: 'Panel', value: row => row.panel }, { header: 'Direction', value: row => row.direction },
              { header: 'Tag', value: row => row.tag }, { header: 'Instrument', value: row => row.instrument },
              { header: 'Signal type', value: row => row.signalType }, { header: 'Assigned product', value: row => row.product },
              { header: 'Saved control logic', value: row => row.controlLogic },
            ], ioSchedule)} disabled={ioSchedule.length === 0} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"><Download className="h-3.5 w-3.5" />Export CSV</button>
            <button type="button" onClick={() => void downloadPdf()} disabled={ioSchedule.length === 0 || pdfLoading} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"><Download className="h-3.5 w-3.5" />{pdfLoading ? 'Preparing PDF…' : 'Download PDF'}</button>
          </div>
        </div>
        {ioSchedule.length === 0 ? <div className="p-8 text-center text-sm text-stone-400" role="status">No saved instrument instances are available for this I/O schedule.</div> : <div
          className="overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
          tabIndex={0}
          role="region"
          aria-label="I/O schedule columns"
          onKeyDown={event => {
            if (event.key !== 'Home' && event.key !== 'End') return;
            event.preventDefault();
            event.currentTarget.scrollLeft = event.key === 'Home' ? 0 : event.currentTarget.scrollWidth;
          }}
        >
          {Array.from(new Map(ioSchedule.map(row => [`${row.panel}::${row.direction}`, { panel: row.panel, direction: row.direction }])).values()).map(group => {
            const rows = ioSchedule.filter(row => row.panel === group.panel && row.direction === group.direction);
            return <div key={`${group.panel}-${group.direction}`} className="border-b border-stone-100 last:border-0">
              <h3 className="bg-stone-50 px-5 py-2 text-xs font-semibold text-stone-600">{group.panel} panel · {group.direction} signals</h3>
              <table className="w-full min-w-[760px] text-left text-xs text-stone-600" aria-label={`${group.panel} ${group.direction} I/O schedule`}>
                <caption className="sr-only">{group.panel} panel {group.direction} signal I/O schedule</caption>
                <thead className="border-y border-stone-100 text-[10px] uppercase tracking-wide text-stone-400"><tr><th className="px-5 py-2 font-medium">Tag</th><th className="px-3 py-2 font-medium">Instrument</th><th className="px-3 py-2 font-medium">Signal type</th><th className="px-3 py-2 font-medium">Direction</th><th className="px-3 py-2 font-medium">Assigned product</th><th className="px-3 py-2 font-medium">Saved control logic</th></tr></thead>
                <tbody>{rows.map((row, index) => <tr key={`${row.tag}-${row.instrument}-${index}`} className="border-b border-stone-100 last:border-0"><td className="whitespace-nowrap px-5 py-3 font-mono text-stone-700">{row.tag}</td><td className="px-3 py-3 font-medium text-stone-700">{row.instrument}</td><td className="px-3 py-3">{row.signalType}</td><td className="px-3 py-3">{row.direction}</td><td className="px-3 py-3">{row.product}</td><td className="px-3 py-3">{row.controlLogic}</td></tr>)}</tbody>
              </table>
            </div>;
          })}
        </div>}
      </section>
    </div>
  );
}
