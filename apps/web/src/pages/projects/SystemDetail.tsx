import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useState } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import MetadataPanel from '../../components/ui/MetadataPanel';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import DataTable, { Column } from '../../components/ui/DataTable';
import Button from '../../components/ui/Button';
import LifecycleHistory from '../../components/ui/LifecycleHistory';
import toast from 'react-hot-toast';
import { Plus, Network, X, Search, Package } from 'lucide-react';

type EquipmentItem = {
  id: string; equip_code: string; product_code?: string; product_name?: string;
  description?: string; quantity?: number; unit?: string; status?: string;
};

export default function SystemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showTransition, setShowTransition] = useState(false);
  const [showNewEq, setShowNewEq] = useState(false);
  const [newState, setNewState] = useState('');

  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [equipCode, setEquipCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data: system, isLoading, refetch } = useQuery({
    queryKey: ['system', id],
    queryFn: () => api.get(`/systems/${id}`).then(r => r.data),
  });

  const { data: history } = useQuery({
    queryKey: ['lifecycle', 'system', id],
    queryFn: () => api.get(`/lifecycle/system/${id}`).then(r => r.data),
  });

  const { data: productResults } = useQuery({
    queryKey: ['product-search-eq', productSearch],
    queryFn: () => api.get(`/product-masters?q=${productSearch}&page_size=8`).then(r => r.data),
    enabled: productSearch.length >= 2 && !selectedProduct,
  });

  if (isLoading) return <div className="p-8 text-slate-400">Loading...</div>;
  if (!system) return <div className="p-8 text-slate-400">System not found</div>;

  const eqCols: Column<EquipmentItem>[] = [
    { key: 'equip_code', header: 'Tag', render: r => <EntityCode code={r.equip_code} /> },
    { key: 'product_name', header: 'Product', render: r => <span className="font-medium">{r.product_name || r.description || '—'}</span> },
    { key: 'product_code', header: 'Product Code', render: r => r.product_code
      ? <Link to={`/products/masters/${r.product_code}`} onClick={e => e.stopPropagation()} className="text-[#3E5C76] hover:underline"><EntityCode code={r.product_code} /></Link>
      : <span className="text-slate-300">—</span>
    },
    { key: 'quantity', header: 'Qty', render: r => <span>{r.quantity ?? 1} {r.unit || 'EA'}</span> },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status || 'Design'} /> },
  ];

  const transitions = ['Draft', 'Internal Review', 'Approved', 'Released', 'Superseded', 'Obsolete'];

  const handleCreateEquipment = async () => {
    if (!equipCode.trim()) { toast.error('Equipment tag code is required'); return; }
    if (!selectedProduct) { toast.error('Select a product from the ASW Library'); return; }
    setSubmitting(true);
    try {
      await api.post('/equipment-items', {
        equip_code: equipCode.trim().toUpperCase(),
        product_master_id: selectedProduct.id,
        project_id: system.project_id,
        system_id: system.id,
        quantity: 1,
        unit: 'EA',
        status: 'Design',
      });
      toast.success('Equipment added');
      setShowNewEq(false);
      setSelectedProduct(null);
      setProductSearch('');
      setEquipCode('');
      refetch();
    } catch {
      toast.error('Failed to add equipment');
    } finally {
      setSubmitting(false);
    }
  };

  const openModal = () => {
    setSelectedProduct(null);
    setProductSearch('');
    setEquipCode('');
    setShowNewEq(true);
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        code={system.system_code} title={system.system_name} status={system.status}
        subtitle={`${system.system_type || ''} ${system.water_type ? '· ' + system.water_type : ''}`}
        breadcrumb={<><Link to="/projects" className="hover:underline">Projects</Link> / <Link to={`/projects/${system.project_id}`} className="hover:underline">{system.project_code}</Link></>}
        actions={
          <div className="flex gap-2">
            <Button size="sm" onClick={() => navigate(`/graph?start=${system.id}&type=system`)}>
              <Network className="w-3.5 h-3.5" />Graph
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setShowTransition(true)}>Transition State</Button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="col-span-2">
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
          </div>
          <div className="space-y-3">
            <LifecycleHistory items={history?.items || []} />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <span className="text-sm font-medium text-slate-700">Equipment ({system.equipment?.length || 0})</span>
            <Button size="sm" variant="primary" onClick={openModal}><Plus className="w-3.5 h-3.5" />Add Equipment</Button>
          </div>
          <DataTable columns={eqCols} data={system.equipment || []} emptyMessage="No equipment added yet — click Add Equipment above" />
        </div>
      </div>

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

      {showNewEq && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-semibold text-slate-800">Add Equipment to {system.system_code}</h2>
              <button onClick={() => setShowNewEq(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2">Select Product from Library *</label>
                {selectedProduct ? (
                  <div className="flex items-center justify-between p-3 border border-[#3E5C76] rounded-lg bg-blue-50">
                    <div className="flex items-center gap-3">
                      <Package className="w-4 h-4 text-[#3E5C76]" />
                      <div>
                        <div className="flex items-center gap-2">
                          <EntityCode code={selectedProduct.product_code} />
                          <span className="text-sm font-medium text-slate-800">{selectedProduct.product_name}</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">{selectedProduct.product_category}{selectedProduct.application_type ? ' · ' + selectedProduct.application_type : ''}</div>
                      </div>
                    </div>
                    <button onClick={() => { setSelectedProduct(null); setProductSearch(''); }} className="text-slate-400 hover:text-slate-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search products by name or code..."
                        value={productSearch}
                        onChange={e => setProductSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]"
                        autoFocus
                      />
                    </div>
                    {productResults?.items?.length > 0 && (
                      <div className="mt-1 border border-slate-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                        {productResults.items.map((p: any) => (
                          <button key={p.id} onClick={() => { setSelectedProduct(p); setProductSearch(p.product_name); }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 text-left border-b border-slate-100 last:border-0">
                            <EntityCode code={p.product_code} />
                            <div>
                              <div className="text-sm font-medium text-slate-800">{p.product_name}</div>
                              <div className="text-xs text-slate-400">{p.product_category}{p.application_type ? ' · ' + p.application_type : ''}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {productSearch.length >= 2 && productResults?.items?.length === 0 && (
                      <div className="mt-1 px-3 py-2 text-sm text-slate-400 border border-slate-200 rounded-lg">No products found</div>
                    )}
                    {productSearch.length < 2 && (
                      <p className="mt-1 text-xs text-slate-400">Type at least 2 characters to search</p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Equipment Code * <span className="text-slate-400 font-normal">(project-specific tag number)</span></label>
                <input
                  type="text"
                  placeholder={`e.g. ${system.system_code}-FF-01`}
                  value={equipCode}
                  onChange={e => setEquipCode(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <Button variant="ghost" onClick={() => setShowNewEq(false)}>Cancel</Button>
              <Button onClick={handleCreateEquipment} disabled={submitting || !selectedProduct || !equipCode.trim()}>
                {submitting ? 'Adding...' : 'Add Equipment'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
