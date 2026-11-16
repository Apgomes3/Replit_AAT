import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, ChevronRight, Copy, Mail, Settings, UsersRound } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

interface PersonRef { id: string; name: string; job_title: string | null; email?: string; report_count?: number }
interface Person {
  id: string; email: string; name: string; job_title: string | null; role: string; is_active: boolean;
  reports_to: PersonRef | null; direct_reports: PersonRef[]; chain: PersonRef[];
  teams: Array<{ id: string; name: string; department: string | null; is_manager: boolean; manager_id: string | null; manager_name: string | null }>;
  calendar: string | null;
}

const ROLE_LABELS: Record<string, string> = { admin: 'Admin', manager: 'Manager', user: 'User', viewer: 'Viewer', hq_manager: 'HQ manager', pmo: 'PMO', engineer: 'Engineer' };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';

function PersonChip({ p }: { p: PersonRef }) {
  return <Link to={`/people/${p.id}`} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-teal-300 hover:bg-teal-50/40">
    <span className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 text-xs font-bold flex items-center justify-center shrink-0">{initials(p.name)}</span>
    <span className="min-w-0">
      <span className="block text-sm font-semibold text-slate-800 truncate">{p.name}</span>
      <span className="block text-xs text-slate-500 truncate">{p.job_title || '—'}{p.report_count ? ` · ${p.report_count} report${p.report_count === 1 ? '' : 's'}` : ''}</span>
    </span>
  </Link>;
}

/** A colleague's card: position, access role, who they report to, who reports to them, teams, contact. */
export default function PersonCard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const me = useAuthStore(s => s.user);
  const { data: p, isLoading, isError } = useQuery({
    queryKey: ['people', id],
    queryFn: () => api.get(`/people/${id}`).then(r => r.data as Person),
    enabled: !!id,
  });
  if (isLoading) return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  if (isError || !p) return <div role="alert" className="p-6 text-sm text-rose-700">This person could not be loaded.</div>;
  const copy = async () => { try { await navigator.clipboard.writeText(p.email); toast.success('Email copied'); } catch { toast.error('Could not copy'); } };

  return <div className="p-6 max-w-3xl mx-auto">
    <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-teal-700 mb-4"><ArrowLeft className="w-4 h-4" /> Back</button>
    <article className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <header className="p-6 flex flex-wrap items-start gap-5 border-b border-slate-100">
        <div className="w-16 h-16 rounded-full bg-teal-700 text-white text-xl font-bold flex items-center justify-center shrink-0">{initials(p.name)}</div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-slate-900">{p.name}</h1>
          <p className="text-slate-600 mt-0.5">{p.job_title || 'No job position recorded'}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">Access: {ROLE_LABELS[p.role] ?? p.role}</span>
            {!p.is_active && <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-700 font-semibold">Blocked</span>}
            {p.calendar && <span className="inline-flex items-center gap-1 text-slate-500"><CalendarDays className="w-3.5 h-3.5" />{p.calendar}</span>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1.5 text-teal-700 font-semibold hover:underline"><Mail className="w-4 h-4" />{p.email}</a>
            <button onClick={copy} aria-label="Copy email" className="text-slate-400 hover:text-teal-700"><Copy className="w-4 h-4" /></button>
          </div>
        </div>
        {me?.role === 'admin' && <Link to={`/admin/users?q=${encodeURIComponent(p.email)}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-teal-700"><Settings className="w-4 h-4" /> Manage user</Link>}
      </header>

      <section className="p-6 border-b border-slate-100" aria-labelledby="person-reports-to">
        <h2 id="person-reports-to" className="text-xs font-bold uppercase tracking-wide text-slate-400">Reports to</h2>
        {p.reports_to ? <>
          {p.chain.length > 1 && <nav aria-label="Reporting line" className="mt-2 flex flex-wrap items-center gap-1 text-xs text-slate-500">
            {p.chain.map((c, i) => <span key={c.id} className="inline-flex items-center gap-1">{i > 0 && <ChevronRight className="w-3 h-3" />}<Link to={`/people/${c.id}`} className="hover:text-teal-700 hover:underline">{c.name}</Link></span>)}
            <ChevronRight className="w-3 h-3" /><span className="font-semibold text-slate-700">{p.name}</span>
          </nav>}
          <div className="mt-3 max-w-sm"><PersonChip p={p.reports_to} /></div>
        </> : <p className="mt-2 text-sm text-slate-500">No one recorded.</p>}
      </section>

      <section className="p-6 border-b border-slate-100" aria-labelledby="person-reports">
        <h2 id="person-reports" className="text-xs font-bold uppercase tracking-wide text-slate-400">Direct reports <span className="font-normal">({p.direct_reports.length})</span></h2>
        {p.direct_reports.length ? <div className="mt-3 grid sm:grid-cols-2 gap-2">{p.direct_reports.map(r => <PersonChip key={r.id} p={r} />)}</div>
          : <p className="mt-2 text-sm text-slate-500">No one reports to {p.name.split(' ')[0]}.</p>}
      </section>

      <section className="p-6" aria-labelledby="person-teams">
        <h2 id="person-teams" className="text-xs font-bold uppercase tracking-wide text-slate-400">Teams</h2>
        {p.teams.length ? <ul className="mt-3 space-y-2 text-sm">{p.teams.map(t => <li key={t.id} className="flex flex-wrap items-center gap-2">
          <UsersRound className="w-4 h-4 text-slate-400" />
          <span className="font-semibold text-slate-800">{t.name}</span>
          {t.department && <span className="text-xs text-slate-500">{t.department}</span>}
          {t.is_manager ? <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold">Leads this team</span>
            : t.manager_id && <span className="text-xs text-slate-500">led by <Link to={`/people/${t.manager_id}`} className="hover:text-teal-700 hover:underline">{t.manager_name}</Link></span>}
        </li>)}</ul> : <p className="mt-2 text-sm text-slate-500">Not in a team yet.</p>}
      </section>
    </article>
  </div>;
}
