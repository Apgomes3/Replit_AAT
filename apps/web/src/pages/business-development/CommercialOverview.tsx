import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Gavel } from 'lucide-react';
import { money, OPEN_STAGES, OUTCOME_REASONS, PipelineRow, Stage, STAGE_LABELS, STAGE_TONES, usePipeline } from './bidsApi';

const DECIDED: Stage[] = ['won', 'lost', 'closed'];

function Card({ r, today }: { r: PipelineRow; today: string }) {
  const late = !!r.due_date && r.due_date < today && OPEN_STAGES.includes(r.status);
  return <Link to={`/enquiries/${r.id}`} className="block rounded-xl border border-[#dce7e2] bg-white p-3 hover:border-[#9bcfc2] hover:shadow-sm">
    <div className="flex items-center gap-2 text-[11px] text-[#6f8082]">
      <span className="font-mono">{r.enquiry_number}</span>
      {r.enquiry_type === 'tender' && <span className="px-1.5 rounded bg-sky-50 text-sky-700 font-bold uppercase text-[9px]">Tender</span>}
      {r.enquiry_type === 'tender' && r.bid_decision === 'pending' && OPEN_STAGES.includes(r.status) && <span className="text-amber-700 font-bold">bid / no-bid?</span>}
    </div>
    <div className="mt-1 text-sm font-bold text-[#20333a] leading-snug">{r.title}</div>
    <div className="text-xs text-[#53686b]">{r.client_name}</div>
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#6f8082]">
      {r.estimated_value != null && <span className="font-semibold text-[#20333a]">{money(r.estimated_value, r.value_currency)}</span>}
      {OPEN_STAGES.includes(r.status) && <span>{r.probability}%</span>}
      {r.due_date && <span className={late ? 'text-rose-600 font-bold' : ''}>due {r.due_date}</span>}
      {r.owner_name && <span>{r.owner_name}</span>}
      {r.outcome_reason && <span>{OUTCOME_REASONS[r.outcome_reason]}</span>}
    </div>
  </Link>;
}

/** Business Development: the bid pipeline by stage, with value and weighted value (in USD). */
export default function CommercialOverview() {
  const [mine, setMine] = useState(false);
  const [showDecided, setShowDecided] = useState(false);
  const pipeline = usePipeline(mine);
  const rows = pipeline.data?.data ?? [];
  const summary = pipeline.data?.summary ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const open = summary.filter(s => OPEN_STAGES.includes(s.stage));
  const total = open.reduce((s, x) => s + x.value_usd, 0);
  const weighted = open.reduce((s, x) => s + x.weighted_usd, 0);
  const openCount = open.reduce((s, x) => s + x.count, 0);
  const pendingDecisions = rows.filter(r => r.enquiry_type === 'tender' && r.bid_decision === 'pending' && OPEN_STAGES.includes(r.status)).length;
  const dueSoon = rows.filter(r => OPEN_STAGES.includes(r.status) && r.due_date && r.due_date <= new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)).length;
  const columns = showDecided ? [...OPEN_STAGES, ...DECIDED] : OPEN_STAGES;

  return <div className="p-6">
    <header className="flex flex-wrap items-start justify-between gap-4 mb-5">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[.16em] text-[#087f73]">Business development</div>
        <h1 className="text-2xl font-extrabold mt-2 inline-flex items-center gap-2"><Gavel className="w-6 h-6 text-[#087f73]" /> Bid pipeline</h1>
        <p className="text-sm text-[#6f8082] mt-1">Every enquiry and tender from first contact to won or lost. Values in USD at the platform exchange rates.</p>
      </div>
      <Link to="/enquiries" className="inline-flex items-center gap-1 text-sm font-bold text-[#087f73]">Enquiry register <ArrowUpRight className="w-4 h-4" /></Link>
    </header>

    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
      {([
        ['Open enquiries', String(openCount)], ['Pipeline value', money(total)], ['Weighted (× win chance)', money(weighted)],
        ['Bid / no-bid to decide', String(pendingDecisions)], ['Due in 14 days', String(dueSoon)],
      ] as const).map(([l, v]) => <div key={l} className="bg-white border border-[#dce7e2] rounded-xl p-4">
        <div className="text-2xl font-extrabold">{pipeline.isLoading ? <span className="inline-block h-7 w-14 skeleton" /> : v}</div>
        <div className="text-xs text-[#6f8082] mt-1">{l}</div>
      </div>)}
    </div>

    <div className="flex flex-wrap items-center gap-4 mb-3 text-sm text-[#53686b]">
      <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> Mine (owner or bid team)</label>
      <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={showDecided} onChange={e => setShowDecided(e.target.checked)} /> Show won, lost and closed (last 90 days)</label>
    </div>

    {pipeline.isError ? <p className="text-sm text-rose-700">The pipeline could not be loaded. <button className="underline font-bold" onClick={() => pipeline.refetch()}>Try again</button></p>
      : <div className="grid gap-3 overflow-x-auto pb-2" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(220px, 1fr))` }}>
        {columns.map(stage => {
          const s = summary.find(x => x.stage === stage);
          const items = rows.filter(r => r.status === stage);
          return <section key={stage} aria-label={STAGE_LABELS[stage]} className="rounded-xl bg-[#f2f7f4] border border-[#dce7e2] p-2 min-h-[180px]">
            <div className="px-1 pb-2">
              <div className="flex items-center justify-between">
                <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase ${STAGE_TONES[stage]}`}>{STAGE_LABELS[stage]}</span>
                <span className="text-xs text-[#8a9b9a]">{items.length}</span>
              </div>
              {s && s.value_usd > 0 && <div className="mt-1 text-[11px] text-[#6f8082]">{money(s.value_usd)}{OPEN_STAGES.includes(stage) ? ` · weighted ${money(s.weighted_usd)}` : ''}</div>}
            </div>
            <div className="space-y-2">{pipeline.isLoading ? <div className="h-20 skeleton rounded-xl" /> : items.map(r => <Card key={r.id} r={r} today={today} />)}</div>
          </section>;
        })}
      </div>}
  </div>;
}
