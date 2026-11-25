// The plate heat exchangers sized for one LSS system, on the system's Thermal tab. "New sizing" opens
// the sizer with the project, design book and system already chosen, so it gets the system's next HX tag.
import { useId } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import api from '../../lib/api';
import { PHE_STATUS } from './PlateHeatExchangers';
import { DEFAULT_INPUTS, fluidName, fmt, PheInputs, resolveInputs } from '../../lib/plateHeatExchanger';

type Summary = {
  status?: string; model?: string; units?: number; duty_kw?: number; plates?: number | null; passes?: string | null;
  area_required_m2?: number | null; area_installed_m2?: number | null; u_service_w_m2k?: number | null; lmtd_k?: number; approach_k?: number;
  primary_flow_m3h?: number; secondary_flow_m3h?: number; primary_dp_kpa?: number | null; secondary_dp_kpa?: number | null; material?: string; fatal?: string;
};
type Row = { id: string; title: string; inputs: Partial<PheInputs>; sheet: { tag?: string; rev?: string }; result_summary: Summary; updated_at: string };

const num = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '–' : fmt(v, d));

/** Primary and secondary side of a saved sizing: fluid, temperatures in → out, flow and pressure drop. */
function sides(row: Row) {
  let I: PheInputs | null = null;
  try { I = resolveInputs({ ...DEFAULT_INPUTS, ...row.inputs } as PheInputs); } catch { I = null; }
  const r = row.result_summary || {};
  return [
    { label: 'Primary', fluid: I ? fluidName(I.pFl) : '', tin: I?.pTin, tout: I?.pTout, flow: r.primary_flow_m3h, dp: r.primary_dp_kpa },
    { label: 'Secondary', fluid: I ? fluidName(I.sFl) : '', tin: I?.sTin, tout: I?.sTout, flow: r.secondary_flow_m3h, dp: r.secondary_dp_kpa },
  ];
}

export function newSizingLink(projectId: string | null | undefined, bookId: string, systemId: string, returnTab: string) {
  const q = new URLSearchParams({ design_book_id: bookId, system_id: systemId, return_tab: returnTab });
  if (projectId) q.set('project_id', projectId);
  return `/plate-heat-exchangers/new?${q}`;
}

export default function LSSPlateHeatExchangersPanel({ projectId, bookId, systemId, readOnly, className = 'mt-4', returnTab = 'thermal' }: { projectId?: string | null; bookId: string; systemId: string; readOnly?: boolean; className?: string; returnTab?: 'overview' | 'thermal' }) {
  // Shown on both the Overview and Thermal tabs, so each copy needs its own heading id.
  const titleId = useId();
  const { data = [], isLoading } = useQuery<Row[]>({
    queryKey: ['plate-heat-exchangers', 'system', systemId],
    queryFn: () => api.get('/plate-heat-exchangers', { params: { system_id: systemId } }).then(r => r.data),
  });
  return (
    <section className={`${className} overflow-hidden rounded-xl border border-stone-200 bg-white`} aria-labelledby={titleId}>
      <div className="flex items-center justify-between gap-3 border-b border-stone-100 bg-stone-50/60 px-5 py-3.5">
        <div>
          <h2 id={titleId} className="text-sm font-semibold text-stone-700">Plate heat exchangers</h2>
          <p className="mt-0.5 text-xs text-stone-400">Sizings on PHEWORLD plates linked to this system.</p>
        </div>
        {!readOnly && projectId && (
          <Link to={newSizingLink(projectId, bookId, systemId, returnTab)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#003f7d] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#00336a]">
            <Plus className="h-4 w-4" />New sizing
          </Link>
        )}
      </div>
      {isLoading ? <p className="px-5 py-4 text-sm text-stone-400">Loading…</p>
        : data.length === 0 ? <p className="px-5 py-4 text-sm text-stone-400">No plate heat exchangers sized for this system yet.</p>
        : <ul className="divide-y divide-stone-100">{data.map(row => {
          const r = row.result_summary || {};
          const st = PHE_STATUS[r.status || ''];
          const href = `/plate-heat-exchangers/${row.id}?return_tab=${returnTab}`;
          return <li key={row.id} className="px-5 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link className="font-mono text-xs font-semibold text-[#003f7d] hover:underline" to={href}>{row.sheet?.tag || '—'}</Link>
              <Link className="font-medium text-stone-800 hover:underline" to={href}>{row.title}</Link>
              {st && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st[1]}`}>{st[0]}</span>}
              <span className="ml-auto text-stone-700">{r.model ? `${(r.units ?? 1) > 1 ? `${r.units} × ` : ''}PHEWORLD ${r.model}` : ''}</span>
            </div>
            {r.fatal ? <p className="mt-1 text-xs text-red-700">{r.fatal}</p> : <>
              <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                <div><dt className="text-stone-400">Duty</dt><dd className="tabular-nums text-stone-700">{num(r.duty_kw, 1)} kW</dd></div>
                <div><dt className="text-stone-400">Plates × units · passes</dt><dd className="tabular-nums text-stone-700">{r.plates ?? '–'} × {r.units ?? 1} · {r.passes ?? '–'}</dd></div>
                <div><dt className="text-stone-400">Area required / installed</dt><dd className="tabular-nums text-stone-700">{num(r.area_required_m2, 2)} / {num(r.area_installed_m2, 2)} m²</dd></div>
                <div><dt className="text-stone-400">LMTD · approach · U</dt><dd className="tabular-nums text-stone-700">{num(r.lmtd_k, 2)} K · {num(r.approach_k, 1)} K · {num(r.u_service_w_m2k, 0)} W/m²K</dd></div>
              </dl>
              <table className="mt-2 w-full text-xs">
                <thead className="text-left text-stone-400"><tr>
                  <th className="py-0.5 pr-3 font-normal">Side</th><th className="py-0.5 pr-3 font-normal">Fluid</th><th className="py-0.5 pr-3 font-normal">In → out °C</th>
                  <th className="py-0.5 pr-3 font-normal">Flow m³/h</th><th className="py-0.5 font-normal">ΔP kPa</th>
                </tr></thead>
                <tbody className="tabular-nums text-stone-700">{sides(row).map(x => <tr key={x.label}>
                  <td className="py-0.5 pr-3 text-stone-500">{x.label}</td><td className="py-0.5 pr-3">{x.fluid}</td>
                  <td className="py-0.5 pr-3">{num(x.tin)} → {num(x.tout)}</td><td className="py-0.5 pr-3">{num(x.flow, 2)}</td><td className="py-0.5">{num(x.dp, 1)}</td>
                </tr>)}</tbody>
              </table>
              {r.material && <p className="mt-1 text-xs text-stone-400">Plates: {r.material}</p>}
            </>}
          </li>;
        })}</ul>}
    </section>
  );
}
