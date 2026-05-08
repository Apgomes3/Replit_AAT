import { useQuery } from '@tanstack/react-query';
import { Activity, PlusCircle, Pencil, Trash2, ArrowRight, Package, Wrench, Minus } from 'lucide-react';
import api from '../../lib/api';
import StatusBadge from './StatusBadge';

interface AuditEvent {
  id: string;
  action: string;
  actor_name: string | null;
  details: Record<string, any> | null;
  created_at: string;
  _source: 'audit';
}

interface TransitionEvent {
  id: string;
  from_state: string | null;
  to_state: string;
  actor_name: string | null;
  comment: string | null;
  transitioned_at: string;
  _source: 'lifecycle';
}

type Event = AuditEvent | TransitionEvent;

function getTimestamp(e: Event): string {
  return e._source === 'lifecycle' ? (e as TransitionEvent).transitioned_at : (e as AuditEvent).created_at;
}

const ACTION_ICONS: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  CREATE:           { icon: <PlusCircle className="w-3.5 h-3.5" />, color: 'text-emerald-600 bg-emerald-50 border-emerald-200', label: 'Created' },
  UPDATE:           { icon: <Pencil className="w-3.5 h-3.5" />, color: 'text-blue-600 bg-blue-50 border-blue-200', label: 'Updated' },
  DELETE:           { icon: <Trash2 className="w-3.5 h-3.5" />, color: 'text-red-500 bg-red-50 border-red-200', label: 'Deleted' },
  STATE_TRANSITION: { icon: <ArrowRight className="w-3.5 h-3.5" />, color: 'text-amber-600 bg-amber-50 border-amber-200', label: 'Status changed' },
  ADD_EQUIPMENT:    { icon: <Package className="w-3.5 h-3.5" />, color: 'text-violet-600 bg-violet-50 border-violet-200', label: 'Equipment added' },
  UPDATE_EQUIPMENT: { icon: <Wrench className="w-3.5 h-3.5" />, color: 'text-slate-600 bg-slate-50 border-slate-200', label: 'Equipment updated' },
  REMOVE_EQUIPMENT: { icon: <Minus className="w-3.5 h-3.5" />, color: 'text-red-400 bg-red-50 border-red-200', label: 'Equipment removed' },
  STATUS_CHANGE:    { icon: <ArrowRight className="w-3.5 h-3.5" />, color: 'text-amber-600 bg-amber-50 border-amber-200', label: 'Status changed' },
};

function fmtDate(ts: string) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function renderDetails(action: string, details: Record<string, any> | null): React.ReactNode {
  if (!details) return null;
  const skip = new Set(['id', 'created_at', 'updated_at']);
  const entries = Object.entries(details).filter(([k, v]) => !skip.has(k) && v != null && v !== '');
  if (entries.length === 0) return null;
  if (action === 'CREATE') {
    const name = details.product_name || details.component_name || details.system_name || details.equipment_name || details.product_code || details.component_code || details.system_code || details.equipment_code;
    return name ? <span className="text-slate-500">"{name}"</span> : null;
  }
  if (action === 'ADD_EQUIPMENT' || action === 'REMOVE_EQUIPMENT') {
    const code = details.equip_code;
    const desc = details.description;
    return <span className="text-slate-500">{code}{desc ? ` — ${desc}` : ''}{details.quantity ? ` × ${details.quantity}` : ''}</span>;
  }
  if (action === 'UPDATE_EQUIPMENT') {
    const parts = [];
    if (details.description) parts.push(details.description);
    if (details.status) parts.push(details.status);
    return parts.length ? <span className="text-slate-500">{parts.join(' · ')}</span> : null;
  }
  const shown = entries.filter(([k]) => !['cost','sell_price'].includes(k)).slice(0, 4);
  if (shown.length === 0) return null;
  return (
    <span className="text-slate-500">
      {shown.map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ')}
    </span>
  );
}

function EventRow({ event }: { event: Event }) {
  const ts = getTimestamp(event);
  const actor = event.actor_name || 'System';

  if (event._source === 'lifecycle') {
    const t = event as TransitionEvent;
    const cfg = ACTION_ICONS['STATE_TRANSITION'];
    return (
      <div className="flex gap-3 items-start py-2.5 border-b border-slate-50 last:border-0">
        <div className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-full border flex items-center justify-center ${cfg.color}`}>
          {cfg.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {t.from_state && (
              <><StatusBadge status={t.from_state} /><ArrowRight className="w-3 h-3 text-slate-300" /></>
            )}
            <StatusBadge status={t.to_state} />
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-400">
            <span className="font-medium text-slate-500">{actor}</span>
            <span>·</span>
            <span>{fmtDate(ts)}</span>
          </div>
          {t.comment && <div className="text-xs text-slate-400 italic mt-0.5">"{t.comment}"</div>}
        </div>
      </div>
    );
  }

  const a = event as AuditEvent;
  const cfg = ACTION_ICONS[a.action] ?? { icon: <Activity className="w-3.5 h-3.5" />, color: 'text-slate-400 bg-slate-50 border-slate-200', label: a.action };
  const detail = renderDetails(a.action, a.details);

  return (
    <div className="flex gap-3 items-start py-2.5 border-b border-slate-50 last:border-0">
      <div className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-full border flex items-center justify-center ${cfg.color}`}>
        {cfg.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-slate-700">{cfg.label}</div>
        {detail && <div className="text-xs mt-0.5">{detail}</div>}
        <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-400">
          <span className="font-medium text-slate-500">{actor}</span>
          <span>·</span>
          <span>{fmtDate(ts)}</span>
        </div>
      </div>
    </div>
  );
}

interface Props {
  entityType: string;
  entityId: string | undefined;
}

export default function ActivityLog({ entityType, entityId }: Props) {
  const { data: auditData } = useQuery({
    queryKey: ['audit', entityType, entityId],
    queryFn: () => api.get(`/audit/${entityType}/${entityId}`).then(r => r.data),
    enabled: !!entityId,
  });

  const { data: lifecycleData } = useQuery({
    queryKey: ['lifecycle', entityType, entityId],
    queryFn: () => api.get(`/lifecycle/${entityType}/${entityId}`).then(r => r.data),
    enabled: !!entityId,
  });

  const auditEvents: AuditEvent[] = (auditData?.items || []).map((e: any) => ({ ...e, _source: 'audit' as const }));
  const lifecycleEvents: TransitionEvent[] = (lifecycleData?.items || []).map((e: any) => ({ ...e, _source: 'lifecycle' as const }));

  const all: Event[] = [...auditEvents, ...lifecycleEvents].sort(
    (a, b) => new Date(getTimestamp(b)).getTime() - new Date(getTimestamp(a)).getTime()
  );

  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <Activity className="w-4 h-4 text-slate-400" />
        <span className="text-sm font-medium text-slate-700">Activity Log</span>
        {all.length > 0 && (
          <span className="ml-auto text-xs text-slate-400">{all.length} event{all.length !== 1 ? 's' : ''}</span>
        )}
      </div>
      <div className="px-4 max-h-80 overflow-y-auto">
        {all.length === 0
          ? <div className="text-sm text-slate-400 py-4 text-center">No activity recorded yet</div>
          : all.map(e => <EventRow key={`${e._source}-${e.id}`} event={e} />)
        }
      </div>
    </div>
  );
}
