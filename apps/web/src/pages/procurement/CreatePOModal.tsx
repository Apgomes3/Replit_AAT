import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import EntityCode from '../../components/ui/EntityCode';
import ProtectedDraftBar, { clearRecoveryDraft } from '../../components/ui/ProtectedDraftBar';
import { draftCreateKey, persistCreateDraft } from '../../lib/createDraftKey';
import { useModalFocus } from '../../hooks/useModalFocus';
import { X, Trash2, Search, Plus, Minus, Network, Paperclip, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { currentReturnContext } from '../../lib/navigation';
import { useAuthStore } from '../../store/authStore';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'SGD', 'AUD', 'CAD', 'JPY', 'CNY'];

const PAYMENT_TERMS_OPTIONS = ['Net 15', 'Net 30', 'Net 45', 'Net 60', 'Net 90', 'Advance Payment', 'Letter of Credit', 'COD', 'Other'];
const SHIPPING_TERMS_OPTIONS = ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF', 'Other'];
const UOM_OPTIONS = ['EA', 'm', 'kg', 'm²', 'm³', 'L', 'pcs', 'set', 'pack', 'roll', 'lot', 'hr'];
const PRIORITY_OPTIONS = [
  { value: 'low',    label: 'Low',    color: 'text-slate-500' },
  { value: 'normal', label: 'Normal', color: 'text-blue-600' },
  { value: 'high',   label: 'High',   color: 'text-amber-600' },
  { value: 'urgent', label: 'Urgent', color: 'text-red-600' },
];

type DraftItem = {
  key: number;
  product_master_id: string;
  product_code: string;
  product_name: string;
  quantity: number;
  uom: string;
  cost_price: string;
  sell_price: string;
  notes: string;
  system_id: string;
  system_code: string;
  system_name: string;
  showPrices: boolean;
};

export default function CreatePOModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore(s => s.user);
  const storageKey = `purchase-order:${user?.id || 'unknown'}:create`;
  const [idempotencyKey, setIdempotencyKey] = useState(() => draftCreateKey(storageKey));
  const searchRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const closeModal = () => { if (!saving) onClose(); };
  const modalRef = useModalFocus<HTMLDivElement>({ onClose: closeModal, initialFocusRef: searchRef });

  const [projectId, setProjectId] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [notes, setNotes] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [requiredByDate, setRequiredByDate] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [paymentTermsOther, setPaymentTermsOther] = useState('');
  const [shippingTerms, setShippingTerms] = useState('');
  const [shippingTermsOther, setShippingTermsOther] = useState('');
  const [priority, setPriority] = useState('normal');
  const [saving, setSaving] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [partialPoId, setPartialPoId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<any>(null);
  const [createCommitted, setCreateCommitted] = useState(false);
  const [navigateToCreatedPoId, setNavigateToCreatedPoId] = useState<string | null>(null);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [recoveredDocumentName, setRecoveredDocumentName] = useState('');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const [items, setItems] = useState<DraftItem[]>([]);
  const [itemKey, setItemKey] = useState(0);
  const [productSearch, setProductSearch] = useState('');
  const [showResults, setShowResults] = useState(false);

  const [systemPickerKey, setSystemPickerKey] = useState<number | null>(null);
  const [systemSearch, setSystemSearch] = useState('');
  const systemPickerRef = useRef<HTMLDivElement>(null);
  const vendorPickerRef = useRef<HTMLDivElement>(null);
  const [showVendorSuggestions, setShowVendorSuggestions] = useState(false);

  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => {
    if (!navigateToCreatedPoId) return;
    const poId = navigateToCreatedPoId;
    setNavigateToCreatedPoId(null);
    navigate(`/purchase-orders/${poId}`, {
      state: currentReturnContext(location.pathname, location.search, location.pathname === '/order-management' ? 'Order queue' : 'Purchase Orders'),
    });
  }, [navigate, navigateToCreatedPoId, location.pathname, location.search]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (systemPickerRef.current && !systemPickerRef.current.contains(e.target as Node)) {
        setSystemPickerKey(null);
        setSystemSearch('');
      }
      if (vendorPickerRef.current && !vendorPickerRef.current.contains(e.target as Node)) {
        setShowVendorSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { data: projectsData } = useQuery({
    queryKey: ['projects-list-createpo'],
    queryFn: () => api.get('/projects?page_size=200').then(r => r.data),
  });

  const { data: productsData } = useQuery({
    queryKey: ['po-products-search', productSearch],
    queryFn: () => api.get(`/product-masters?q=${encodeURIComponent(productSearch)}&page_size=20`).then(r => r.data),
    enabled: productSearch.length >= 1,
  });

  const { data: projectSystems } = useQuery({
    queryKey: ['po-project-systems', projectId],
    queryFn: () => api.get(`/purchase-orders/systems-search?project_id=${projectId}&page_size=50`).then(r => r.data),
    enabled: !!projectId,
  });

  const { data: vendorData, isFetching: vendorsLoading } = useQuery({
    queryKey: ['po-vendor-search', vendorName.trim()],
    queryFn: () => api.get(`/purchase-orders/vendors?q=${encodeURIComponent(vendorName.trim())}`).then(r => r.data),
    enabled: vendorName.trim().length >= 1,
  });

  const { data: systemSearchResults } = useQuery({
    queryKey: ['po-system-search', systemSearch, projectId],
    queryFn: () => {
      const params = new URLSearchParams({ page_size: '20' });
      if (systemSearch) params.set('q', systemSearch);
      if (projectId) params.set('project_id', projectId);
      return api.get(`/purchase-orders/systems-search?${params}`).then(r => r.data);
    },
    enabled: systemPickerKey !== null,
  });

  const systemOptions = systemSearch.length >= 1
    ? (systemSearchResults?.items || [])
    : (projectId ? (projectSystems?.items || []) : (systemSearchResults?.items || []));
  const vendorSuggestions = vendorData?.items || [];
  const poDraft = {
    projectId, currency, notes, vendorName, requiredByDate, paymentTerms, paymentTermsOther,
    shippingTerms, shippingTermsOther, priority, items, documentName: docFile?.name || recoveredDocumentName,
    partialPoId, idempotencyKey,
  };
  const restoreDraft = (draft: any) => {
    setProjectId(draft.projectId || '');
    setCurrency(draft.currency || 'USD');
    setNotes(draft.notes || '');
    setVendorName(draft.vendorName || '');
    setRequiredByDate(draft.requiredByDate || '');
    setPaymentTerms(draft.paymentTerms || '');
    setPaymentTermsOther(draft.paymentTermsOther || '');
    setShippingTerms(draft.shippingTerms || '');
    setShippingTermsOther(draft.shippingTermsOther || '');
    setPriority(draft.priority || 'normal');
    setPartialPoId(draft.partialPoId || null);
    setIdempotencyKey(draft.idempotencyKey || crypto.randomUUID());
    setDocFile(null);
    setRecoveredDocumentName(draft.documentName || '');
    const restoredItems = Array.isArray(draft.items) ? draft.items : [];
    setItems(restoredItems);
    setItemKey(restoredItems.reduce((next: number, item: DraftItem) => Math.max(next, item.key + 1), 0));
  };

  const addItem = useCallback((prod: any) => {
    setItems(prev => [...prev, {
      key: itemKey,
      product_master_id: prod.id,
      product_code: prod.product_code,
      product_name: prod.product_name,
      quantity: 1,
      uom: 'EA',
      cost_price: prod.cost != null ? String(prod.cost) : '',
      sell_price: prod.sell_price != null ? String(prod.sell_price) : '',
      notes: '',
      system_id: '',
      system_code: '',
      system_name: '',
      showPrices: false,
    }]);
    setItemKey(k => k + 1);
    setProductSearch('');
    setShowResults(false);
    setTimeout(() => searchRef.current?.focus(), 50);
  }, [itemKey]);

  const validateForm = (): string[] => {
    const errors: string[] = [];
    if (!projectId) errors.push('A project must be selected');
    if (items.length === 0) errors.push('At least one line item is required');
    const badQty = items.filter(i => !i.quantity || i.quantity <= 0);
    if (badQty.length > 0) errors.push(`${badQty.length} item(s) have invalid quantity (must be > 0)`);
    const badCost = items.filter(i => i.cost_price !== '' && (isNaN(parseFloat(i.cost_price)) || parseFloat(i.cost_price) < 0));
    if (badCost.length > 0) errors.push(`${badCost.length} item(s) have invalid cost price (must be a non-negative number)`);
    return errors;
  };

  const updateItem = (key: number, fields: Partial<DraftItem>) =>
    setItems(prev => prev.map(i => i.key === key ? { ...i, ...fields } : i));

  const removeItem = (key: number) => {
    setItems(prev => prev.filter(i => i.key !== key));
    if (systemPickerKey === key) { setSystemPickerKey(null); setSystemSearch(''); }
  };

  const changeQty = (key: number, delta: number) =>
    setItems(prev => prev.map(i => i.key === key ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i));

  const selectSystem = (sys: { id: string; system_code: string; system_name: string }) => {
    if (systemPickerKey !== null) {
      updateItem(systemPickerKey, { system_id: sys.id, system_code: sys.system_code, system_name: sys.system_name });
    }
    setSystemPickerKey(null);
    setSystemSearch('');
  };

  const handleCreate = async () => {
    if (partialPoId) {
      setCreateError(null);
      navigate(`/purchase-orders/${partialPoId}`, {
        state: currentReturnContext(location.pathname, location.search, location.pathname === '/order-management' ? 'Order queue' : 'Purchase Orders'),
      });
      return;
    }
    const errors = validateForm();
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    setValidationErrors([]);
    setCreateError(null);
    setSaving(true);
    try {
      const effectivePaymentTerms = paymentTerms === 'Other' ? (paymentTermsOther || 'Other') : paymentTerms;
      const effectiveShippingTerms = shippingTerms === 'Other' ? (shippingTermsOther || 'Other') : shippingTerms;
      persistCreateDraft(storageKey, poDraft);
      const poRes = await api.post('/purchase-orders', {
        idempotency_key: idempotencyKey,
        project_id: projectId || null,
        notes: notes || null,
        vendor_name: vendorName || null,
        required_by_date: requiredByDate || null,
        payment_terms: effectivePaymentTerms || null,
        shipping_terms: effectiveShippingTerms || null,
        priority: priority || 'normal',
      });
      const poId = poRes.data.id;
      setPartialPoId(poId);
      // The header may be committed even if an item response is lost. Persist
      // its ID before sending any item request so recovery opens that PO.
      persistCreateDraft(storageKey, { ...poDraft, partialPoId: poId });

      await Promise.all(items.map((item, idx) =>
        api.post(`/purchase-orders/${poId}/items`, {
          product_master_id: item.product_master_id,
          quantity: item.quantity,
          uom: item.uom || 'EA',
          cost_price: item.cost_price !== '' ? parseFloat(item.cost_price) : null,
          sell_price: item.sell_price !== '' ? parseFloat(item.sell_price) : null,
          currency,
          notes: item.notes || null,
          system_id: item.system_id || null,
          sort_order: idx,
        })
      ));

      if (docFile) {
        const form = new FormData();
        form.append('document', docFile);
        await api.post(`/purchase-orders/${poId}/document`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      }

      toast.success(`${poRes.data.po_code} created`);
      setDraftSavedAt(Date.now());
      setPartialPoId(null);
      setCreateCommitted(true);
      clearRecoveryDraft(storageKey);
      setNavigateToCreatedPoId(poId);
    } catch (e: any) {
      setCreateError(e);
      toast.error(e?.response?.data?.error?.message || 'Failed to create PO');
    } finally {
      setSaving(false);
    }
  };

  const selectedProject = (projectsData?.items || []).find((p: any) => p.id === projectId);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-po-title"
        tabIndex={-1}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col"
      >

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 id="create-po-title" className="text-base font-semibold text-slate-800">New Purchase Order</h2>
          <button aria-label="Close new purchase order dialog" title="Close dialog" onClick={closeModal} disabled={saving} className="text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-6 pt-3">
            <ProtectedDraftBar
              storageKey={storageKey}
              value={poDraft}
              baseline={{ projectId: '', currency: 'USD', notes: '', vendorName: '', requiredByDate: '', paymentTerms: '', paymentTermsOther: '', shippingTerms: '', shippingTermsOther: '', priority: 'normal', items: [], documentName: '', partialPoId: null, idempotencyKey }}
              enabled={!createCommitted}
              saving={saving}
              error={createError}
              savedAt={draftSavedAt}
              onRestore={restoreDraft}
              onDiscard={() => setIdempotencyKey(crypto.randomUUID())}
              onSave={partialPoId ? undefined : handleCreate}
            />
          </div>

          {/* Top bar: project + currency + notes */}
          <div className="px-6 pt-4 pb-3 border-b border-slate-100 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1">
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                  Project <span className="text-red-400">*</span>
                </label>
                <select
                  value={projectId}
                  onChange={e => { setProjectId(e.target.value); setValidationErrors([]); }}
                  className={`w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${!projectId && validationErrors.length > 0 ? 'border-red-400' : 'border-slate-200'}`}
                >
                  <option value="">— None —</option>
                  {(projectsData?.items || []).map((p: any) => (
                    <option key={p.id} value={p.id}>{p.project_code} — {p.project_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Currency</label>
                <select
                  value={currency}
                  onChange={e => setCurrency(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Notes</label>
                <input
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Optional…"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Row 2: Vendor, Required By, Priority */}
            <div className="grid grid-cols-3 gap-3">
              <div ref={vendorPickerRef} className="relative">
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Supplier / Vendor</label>
                <input
                  value={vendorName}
                  onChange={e => { setVendorName(e.target.value); setShowVendorSuggestions(true); }}
                  onFocus={() => setShowVendorSuggestions(true)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') setShowVendorSuggestions(false);
                    if (e.key === 'Enter' && vendorSuggestions.length > 0 && showVendorSuggestions) {
                      e.preventDefault();
                      setVendorName(vendorSuggestions[0].vendor_name);
                      setShowVendorSuggestions(false);
                    }
                  }}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={showVendorSuggestions && vendorName.trim().length >= 1}
                  aria-controls="vendor-suggestions"
                  placeholder="Vendor name…"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {showVendorSuggestions && vendorName.trim().length >= 1 && (
                  <div id="vendor-suggestions" role="listbox" className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-30 max-h-48 overflow-y-auto">
                    {vendorsLoading ? (
                      <div className="px-3 py-2.5 text-xs text-slate-400">Searching vendors…</div>
                    ) : vendorSuggestions.length === 0 ? (
                      <div className="px-3 py-2.5 text-xs text-slate-400">No matching vendors</div>
                    ) : (
                      vendorSuggestions.map((vendor: { vendor_name: string }) => (
                        <button
                          key={vendor.vendor_name}
                          type="button"
                          role="option"
                          aria-selected={vendor.vendor_name === vendorName}
                          onClick={() => {
                            setVendorName(vendor.vendor_name);
                            setShowVendorSuggestions(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-blue-50 transition-colors"
                        >
                          {vendor.vendor_name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Required By Date</label>
                <input
                  type="date"
                  value={requiredByDate}
                  onChange={e => setRequiredByDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Priority</label>
                <select
                  value={priority}
                  onChange={e => setPriority(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            </div>

            {/* Row 3: Payment Terms, Shipping Terms */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Payment Terms</label>
                <select
                  value={paymentTerms}
                  onChange={e => setPaymentTerms(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— Select —</option>
                  {PAYMENT_TERMS_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {paymentTerms === 'Other' && (
                  <input
                    value={paymentTermsOther}
                    onChange={e => setPaymentTermsOther(e.target.value)}
                    placeholder="Specify terms…"
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                )}
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Shipping Terms / Incoterms</label>
                <select
                  value={shippingTerms}
                  onChange={e => setShippingTerms(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— Select —</option>
                  {SHIPPING_TERMS_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {shippingTerms === 'Other' && (
                  <input
                    value={shippingTermsOther}
                    onChange={e => setShippingTermsOther(e.target.value)}
                    placeholder="Specify terms…"
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Product search */}
          <div className="px-6 pt-4 pb-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                ref={searchRef}
                value={productSearch}
                onChange={e => { setProductSearch(e.target.value); setShowResults(true); setSystemPickerKey(null); }}
                onFocus={() => setShowResults(true)}
                placeholder="Search product by name or code to add…"
                className="w-full border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              {showResults && productSearch.length >= 1 && (
                <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-20 max-h-48 overflow-y-auto divide-y divide-slate-50">
                  {(productsData?.items || []).length === 0 ? (
                    <div className="px-4 py-3 text-xs text-slate-400">No products found</div>
                  ) : (productsData?.items || []).map((p: any) => (
                    <button key={p.id} onMouseDown={() => addItem(p)}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 flex items-center gap-3 transition-colors">
                      <EntityCode code={p.product_code} />
                      <span className="text-slate-700 truncate flex-1">{p.product_name}</span>
                      {p.sell_price && (
                        <span className="text-xs text-slate-400 shrink-0">
                          {parseFloat(p.sell_price).toLocaleString()} {p.currency || currency}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Items list */}
          <div className="px-6 pb-2 space-y-1.5">
            {items.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">
                Search above to add products — they'll appear here
              </p>
            ) : items.map((item, idx) => (
              <div key={item.key} className="border border-slate-200 rounded-xl bg-slate-50/60 overflow-visible">
                {/* Main row */}
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <span className="text-[10px] text-slate-300 font-mono w-4 text-center shrink-0">{idx + 1}</span>
                  <EntityCode code={item.product_code} />
                  <span className="text-sm text-slate-700 font-medium truncate flex-1">{item.product_name}</span>

                  {/* Qty + UOM */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button aria-label={`Decrease quantity for ${item.product_name}`} title="Decrease quantity" onClick={() => changeQty(item.key, -1)}
                      className="w-6 h-6 rounded-md border border-slate-200 bg-white flex items-center justify-center hover:border-blue-400 hover:text-blue-600 transition-colors">
                      <Minus className="w-3 h-3" />
                    </button>
                    <input
                      type="number" min="1" step="any"
                      value={item.quantity}
                      onChange={e => { updateItem(item.key, { quantity: parseFloat(e.target.value) || 1 }); setValidationErrors([]); }}
                      className="w-12 text-center border border-slate-200 rounded-md px-1 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button aria-label={`Increase quantity for ${item.product_name}`} title="Increase quantity" onClick={() => changeQty(item.key, 1)}
                      className="w-6 h-6 rounded-md border border-slate-200 bg-white flex items-center justify-center hover:border-blue-400 hover:text-blue-600 transition-colors">
                      <Plus className="w-3 h-3" />
                    </button>
                    <select
                      value={item.uom}
                      onChange={e => updateItem(item.key, { uom: e.target.value })}
                      className="border border-slate-200 rounded-md px-1 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-600"
                      title="Unit of Measure"
                    >
                      {UOM_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>

                  {/* System picker trigger */}
                  <div className="relative shrink-0" ref={systemPickerKey === item.key ? systemPickerRef : undefined}>
                    {item.system_id ? (
                      <div className="flex items-center gap-1 bg-blue-50 border border-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full">
                        <Network className="w-3 h-3 shrink-0" />
                        <span className="max-w-[80px] truncate">{item.system_code}</span>
                        <button aria-label={`Remove system from ${item.product_name}`} title="Remove system" onClick={() => updateItem(item.key, { system_id: '', system_code: '', system_name: '' })}
                          className="text-blue-300 hover:text-red-500 ml-0.5 transition-colors">
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setSystemPickerKey(item.key); setSystemSearch(''); }}
                        className="flex items-center gap-1 text-xs text-slate-400 hover:text-blue-600 border border-dashed border-slate-300 hover:border-blue-400 px-2 py-1 rounded-full transition-colors"
                      >
                        <Network className="w-3 h-3" /> system
                      </button>
                    )}

                    {systemPickerKey === item.key && (
                      <div ref={systemPickerRef} className="absolute right-0 top-full mt-1.5 w-64 bg-white border border-slate-200 rounded-xl shadow-2xl z-30">
                        <div className="p-2 border-b border-slate-100">
                          <div className="relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
                            <input
                              autoFocus
                              value={systemSearch}
                              onChange={e => setSystemSearch(e.target.value)}
                              placeholder={selectedProject ? `Systems in ${selectedProject.project_code}…` : 'Search systems…'}
                              className="w-full pl-6 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                        </div>
                        <div className="max-h-40 overflow-y-auto divide-y divide-slate-50">
                          {systemOptions.length === 0 ? (
                            <div className="px-3 py-3 text-xs text-slate-400 text-center">
                              {projectId ? 'No systems in this project' : 'Type to search systems'}
                            </div>
                          ) : systemOptions.map((s: any) => (
                            <button key={s.id} onMouseDown={() => selectSystem(s)}
                              className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center gap-2 transition-colors">
                              <EntityCode code={s.system_code} />
                              <span className="text-slate-600 truncate flex-1">{s.system_name}</span>
                              {!projectId && <span className="text-slate-300 shrink-0">{s.project_code}</span>}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Toggle prices */}
                  <button
                    onClick={() => updateItem(item.key, { showPrices: !item.showPrices })}
                    aria-label={`${item.showPrices ? 'Hide' : 'Edit'} prices for ${item.product_name}`}
                    title={`${item.showPrices ? 'Hide' : 'Edit'} prices`}
                    className="text-slate-300 hover:text-blue-500 transition-colors shrink-0"
                  >
                    {item.showPrices ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>

                  <button aria-label={`Remove ${item.product_name}`} title="Remove item" onClick={() => removeItem(item.key)} className="text-slate-300 hover:text-red-500 transition-colors shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Expandable prices + notes */}
                {item.showPrices && (
                  <div className="px-3 pb-3 pt-1 border-t border-slate-100 grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5 uppercase tracking-wide">Cost</label>
                      <input type="number" min="0" step="any" placeholder="0.00" value={item.cost_price}
                        onChange={e => updateItem(item.key, { cost_price: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5 uppercase tracking-wide">Sell</label>
                      <input type="number" min="0" step="any" placeholder="0.00" value={item.sell_price}
                        onChange={e => updateItem(item.key, { sell_price: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-0.5 uppercase tracking-wide">Notes</label>
                      <input placeholder="Optional…" value={item.notes}
                        onChange={e => updateItem(item.key, { notes: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Document attachment */}
          <div className="px-6 pb-4 pt-2">
            <input ref={docRef} type="file" className="hidden" onChange={e => { setDocFile(e.target.files?.[0] || null); setRecoveredDocumentName(''); }} />
            {recoveredDocumentName && !docFile && <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">The recovered draft referenced “{recoveredDocumentName}”, but browser drafts cannot retain file contents. Please attach it again.</div>}
            {docFile ? (
              <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
                <Paperclip className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span className="text-xs text-blue-700 truncate flex-1">{docFile.name}</span>
                <button aria-label="Remove attached document" title="Remove attached document" onClick={() => { setDocFile(null); setRecoveredDocumentName(''); }} className="text-blue-300 hover:text-red-500 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => docRef.current?.click()}
                className="flex items-center gap-2 text-xs text-slate-400 hover:text-blue-600 border border-dashed border-slate-200 hover:border-blue-400 rounded-xl px-4 py-2 w-full justify-center transition-colors"
              >
                <Paperclip className="w-3.5 h-3.5" /> Attach a document (optional)
              </button>
            )}
          </div>
        </div>

        {/* Validation error banner */}
        {validationErrors.length > 0 && (
          <div className="mx-6 mb-2 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div className="text-xs text-red-700">
              <div className="font-semibold mb-0.5">Please fix the following before creating the PO:</div>
              <ul className="list-disc list-inside space-y-0.5">
                {validationErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          </div>
        )}
        {partialPoId && (
          <div className="mx-6 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
            The purchase order header was created, but saving all lines or its document failed. It was not retried to avoid creating a duplicate. Open PO <strong className="font-mono">{partialPoId}</strong> to review and complete it.
            <button type="button" onClick={() => navigate(`/purchase-orders/${partialPoId}`, { state: currentReturnContext(location.pathname, location.search, location.pathname === '/order-management' ? 'Order queue' : 'Purchase Orders') })} className="ml-2 font-bold underline">Open incomplete PO</button>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50/60 rounded-b-2xl">
          <span className="text-xs text-slate-400">
            {items.length > 0
              ? `${items.length} item${items.length > 1 ? 's' : ''} · ${currency}`
              : 'No items yet'}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={closeModal} disabled={saving}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 border border-slate-200 rounded-lg bg-white transition-colors disabled:opacity-50">
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={saving}
              title={validationErrors.length > 0 ? validationErrors.join(' · ') : undefined}
              className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-60 active:scale-95"
            >
              {saving ? 'Creating…' : partialPoId ? 'Open incomplete PO' : 'Create PO'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
