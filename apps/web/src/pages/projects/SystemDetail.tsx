import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useState } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import MetadataPanel from '../../components/ui/MetadataPanel';
import LifecycleHistory from '../../components/ui/LifecycleHistory';
import Button from '../../components/ui/Button';
import toast from 'react-hot-toast';
import { Network, Pencil } from 'lucide-react';

export default function SystemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showTransition, setShowTransition] = useState(false);
  const [newState, setNewState] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>(null);

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

      <div className="flex-1 overflow-auto p-4">
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
    </div>
  );
}
