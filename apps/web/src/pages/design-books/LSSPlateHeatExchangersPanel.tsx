// The plate heat exchangers sized for one LSS system, on the system's Thermal tab. "New sizing" opens
// the sizer with the project, design book and system already chosen, so it gets the system's next HX tag.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import api from '../../lib/api';
import { PHE_STATUS } from './PlateHeatExchangers';

type Row = {
  id: string; title: string; sheet: { tag?: string; rev?: string };
  result_summary: { status?: string; model?: string; units?: number; duty_kw?: number };
  updated_at: string;
};

export function newSizingLink(projectId: string | null | undefined, bookId: string, systemId: string) {
  const q = new URLSearchParams({ design_book_id: bookId, system_id: systemId });
  if (projectId) q.set('project_id', projectId);
  return `/plate-heat-exchangers/new?${q}`;
}

export default function LSSPlateHeatExchangersPanel({ projectId, bookId, systemId, readOnly }: { projectId?: string | null; bookId: string; systemId: string; readOnly?: boolean }) {
  const { data = [], isLoading } = useQuery<Row[]>({
    queryKey: ['plate-heat-exchangers', 'system', systemId],
    queryFn: () => api.get('/plate-heat-exchangers', { params: { system_id: systemId } }).then(r => r.data),
  });
  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-stone-200 bg-white" aria-labelledby="lss-phe-title">
      <div className="flex items-center justify-between gap-3 border-b border-stone-100 bg-stone-50/60 px-5 py-3.5">
        <div>
          <h2 id="lss-phe-title" className="text-sm font-semibold text-stone-700">Plate heat exchangers</h2>
          <p className="mt-0.5 text-xs text-stone-400">Sizings on PHEWORLD plates linked to this system.</p>
        </div>
        {!readOnly && projectId && (
          <Link to={newSizingLink(projectId, bookId, systemId)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#003f7d] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#00336a]">
            <Plus className="h-4 w-4" />New sizing
          </Link>
        )}
      </div>
      {isLoading ? <p className="px-5 py-4 text-sm text-stone-400">Loading…</p>
        : data.length === 0 ? <p className="px-5 py-4 text-sm text-stone-400">No plate heat exchangers sized for this system yet.</p>
        : <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500"><tr>
            <th className="px-5 py-2 font-medium">Tag</th><th className="px-3 py-2 font-medium">Title</th>
            <th className="px-3 py-2 font-medium">Duty kW</th><th className="px-3 py-2 font-medium">Selection</th><th className="px-5 py-2 font-medium">Status</th>
          </tr></thead>
          <tbody>{data.map(row => {
            const s = PHE_STATUS[row.result_summary?.status || ''];
            return <tr key={row.id} className="border-t border-stone-100 hover:bg-stone-50">
              <td className="px-5 py-2 font-mono text-xs"><Link className="text-[#003f7d] hover:underline" to={`/plate-heat-exchangers/${row.id}`}>{row.sheet?.tag || '—'}</Link></td>
              <td className="px-3 py-2"><Link className="text-stone-800 hover:underline" to={`/plate-heat-exchangers/${row.id}`}>{row.title}</Link></td>
              <td className="px-3 py-2 tabular-nums">{row.result_summary?.duty_kw != null ? Math.round(row.result_summary.duty_kw) : '—'}</td>
              <td className="px-3 py-2">{row.result_summary?.model ? `${(row.result_summary.units ?? 1) > 1 ? `${row.result_summary.units} × ` : ''}${row.result_summary.model}` : '—'}</td>
              <td className="px-5 py-2">{s ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s[1]}`}>{s[0]}</span> : '—'}</td>
            </tr>;
          })}</tbody>
        </table>}
    </section>
  );
}
