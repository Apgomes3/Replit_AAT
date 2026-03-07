import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import MetadataPanel from '../../components/ui/MetadataPanel';
import LifecycleHistory from '../../components/ui/LifecycleHistory';
import Button from '../../components/ui/Button';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import toast from 'react-hot-toast';
import { Network, Pencil, Plus, Trash2, Search, X, Copy } from 'lucide-react';

export default function SystemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showTransition, setShowTransition] = useState(false);
  const [newState, setNewState] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>(null);

  const [showAddProduct, setShowAddProduct] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [equipCode, setEquipCode] = useState('');
  const [equipQty, setEquipQty] = useState('1');
  const [equipUnit, setEquipUnit] = useState('EA');
  const [equipStatus, setEquipStatus] = useState('Design');
  const [addingSaving, setAddingSaving] = useState(false);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: any } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [editingEq, setEditingEq] = useState<any>(null);
  const [editEqForm, setEditEqForm] = useState<any>(null);
  const [editEqSaving, setEditEqSaving] = useState(false);

  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    window.addEventListener('contextmenu', handler);
    return () => { window.removeEventListener('click', handler); window.removeEventListener('contextmenu', handler); };
  }, []);

  const { data: system, isLoading, refetch } = useQuery({
    queryKey: ['system', id],
    queryFn: () => api.get(`/systems/${id}`).then(r => r.data),
  });

  const { data: history } = useQuery({
    queryKey: ['lifecycle', 'system', id],
    queryFn: () => api.get(`/lifecycle/system/${id}`).then(r => r.data),
  });

  const { data: productSearchResults } = useQuery({
    queryKey: ['product-search', productSearch],
    queryFn: () => api.get(`/product-masters?q=${productSearch}&page_size=8`).then(r => r.data),
    enabled: productSearch.length >= 2 && !selectedProduct,
  });

  if (isLoading) return <div className="p-8 text-slate-400">Loading...</div>;
  if (!system) return <div className="p-8 text-slate-400">System not found</div>;

  const equipment: any[] = system.equipment || [];

  const startEdit = () => {
    setForm({
      system_name: system.system_name || '',
      system_type: system.system_type || '',
      water_type: system.water_type || '',
      design_flow_m3h: system.design_flow_m3h ?? '',
      turnover_rate_hr: system.turnover_rate_hr ?? '',
      status: system.status || 'Draft',
      duty_description: system.duty_description || '',
      redundancy_strategy: system.redundancy_strategy || '',
    });
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/systems/${system.id}`, form);
      toast.success('System saved');
      refetch();
      qc.invalidateQueries({ queryKey: ['project-systems'] });
      setEditing(false);
    } catch { toast.error('Save failed'); }
    finally { setSaving(false); }
  };

  const openAddProduct = () => {
    setProductSearch('');
    setSelectedProduct(null);
    setEquipCode('');
    setEquipQty('1');
    setEquipUnit('EA');
    setEquipStatus('Design');
    setShowAddProduct(true);
  };

  const handleAddProduct = async () => {
    if (!equipCode.trim()) { toast.error('Tag / equipment code is required'); return; }
    setAddingSaving(true);
    try {
      await api.post('/equipment-items', {
        equip_code: equipCode.trim().toUpperCase(),
        project_id: system.project_id,
        system_id: system.id,
        product_master_id: selectedProduct?.id || null,
        description: selectedProduct ? null : productSearch || null,
        quantity: parseFloat(equipQty) || 1,
        unit: equipUnit,
        status: equipStatus,
      });
      toast.success('Product added');
      refetch();
      setShowAddProduct(false);
    } catch { toast.error('Failed to add product'); }
    finally { setAddingSaving(false); }
  };

  const handleDeleteEquipment = async (eqId: string) => {
    if (!confirm('Remove this product from the system?')) return;
    try {
      await api.delete(`/equipment-items/${eqId}`);
      toast.success('Removed');
      refetch();
    } catch { toast.error('Delete failed'); }
  };

  const openEditEq = (eq: any) => {
    setEditingEq(eq);
    setEditEqForm({
      equip_code: eq.equip_code || '',
      quantity: eq.quantity ?? 1,
      unit: eq.unit || 'EA',
      status: eq.status || 'Design',
    });
    setContextMenu(null);
  };

  const handleSaveEq = async () => {
    if (!editEqForm.equip_code.trim()) { toast.error('Tag is required'); return; }
    setEditEqSaving(true);
    try {
      await api.put(`/equipment-items/${editingEq.id}`, {
        equip_code: editEqForm.equip_code.trim().toUpperCase(),
        system_id: system.id,
        product_master_id: editingEq.product_master_id || null,
        quantity: parseFloat(editEqForm.quantity) || 1,
        unit: editEqForm.unit,
        status: editEqForm.status,
      });
      toast.success('Saved');
      refetch();
      setEditingEq(null);
    } catch { toast.error('Save failed'); }
    finally { setEditEqSaving(false); }
  };

  const handleDuplicateEq = async (eq: any) => {
    setContextMenu(null);
    try {
      await api.post('/equipment-items', {
        equip_code: eq.equip_code + '-COPY',
        project_id: system.project_id,
        system_id: system.id,
        product_master_id: eq.product_master_id || null,
        description: eq.description || null,
        quantity: eq.quantity ?? 1,
        unit: eq.unit || 'EA',
        status: eq.status || 'Design',
      });
      toast.success('Duplicated');
      refetch();
    } catch { toast.error('Duplicate failed'); }
  };

  const transitions = ['Draft', 'Internal Review', 'Approved', 'Released', 'Superseded', 'Obsolete'];

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        code={system.system_code} title={system.system_name} status={system.status}
        subtitle={`${system.system_type || ''} ${system.water_type ? '· ' + system.water_type : ''}`}
        breadcrumb={<><Link to="/projects" className="hover:underline">Projects</Link> / <Link to={`/projects/${system.project_id}`} className="hover:underline">{system.project_code}</Link></>}
        actions={
          <div className="flex gap-2">
            {!editing ? (
              <>
                <Button size="sm" onClick={() => navigate(`/graph?start=${system.id}&type=system`)}>
                  <Network className="w-3.5 h-3.5" />Graph
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setShowTransition(true)}>Transition State</Button>
                <Button size="sm" variant="primary" onClick={startEdit}>
                  <Pencil className="w-3.5 h-3.5" />Edit
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" onClick={() => setEditing(false)}>Cancel</Button>
                <Button size="sm" variant="primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Details + history row */}
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            {!editing ? (
              <MetadataPanel fields={[
                { label: 'System Type', value: system.system_type },
                { label: 'Water Type', value: system.water_type },
                { label: 'Design Flow', value: system.design_flow_m3h ? `${system.design_flow_m3h} m³/h` : null },
                { label: 'Turnover Rate', value: system.turnover_rate_hr ? `${system.turnover_rate_hr} /hr` : null },
                { label: 'Area', value: system.area_name },
                { label: 'Exhibit', value: system.exhibit_name },
                { label: 'Duty', value: system.duty_description },
                { label: 'Redundancy', value: system.redundancy_strategy },
              ]} />
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg p-5">
                <div className="text-xs text-slate-400 uppercase tracking-wide mb-4">Edit System Details</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">System Name</label>
                    <input value={form.system_name} onChange={e => setForm((f: any) => ({ ...f, system_name: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">System Type</label>
                    <select value={form.system_type} onChange={e => setForm((f: any) => ({ ...f, system_type: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30">
                      <option value="">— select —</option>
                      {['Life Support', 'Utility', 'HVAC', 'Fire Fighting', 'Electrical', 'Other'].map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Water Type</label>
                    <select value={form.water_type} onChange={e => setForm((f: any) => ({ ...f, water_type: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30">
                      <option value="">— select —</option>
                      {['Fresh Water', 'Salt Water', 'Brackish', 'N/A'].map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Design Flow (m³/h)</label>
                    <input type="number" value={form.design_flow_m3h} onChange={e => setForm((f: any) => ({ ...f, design_flow_m3h: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Turnover Rate (/hr)</label>
                    <input type="number" value={form.turnover_rate_hr} onChange={e => setForm((f: any) => ({ ...f, turnover_rate_hr: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                    <select value={form.status} onChange={e => setForm((f: any) => ({ ...f, status: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30">
                      {['Draft', 'Internal Review', 'Approved', 'Released', 'Superseded', 'Obsolete'].map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Redundancy Strategy</label>
                    <input value={form.redundancy_strategy} onChange={e => setForm((f: any) => ({ ...f, redundancy_strategy: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Duty Description</label>
                    <textarea value={form.duty_description} onChange={e => setForm((f: any) => ({ ...f, duty_description: e.target.value }))}
                      rows={3} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="space-y-3">
            <LifecycleHistory items={history?.items || []} />
          </div>
        </div>

        {/* Products section */}
        <div className="bg-white border border-slate-200 rounded-lg">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Products</h3>
              <p className="text-xs text-slate-400 mt-0.5">Equipment items assigned to this system</p>
            </div>
            <Button size="sm" variant="primary" onClick={openAddProduct}>
              <Plus className="w-3.5 h-3.5" />Add Product
            </Button>
          </div>

          {equipment.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-400">
              No products added yet — click <strong>Add Product</strong> to assign equipment to this system.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Tag</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Product</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Code</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Qty</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {equipment.map((eq: any) => (
                  <tr
                    key={eq.id}
                    className="hover:bg-slate-50 cursor-context-menu select-none"
                    onContextMenu={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({ x: e.clientX, y: e.clientY, item: eq });
                    }}
                  >
                    <td className="px-5 py-3"><EntityCode code={eq.equip_code} /></td>
                    <td className="px-5 py-3 font-medium text-slate-800">{eq.product_name || eq.description || '—'}</td>
                    <td className="px-5 py-3">
                      {eq.product_code
                        ? <Link to={`/products/masters/${eq.product_code}`} className="text-[#3E5C76] hover:underline"><EntityCode code={eq.product_code} /></Link>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-5 py-3 text-slate-600">{eq.quantity ?? 1} {eq.unit || 'EA'}</td>
                    <td className="px-5 py-3"><StatusBadge status={eq.status || 'Design'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-white border border-slate-200 rounded-xl shadow-2xl py-1.5 w-44"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={e => e.stopPropagation()}
          onContextMenu={e => e.preventDefault()}
        >
          <button
            onClick={() => openEditEq(contextMenu.item)}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left"
          >
            <Pencil className="w-3.5 h-3.5 text-slate-400" /> Edit
          </button>
          <button
            onClick={() => handleDuplicateEq(contextMenu.item)}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left"
          >
            <Copy className="w-3.5 h-3.5 text-slate-400" /> Duplicate
          </button>
          <div className="my-1 border-t border-slate-100" />
          <button
            onClick={() => { handleDeleteEquipment(contextMenu.item.id); setContextMenu(null); }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-red-600 hover:bg-red-50 text-left"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      )}

      {/* Edit Equipment Modal */}
      {editingEq && editEqForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-[400px]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">Edit Product Item</h3>
              <button onClick={() => setEditingEq(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {editingEq.product_name && (
                <div className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                  <span className="font-medium text-slate-700">{editingEq.product_name}</span>
                  {editingEq.product_code && <span className="ml-2 text-slate-400">({editingEq.product_code})</span>}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tag / Equipment Code <span className="text-red-400">*</span></label>
                <input
                  value={editEqForm.equip_code}
                  onChange={e => setEditEqForm((f: any) => ({ ...f, equip_code: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30 uppercase"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Quantity</label>
                  <input type="number" min="0.001" step="any"
                    value={editEqForm.quantity}
                    onChange={e => setEditEqForm((f: any) => ({ ...f, quantity: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Unit</label>
                  <select value={editEqForm.unit} onChange={e => setEditEqForm((f: any) => ({ ...f, unit: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30">
                    {['EA', 'SET', 'M', 'M2', 'M3', 'KG', 'L', 'LOT'].map(u => <option key={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                <select value={editEqForm.status} onChange={e => setEditEqForm((f: any) => ({ ...f, status: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30">
                  {['Design', 'Procurement', 'Installed', 'Commissioned', 'Active', 'Decommissioned'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
              <Button size="sm" onClick={() => setEditingEq(null)}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={handleSaveEq} disabled={editEqSaving}>
                {editEqSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add Product Modal */}
      {showAddProduct && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">Add Product to System</h3>
              <button onClick={() => setShowAddProduct(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-auto">
              {/* Product search */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Product (from library)</label>
                {selectedProduct ? (
                  <div className="flex items-center gap-2 border border-[#3E5C76] bg-blue-50 rounded-lg px-3 py-2">
                    <EntityCode code={selectedProduct.product_code} />
                    <span className="text-sm font-medium text-slate-800 flex-1">{selectedProduct.product_name}</span>
                    <button onClick={() => { setSelectedProduct(null); setProductSearch(''); }} className="text-slate-400 hover:text-red-500">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
                    <input
                      autoFocus
                      value={productSearch}
                      onChange={e => setProductSearch(e.target.value)}
                      placeholder="Search product library..."
                      className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30"
                    />
                    {productSearchResults?.items?.length > 0 && (
                      <div className="absolute top-full left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg mt-1 z-10 max-h-48 overflow-auto">
                        {productSearchResults.items.map((p: any) => (
                          <button
                            key={p.id}
                            onClick={() => { setSelectedProduct(p); setProductSearch(''); }}
                            className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-slate-50 text-left border-b border-slate-50 last:border-0"
                          >
                            <EntityCode code={p.product_code} />
                            <span className="text-sm text-slate-800">{p.product_name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {productSearch.length >= 2 && !productSearchResults?.items?.length && (
                      <p className="text-xs text-slate-400 mt-1">No products found — you can still add a free-text item below.</p>
                    )}
                  </div>
                )}
              </div>

              {/* Tag / equipment code */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tag / Equipment Code <span className="text-red-400">*</span></label>
                <input
                  value={equipCode}
                  onChange={e => setEquipCode(e.target.value)}
                  placeholder="e.g. P-101"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30 uppercase"
                />
              </div>

              {/* Qty + Unit */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Quantity</label>
                  <input type="number" min="0.001" step="any"
                    value={equipQty} onChange={e => setEquipQty(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Unit</label>
                  <select value={equipUnit} onChange={e => setEquipUnit(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30">
                    {['EA', 'SET', 'M', 'M2', 'M3', 'KG', 'L', 'LOT'].map(u => <option key={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              {/* Status */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                <select value={equipStatus} onChange={e => setEquipStatus(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30">
                  {['Design', 'Procurement', 'Installed', 'Commissioned', 'Active', 'Decommissioned'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
              <Button size="sm" onClick={() => setShowAddProduct(false)}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={handleAddProduct} disabled={addingSaving}>
                {addingSaving ? 'Adding...' : 'Add Product'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Transition State Modal */}
      {showTransition && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-80 p-5">
            <h3 className="font-semibold mb-3">Transition State</h3>
            <select value={newState} onChange={e => setNewState(e.target.value)} className="w-full border rounded px-3 py-2 text-sm mb-3 focus:outline-none focus:border-[#3E5C76]">
              <option value="">Select new state...</option>
              {transitions.map(t => <option key={t}>{t}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setShowTransition(false)}>Cancel</Button>
              <Button variant="primary" onClick={async () => {
                if (!newState) return;
                await api.post('/lifecycle/transition', { entity_type: 'system', entity_id: system.id, to_state: newState });
                toast.success(`State → ${newState}`);
                refetch();
                qc.invalidateQueries({ queryKey: ['lifecycle'] });
                setShowTransition(false);
              }}>Apply</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
