import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';

export default function ClientDetail() {
  const { id } = useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['client', id],
    queryFn: () => api.get(`/clients/${id}`).then(r => r.data),
  });
  if (isLoading) return <div className="p-6">Loading client…</div>;
  if (isError) return <div role="alert" className="p-6">Client could not be loaded.</div>;
  return <div>
    <PageHeader title={data.name} code={data.client_code} status={data.status} crumbs={[{ label: 'Clients', href: '/clients' }, { label: data.name }]} />
    <div className="p-6 max-w-3xl space-y-6">
      {data.legal_name && <p className="text-sm text-slate-600">Legal name: {data.legal_name}</p>}
      {data.country && <p className="text-sm text-slate-600">Country: {data.country}</p>}
      {data.notes && <p className="text-sm text-slate-600">{data.notes}</p>}
      <section><h2 className="font-semibold mb-2">Contacts</h2>
        {data.contacts?.length ? data.contacts.map((c: any) => <p key={c.id} className="text-sm py-1">{c.name}{c.job_title ? ` · ${c.job_title}` : ''}</p>) : <p className="text-sm text-slate-500">No contacts.</p>}
      </section>
      <section><h2 className="font-semibold mb-2">Enquiries</h2>
        {data.enquiries?.length ? data.enquiries.map((e: any) => <p key={e.id} className="py-1 text-sm"><Link className="text-blue-600" to={`/enquiries/${e.id}`}>{e.enquiry_number} · {e.title}</Link></p>) : <p className="text-sm text-slate-500">No enquiries.</p>}
      </section>
    </div>
  </div>;
}