import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Gavel, Trophy, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { usePeople } from '../initiatives/initiativesApi';
import {
  apiError, CURRENCIES, OPEN_STAGES, OUTCOME_REASONS, OutcomeReason, Stage, STAGE_LABELS, STAGE_TONES, useBid, useDecide, useMoveStage, useSaveBid, useSaveTeam,
} from './bidsApi';

const box = 'bg-white border border-[#dce7e2] rounded-xl p-5';
const label = 'text-[10px] uppercase tracking-wider font-extrabold text-[#8a9b9a]';
const input = 'mt-1 w-full border border-[#dce7e2] rounded-lg px-2.5 py-1.5 text-sm bg-white';
const NEXT: Record<Stage, Stage[]> = {
  new: ['qualifying', 'bidding'], qualifying: ['bidding'], bidding: ['submitted'], submitted: [], won: [], lost: ['qualifying'], closed: ['qualifying'],
};

/** The bid side of an enquiry: type, stage, bid/no-bid decision, value and win chance, owner and team. */
export default function BidPanel({ enquiryId, canManage, projectId }: { enquiryId: string; canManage: boolean; projectId?: string | null }) {
  const bid = useBid(enquiryId);
  const people = usePeople();
  const save = useSaveBid(enquiryId);
  const decide = useDecide(enquiryId);
  const move = useMoveStage(enquiryId);
  const saveTeam = useSaveTeam(enquiryId);
  const [f, setF] = useState({ value: '', currency: 'USD', chance: '', owner: '' });
  const [ending, setEnding] = useState<null | 'lost' | 'closed'>(null);
  const [reason, setReason] = useState<OutcomeReason>('price');
  const [note, setNote] = useState('');
  const [newMember, setNewMember] = useState('');
  const b = bid.data;
  useEffect(() => {
    if (b) setF({ value: b.estimated_value != null ? String(b.estimated_value) : '', currency: b.value_currency, chance: b.win_probability != null ? String(b.win_probability) : '', owner: b.owner?.id ?? '' });
  }, [b?.estimated_value, b?.value_currency, b?.win_probability, b?.owner?.id]);
  if (bid.isLoading) return <section className={box}><div className="h-24 skeleton" /></section>;
  if (bid.isError || !b) return null;

  const open = OPEN_STAGES.includes(b.status);
  const tender = b.enquiry_type === 'tender';
  const run = async (p: Promise<unknown>, ok: string) => { try { await p; toast.success(ok); return true; } catch (err) { toast.error(apiError(err, 'Could not save')); return false; } };
  const saveValues = () => run(save.mutateAsync({
    estimated_value: f.value === '' ? null : Number(f.value), value_currency: f.currency,
    win_probability: f.chance === '' ? null : Number(f.chance), bid_owner_user_id: f.owner || null,
  }), 'Bid details saved');
  const dirty = b && (f.value !== (b.estimated_value != null ? String(b.estimated_value) : '') || f.currency !== b.value_currency
    || f.chance !== (b.win_probability != null ? String(b.win_probability) : '') || f.owner !== (b.owner?.id ?? ''));

  return <section className={box} aria-labelledby="bid-title">
    <div className="flex items-center justify-between gap-3">
      <h2 id="bid-title" className="font-extrabold inline-flex items-center gap-2"><Gavel className="w-4 h-4 text-[#087f73]" /> Bid</h2>
      <span className={`px-2 py-1 rounded-md text-[10px] uppercase font-extrabold ${STAGE_TONES[b.status]}`}>{STAGE_LABELS[b.status]}</span>
    </div>

    <div className="mt-3 flex gap-1 rounded-lg bg-[#f2f7f4] p-1 text-xs font-bold" role="group" aria-label="Enquiry type">
      {(['direct', 'tender'] as const).map(t => <button key={t} disabled={!canManage || save.isPending} onClick={() => t !== b.enquiry_type && run(save.mutateAsync({ enquiry_type: t }), t === 'tender' ? 'Marked as a tender' : 'Marked as a direct request')}
        className={`flex-1 py-1.5 rounded-md ${b.enquiry_type === t ? 'bg-white shadow-sm text-[#087f73]' : 'text-[#6f8082]'}`}>{t === 'tender' ? 'Tender / bid' : 'Direct request'}</button>)}
    </div>

    {/* Bid / no-bid */}
    {(tender || b.bid_decision !== 'pending') && <div className="mt-4">
      <div className={label}>Bid / no-bid decision</div>
      {b.bid_decision === 'pending' ? <>
        <p className="text-sm text-[#53686b] mt-1">Not decided yet{tender ? ': decide before preparing the bid.' : '.'}</p>
        {canManage && open && <div className="mt-2 flex flex-wrap gap-2">
          <button disabled={decide.isPending} onClick={() => run(decide.mutateAsync({ decision: 'bid' }), 'Decision: bid')} className="px-3 py-1.5 rounded-lg bg-[#087f73] text-white text-sm font-bold">We bid</button>
          <button disabled={decide.isPending} onClick={async () => {
            const why = window.prompt('Why are we not bidding?', '');
            if (why === null) return;
            if (!why.trim()) return toast.error('Say why we are not bidding');
            await run(decide.mutateAsync({ decision: 'no_bid', note: why }), 'Decision: no bid (enquiry closed)');
          }} className="px-3 py-1.5 rounded-lg border border-[#dce7e2] text-sm font-bold">No bid</button>
        </div>}
      </> : <div className="mt-1 text-sm">
        <span className={`font-bold ${b.bid_decision === 'bid' ? 'text-[#087f73]' : 'text-rose-700'}`}>{b.bid_decision === 'bid' ? 'Bid' : 'No bid'}</span>
        <span className="text-[#6f8082]"> · {b.bid_decided_by?.name ?? 'someone'}{b.bid_decided_at ? `, ${b.bid_decided_at.slice(0, 10)}` : ''}</span>
        {b.bid_decision_note && <p className="text-xs text-[#53686b] mt-0.5">“{b.bid_decision_note}”</p>}
        {canManage && open && <button onClick={() => run(decide.mutateAsync({ decision: 'pending' }), 'Decision cleared')} className="block mt-1 text-xs font-bold text-[#6f8082] underline">Change decision</button>}
      </div>}
    </div>}

    {/* Stage moves */}
    {canManage && <div className="mt-4">
      <div className={label}>Move to</div>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {NEXT[b.status].map(s => <button key={s} disabled={move.isPending} onClick={() => run(move.mutateAsync({ stage: s }), STAGE_LABELS[s])}
          className="px-3 py-1.5 rounded-lg border border-[#c9e3dc] bg-[#f4faf7] text-sm font-bold text-[#087f73]">{STAGE_LABELS[s]}</button>)}
        {open && <>
          {!projectId && <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 text-sm font-bold" title="Use Create project at the top of the page"><Trophy className="w-4 h-4" /> Won → Create project</span>}
          <button onClick={() => { setEnding('lost'); setReason('price'); setNote(''); }} className="px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 text-sm font-bold">Lost</button>
          <button onClick={() => { setEnding('closed'); setReason('client_cancelled'); setNote(''); }} className="px-3 py-1.5 rounded-lg border border-[#dce7e2] text-[#6f8082] text-sm font-bold">Close</button>
        </>}
      </div>
      {ending && <div className="mt-3 rounded-lg border border-[#dce7e2] p-3 space-y-2">
        <div className="flex justify-between text-sm font-bold">{ending === 'lost' ? 'Why was it lost?' : 'Why is it closed?'}<button onClick={() => setEnding(null)} aria-label="Cancel"><X className="w-4 h-4 text-[#8a9b9a]" /></button></div>
        <select aria-label="Reason" value={reason} onChange={e => setReason(e.target.value as OutcomeReason)} className={input}>
          {Object.entries(OUTCOME_REASONS).filter(([k]) => k !== 'no_bid').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <textarea aria-label="Notes" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="What we learned (who won, their price, feedback…)" className={input} />
        <button disabled={move.isPending} onClick={async () => { if (await run(move.mutateAsync({ stage: ending, reason, note }), ending === 'lost' ? 'Marked as lost' : 'Closed')) setEnding(null); }}
          className="px-3 py-1.5 rounded-lg bg-rose-700 text-white text-sm font-bold">{ending === 'lost' ? 'Mark lost' : 'Close enquiry'}</button>
      </div>}
    </div>}
    {(b.status === 'lost' || b.status === 'closed') && b.outcome_reason && <p className="mt-3 text-sm text-[#53686b]"><span className="font-bold">{OUTCOME_REASONS[b.outcome_reason]}</span>{b.outcome_note ? `: ${b.outcome_note}` : ''}</p>}
    {b.submitted_on && <p className="mt-2 text-xs text-[#6f8082]">Submitted on {b.submitted_on}</p>}

    {/* Value, chance, owner */}
    <div className="mt-4 grid grid-cols-2 gap-3">
      <label className={label}>Estimated value<input type="number" min={0} disabled={!canManage} value={f.value} onChange={e => setF({ ...f, value: e.target.value })} className={input} /></label>
      <label className={label}>Currency<select disabled={!canManage} value={f.currency} onChange={e => setF({ ...f, currency: e.target.value })} className={input}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></label>
      <label className={label}>Win chance %<input type="number" min={0} max={100} disabled={!canManage} value={f.chance} onChange={e => setF({ ...f, chance: e.target.value })} placeholder={`${b.probability} (stage default)`} className={input} /></label>
      <label className={label}>Bid owner<select disabled={!canManage} value={f.owner} onChange={e => setF({ ...f, owner: e.target.value })} className={input}>
        <option value="">Nobody yet</option>{(people.data ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
    </div>
    {canManage && dirty && <button disabled={save.isPending} onClick={saveValues} className="mt-3 px-3 py-1.5 rounded-lg bg-[#087f73] text-white text-sm font-bold">Save bid details</button>}

    {/* Team */}
    <div className="mt-4">
      <div className={label}>Bid team</div>
      {b.team.length === 0 ? <p className="text-sm text-[#6f8082] mt-1">Nobody added.</p>
        : <ul className="mt-1.5 space-y-1 text-sm">{b.team.map(m => <li key={m.user_id} className="flex items-center gap-2">
          <Link to={`/people/${m.user_id}`} className="font-semibold hover:text-[#087f73]">{m.name}</Link>
          <span className="text-xs text-[#6f8082]">{m.role || m.job_title}</span>
          {canManage && <button aria-label={`Remove ${m.name}`} onClick={() => run(saveTeam.mutateAsync(b.team.filter(x => x.user_id !== m.user_id).map(x => ({ user_id: x.user_id, role: x.role }))), `${m.name} removed`)} className="ml-auto text-[#8a9b9a] hover:text-rose-700"><X className="w-3.5 h-3.5" /></button>}
        </li>)}</ul>}
      {canManage && <div className="mt-2 flex gap-2">
        <select aria-label="Add to the bid team" value={newMember} onChange={e => setNewMember(e.target.value)} className={`${input} mt-0`}>
          <option value="">Add someone…</option>
          {(people.data ?? []).filter(p => !b.team.some(m => m.user_id === p.id)).map(p => <option key={p.id} value={p.id}>{p.name}{p.job_title ? ` — ${p.job_title}` : ''}</option>)}
        </select>
        <button disabled={!newMember || saveTeam.isPending} onClick={async () => {
          if (await run(saveTeam.mutateAsync([...b.team.map(x => ({ user_id: x.user_id, role: x.role })), { user_id: newMember }]), 'Added to the bid team')) setNewMember('');
        }} className="px-3 py-1.5 rounded-lg border border-[#dce7e2] text-sm font-bold disabled:opacity-50">Add</button>
      </div>}
    </div>
  </section>;
}
