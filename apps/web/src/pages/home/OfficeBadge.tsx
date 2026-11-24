// Home page, top right: the office the signed-in person belongs to, with the local time there.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Clock } from 'lucide-react';
import api from '../../lib/api';
import { localTimeIn, utcOffsetLabel } from '../../lib/timeZones';

export type MyOffice = { id: string; name: string; address: string | null; time_zone: string | null };

export default function OfficeBadge() {
  const { data: office, isSuccess } = useQuery({
    queryKey: ['auth-me', 'office'],
    queryFn: () => api.get('/auth/me').then(r => (r.data.office ?? null) as MyOffice | null),
    staleTime: 5 * 60_000,
  });
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  if (!isSuccess) return null;

  if (!office) {
    return <div className="flex items-center gap-2 rounded-xl border border-dashed border-stone-300 px-3 py-2 text-xs text-stone-400" aria-label="Your office">
      <Building2 className="w-4 h-4" /> No office set yet
    </div>;
  }
  const time = office.time_zone ? localTimeIn(office.time_zone, now) : null;
  const offset = office.time_zone ? utcOffsetLabel(office.time_zone, now) : null;
  return <div aria-label="Your office" title={office.address ?? undefined}
    className="flex items-start gap-2.5 rounded-xl border border-stone-200 bg-white/80 px-3.5 py-2 shadow-sm max-w-xs">
    <Building2 className="w-4 h-4 mt-0.5 text-blue-600 shrink-0" />
    <div className="min-w-0">
      <div className="text-sm font-semibold text-stone-800 truncate">{office.name}</div>
      {office.address && <div className="text-xs text-stone-500 truncate">{office.address.split('\n')[0]}</div>}
      {time && <div className="mt-0.5 flex items-center gap-1 text-xs text-stone-500 tabular-nums">
        <Clock className="w-3 h-3" /> {time} local{offset ? ` · ${offset}` : ''}
      </div>}
    </div>
  </div>;
}
