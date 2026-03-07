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
import NewEntityModal from '../../components/ui/NewEntityModal';
import LifecycleHistory from '../../components/ui/LifecycleHistory';
import { EquipmentInstance } from '../../types';
import toast from 'react-hot-toast';
import { Plus, Network } from 'lucide-react';

export default function SystemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showTransition, setShowTransition] = useState(false);
  const [showNewEq, setShowNewEq] = useState(false);
  const [newState, setNewState] = useState('');

  const { data: system, isLoading, refetch } = useQuery({
    queryKey: ['system', id],
    queryFn: () => api.get(`/systems/${id}`).then(r => r.data),
  });

  const { data: history } = useQuery({
    queryKey: ['lifecycle', 'system', id],
    queryFn: () => api.get(`/lifecycle/system/${id}`).then(r => r.data),
  });

  if (isLoading) return <div className="p-8 text-slate-400">Loading...</div>;
  if (!system) return <div className="p-8 text-slate-400">System not found</div>;

  const eqCols: Column<EquipmentInstance>[] = [
    { key: 'equipment_code', header: 'Code', render: r => <EntityCode code={r.equipment_code} /> },
    { key: 'equipment_name', header: 'Equipment Name', render: r => <span className="font-medium">{r.equipment_name}</span> },
    { key: 'equipment_type', header: 'Type' },
    { key: 'product_code', header: 'Product', render: r => r.product_code ? <Link to={`/products/masters/${r.product_code}`} onClick={e => e.stopPropagation()} className="text-[#3E5C76] hover:underline"><EntityCode code={r.product_code} /></Link> : <span className="text-slate-300">—</span> },
    { key: 'design_flow_m3h', header: 'Flow (m³/h)' },
    { key: 'power_kw', header: 'Power (kW)' },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status} /> },
  ];

  const transitions = ['Draft', 'Internal Review', 'Approved', 'Released', 'Superseded', 'Obsolete'];

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
            <Button size="sm" variant="primary" onClick={() => setShowNewEq(true)}><Plus className="w-3.5 h-3.5" />Add Equipment</Button>
          </div>
          <DataTable columns={eqCols} data={system.equipment || []} onRowClick={r => navigate(`/equipment/${r.id}`)} />
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
        <NewEntityModal title="New Equipment Instance" onClose={() => setShowNewEq(false)}
          fields={[
            { name: 'equipment_code', label: 'Equipment Code', required: true, placeholder: 'EQI-TY-SHARK-XX-01' },
            { name: 'equipment_name', label: 'Equipment Name', required: true },
            { name: 'equipment_type', label: 'Equipment Type', options: ['Foam Fractionator', 'Circulation Pump', 'Drum Filter', 'UV Sterilizer', 'Heat Exchanger', 'Ozone Generator', 'Control Panel', 'Valve', 'Other'] },
            { name: 'design_flow_m3h', label: 'Design Flow (m³/h)', type: 'number' },
            { name: 'power_kw', label: 'Power (kW)', type: 'number' },
            { name: 'material_code', label: 'Material Code' },
          ]}
          onSubmit={async (data) => {
            await api.post('/equipment-instances', { ...data, project_id: system.project_id, system_id: system.id });
            toast.success('Equipment created');
            refetch();
            setShowNewEq(false);
          }}
        />
      )}
    </div>
  );
}
