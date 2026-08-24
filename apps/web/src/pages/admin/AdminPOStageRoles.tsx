import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import PageHeader from '../../components/ui/PageHeader';
import toast from 'react-hot-toast';
import { Plus, Trash2, Lock, ChevronRight, User } from 'lucide-react';

const STAGE_CONFIG = [
  {
    stage: 'pending_approval',
    label: 'Pending Approval',
    description: 'Who can approve or reject a submitted PO',
    note: 'If no users are assigned here, any HQ Manager or Admin can approve. Assigning users overrides the default.',
    color: 'blue',
  },
  {
    stage: 'purchase_order',
    label: 'Purchase Order',
    description: 'Who can advance a PO from Purchase Order → PO Review',
    note: 'The PO creator and any HQ Manager / Admin can also advance this stage regardless of this list.',
    color: 'blue',
  },
  {
    stage: 'po_review',
    label: 'PO Review',
    description: 'Who can advance a PO from PO Review → Engineering Review',
    note: null,
    color: 'violet',
  },
  {
    stage: 'engineering_review',
    label: 'Engineering Review',
    description: 'Who can advance a PO from Engineering Review → Released',
    note: null,
    color: 'emerald',
  },
];

const FIXED_STAGES = [
  {
    label: 'Draft',
    description: 'Submit for approval',
    actors: 'Any Procurement Manager, HQ Manager, or Admin who created the PO',
    color: 'stone',
  },
];

const COLOR: Record<string, { badge: string; dot: string; ring: string; header: string }> = {
  blue:    { badge: 'bg-blue-50 text-blue-700 border-blue-200',    dot: 'bg-blue-500',    ring: 'ring-blue-200',   header: 'bg-blue-50 border-blue-100' },
  violet:  { badge: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-500', ring: 'ring-violet-200', header: 'bg-violet-50 border-violet-100' },
  emerald: { badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', ring: 'ring-emerald-200', header: 'bg-emerald-50 border-emerald-100' },
  stone:   { badge: 'bg-stone-100 text-stone-600 border-stone-200', dot: 'bg-stone-400', ring: 'ring-stone-200', header: 'bg-stone-50 border-stone-100' },
};

export default function AdminPOStageRoles() {
  const currentUser = useAuthStore(s => s.user);
  const isAdmin = currentUser?.role === 'admin';
  const qc = useQueryClient();
  const [addingStage, setAddingStage] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState('');

  const { data: stageRoles = {}, isLoading } = useQuery({
    queryKey: ['admin-po-stage-roles'],
    queryFn: () => api.get('/admin/po-stage-roles').then(r => r.data),
  });

  const { data: usersData } = useQuery({
    queryKey: ['admin-users-list'],
    queryFn: () => api.get('/admin/users', { params: { page_size: 1000 } }).then(r => r.data),
  });
  const allUsers: any[] = usersData?.items ?? [];

  const addMutation = useMutation({
    mutationFn: ({ stage, user_id }: { stage: string; user_id: string }) =>
      api.post('/admin/po-stage-roles', { stage, user_id }),
    onSuccess: () => {
      toast.success('User added to stage');
      qc.invalidateQueries({ queryKey: ['admin-po-stage-roles'] });
      qc.invalidateQueries({ queryKey: ['po-stage-roles'] });
      setAddingStage(null);
      setSelectedUserId('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error?.message ?? 'Failed to add user'),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/po-stage-roles/${id}`),
    onSuccess: () => {
      toast.success('Removed');
      qc.invalidateQueries({ queryKey: ['admin-po-stage-roles'] });
      qc.invalidateQueries({ queryKey: ['po-stage-roles'] });
    },
    onError: () => toast.error('Failed to remove'),
  });

  const handleAdd = (stage: string) => {
    if (!selectedUserId) return;
    addMutation.mutate({ stage, user_id: selectedUserId });
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <PageHeader
        title="PO Stage Roles"
        subtitle="Configure which users can advance a purchase order at each pipeline stage. Multiple users can be assigned to the same stage."
      />

      {/* Pipeline visual */}
      <div className="flex items-center gap-1 flex-wrap text-xs font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
        {['Draft', 'Pending Approval', 'Purchase Order', 'PO Review', 'Engineering Review', 'Released'].map((s, i, arr) => (
          <span key={s} className="flex items-center gap-1">
            <span className={i >= 1 && i <= 4 ? 'text-blue-600 font-semibold' : ''}>{s}</span>
            {i < arr.length - 1 && <ChevronRight className="w-3 h-3 text-slate-300" />}
          </span>
        ))}
        <span className="ml-auto text-slate-400 italic">Configurable stages highlighted</span>
      </div>

      {/* Fixed / system-enforced stages */}
      <div className="grid grid-cols-1 gap-4">
        {FIXED_STAGES.map(s => {
          const c = COLOR[s.color];
          return (
            <div key={s.label} className={`rounded-xl border ${c.ring} ring-1 overflow-hidden`}>
              <div className={`flex items-center gap-2 px-4 py-3 border-b ${c.header}`}>
                <div className={`w-2 h-2 rounded-full ${c.dot}`} />
                <div className="font-semibold text-slate-800 text-sm">{s.label}</div>
                <span className="ml-auto flex items-center gap-1 text-xs text-slate-400">
                  <Lock className="w-3 h-3" /> System enforced
                </span>
              </div>
              <div className="px-4 py-3">
                <div className="text-xs text-slate-500 mb-1 font-medium">{s.description}</div>
                <div className="text-sm text-slate-700">{s.actors}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Configurable stages */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <div key={i} className="h-40 rounded-xl bg-slate-100 animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {STAGE_CONFIG.map(cfg => {
            const assignees: any[] = stageRoles[cfg.stage] ?? [];
            const assignedIds = new Set(assignees.map((a: any) => a.user_id));
            const available = allUsers.filter(u => !assignedIds.has(u.id));
            const c = COLOR[cfg.color];

            return (
              <div key={cfg.stage} className={`rounded-xl border ring-1 ${c.ring} overflow-hidden`}>
                <div className={`flex items-start justify-between px-4 py-3 border-b ${c.header}`}>
                  <div>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${c.dot}`} />
                      <span className="font-semibold text-slate-800 text-sm">{cfg.label}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${c.badge}`}>
                        {assignees.length} assigned
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1 ml-4">{cfg.description}</p>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => { setAddingStage(cfg.stage); setSelectedUserId(''); }}
                      className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-200 hover:bg-blue-50 rounded-lg px-3 py-1.5 transition-colors shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add User
                    </button>
                  )}
                </div>

                <div className="divide-y divide-slate-100">
                  {assignees.length === 0 && (
                    <div className="px-4 py-5 text-sm text-slate-400 italic text-center">
                      No users assigned — nobody can advance this stage
                    </div>
                  )}
                  {assignees.map((a: any) => (
                    <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-slate-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-800">
                          {a.first_name} {a.last_name}
                        </div>
                        <div className="text-xs text-slate-400">{a.email}</div>
                      </div>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 font-medium capitalize">
                        {a.role?.replace(/_/g, ' ')}
                      </span>
                      {isAdmin && (
                        <button
                          onClick={() => removeMutation.mutate(a.id)}
                          disabled={removeMutation.isPending}
                          aria-label={`Remove ${a.first_name} ${a.last_name} from ${cfg.stage}`}
                          title="Remove user from stage"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}

                  {addingStage === cfg.stage && (
                    <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-t border-slate-100">
                      <select
                        value={selectedUserId}
                        onChange={e => setSelectedUserId(e.target.value)}
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Select a user…</option>
                        {available.map(u => (
                          <option key={u.id} value={u.id}>
                            {u.first_name} {u.last_name} ({u.email}) — {u.role?.replace(/_/g, ' ')}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleAdd(cfg.stage)}
                        disabled={!selectedUserId || addMutation.isPending}
                        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => { setAddingStage(null); setSelectedUserId(''); }}
                        className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {cfg.note && (
                  <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 text-xs text-slate-400 italic">
                    {cfg.note}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
