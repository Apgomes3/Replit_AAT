import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Building2, Plus, Search } from 'lucide-react';
import ClientFormModal from '../../components/clients/ClientFormModal';
import { CLIENT_KINDS, ClientKind, KIND_LABELS, placeOf, useCanManageClients, useCompanies } from './clientsApi';

/** The company directory: every client, consultant, contractor, partner and supplier, with their people. */
export default function ClientsList() {
  const canManage = useCanManageClients();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const kindParam = params.get('kind');
  const kind = (CLIENT_KINDS as readonly string[]).includes(kindParam ?? '') ? kindParam as ClientKind : '';
  const status = (params.get('status') as 'active' | 'inactive' | null) ?? 'active';
  const [adding, setAdding] = useState(false);
  const list = useCompanies({ search: search.trim(), kind, status, pageSize: 500 });
  const rows = list.data?.data ?? [];

  const setParam = (key: string, value: string) => setParams(p => { if (value) p.set(key, value); else p.delete(key); return p; }, { replace: true });

  return <div className="p-6 max-w-7xl mx-auto">
    <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[.16em] text-[#087f73]">Directory</div>
        <h1 className="text-2xl font-extrabold mt-2">Clients &amp; contacts</h1>
        <p className="text-sm text-[#6f8082] mt-1">One list of the companies we work with and their people, used by projects, enquiries and quotes.</p>
      </div>
      {canManage && <button onClick={() => setAdding(true)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#087f73] text-white text-sm font-bold"><Plus className="w-4 h-4" /> Add company</button>}
    </header>

    <div className="flex flex-wrap items-center gap-3 mb-4">
      <div className="relative w-full max-w-md">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-[#8da09d]" />
        <label htmlFor="client-search" className="sr-only">Search companies and people</label>
        <input id="client-search" value={search} onChange={e => { setSearch(e.target.value); setParam('search', e.target.value); }}
          placeholder="Search company, code, place or person…" className="w-full pl-9 pr-3 py-2 border border-[#dce7e2] rounded-lg bg-white text-sm" />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kind">
        {(['', ...CLIENT_KINDS] as const).map(k => <button key={k || 'all'} onClick={() => setParam('kind', k)} aria-pressed={kind === k}
          className={`px-3 py-1.5 rounded-full text-xs font-bold border ${kind === k ? 'bg-[#087f73] text-white border-[#087f73]' : 'bg-white text-[#53686b] border-[#dce7e2]'}`}>
          {k ? `${KIND_LABELS[k]}s` : 'All'}
        </button>)}
      </div>
      <select aria-label="Status" value={status} onChange={e => setParam('status', e.target.value === 'active' ? '' : e.target.value)}
        className="px-3 py-2 border border-[#dce7e2] rounded-lg bg-white text-sm">
        <option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option>
      </select>
    </div>

    <div className="bg-white rounded-xl border border-[#dce7e2] overflow-hidden shadow-sm">
      {list.isError ? <div className="p-8 text-sm text-rose-700">Companies could not be loaded. <button className="underline font-bold" onClick={() => list.refetch()}>Try again</button></div>
        : list.isLoading ? <div className="p-5 space-y-3">{[1, 2, 3, 4].map(i => <div key={i} className="h-12 skeleton" />)}</div>
        : rows.length === 0 ? <div className="p-16 text-center"><Building2 className="mx-auto w-9 h-9 text-[#b8d9d0] mb-3" /><p className="font-bold">No companies found</p></div>
        : <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-[#f2f7f4] border-b border-[#dce7e2]"><tr>
            {['Company', 'Kind', 'Main contact', 'Location', 'People', 'Projects', 'Enquiries'].map(h => <th key={h} className="text-left px-5 py-3 text-[10px] uppercase tracking-[.13em] text-[#6f8082] font-extrabold">{h}</th>)}
          </tr></thead>
          <tbody>{rows.map(c => <tr key={c.id} className="border-b border-[#edf2ef] last:border-0 hover:bg-[#f4faf7]">
            <td className="px-5 py-3.5">
              <Link to={`/clients/${c.id}`} className="font-bold hover:text-[#087f73]">{c.name}</Link>
              <div className="text-xs text-[#6f8082] mt-0.5"><span className="font-mono">{c.client_code}</span>{c.parent_name && <> · part of {c.parent_name}</>}{!c.active && <> · <span className="font-bold">inactive</span></>}</div>
            </td>
            <td className="px-5 py-3.5"><div className="flex flex-wrap gap-1">{c.kinds.map(k => <span key={k} className="px-2 py-0.5 rounded-md bg-[#e4f2ee] text-[#087f73] text-[10px] uppercase font-extrabold">{KIND_LABELS[k]}</span>)}</div></td>
            <td className="px-5 py-3.5 text-[#53686b]">{c.primary_contact_name ?? '—'}<div className="text-xs text-[#8a9b9a]">{c.primary_contact_email ?? c.primary_contact_phone ?? ''}</div></td>
            <td className="px-5 py-3.5 text-[#53686b]">{placeOf(c) || '—'}</td>
            <td className="px-5 py-3.5 text-[#53686b]">{c.contact_count ?? 0}</td>
            <td className="px-5 py-3.5 text-[#53686b]">{c.project_count ?? 0}</td>
            <td className="px-5 py-3.5 text-[#53686b]">{c.enquiry_count ?? 0}</td>
          </tr>)}</tbody>
        </table></div>}
    </div>
    {list.data && <p className="mt-2 text-xs text-[#8a9b9a]">{list.data.pagination.total} {list.data.pagination.total === 1 ? 'company' : 'companies'}</p>}
    {adding && <ClientFormModal onClose={() => setAdding(false)} />}
  </div>;
}
