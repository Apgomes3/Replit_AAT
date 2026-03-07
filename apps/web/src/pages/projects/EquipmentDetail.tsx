import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import MetadataPanel from '../../components/ui/MetadataPanel';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import LifecycleHistory from '../../components/ui/LifecycleHistory';
import Button from '../../components/ui/Button';
import toast from 'react-hot-toast';
import { Network } from 'lucide-react';

export default function EquipmentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showTransition, setShowTransition] = useState(false);
  const [newState, setNewState] = useState('');

  const { data: equipment, isLoading, refetch } = useQuery({
    queryKey: ['equipment', id],
    queryFn: () => api.get(`/equipment-instances/${id}`).then(r => r.data),
  });

  const { data: history } = useQuery({
    queryKey: ['lifecycle', 'equipment', id],
    queryFn: () => api.get(`/lifecycle/equipment/${id}`).then(r => r.data),
  });

  if (isLoading) return <div className="p-8 text-slate-400">Loading...</div>;
  if (!equipment) return <div className="p-8 text-slate-400">Equipment not found</div>;

  const transitions = ['Draft', 'Internal Review', 'Approved', 'Released', 'Superseded', 'Obsolete'];

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        code={equipment.equipment_code} title={equipment.equipment_name} status={equipment.status}
        subtitle={equipment.equipment_type}
        breadcrumb={<>
          <Link to="/projects" className="hover:underline">Projects</Link> /
          <Link to={`/projects/${equipment.project_id}`} className="hover:underline ml-1">{equipment.project_code}</Link> /
          {equipment.system_id && <Link to={`/systems/${equipment.system_id}`} className="hover:underline ml-1">{equipment.system_code}</Link>}
        </>}
        actions={
          <div className="flex gap-2">
            <Button size="sm" onClick={() => navigate(`/graph?start=${equipment.id}&type=equipment`)}>
              <Network className="w-3.5 h-3.5" />Graph
            </Button>
            <Button size="sm" onClick={() => setShowTransition(true)}>Transition State</Button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 space-y-4">
            <MetadataPanel title="Technical Specifications" fields={[
              { label: 'Equipment Type', value: equipment.equipment_type },
              { label: 'Subtype', value: equipment.equipment_subtype },
              { label: 'Operational Duty', value: equipment.operational_duty },
              { label: 'Design Flow', value: equipment.design_flow_m3h ? `${equipment.design_flow_m3h} m³/h` : null },
              { label: 'Design Head', value: equipment.design_head_m ? `${equipment.design_head_m} m` : null },
              { label: 'Power', value: equipment.power_kw ? `${equipment.power_kw} kW` : null },
              { label: 'Material', value: equipment.material_code ? <><EntityCode code={equipment.material_code} /> {equipment.material_name && <span className="text-slate-500 text-xs ml-1">{equipment.material_name}</span>}</> : null },
              { label: 'Location', value: equipment.location_reference },
            ]} />

            <MetadataPanel title="Installation" fields={[
              { label: 'Serial Number', value: equipment.serial_number },
              { label: 'Installation Date', value: equipment.installation_date?.split('T')[0] },
              { label: 'Commissioning Date', value: equipment.commissioning_date?.split('T')[0] },
              { label: 'PO Reference', value: equipment.po_reference },
            ]} />

            {equipment.product_code && (
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Referenced Product</div>
                <Link to={`/products/masters/${equipment.product_code}`} className="flex items-center gap-2 hover:bg-slate-50 p-2 rounded">
                  <EntityCode code={equipment.product_code} />
                  <span className="text-sm text-[#3E5C76]">{equipment.product_name}</span>
                </Link>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <LifecycleHistory items={history?.items || []} />
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Project Context</div>
              <div className="space-y-1.5 text-sm">
                {equipment.project_code && <div><span className="text-slate-400">Project:</span> <Link to={`/projects/${equipment.project_id}`} className="text-[#3E5C76] hover:underline"><EntityCode code={equipment.project_code} /></Link></div>}
                {equipment.system_code && <div><span className="text-slate-400">System:</span> <Link to={`/systems/${equipment.system_id}`} className="text-[#3E5C76] hover:underline"><EntityCode code={equipment.system_code} /></Link></div>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showTransition && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-80 p-5">
            <h3 className="font-semibold mb-3">Transition State</h3>
            <select value={newState} onChange={e => setNewState(e.target.value)} className="w-full border rounded px-3 py-2 text-sm mb-3 focus:outline-none">
              <option value="">Select new state...</option>
              {transitions.map(t => <option key={t}>{t}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setShowTransition(false)}>Cancel</Button>
              <Button variant="primary" onClick={async () => {
                if (!newState) return;
                await api.post('/lifecycle/transition', { entity_type: 'equipment', entity_id: equipment.id, to_state: newState });
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
