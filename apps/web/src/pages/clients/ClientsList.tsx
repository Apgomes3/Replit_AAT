import { useState } from 'react';
import SkeletonTable from '../../components/ui/SkeletonTable';
import EmptyState from '../../components/ui/EmptyState';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import DataTable from '../../components/ui/DataTable';
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
  type Row = (typeof rows)[number];
  const navigate = useNavigate();

  const setParam = (key: string, value: string) => setParams(p => { if (value) p.set(key, value); else p.delete(key); return p; }, { replace: true });

  return <div>
    <PageHeader
      crumbs={[{ label: 'Clients & Contacts' }]}
      title="Clients & Contacts"
      subtitle="One list of the companies we work with and their people, used by projects, enquiries and quotes."
      actions={canManage && <Button variant="primary" onClick={() => setAdding(true)}><Plus className="w-4 h-4" /> Add company</Button>}
    />
    <div className="p-6">
    

    <div className="flex flex-wrap items-center gap-3 mb-4">
      <div className="relative w-full max-w-md">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-stone-400" />
        <label htmlFor="client-search" className="sr-only">Search companies and people</label>
        <input id="client-search" value={search} onChange={e => { setSearch(e.target.value); setParam('search', e.target.value); }}
          placeholder="Search company, code, place or person…" className="w-full pl-9 pr-3 py-2 border border-stone-200 rounded-lg bg-white text-sm" />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kind">
        {(['', ...CLIENT_KINDS] as const).map(k => <button key={k || 'all'} onClick={() => setParam('kind', k)} aria-pressed={kind === k}
          className={`px-3 py-1.5 rounded-full text-xs font-bold border ${kind === k ? 'bg-blue-600 text-white hover:bg-blue-700 border-blue-600' : 'bg-white text-stone-600 border-stone-200'}`}>
          {k ? `${KIND_LABELS[k]}s` : 'All'}
        </button>)}
      </div>
      <select aria-label="Status" value={status} onChange={e => setParam('status', e.target.value === 'active' ? '' : e.target.value)}
        className="px-3 py-2 border border-stone-200 rounded-lg bg-white text-sm">
        <option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option>
      </select>
    </div>

    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      {list.isError ? <div className="p-8 text-sm text-rose-700">Companies could not be loaded. <button className="underline font-bold" onClick={() => list.refetch()}>Try again</button></div>
        : list.isLoading ? <SkeletonTable rows={6} columns={6} />
        : rows.length === 0 ? <EmptyState icon={Building2} title="No companies found" description={search ? 'Try a different name, code, place or person.' : 'Add the companies you work with to use them in projects, enquiries and quotes.'} />
        : <DataTable<Row>
            tableId="clients"
            data={rows}
            onRowClick={c => navigate(`/clients/${c.id}`)}
            columns={[
              { key: 'name', header: 'Company', render: c => <>
                <Link to={`/clients/${c.id}`} onClick={e => e.stopPropagation()} className="font-semibold text-stone-800 hover:text-blue-600">{c.name}</Link>
                <div className="text-xs text-stone-500 mt-0.5"><span className="font-mono whitespace-nowrap">{c.client_code}</span>{c.parent_name && <> · part of {c.parent_name}</>}{!c.active && <> · <span className="font-semibold">inactive</span></>}</div>
              </> },
              { key: 'kinds', header: 'Kind', sortValue: c => c.kinds.map(k => KIND_LABELS[k]).join(','), render: c => <div className="flex flex-wrap gap-1">{c.kinds.map(k => <span key={k} className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 text-[10px] uppercase font-bold">{KIND_LABELS[k]}</span>)}</div> },
              { key: 'primary_contact_name', header: 'Main contact', render: c => <>{c.primary_contact_name ?? '—'}<div className="text-xs text-stone-400">{c.primary_contact_email ?? c.primary_contact_phone ?? ''}</div></> },
              { key: 'location', header: 'Location', sortValue: c => placeOf(c) || '', filterValue: c => placeOf(c) || '', render: c => placeOf(c) || '—' },
              { key: 'contact_count', header: 'People', className: 'text-right tabular-nums', sortValue: c => c.contact_count ?? 0, render: c => c.contact_count ?? 0 },
              { key: 'project_count', header: 'Projects', className: 'text-right tabular-nums', sortValue: c => c.project_count ?? 0, render: c => c.project_count ?? 0 },
              { key: 'enquiry_count', header: 'Enquiries', className: 'text-right tabular-nums', sortValue: c => c.enquiry_count ?? 0, render: c => c.enquiry_count ?? 0 },
            ]}
          />}
    </div>
    {list.data && <p className="mt-2 text-xs text-stone-400">{list.data.pagination.total} {list.data.pagination.total === 1 ? 'company' : 'companies'}</p>}
    {adding && <ClientFormModal onClose={() => setAdding(false)} />}
    </div>
  </div>;
}
