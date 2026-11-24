// Saved plate heat exchanger sizings, newest first; filter by project. Opens the sizer.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import DataTable from '../../components/ui/DataTable';

type Row = {
  id: string; title: string; project_id: string | null; project_code: string | null; project_name: string | null; client_name: string | null; system_code: string | null; system_name: string | null;
  sheet: { tag?: string; rev?: string }; result_summary: { status?: string; model?: string; units?: number; duty_kw?: number; plate?: string };
  updated_at: string; updated_by_name: string | null;
};

export const PHE_STATUS: Record<string, [string, string]> = {
  feasible: ['Feasible', 'bg-emerald-50 text-emerald-700'],
  warnings: ['Check warnings', 'bg-amber-50 text-amber-700'],
  not_feasible: ['Not feasible', 'bg-red-50 text-red-700'],
};

export default function PlateHeatExchangers() {
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState('');
  const { data = [], isLoading } = useQuery<Row[]>({
    queryKey: ['plate-heat-exchangers', 'list', projectId],
    queryFn: () => api.get('/plate-heat-exchangers', { params: projectId ? { project_id: projectId } : {} }).then(r => r.data),
  });
  const projectsQ = useQuery({
    queryKey: ['projects', 'phe-picker'],
    queryFn: () => api.get('/projects', { params: { page_size: 500, sort: 'project_code' } }).then(r => r.data.items as any[]),
  });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Plate Heat Exchangers"
        subtitle="Gasketed plate heat exchanger sizing on PHEWORLD plates, with a printable selection sheet."
        actions={<Button variant="primary" onClick={() => navigate('/plate-heat-exchangers/new')}><Plus className="h-4 w-4" />New sizing</Button>}
      />
      <div className="flex-1 overflow-auto p-4">
        <div className="mb-3 flex items-center gap-2">
          <label className="text-xs text-stone-600" htmlFor="phe-project">Project</label>
          <select id="phe-project" className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm" value={projectId} onChange={e => setProjectId(e.target.value)}>
            <option value="">All projects</option>
            {projectsQ.data?.map(p => <option key={p.id} value={p.id}>{p.project_code} · {p.project_name}</option>)}
          </select>
        </div>
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
          <DataTable<Row>
            tableId="plate-heat-exchangers"
            data={data}
            loading={isLoading}
            emptyMessage="No sizings saved yet. Start a new sizing to size a plate heat exchanger."
            defaultSortable
            onRowClick={row => navigate(`/plate-heat-exchangers/${row.id}`)}
            columns={[
              { key: 'title', header: 'Title', render: row => <span className="font-medium text-stone-800">{row.title}</span> },
              { key: 'tag', header: 'Tag', className: 'w-28', sortValue: row => row.sheet?.tag || '', render: row => row.sheet?.tag || <span className="text-stone-300">—</span> },
              { key: 'project', header: 'Project', sortValue: row => row.project_code || '', render: row => row.project_code
                ? <span className="whitespace-nowrap"><span className="rounded bg-stone-100 px-2 py-0.5 font-mono text-xs text-stone-600">{row.project_code}</span> <span className="text-stone-600">{row.project_name}</span></span>
                : <span className="text-stone-300">—</span> },
              { key: 'system', header: 'LSS system', sortValue: row => row.system_code || '', render: row => row.system_code ? `${row.system_code} · ${row.system_name}` : <span className="text-stone-300">—</span> },
              { key: 'client', header: 'Client', sortValue: row => row.client_name || '', render: row => row.client_name || <span className="text-stone-300">—</span> },
              { key: 'duty', header: 'Duty kW', className: 'w-24 tabular-nums', sortValue: row => Number(row.result_summary?.duty_kw) || 0, render: row => row.result_summary?.duty_kw != null ? Math.round(row.result_summary.duty_kw) : '—' },
              { key: 'model', header: 'Selection', sortValue: row => row.result_summary?.model || '', render: row => row.result_summary?.model
                ? `${(row.result_summary.units ?? 1) > 1 ? `${row.result_summary.units} × ` : ''}${row.result_summary.model}` : '—' },
              { key: 'status', header: 'Status', className: 'w-36', sortValue: row => row.result_summary?.status || '', render: row => {
                const s = PHE_STATUS[row.result_summary?.status || ''];
                return s ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s[1]}`}>{s[0]}</span> : '—';
              } },
              { key: 'updated_at', header: 'Updated', className: 'w-44', sortValue: row => row.updated_at, render: row => <span className="text-xs text-stone-500">{new Date(row.updated_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}{row.updated_by_name ? ` · ${row.updated_by_name}` : ''}</span> },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
