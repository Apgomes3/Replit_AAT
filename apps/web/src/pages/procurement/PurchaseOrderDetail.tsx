import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { useRecordTitle } from '../../hooks/usePageTitle';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import EntityCode from '../../components/ui/EntityCode';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';
import { useConfirm } from '../../hooks/useConfirm';
import {
  Package, CheckCircle, XCircle, ArrowRight, ChevronRight, Plus, Trash2, Clock, Search, X, FileText, Pencil, RefreshCw,
  MessageSquare, Paperclip, AlertTriangle, CalendarClock, Send, Download, History, CheckCheck, Ban, RotateCcw, Zap, Flag,
  Wrench, ClipboardCheck, ShoppingBag, Info, ExternalLink, Tag, Layers, Building2, Beaker
} from 'lucide-react';

const STAGES = ['draft', 'pending_approval', 'purchase_order', 'po_review', 'engineering_review', 'released'];

const STATUS_META: Record<string, { label: string; color: string; dot: string }> = {
  draft:              { label: 'Draft',              color: 'bg-slate-100 text-slate-600',   dot: 'bg-slate-400' },
  pending_approval:   { label: 'Pending Approval',   color: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-400' },
  purchase_order:     { label: 'Purchase Order',     color: 'bg-blue-100 text-blue-700',     dot: 'bg-blue-500' },
  po_review:          { label: 'PO Review',          color: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-500' },
  engineering_review: { label: 'Engineering Review', color: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
  released:           { label: 'Released',           color: 'bg-green-100 text-green-700',   dot: 'bg-green-500' },
};

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'SGD', 'AUD', 'CAD', 'JPY', 'CNY'];

function POStatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] || { label: status, color: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium px-2.5 py-1 rounded-full ${meta.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

const STAGE_ICONS: Record<string, React.ElementType> = {
  draft:              FileText,
  pending_approval:   Clock,
  purchase_order:     ShoppingBag,
  po_review:          ClipboardCheck,
  engineering_review: Wrench,
  released:           Flag,
};

function LifecycleBar({ status }: { status: string }) {
  const idx = STAGES.indexOf(status);
  return (
    <div className="flex items-end gap-0 py-2">
      {STAGES.map((s, i) => {
        const meta = STATUS_META[s];
        const done   = i < idx;
        const active = i === idx;
        const Icon   = STAGE_ICONS[s] ?? FileText;
        return (
          <div key={s} className="flex items-center flex-1 min-w-0">
            {/* Step */}
            <div className="flex flex-col items-center flex-shrink-0" style={{ minWidth: 56 }}>
              {/* Circle */}
              <div className="relative">
                {active && (
                  <span className="absolute inset-0 rounded-full bg-green-400 opacity-30 animate-ping" />
                )}
                <div className={`relative w-11 h-11 rounded-full flex items-center justify-center border-2 transition-all ${
                  active ? 'bg-green-500 border-green-500 shadow-md shadow-green-200'
                         : done  ? 'bg-green-50 border-green-400'
                                 : 'bg-white border-slate-200'
                }`}>
                  <Icon className={`w-5 h-5 ${
                    active ? 'text-white'
                           : done  ? 'text-green-500'
                                   : 'text-slate-300'
                  }`} />
                </div>
              </div>
              {/* Label */}
              <span className={`text-[10px] mt-1.5 text-center leading-tight hidden sm:block px-0.5 ${
                active ? 'text-green-600 font-bold'
                       : done  ? 'text-green-500 font-medium'
                               : 'text-slate-300'
              }`}>
                {meta?.label}
              </span>
            </div>
            {/* Connector */}
            {i < STAGES.length - 1 && (
              <div className={`h-0.5 flex-1 mb-5 ${done || active ? 'bg-green-300' : 'bg-slate-100'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

const PEGGED_RATES_FROM_USD: Record<string, number> = {
  AED: 3.6725,
  SAR: 3.75,
};

function useExchangeRates() {
  const [rates, setRates] = useState<Record<string, number>>({ USD: 1, ...PEGGED_RATES_FROM_USD });
  const [rateDate, setRateDate] = useState<string | null>(null);
  useEffect(() => {
    api.get('/purchase-orders/exchange-rates')
      .then(r => r.data)
      .then((d: { rates: Record<string, number>; date: string }) => {
        setRates({ ...PEGGED_RATES_FROM_USD, ...d.rates, USD: 1 });
        setRateDate(d.date || null);
      })
      .catch(() => {});
  }, []);
  return { rates, rateDate };
}

function convertAmount(amount: number | null, fromCurrency: string, toCurrency: string, rates: Record<string, number>): number | null {
  if (amount == null) return null;
  if (fromCurrency === toCurrency) return amount;
  const toUSD = fromCurrency === 'USD' ? amount : (amount / (rates[fromCurrency] ?? 1));
  if (toCurrency === 'USD') return toUSD;
  return toUSD * (rates[toCurrency] ?? 1);
}

type Item = {
  id: string; product_master_id: string | null; product_code: string; product_name: string;
  quantity: string; cost_price: string | null; sell_price: string | null; currency: string; notes: string | null;
  system_id: string | null; system_code: string | null; system_name: string | null;
  budget_amount: string | null;
};

type POComment = { id: string; comment: string; created_at: string; author_name: string; user_id: string };
type POAttachment = { id: string; file_name: string; file_url: string; created_at: string; uploader_name: string; user_id: string };

export default function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const fromSystem = location.state?.from === 'system' ? location.state : null;
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [displayCurrency, setDisplayCurrency] = useState(() => localStorage.getItem('preferred_currency') || 'USD');
  const { rates, rateDate } = useExchangeRates();

  const [commentModal, setCommentModal] = useState<null | 'approve' | 'reject' | 'advance'>(null);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const [showAddItem, setShowAddItem] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [addingItem, setAddingItem] = useState(false);
  const addItemSearchRef = useRef<HTMLInputElement>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  // Inline item editing
  const [inlineEdit, setInlineEdit] = useState<{ itemId: string; field: 'quantity' | 'cost_price' | 'sell_price' | 'budget_amount'; value: string } | null>(null);

  // Inline currency editing (stores itemId being edited)
  const [currencyEdit, setCurrencyEdit] = useState<string | null>(null);

  // Comments
  const [newComment, setNewComment] = useState('');
  const [commentPosting, setCommentPosting] = useState(false);

  // Attachments
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  // Product quick-view flyout
  const [quickViewProductId, setQuickViewProductId] = useState<string | null>(null);
  const { data: quickViewProduct, isLoading: quickViewLoading } = useQuery({
    queryKey: ['product-master-quick', quickViewProductId],
    queryFn: () => api.get(`/product-masters/${quickViewProductId}`).then(r => r.data),
    enabled: !!quickViewProductId,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (!quickViewProductId) return;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setQuickViewProductId(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [quickViewProductId]);

  // Right-column tab
  const [rightTab, setRightTab] = useState<'items' | 'timeline' | 'comments' | 'attachments'>('items');

  // Keyboard shortcuts for tab switching (1/2/3/4)
  useEffect(() => {
    const TAB_KEYS: Record<string, typeof rightTab> = {
      '1': 'items', '2': 'timeline', '3': 'comments', '4': 'attachments',
    };
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tab = TAB_KEYS[e.key];
      if (tab) { e.preventDefault(); setRightTab(tab); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Due date editing
  const [dueDateEditing, setDueDateEditing] = useState(false);
  const [dueDateValue, setDueDateValue] = useState('');

  // Designated users
  const [showUserPicker, setShowUserPicker] = useState(false);
  const [userPickerSearch, setUserPickerSearch] = useState('');
  const [userActionLoading, setUserActionLoading] = useState<string | null>(null);

  // Auto-save indicator
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Inline system picker
  const [systemEdit, setSystemEdit] = useState<{ itemId: string; pos: { top: number; left: number } } | null>(null);
  const [itemSysSearch, setItemSysSearch] = useState('');
  const sysEditRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (systemEdit) setTimeout(() => sysEditRef.current?.focus(), 30);
    else setItemSysSearch('');
  }, [systemEdit?.itemId]);

  useEffect(() => {
    if (!systemEdit) return;
    const close = (e: MouseEvent) => {
      const el = document.getElementById('sys-picker-popup');
      if (el && !el.contains(e.target as Node)) setSystemEdit(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setSystemEdit(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [systemEdit]);

  const handleSaveSystem = async (itemId: string, systemId: string | null) => {
    const item = (po?.items || []).find((i: Item) => i.id === itemId);
    if (!item) { setSystemEdit(null); return; }
    setSystemEdit(null);
    setItemSysSearch('');
    try {
      await api.put(`/purchase-orders/${id}/items/${itemId}`, {
        quantity: item.quantity,
        cost_price: item.cost_price ?? '',
        sell_price: item.sell_price ?? '',
        currency: item.currency,
        notes: item.notes,
        system_id: systemId,
      });
      setSavedAt(new Date());
      refetch();
    } catch {
      toast.error('Failed to update system');
    }
  };

  const handleSaveInline = async () => {
    if (!inlineEdit) return;
    const item = (po?.items || []).find((i: Item) => i.id === inlineEdit.itemId);
    if (!item) { setInlineEdit(null); return; }
    const snap = { ...inlineEdit };
    setInlineEdit(null);
    try {
      await api.put(`/purchase-orders/${id}/items/${snap.itemId}`, {
        quantity: snap.field === 'quantity' ? snap.value : item.quantity,
        cost_price: snap.field === 'cost_price' ? snap.value : (item.cost_price ?? ''),
        sell_price: snap.field === 'sell_price' ? snap.value : (item.sell_price ?? ''),
        currency: item.currency,
        notes: item.notes,
        system_id: item.system_id,
        budget_amount: snap.field === 'budget_amount' ? (snap.value === '' ? null : snap.value) : (item.budget_amount ?? null),
      });
      setSavedAt(new Date());
      refetch();
    } catch {
      toast.error('Failed to save');
    }
  };

  const handleCurrencyChange = async (itemId: string, newCurrency: string) => {
    setCurrencyEdit(null);
    const item = (po?.items || []).find((i: Item) => i.id === itemId);
    if (!item || item.currency === newCurrency) return;
    try {
      await api.put(`/purchase-orders/${id}/items/${itemId}`, {
        quantity: item.quantity,
        cost_price: item.cost_price ?? '',
        sell_price: item.sell_price ?? '',
        currency: newCurrency,
        notes: item.notes,
        system_id: item.system_id,
      });
      setSavedAt(new Date());
      refetch();
    } catch {
      toast.error('Failed to update currency');
    }
  };

  const { data: po, isLoading, refetch } = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => api.get(`/purchase-orders/${id}`).then(r => r.data),
  });
  useRecordTitle(po?.po_code);

  const { data: productSearchResults } = useQuery({
    queryKey: ['po-detail-product-search', productSearch],
    queryFn: () => api.get(`/product-masters?q=${encodeURIComponent(productSearch)}&page_size=20`).then(r => r.data),
    enabled: productSearch.length >= 1,
  });

  const { data: itemSysResults } = useQuery({
    queryKey: ['item-sys-search', itemSysSearch],
    queryFn: () => api.get(`/purchase-orders/systems-search?q=${encodeURIComponent(itemSysSearch)}&page_size=15`).then(r => r.data),
    enabled: itemSysSearch.length >= 1 && systemEdit !== null,
  });

  const { data: comments = [], refetch: refetchComments } = useQuery<POComment[]>({
    queryKey: ['po-comments', id],
    queryFn: () => api.get(`/purchase-orders/${id}/comments`).then(r => r.data.items ?? []),
    enabled: !!id,
  });

  const { data: allUsersData } = useQuery({
    queryKey: ['po-users'],
    queryFn: () => api.get('/purchase-orders/users').then(r => r.data),
    staleTime: 60_000,
  });
  const allUsers: any[] = allUsersData?.items ?? [];

  const handleAddDesignatedUser = async (userId: string) => {
    setUserActionLoading(userId);
    try {
      await api.post(`/purchase-orders/${id}/designated-users`, { user_id: userId });
      refetch();
      setShowUserPicker(false);
      setUserPickerSearch('');
    } catch {
      toast.error('Failed to assign user');
    } finally {
      setUserActionLoading(null);
    }
  };

  const handleRemoveDesignatedUser = async (userId: string) => {
    setUserActionLoading(userId);
    try {
      await api.delete(`/purchase-orders/${id}/designated-users/${userId}`);
      refetch();
    } catch {
      toast.error('Failed to remove user');
    } finally {
      setUserActionLoading(null);
    }
  };

  const { data: attachments = [], refetch: refetchAttachments } = useQuery<POAttachment[]>({
    queryKey: ['po-attachments', id],
    queryFn: () => api.get(`/purchase-orders/${id}/attachments`).then(r => r.data.items ?? []),
    enabled: !!id,
  });

  useEffect(() => {
    localStorage.setItem('preferred_currency', displayCurrency);
  }, [displayCurrency]);

  useEffect(() => {
    if (showAddItem) {
      setTimeout(() => addItemSearchRef.current?.focus(), 50);
    } else {
      setProductSearch('');
    }
  }, [showAddItem]);

  const refetchAll = () => { refetch(); qc.invalidateQueries({ queryKey: ['purchase-orders'] }); };

  const canManage = user?.role === 'admin' || user?.role === 'engineer' || user?.role === 'hq_manager'
    || (po?.designated_users || []).some((u: any) => u.user_id === user?.id);
  const canApprove = user?.role === 'hq_manager' || user?.role === 'admin';
  const isDraft = po?.status === 'draft';
  const isPending = po?.status === 'pending_approval';
  const isReleased = po?.status === 'released';
  const stageIdx = STAGES.indexOf(po?.status || 'draft');
  const hasNextStage = stageIdx >= 2 && stageIdx < STAGES.length - 1;

  const STALL_DAYS = 7;
  const isStalled = po && !['draft', 'released'].includes(po.status) &&
    (Date.now() - new Date(po.updated_at).getTime()) > STALL_DAYS * 86_400_000;

  const stageDuePast = po?.stage_due_date && new Date(po.stage_due_date) < new Date() && po.status !== 'released';

  const totalBudget = (po?.items || []).reduce((sum: number, item: Item) => {
    if (!item.budget_amount) return sum;
    const c = convertAmount(parseFloat(item.budget_amount), item.currency, displayCurrency, rates);
    return sum + (c || 0) * parseFloat(item.quantity);
  }, 0);
  const hasBudget = (po?.items || []).some((item: Item) => item.budget_amount != null);

  const handleAction = async (action: 'submit' | 'approve' | 'reject' | 'advance') => {
    // Client-side gate validation
    if (action === 'submit' || action === 'advance') {
      const items = po?.items || [];
      if (items.length === 0) {
        toast.error('Add at least one item before submitting.');
        return;
      }
      const missingCost = items.filter((i: Item) => !i.cost_price || parseFloat(String(i.cost_price)) === 0);
      if (missingCost.length > 0) {
        toast.error(`${missingCost.length} item(s) are missing a cost price — set all costs first.`);
        return;
      }
    }
    setSaving(true);
    try {
      if (action === 'submit') {
        await api.post(`/purchase-orders/${id}/submit`);
        toast.success('PO submitted');
      } else if (action === 'approve') {
        await api.post(`/purchase-orders/${id}/approve`, { comment });
        toast.success('PO approved');
      } else if (action === 'reject') {
        await api.post(`/purchase-orders/${id}/reject`, { comment });
        toast.success('PO sent back to draft');
      } else if (action === 'advance') {
        await api.post(`/purchase-orders/${id}/transition`, { comment });
        toast.success('Stage advanced');
      }
      setCommentModal(null);
      setComment('');
      refetchAll();
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || 'Action failed');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickAdd = useCallback(async (prod: any) => {
    if (addingItem) return;
    const existingIds = (po?.items || []).map((i: Item) => i.product_master_id).filter(Boolean);
    if (existingIds.includes(prod.id)) {
      const ok = await confirm({ message: `${prod.product_code} is already in this PO. Add it again?` });
      if (!ok) return;
    }
    setAddingItem(true);
    try {
      await api.post(`/purchase-orders/${id}/items`, {
        product_master_id: prod.id,
        quantity: 1,
        cost_price: prod.cost_price != null ? parseFloat(prod.cost_price) : null,
        sell_price: prod.sell_price != null ? parseFloat(prod.sell_price) : null,
        currency: prod.currency || 'USD',
        notes: null,
        system_id: null,
      });
      toast.success(`${prod.product_code} added`);
      setProductSearch('');
      refetch();
      setTimeout(() => addItemSearchRef.current?.focus(), 50);
    } catch {
      toast.error('Failed to add item');
    } finally {
      setAddingItem(false);
    }
  }, [id, addingItem, refetch, po?.items, confirm]);

  const handleDeleteItem = async (itemId: string) => {
    if (!await confirm({ message: 'Remove this item from the PO?', confirmLabel: 'Remove', danger: true })) return;
    await api.delete(`/purchase-orders/${id}/items/${itemId}`);
    toast.success('Item removed');
    refetch();
  };

  const handleSaveDueDate = async () => {
    try {
      await api.patch(`/purchase-orders/${id}/due-date`, { stage_due_date: dueDateValue || null });
      toast.success('Due date saved');
      setDueDateEditing(false);
      refetch();
    } catch { toast.error('Failed to save due date'); }
  };

  const handlePostComment = async () => {
    const text = newComment.trim();
    if (!text) return;
    setCommentPosting(true);
    try {
      await api.post(`/purchase-orders/${id}/comments`, { message: text });
      setNewComment('');
      refetchComments();
    } catch { toast.error('Failed to post comment'); }
    finally { setCommentPosting(false); }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!await confirm({ message: 'Delete this comment?', confirmLabel: 'Delete', danger: true })) return;
    await api.delete(`/purchase-orders/${id}/comments/${commentId}`);
    refetchComments();
  };

  const handleUploadAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachmentUploading(true);
    const form = new FormData();
    form.append('file', file);
    try {
      await api.post(`/purchase-orders/${id}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      refetchAttachments();
    } catch { toast.error('Failed to upload attachment'); }
    finally { setAttachmentUploading(false); if (attachmentInputRef.current) attachmentInputRef.current.value = ''; }
  };

  const handleDeleteAttachment = async (attachmentId: string) => {
    if (!await confirm({ message: 'Delete this attachment?', confirmLabel: 'Delete', danger: true })) return;
    await api.delete(`/purchase-orders/${id}/attachments/${attachmentId}`);
    refetchAttachments();
  };

  const formatCurrency = (amount: number | null, from: string) => {
    const converted = convertAmount(amount, from, displayCurrency, rates);
    if (converted == null) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: displayCurrency, minimumFractionDigits: 2 }).format(converted);
  };

  const totalCost = (po?.items || []).reduce((sum: number, item: Item) => {
    const c = convertAmount(parseFloat(item.cost_price || '0'), item.currency, displayCurrency, rates);
    return sum + (c || 0) * parseFloat(item.quantity);
  }, 0);

  const totalSell = (po?.items || []).reduce((sum: number, item: Item) => {
    const c = convertAmount(parseFloat(item.sell_price || '0'), item.currency, displayCurrency, rates);
    return sum + (c || 0) * parseFloat(item.quantity);
  }, 0);

  const totalMargin = totalSell - totalCost;
  const marginPct = totalCost > 0 ? (totalMargin / totalCost) * 100 : 0;

  const itemMargin = (item: Item) => {
    const s = convertAmount(parseFloat(item.sell_price || '0'), item.currency, displayCurrency, rates) || 0;
    const c = convertAmount(parseFloat(item.cost_price || '0'), item.currency, displayCurrency, rates) || 0;
    return (s - c) * parseFloat(item.quantity);
  };

  const formatTotal = (val: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: displayCurrency, minimumFractionDigits: 2 }).format(val);

  if (isLoading) return <div className="p-8 text-slate-400">Loading…</div>;
  if (!po) return <div className="p-8 text-slate-400">PO not found</div>;

  const statusMeta = STATUS_META[po.status] || { label: po.status, color: '', dot: '' };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={<span className="flex items-center gap-2"><EntityCode code={po.po_code} /><POStatusBadge status={po.status} /></span>}
        subtitle={po.project_name ? `${po.project_code} — ${po.project_name}` : 'No project linked'}
        crumbs={[
          ...(fromSystem ? [
            { label: fromSystem.projectCode ? `${fromSystem.projectCode} — ${fromSystem.projectName}` : (fromSystem.projectName || 'Project'), href: `/projects/${fromSystem.projectId}` },
            { label: fromSystem.systemCode ? `${fromSystem.systemCode} — ${fromSystem.systemName}` : (fromSystem.systemName || 'System'), href: `/systems/${fromSystem.systemId}` },
          ] : [
            { label: 'Order Management', href: '/order-management' },
            { label: 'Purchase Orders', href: '/purchase-orders' },
          ]),
          { label: po.po_code },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={displayCurrency}
              onChange={e => setDisplayCurrency(e.target.value)}
              className="border border-slate-200 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-blue-600"
              title="Display currency"
            >
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {isDraft && (
              <Button variant="primary" onClick={() => handleAction('submit')}>
                <ArrowRight className="w-4 h-4" />Submit
              </Button>
            )}
            {isPending && canApprove && (
              <>
                <Button variant="primary" onClick={() => setCommentModal('approve')}>
                  <CheckCircle className="w-4 h-4" />Approve
                </Button>
                <Button onClick={() => setCommentModal('reject')}>
                  <XCircle className="w-4 h-4" />Reject
                </Button>
              </>
            )}
            {hasNextStage && canManage && (
              <Button variant="primary" onClick={() => setCommentModal('advance')}>
                <ArrowRight className="w-4 h-4" />Advance Stage
              </Button>
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-6 space-y-5 bg-[#F1F4F8]">
        {isStalled && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
            <div>
              <span className="font-semibold">PO appears stalled</span>
              {' — '}no updates in over {STALL_DAYS} days. Consider advancing the stage or leaving a comment.
            </div>
          </div>
        )}
        {stageDuePast && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-sm">
            <CalendarClock className="w-4 h-4 mt-0.5 shrink-0 text-red-500" />
            <div>
              <span className="font-semibold">Stage due date has passed</span>
              {' — '}this stage was due on {new Date(po.stage_due_date).toLocaleDateString()}.
            </div>
          </div>
        )}

        {/* Lifecycle bar */}
        <div className="bg-white border border-slate-200 rounded-lg px-5 pt-4 pb-5">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Lifecycle</div>
          <LifecycleBar status={po.status} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Left: meta + systems + designated */}
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-lg">
              <div className="px-4 py-3 border-b border-slate-100 text-sm font-medium text-slate-700">Details</div>
              <div className="px-4 py-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Status</span>
                  <POStatusBadge status={po.status} />
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Project</span>
                  <span className="font-medium text-right">{po.project_name || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Created by</span>
                  <span className="text-right">{po.created_by_name || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Created</span>
                  <span className="text-slate-500">{new Date(po.created_at).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 flex items-center gap-1"><CalendarClock className="w-3 h-3" />Stage due</span>
                  {dueDateEditing ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="date"
                        value={dueDateValue}
                        onChange={e => setDueDateValue(e.target.value)}
                        className="text-xs border border-blue-400 rounded px-1.5 py-0.5 focus:outline-none"
                      />
                      <button onClick={handleSaveDueDate} className="text-xs text-blue-600 hover:underline font-medium">Save</button>
                      <button onClick={() => setDueDateEditing(false)} className="text-slate-400 hover:text-slate-600"><X className="w-3 h-3" /></button>
                    </div>
                  ) : (
                    <span
                      onClick={() => { setDueDateEditing(true); setDueDateValue(po.stage_due_date ? po.stage_due_date.slice(0, 10) : ''); }}
                      className={`text-xs cursor-pointer hover:text-blue-600 flex items-center gap-1 group/due ${stageDuePast ? 'text-red-600 font-medium' : 'text-slate-500'}`}
                    >
                      {po.stage_due_date ? new Date(po.stage_due_date).toLocaleDateString() : <span className="text-slate-300">Set date…</span>}
                      <Pencil className="w-2.5 h-2.5 opacity-0 group-hover/due:opacity-40" />
                    </span>
                  )}
                </div>
                {po.fo_number && (
                  <div className="flex justify-between items-center pt-1 mt-1 border-t border-slate-100">
                    <span className="text-slate-500 font-medium">Factory Order</span>
                    <span className="font-bold text-emerald-700 font-mono tracking-wide text-sm">{po.fo_number}</span>
                  </div>
                )}
                {po.approved_by_name && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Approved by</span>
                    <span className="text-right">{po.approved_by_name}</span>
                  </div>
                )}
                {po.approved_at && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Approved</span>
                    <span className="text-slate-500">{new Date(po.approved_at).toLocaleDateString()}</span>
                  </div>
                )}
                {po.notes && (
                  <div className="pt-2 border-t border-slate-100">
                    <div className="text-xs text-slate-400 mb-1">Notes</div>
                    <div className="text-slate-700 text-sm">{po.notes}</div>
                  </div>
                )}
                {po.document_url && (
                  <div className="pt-2 border-t border-slate-100">
                    <div className="text-xs text-slate-400 mb-1 flex items-center gap-1"><FileText className="w-3 h-3" />Attachment</div>
                    <a
                      href={po.document_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline truncate"
                    >
                      <FileText className="w-3 h-3 shrink-0" />
                      {po.document_name || 'View Document'}
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Designated / Assigned Users */}
            {(() => {
              const designatedUsers: any[] = po.designated_users ?? [];
              const assignedIds = new Set(designatedUsers.map((u: any) => u.user_id));
              const availableUsers = allUsers.filter(u =>
                !assignedIds.has(u.id) &&
                (!userPickerSearch || `${u.first_name ?? ''} ${u.last_name ?? ''} ${u.email}`.toLowerCase().includes(userPickerSearch.toLowerCase()))
              );
              return (
                <div className="bg-white border border-slate-200 rounded-lg">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">Assigned Users</span>
                    {canManage && (
                      <button
                        onClick={() => { setShowUserPicker(v => !v); setUserPickerSearch(''); }}
                        className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        Add
                      </button>
                    )}
                  </div>

                  {showUserPicker && (
                    <div className="px-3 pt-2 pb-1 border-b border-slate-100">
                      <div className="relative mb-1">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                        <input
                          autoFocus
                          value={userPickerSearch}
                          onChange={e => setUserPickerSearch(e.target.value)}
                          placeholder="Search users…"
                          className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:border-blue-400"
                        />
                      </div>
                      <div className="max-h-40 overflow-y-auto divide-y divide-slate-50 -mx-3">
                        {availableUsers.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-slate-400 text-center">
                            {allUsers.length === 0 ? 'Loading…' : 'All users already assigned'}
                          </div>
                        ) : availableUsers.map(u => {
                          const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email;
                          return (
                            <button
                              key={u.id}
                              onClick={() => handleAddDesignatedUser(u.id)}
                              disabled={userActionLoading === u.id}
                              className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-blue-50 transition-colors disabled:opacity-50"
                            >
                              <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-500 shrink-0">
                                {name.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-slate-700 truncate">{name}</div>
                                <div className="text-[10px] text-slate-400 truncate">{u.role?.replace(/_/g, ' ')}</div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="px-4 py-2 space-y-1.5">
                    {designatedUsers.length === 0 ? (
                      <p className="text-xs text-slate-400 py-1">No users assigned yet.</p>
                    ) : designatedUsers.map((u: any) => {
                      const name = u.full_name || u.email;
                      return (
                        <div key={u.user_id} className="flex items-center gap-2.5 group/du">
                          <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-xs font-semibold text-blue-600 shrink-0">
                            {name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-slate-700 truncate">{name}</div>
                            <div className="text-[10px] text-slate-400 truncate">{u.role?.replace(/_/g, ' ')}</div>
                          </div>
                          {canManage && (
                            <button
                              onClick={() => handleRemoveDesignatedUser(u.user_id)}
                              disabled={userActionLoading === u.user_id}
                              className="opacity-0 group-hover/du:opacity-100 transition-opacity text-slate-300 hover:text-red-500 disabled:opacity-30"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

          </div>

          {/* Right: tabbed panel */}
          <div className="md:col-span-2 space-y-4">
            {/* Tab bar */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="flex border-b border-slate-200">
                {([
                  { key: 'items',       label: 'Line Items',  icon: Package,       badge: po.items?.length || 0,   shortcut: '1' },
                  { key: 'timeline',    label: 'Timeline',    icon: History,       badge: po.history?.length || 0, shortcut: '2' },
                  { key: 'comments',    label: 'Comments',    icon: MessageSquare, badge: comments.length,         shortcut: '3' },
                  { key: 'attachments', label: 'Attachments', icon: Paperclip,     badge: attachments.length,      shortcut: '4' },
                ] as { key: typeof rightTab; label: string; icon: any; badge: number; shortcut: string }[]).map(({ key, label, icon: Icon, badge, shortcut }) => (
                  <button
                    key={key}
                    onClick={() => setRightTab(key)}
                    title={`${label} (press ${shortcut})`}
                    className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                      rightTab === key
                        ? 'border-blue-600 text-blue-600 bg-blue-50/40'
                        : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                    {badge > 0 && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                        rightTab === key ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
                      }`}>{badge}</span>
                    )}
                    <kbd className={`ml-0.5 text-[9px] px-1 py-0.5 rounded border font-mono leading-none ${
                      rightTab === key ? 'border-blue-200 text-blue-400 bg-blue-50' : 'border-slate-200 text-slate-300 bg-slate-50'
                    }`}>{shortcut}</kbd>
                  </button>
                ))}
              </div>

              {/* ── Items tab ── */}
              {rightTab === 'items' && (
                <div>
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                      {savedAt && (
                        <span className="text-[10px] font-normal text-green-600 flex items-center gap-0.5 ml-1">
                          <CheckCircle className="w-3 h-3" /> Saved
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-3">
                      {displayCurrency !== 'USD' && rateDate && (
                        <span className="flex items-center gap-1 text-xs text-emerald-600" title={`Exchange rates as of ${rateDate}`}>
                          <RefreshCw className="w-3 h-3" />
                          Rate {rateDate}
                        </span>
                      )}
                      <span className="text-xs text-slate-400">Totals in <span className="font-medium text-slate-600">{displayCurrency}</span></span>
                      {isDraft && (
                        <button onClick={() => setShowAddItem(v => !v)} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                          <Plus className="w-3 h-3" />Add Item
                        </button>
                      )}
                    </div>
                  </div>

              {showAddItem && (
                <div className="border-b border-slate-100 bg-slate-50">
                  <div className="px-4 pt-3 pb-1 flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Quick Add Items</span>
                    <button onClick={() => setShowAddItem(false)} className="text-slate-400 hover:text-slate-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="px-4 pb-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                      <input
                        ref={addItemSearchRef}
                        value={productSearch}
                        onChange={e => setProductSearch(e.target.value)}
                        placeholder="Type product name or code to add…"
                        className="w-full border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                        disabled={addingItem}
                      />
                    </div>
                    {productSearch.length >= 1 && (
                      <div className="mt-1.5 border border-slate-200 rounded-xl bg-white shadow-sm overflow-hidden divide-y divide-slate-50 max-h-52 overflow-y-auto">
                        {(productSearchResults?.items || []).length === 0 ? (
                          <div className="px-4 py-3 text-sm text-slate-400 text-center">No products found</div>
                        ) : (
                          (productSearchResults?.items || []).map((p: any) => (
                            <button
                              key={p.id}
                              onClick={() => handleQuickAdd(p)}
                              disabled={addingItem}
                              className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-blue-50 transition-colors group disabled:opacity-50"
                            >
                              <EntityCode code={p.product_code} />
                              <span className="flex-1 text-sm text-slate-700 truncate group-hover:text-blue-700">{p.product_name}</span>
                              {p.sell_price && (
                                <span className="text-xs text-slate-400 shrink-0">
                                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: p.currency || 'USD' }).format(parseFloat(p.sell_price))}
                                </span>
                              )}
                              <Plus className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-500 shrink-0" />
                            </button>
                          ))
                        )}
                      </div>
                    )}
                    {productSearch.length === 0 && (
                      <p className="text-xs text-slate-400 mt-1.5 px-1">Click any product to add it instantly. Adjust qty &amp; price by clicking the cells in the table.</p>
                    )}
                  </div>
                </div>
              )}

              {po.items?.length === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-400 text-center">No items yet</div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100">
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">Product</th>
                          <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500">System</th>
                          <th className="text-right px-3 py-2.5 text-xs font-medium text-slate-500">Qty</th>
                          <th className="text-right px-3 py-2.5 text-xs font-medium text-slate-500">Budget ({displayCurrency})</th>
                          <th className="text-right px-3 py-2.5 text-xs font-medium text-slate-500">Cost ({displayCurrency})</th>
                          <th className="text-right px-3 py-2.5 text-xs font-medium text-slate-500">Sell ({displayCurrency})</th>
                          <th className="text-right px-3 py-2.5 text-xs font-medium text-slate-500">Total Sell</th>
                          <th className="text-right px-3 py-2.5 text-xs font-medium text-slate-500">Margin</th>
                          {isDraft && <th className="w-8" />}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {po.items.map((item: Item) => {
                          const isEditingQty = inlineEdit?.itemId === item.id && inlineEdit.field === 'quantity';
                          const isEditingBudget = inlineEdit?.itemId === item.id && inlineEdit.field === 'budget_amount';
                          const isEditingCost = inlineEdit?.itemId === item.id && inlineEdit.field === 'cost_price';
                          const isEditingSell = inlineEdit?.itemId === item.id && inlineEdit.field === 'sell_price';
                          const budgetConverted = item.budget_amount != null
                            ? convertAmount(parseFloat(item.budget_amount), item.currency, displayCurrency, rates)
                            : null;
                          const costConverted = convertAmount(parseFloat(item.cost_price || '0'), item.currency, displayCurrency, rates) || 0;
                          const budgetVsCost = budgetConverted != null ? (costConverted - budgetConverted) * parseFloat(item.quantity) : null;
                          const margin = itemMargin(item);
                          return (
                            <tr key={item.id} className="hover:bg-slate-50 group">
                              <td className="px-4 py-3">
                                {item.product_code
                                  ? <div className="flex items-center gap-1.5 group/prod">
                                      <EntityCode code={item.product_code} />
                                      <span className="text-slate-600 text-xs truncate max-w-[140px]">{item.product_name}</span>
                                      {item.product_master_id && (
                                        <button
                                          onClick={() => setQuickViewProductId(item.product_master_id)}
                                          title="View product details"
                                          className="opacity-0 group-hover/prod:opacity-100 transition-opacity text-slate-400 hover:text-blue-600 shrink-0"
                                        >
                                          <Info className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  : <span className="text-slate-400 text-xs">Unknown product</span>
                                }
                                {item.notes && <div className="text-xs text-slate-400 mt-0.5">{item.notes}</div>}
                              </td>
                              <td className="px-3 py-3">
                                <div
                                  className={isDraft ? 'cursor-pointer group/sysCell flex items-center gap-1 min-w-[90px]' : 'flex items-center gap-1'}
                                  onClick={isDraft ? e => {
                                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                    setSystemEdit({ itemId: item.id, pos: { top: rect.bottom + 4, left: rect.left } });
                                  } : undefined}
                                >
                                  {item.system_code
                                    ? <>
                                        <EntityCode code={item.system_code} />
                                        <span className="text-slate-500 text-xs truncate max-w-[100px]">{item.system_name}</span>
                                      </>
                                    : <span className={`text-xs ${isDraft ? 'text-slate-300 group-hover/sysCell:text-blue-400' : 'text-slate-300'}`}>
                                        {isDraft ? 'Add system…' : '—'}
                                      </span>
                                  }
                                  {isDraft && <Pencil className="w-2.5 h-2.5 opacity-0 group-hover/sysCell:opacity-40 ml-auto shrink-0" />}
                                </div>
                              </td>
                              <td className="px-3 py-3 text-right font-mono text-xs">
                                {isEditingQty ? (
                                  <input autoFocus type="number" min="0" step="any"
                                    value={inlineEdit!.value}
                                    onChange={e => setInlineEdit(v => v ? { ...v, value: e.target.value } : v)}
                                    onBlur={handleSaveInline}
                                    onKeyDown={e => { if (e.key === 'Enter') handleSaveInline(); if (e.key === 'Escape') setInlineEdit(null); }}
                                    className="w-20 border border-blue-400 rounded px-1 py-0.5 text-xs text-right focus:outline-none"
                                  />
                                ) : (
                                  <span
                                    className={isDraft ? 'cursor-pointer hover:text-blue-600 flex items-center justify-end gap-1 group/cell' : ''}
                                    onClick={() => isDraft && setInlineEdit({ itemId: item.id, field: 'quantity', value: item.quantity })}
                                  >
                                    {parseFloat(item.quantity).toFixed(2)}
                                    {isDraft && <Pencil className="w-2.5 h-2.5 opacity-0 group-hover/cell:opacity-40" />}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-right text-xs">
                                {isEditingBudget ? (
                                  <input autoFocus type="number" min="0" step="any"
                                    value={inlineEdit!.value}
                                    onChange={e => setInlineEdit(v => v ? { ...v, value: e.target.value } : v)}
                                    onBlur={handleSaveInline}
                                    onKeyDown={e => { if (e.key === 'Enter') handleSaveInline(); if (e.key === 'Escape') setInlineEdit(null); }}
                                    className="w-24 border border-blue-400 rounded px-1 py-0.5 text-xs text-right focus:outline-none"
                                  />
                                ) : (
                                  <div
                                    className={isDraft ? 'cursor-pointer group/budgetcell' : ''}
                                    onClick={() => isDraft && setInlineEdit({ itemId: item.id, field: 'budget_amount', value: item.budget_amount || '' })}
                                  >
                                    <span className={`flex items-center justify-end gap-1 ${item.budget_amount == null ? 'text-slate-200' : 'text-slate-600'}`}>
                                      {item.budget_amount != null ? formatCurrency(parseFloat(item.budget_amount), item.currency) : (isDraft ? 'Set…' : '—')}
                                      {isDraft && <Pencil className="w-2.5 h-2.5 opacity-0 group-hover/budgetcell:opacity-40" />}
                                    </span>
                                    {budgetVsCost != null && (
                                      <span className={`text-[10px] ${budgetVsCost > 0 ? 'text-red-500' : 'text-green-600'}`}>
                                        {budgetVsCost > 0 ? '+' : ''}{formatTotal(budgetVsCost)} over
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-3 text-right text-xs text-slate-600">
                                <div className="flex items-center justify-end gap-1.5">
                                  {currencyEdit === item.id ? (
                                    <select
                                      autoFocus
                                      value={item.currency}
                                      onChange={e => handleCurrencyChange(item.id, e.target.value)}
                                      onBlur={() => setCurrencyEdit(null)}
                                      className="text-xs border border-blue-400 rounded px-1 py-0.5 bg-white focus:outline-none"
                                    >
                                      {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                  ) : (
                                    <span
                                      onClick={isDraft ? () => setCurrencyEdit(item.id) : undefined}
                                      title={isDraft ? 'Click to change currency' : item.currency}
                                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded select-none ${isDraft ? 'bg-slate-100 hover:bg-blue-100 hover:text-blue-700 text-slate-500 cursor-pointer' : 'bg-slate-50 text-slate-400'}`}
                                    >
                                      {item.currency}
                                    </span>
                                  )}
                                  {isEditingCost ? (
                                    <input autoFocus type="number" min="0" step="any"
                                      value={inlineEdit!.value}
                                      onChange={e => setInlineEdit(v => v ? { ...v, value: e.target.value } : v)}
                                      onBlur={handleSaveInline}
                                      onKeyDown={e => { if (e.key === 'Enter') handleSaveInline(); if (e.key === 'Escape') setInlineEdit(null); }}
                                      className="w-24 border border-blue-400 rounded px-1 py-0.5 text-xs text-right focus:outline-none"
                                    />
                                  ) : (
                                    <span
                                      className={isDraft ? 'cursor-pointer hover:text-blue-600 flex items-center justify-end gap-1 group/cell' : ''}
                                      onClick={() => isDraft && setInlineEdit({ itemId: item.id, field: 'cost_price', value: item.cost_price || '' })}
                                    >
                                      {formatCurrency(parseFloat(item.cost_price || '0'), item.currency)}
                                      {isDraft && <Pencil className="w-2.5 h-2.5 opacity-0 group-hover/cell:opacity-40" />}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-3 text-right text-xs text-slate-600">
                                {isEditingSell ? (
                                  <input autoFocus type="number" min="0" step="any"
                                    value={inlineEdit!.value}
                                    onChange={e => setInlineEdit(v => v ? { ...v, value: e.target.value } : v)}
                                    onBlur={handleSaveInline}
                                    onKeyDown={e => { if (e.key === 'Enter') handleSaveInline(); if (e.key === 'Escape') setInlineEdit(null); }}
                                    className="w-24 border border-blue-400 rounded px-1 py-0.5 text-xs text-right focus:outline-none"
                                  />
                                ) : (
                                  <span
                                    className={isDraft ? 'cursor-pointer hover:text-blue-600 flex items-center justify-end gap-1 group/cell' : ''}
                                    onClick={() => isDraft && setInlineEdit({ itemId: item.id, field: 'sell_price', value: item.sell_price || '' })}
                                  >
                                    {formatCurrency(parseFloat(item.sell_price || '0'), item.currency)}
                                    {isDraft && <Pencil className="w-2.5 h-2.5 opacity-0 group-hover/cell:opacity-40" />}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-right text-xs font-medium text-slate-800">
                                {formatCurrency(parseFloat(item.sell_price || '0') * parseFloat(item.quantity), item.currency)}
                              </td>
                              <td className={`px-3 py-3 text-right text-xs font-medium ${margin >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                {formatTotal(margin)}
                              </td>
                              {isDraft && (
                                <td className="px-2 py-3">
                                  <button onClick={() => handleDeleteItem(item.id)} className="text-red-300 hover:text-red-500">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-slate-200 bg-slate-50">
                          <td colSpan={3} className="px-4 py-2.5 text-xs font-medium text-slate-500 text-right">Totals</td>
                          <td className="px-3 py-2.5 text-right text-xs font-semibold text-slate-700">
                            {hasBudget ? (
                              <div>
                                <div>{formatTotal(totalBudget)}</div>
                                {totalBudget > 0 && (
                                  <div className={`text-[10px] ${totalCost > totalBudget ? 'text-red-500' : 'text-green-600'}`}>
                                    {totalCost > totalBudget ? '+' : ''}{formatTotal(totalCost - totalBudget)} vs cost
                                  </div>
                                )}
                              </div>
                            ) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs font-semibold text-slate-700">{formatTotal(totalCost)}</td>
                          <td className="px-3 py-2.5 text-right text-xs font-semibold text-slate-700" />
                          <td className="px-3 py-2.5 text-right text-sm font-bold text-blue-600">{formatTotal(totalSell)}</td>
                          <td className="px-3 py-2.5 text-right text-xs font-semibold">
                            <span className={totalMargin >= 0 ? 'text-green-600' : 'text-red-500'}>
                              {formatTotal(totalMargin)}
                            </span>
                            <span className="text-slate-400 ml-1">({marginPct.toFixed(1)}%)</span>
                          </td>
                          {isDraft && <td />}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}
                </div>
              )}

              {/* ── Timeline tab ── */}
              {rightTab === 'timeline' && (
                <div className="px-6 py-5">
                  {(!po.history || po.history.length === 0) ? (
                    <div className="text-sm text-slate-400 text-center py-6">No history yet</div>
                  ) : (
                    <div className="relative">
                      {/* vertical spine */}
                      <div className="absolute left-5 top-3 bottom-3 w-px bg-slate-200" />
                      <div className="space-y-0">
                        {[...po.history].reverse().map((h: any, idx: number) => {
                          const isFirst = idx === 0;
                          const isRejection = h.from_status && h.to_status === 'draft';
                          const isCreation = !h.from_status;
                          const isRelease = h.to_status === 'released';
                          const isApproval = h.from_status === 'pending_approval' && h.to_status === 'purchase_order';

                          let iconEl: React.ReactNode;
                          let dotBg: string;
                          let dotBorder: string;
                          if (isRejection) {
                            dotBg = 'bg-red-50'; dotBorder = 'border-red-400';
                            iconEl = <Ban className="w-3 h-3 text-red-500" />;
                          } else if (isRelease) {
                            dotBg = 'bg-emerald-50'; dotBorder = 'border-emerald-500';
                            iconEl = <Flag className="w-3 h-3 text-emerald-600" />;
                          } else if (isApproval) {
                            dotBg = 'bg-green-50'; dotBorder = 'border-green-500';
                            iconEl = <CheckCheck className="w-3 h-3 text-green-600" />;
                          } else if (isCreation) {
                            dotBg = 'bg-slate-100'; dotBorder = 'border-slate-400';
                            iconEl = <Zap className="w-3 h-3 text-slate-500" />;
                          } else if (isFirst) {
                            dotBg = 'bg-blue-50'; dotBorder = 'border-blue-500';
                            iconEl = <ArrowRight className="w-3 h-3 text-blue-600" />;
                          } else {
                            dotBg = 'bg-white'; dotBorder = 'border-slate-300';
                            iconEl = <ArrowRight className="w-3 h-3 text-slate-400" />;
                          }

                          const stageLabel = isRejection
                            ? 'Rejected / Sent Back'
                            : STATUS_META[h.to_status]?.label || h.to_status.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

                          return (
                            <div key={h.id ?? idx} className="relative flex gap-4 pb-7 last:pb-0">
                              {/* icon dot */}
                              <div className={`relative z-10 w-10 h-10 rounded-full border-2 flex items-center justify-center shrink-0 ${dotBg} ${dotBorder}`}>
                                {iconEl}
                              </div>
                              {/* content */}
                              <div className="flex-1 min-w-0 pt-1.5">
                                <div className="flex items-start justify-between gap-3 flex-wrap">
                                  <div>
                                    <div className={`text-sm font-semibold ${isRejection ? 'text-red-600' : isRelease ? 'text-emerald-700' : isFirst ? 'text-slate-900' : 'text-slate-700'}`}>
                                      {stageLabel}
                                    </div>
                                    {isRejection && h.from_status && (
                                      <div className="text-xs text-slate-400 mt-0.5">
                                        from {STATUS_META[h.from_status]?.label || h.from_status}
                                      </div>
                                    )}
                                    {!isRejection && !isCreation && h.from_status && (
                                      <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                                        <span>{STATUS_META[h.from_status]?.label || h.from_status}</span>
                                        <ChevronRight className="w-3 h-3" />
                                        <span className="font-medium text-slate-600">{STATUS_META[h.to_status]?.label || h.to_status}</span>
                                      </div>
                                    )}
                                  </div>
                                  <div className="text-right shrink-0">
                                    <div className="text-xs font-medium text-slate-500">
                                      {new Date(h.changed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                    </div>
                                    <div className="text-[11px] text-slate-400">
                                      {new Date(h.changed_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                  </div>
                                </div>

                                {/* actor */}
                                {h.actor_name && (
                                  <div className="flex items-center gap-1.5 mt-1.5">
                                    <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-[9px] font-bold shrink-0 uppercase">
                                      {h.actor_name.charAt(0)}
                                    </div>
                                    <span className="text-xs text-slate-500">{h.actor_name}</span>
                                  </div>
                                )}

                                {/* comment */}
                                {h.comment && (
                                  <div className={`mt-2 text-xs rounded-lg px-3 py-2 border flex items-start gap-1.5 ${
                                    isRejection
                                      ? 'bg-red-50 border-red-100 text-red-700'
                                      : 'bg-slate-50 border-slate-100 text-slate-600'
                                  }`}>
                                    <MessageSquare className="w-3 h-3 mt-0.5 shrink-0 opacity-60" />
                                    <span className="italic">{h.comment}</span>
                                  </div>
                                )}

                                {/* "current stage" badge for most recent */}
                                {isFirst && (
                                  <div className="mt-2">
                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                                      Current stage
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Comments tab ── */}
              {rightTab === 'comments' && (
                <div>
                  <div className="divide-y divide-slate-50 max-h-[480px] overflow-y-auto">
                    {comments.length === 0
                      ? <div className="px-4 py-8 text-sm text-slate-400 text-center">No comments yet</div>
                      : comments.map(c => (
                        <div key={c.id} className="px-4 py-3 flex items-start gap-3 group">
                          <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-[10px] font-bold shrink-0 uppercase">
                            {c.author_name?.charAt(0) || '?'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-semibold text-slate-700">{c.author_name}</span>
                              <span className="text-xs text-slate-300">{new Date(c.created_at).toLocaleString()}</span>
                            </div>
                            <div className="text-xs text-slate-600 mt-0.5 whitespace-pre-wrap">{c.comment}</div>
                          </div>
                          {(c.user_id === user?.id || user?.role === 'admin') && (
                            <button
                              onClick={() => handleDeleteComment(c.id)}
                              className="opacity-0 group-hover:opacity-100 text-red-300 hover:text-red-500 shrink-0 transition-opacity"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))
                    }
                  </div>
                  <div className="px-4 py-3 border-t border-slate-100 flex items-end gap-2">
                    <textarea
                      value={newComment}
                      onChange={e => setNewComment(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handlePostComment(); }}
                      placeholder="Add a comment… (⌘+Enter to post)"
                      rows={2}
                      className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-xs resize-none focus:outline-none focus:border-blue-400"
                    />
                    <button
                      onClick={handlePostComment}
                      disabled={commentPosting || !newComment.trim()}
                      className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* ── Attachments tab ── */}
              {rightTab === 'attachments' && (
                <div>
                  <div className="px-4 py-2.5 border-b border-slate-100 flex justify-end">
                    <button
                      onClick={() => attachmentInputRef.current?.click()}
                      disabled={attachmentUploading}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:underline disabled:opacity-40"
                    >
                      <Plus className="w-3 h-3" />{attachmentUploading ? 'Uploading…' : 'Add file'}
                    </button>
                    <input ref={attachmentInputRef} type="file" className="hidden" onChange={handleUploadAttachment} />
                  </div>
                  <div className="divide-y divide-slate-50">
                    {attachments.length === 0
                      ? <div className="px-4 py-8 text-sm text-slate-400 text-center">No attachments yet</div>
                      : attachments.map(a => (
                        <div key={a.id} className="px-4 py-3 flex items-center gap-3 group">
                          <FileText className="w-4 h-4 text-slate-300 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <a
                              href={a.file_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline truncate block"
                            >
                              {a.file_name}
                            </a>
                            <div className="text-[10px] text-slate-300 mt-0.5">{a.uploader_name} · {new Date(a.created_at).toLocaleDateString()}</div>
                          </div>
                          <a href={a.file_url} target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-blue-500 shrink-0">
                            <Download className="w-3.5 h-3.5" />
                          </a>
                          {(a.user_id === user?.id || user?.role === 'admin') && (
                            <button
                              onClick={() => handleDeleteAttachment(a.id)}
                              className="opacity-0 group-hover:opacity-100 text-red-300 hover:text-red-500 shrink-0 transition-opacity"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))
                    }
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>

      {/* Inline system picker popup */}
      {systemEdit && (
        <div
          id="sys-picker-popup"
          style={{ position: 'fixed', top: systemEdit.pos.top, left: systemEdit.pos.left, zIndex: 9999 }}
          className="bg-white border border-slate-200 rounded-xl shadow-2xl w-72 overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              ref={sysEditRef}
              value={itemSysSearch}
              onChange={e => setItemSysSearch(e.target.value)}
              placeholder="Search system to link…"
              className="flex-1 text-sm focus:outline-none bg-transparent"
            />
            <button onClick={() => setSystemEdit(null)} className="text-slate-400 hover:text-slate-600 shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="max-h-52 overflow-y-auto divide-y divide-slate-50">
            {(() => {
              const currentItem = (po?.items || []).find((i: Item) => i.id === systemEdit.itemId);
              return (
                <>
                  {currentItem?.system_code && (
                    <button
                      onClick={() => handleSaveSystem(systemEdit.itemId, null)}
                      className="w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-red-50 flex items-center gap-1.5"
                    >
                      <X className="w-3 h-3" />Unlink system
                    </button>
                  )}
                  {itemSysSearch.length >= 1 && (itemSysResults?.items || []).length === 0 && (
                    <div className="px-3 py-3 text-xs text-slate-400 text-center">No systems found</div>
                  )}
                  {(itemSysResults?.items || []).map((s: any) => (
                    <button
                      key={s.id}
                      onClick={() => handleSaveSystem(systemEdit.itemId, s.id)}
                      className="w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-blue-50 transition-colors group"
                    >
                      <EntityCode code={s.system_code} />
                      <span className="flex-1 text-xs text-slate-700 truncate group-hover:text-blue-700">{s.system_name}</span>
                      <span className="text-xs text-slate-300 shrink-0">{s.project_code}</span>
                    </button>
                  ))}
                  {itemSysSearch.length === 0 && (
                    <div className="px-3 py-3 text-xs text-slate-400 text-center">Type to search systems…</div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Product quick-view flyout */}
      {quickViewProductId && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setQuickViewProductId(null)}
          />
          {/* Panel */}
          <div className="fixed right-0 top-0 h-full w-[420px] max-w-full bg-white border-l border-slate-200 shadow-2xl z-50 flex flex-col">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
              <div className="flex-1 min-w-0">
                {quickViewLoading ? (
                  <div className="h-5 w-32 bg-slate-100 rounded animate-pulse mb-1" />
                ) : (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      {quickViewProduct?.product_code && (
                        <EntityCode code={quickViewProduct.product_code} />
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        quickViewProduct?.standard_status === 'Active'
                          ? 'bg-green-100 text-green-700'
                          : quickViewProduct?.standard_status === 'Obsolete'
                          ? 'bg-red-100 text-red-600'
                          : 'bg-slate-100 text-slate-500'
                      }`}>{quickViewProduct?.standard_status || '—'}</span>
                    </div>
                    <h2 className="text-base font-semibold text-slate-900 mt-1 leading-snug">
                      {quickViewProduct?.product_name}
                    </h2>
                    {quickViewProduct?.product_family_name && (
                      <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                        <Tag className="w-3 h-3" />{quickViewProduct.product_family_name}
                      </p>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {quickViewProduct && (
                  <Link
                    to={`/product-masters/${quickViewProductId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                    title="Open full product page"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Link>
                )}
                <button
                  onClick={() => setQuickViewProductId(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Body — scrollable */}
            <div className="flex-1 overflow-y-auto">
              {quickViewLoading ? (
                <div className="p-5 space-y-3">
                  {[1,2,3,4].map(i => <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />)}
                </div>
              ) : quickViewProduct ? (
                <div className="divide-y divide-slate-50">

                  {/* Key specs */}
                  <div className="px-5 py-4">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2.5">Specifications</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      {[
                        { label: 'Category',    value: quickViewProduct.product_category, icon: Layers },
                        { label: 'Application', value: quickViewProduct.application_type,  icon: Beaker },
                        { label: 'Material',    value: quickViewProduct.material_name || quickViewProduct.primary_material_code, icon: Wrench },
                        { label: 'Flow (m³/h)', value: quickViewProduct.design_flow_m3h, icon: null },
                        { label: 'Pressure (bar)', value: quickViewProduct.design_pressure_bar, icon: null },
                        { label: 'Head (m)',    value: quickViewProduct.design_head_m, icon: null },
                        { label: 'Power (kW)',  value: quickViewProduct.power_kw, icon: null },
                      ].filter(r => r.value != null && r.value !== '').map(({ label, value, icon: SpecIcon }) => (
                        <div key={label}>
                          <div className="text-slate-400 text-[10px] mb-0.5">{label}</div>
                          <div className="font-medium text-slate-700 flex items-center gap-1">
                            {SpecIcon && <SpecIcon className="w-3 h-3 text-slate-400" />}
                            {String(value)}
                          </div>
                        </div>
                      ))}
                    </div>
                    {quickViewProduct.notes && (
                      <div className="mt-3 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                        {quickViewProduct.notes}
                      </div>
                    )}
                  </div>

                  {/* Variants */}
                  {quickViewProduct.variants?.length > 0 && (
                    <div className="px-5 py-4">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2.5 flex items-center gap-1.5">
                        <Layers className="w-3 h-3" />Variants ({quickViewProduct.variants.length})
                      </div>
                      <div className="space-y-1.5">
                        {quickViewProduct.variants.slice(0, 8).map((v: any) => (
                          <div key={v.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-2">
                            <span className="font-mono font-medium text-slate-600 text-[11px]">{v.variant_code}</span>
                            <span className="text-slate-500 truncate ml-2">{v.variant_name}</span>
                            {v.sell_price && (
                              <span className="text-blue-600 font-medium ml-2 shrink-0">
                                {new Intl.NumberFormat('en-US', { style: 'currency', currency: v.currency || 'USD', maximumFractionDigits: 0 }).format(parseFloat(v.sell_price))}
                              </span>
                            )}
                          </div>
                        ))}
                        {quickViewProduct.variants.length > 8 && (
                          <p className="text-[10px] text-slate-400 text-center">+{quickViewProduct.variants.length - 8} more — open full page</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Vendors */}
                  {quickViewProduct.vendors?.length > 0 && (
                    <div className="px-5 py-4">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2.5 flex items-center gap-1.5">
                        <Building2 className="w-3 h-3" />Vendors ({quickViewProduct.vendors.length})
                      </div>
                      <div className="space-y-1.5">
                        {quickViewProduct.vendors.slice(0, 5).map((v: any) => (
                          <div key={v.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-2">
                            <span className="text-slate-700 font-medium">{v.vendor_name}</span>
                            <div className="flex items-center gap-2 text-slate-400 shrink-0 ml-2">
                              {v.lead_time_days && <span>{v.lead_time_days}d lead</span>}
                              {v.unit_price && (
                                <span className="text-blue-600 font-medium">
                                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: v.currency || 'USD', maximumFractionDigits: 0 }).format(parseFloat(v.unit_price))}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Project usage */}
                  {quickViewProduct.projects?.length > 0 && (
                    <div className="px-5 py-4">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2.5">Used in Projects</div>
                      <div className="flex flex-wrap gap-1.5">
                        {quickViewProduct.projects.map((p: any) => (
                          <span key={p.project_code} className="text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                            {p.project_code}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              ) : (
                <div className="p-5 text-sm text-slate-400 text-center">Product not found</div>
              )}
            </div>

            {/* Footer */}
            {quickViewProduct && (
              <div className="px-5 py-3 border-t border-slate-100 shrink-0">
                <Link
                  to={`/product-masters/${quickViewProductId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full text-sm text-blue-600 hover:text-blue-700 font-medium py-2 rounded-lg hover:bg-blue-50 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open full product page
                </Link>
              </div>
            )}
          </div>
        </>
      )}

      {confirmDialog}
      {commentModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-96 p-5">
            <h3 className="font-semibold mb-1">
              {commentModal === 'approve' ? 'Approve PO' : commentModal === 'reject' ? 'Reject / Send Back' : 'Advance Stage'}
            </h3>
            <p className="text-xs text-slate-400 mb-3">
              {commentModal === 'approve' ? `Approve ${po.po_code} and move to Purchase Order status.`
                : commentModal === 'reject' ? 'Send this PO back to Draft for corrections.'
                : `Advance ${po.po_code} to the next stage.`}
            </p>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder={commentModal === 'reject' ? 'Rejection reason (required)…' : 'Add a comment (optional)…'}
              rows={3}
              className={`w-full border rounded px-3 py-2 text-sm focus:outline-none resize-none ${commentModal === 'reject' && !comment.trim() ? 'border-red-300 focus:border-red-500' : 'focus:border-blue-600'}`}
            />
            {commentModal === 'reject' && !comment.trim() && (
              <p className="text-xs text-red-500 mt-1">A reason is required so the submitter knows what to correct.</p>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <Button onClick={() => { setCommentModal(null); setComment(''); }}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => handleAction(commentModal)}
                disabled={saving || (commentModal === 'reject' && !comment.trim())}
              >
                {saving ? '…' : commentModal === 'approve' ? 'Approve' : commentModal === 'reject' ? 'Send Back' : 'Advance'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
