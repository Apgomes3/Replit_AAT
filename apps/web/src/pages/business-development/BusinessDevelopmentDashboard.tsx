import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { ArrowUpRight, BriefcaseBusiness, CircleDollarSign, Clock3, Plus, Target } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

const statusTone: Record<string, string> = {
  active: 'bg-blue-50 text-blue-700 border-blue-200', in_review: 'bg-amber-50 text-amber-700 border-amber-200',
  won: 'bg-emerald-50 text-emerald-700 border-emerald-200', lost: 'bg-rose-50 text-rose-700 border-rose-200',
  draft: 'bg-stone-100 text-stone-600 border-stone-200', withdrawn: 'bg-stone-100 text-stone-500 border-stone-200',
};
const label = (s: string) => s?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || '—';
const money = (value: number, currency = 'USD') => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value || 0);
const locationText = (value: any) => typeof value === 'string' ? value : value?.display_name || [value?.site_name, value?.city, value?.country].filter(Boolean).join(', ');

export default function BusinessDevelopmentDashboard() {
  const user = useAuthStore(s => s.user);
  const canManage = user?.role === 'admin' || user?.moduleAccess?.business_development === 'manage';
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['business-books', 'dashboard'],
    queryFn: () => api.get('/business-books', { params: { page: 1, page_size: 100 } }).then(r => r.data),
  });
  const books: any[] = data?.data || data?.items || [];
  const opportunities = books.flatMap(b => b.opportunities || []);
  const active = opportunities.filter(o => ['active', 'in_review'].includes(o.status));
  const won = opportunities.filter(o => o.status === 'won');
  const pipeline = active.reduce((sum, o) => sum + Number(o.expected_value || 0), 0);
  const pipelineCurrencies = new Set(active.filter(o => o.expected_value != null).map(o => o.expected_currency).filter(Boolean));
  const pipelineLabel = pipelineCurrencies.size > 1 ? 'Mixed currencies' : money(pipeline, [...pipelineCurrencies][0] || 'USD');
  const recent = [...books].sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime()).slice(0, 7);
  const statuses = ['draft', 'active', 'in_review', 'won', 'lost'];

  return <div className="p-6 max-w-7xl mx-auto space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-cyan-700"><BriefcaseBusiness className="w-4 h-4" /> Commercial workspace</div>
        <h1 className="text-3xl font-bold tracking-tight text-stone-800 mt-2">Business Development</h1>
        <p className="text-sm text-stone-500 mt-1">Business Books, opportunities, and the decisions behind every pursuit.</p></div>
      {canManage && <Link to="/business-books?new=1" className="inline-flex items-center gap-2 rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-cyan-800 transition-colors"><Plus className="w-4 h-4" /> New Business Book</Link>}
    </div>
    {isError ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">Business Book data could not be loaded. <button onClick={() => refetch()} className="font-semibold underline ml-1">Try again</button></div> :
      <><div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[['Books', books.length, BriefcaseBusiness, 'text-cyan-700 bg-cyan-50'], ['Live pipeline', active.length, Target, 'text-blue-700 bg-blue-50'], ['Pipeline value', pipelineLabel, CircleDollarSign, 'text-amber-700 bg-amber-50'], ['Won opportunities', won.length, Clock3, 'text-emerald-700 bg-emerald-50']].map(([title, value, Icon, tone]: any) =>
          <div key={title} className="bg-white border border-stone-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow"><div className={`w-8 h-8 rounded-lg ${tone} flex items-center justify-center`}><Icon className="w-4 h-4" /></div><div className="text-2xl font-bold text-stone-800 mt-3">{isLoading ? <span className="inline-block h-7 w-14 skeleton" /> : value}</div><div className="text-xs text-stone-500 mt-1">{title}</div></div>)}
      </div>
      <div className="grid lg:grid-cols-[1.25fr_.75fr] gap-5">
        <section className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
          <div className="flex justify-between items-center px-5 py-4 border-b border-stone-100"><div><h2 className="font-semibold text-stone-800">Recent Business Books</h2><p className="text-xs text-stone-400 mt-0.5">Latest commercial records</p></div><Link to="/business-books" className="text-xs font-semibold text-cyan-700 hover:text-cyan-900 flex items-center gap-1">View all <ArrowUpRight className="w-3.5 h-3.5" /></Link></div>
          {isLoading ? <div className="p-5 space-y-4">{[1,2,3,4].map(i => <div key={i} className="h-10 skeleton" />)}</div> : recent.length === 0 ? <div className="p-12 text-center text-sm text-stone-400"><BriefcaseBusiness className="w-9 h-9 mx-auto mb-3 text-stone-300" />No Business Books yet.</div> : <div className="divide-y divide-stone-100">{recent.map(b => <Link key={b.id} to={`/business-books/${b.id}`} className="flex items-center justify-between px-5 py-3.5 hover:bg-cyan-50/40 transition-colors group"><div className="min-w-0"><div className="font-medium text-sm text-stone-700 group-hover:text-cyan-800 truncate">{b.title}</div><div className="text-xs text-stone-400 mt-1">{b.client_name || 'No client'} {locationText(b.project_location) ? `· ${locationText(b.project_location)}` : ''}</div></div><div className="flex items-center gap-3 shrink-0"><span className={`px-2 py-1 rounded-md border text-[10px] font-semibold uppercase ${statusTone[b.status] || statusTone.draft}`}>{label(b.status)}</span><ArrowUpRight className="w-4 h-4 text-stone-300 group-hover:text-cyan-700" /></div></Link>)}</div>}
        </section>
        <section className="bg-[#f5f8f7] border border-cyan-100 rounded-xl p-5"><h2 className="font-semibold text-stone-800">Opportunity posture</h2><p className="text-xs text-stone-500 mt-1 mb-5">Distribution across the current register.</p>{statuses.map(s => { const n = opportunities.filter(o => o.status === s).length; const pct = opportunities.length ? Math.round(n / opportunities.length * 100) : 0; return <div key={s} className="mb-4"><div className="flex justify-between text-xs mb-1.5"><span className="font-medium text-stone-600">{label(s)}</span><span className="text-stone-400">{n}</span></div><div className="h-2 bg-white rounded-full overflow-hidden"><div className="h-full bg-cyan-600 rounded-full transition-all" style={{ width: `${pct}%` }} /></div></div>})}<div className="border-t border-cyan-100 pt-4 text-xs text-stone-500">Expected value shown in each record's reporting currency.</div></section>
      </div></>}
  </div>;
}