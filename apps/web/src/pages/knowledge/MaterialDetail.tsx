import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';

export default function MaterialDetail() {
  const { id } = useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['material', id],
    queryFn: () => api.get(`/materials/${id}`).then(r => r.data),
  });
  if (isLoading) return <div className="p-6">Loading material…</div>;
  if (isError) return <div role="alert" className="p-6">Material could not be loaded.</div>;
  return <div><PageHeader title={data.material_name} code={data.material_code} status={data.status}
    crumbs={[{ label: 'Materials', href: '/knowledge/materials' }, { label: data.material_name }]} />
    <div className="p-6 max-w-3xl space-y-3 text-sm text-slate-700">
      {data.material_category && <p>Category: {data.material_category}</p>}
      {data.density != null && <p>Density: {data.density}</p>}
      {data.chemical_resistance && <p>Chemical resistance: {data.chemical_resistance}</p>}
      {data.notes && <p>{data.notes}</p>}
    </div>
  </div>;
}