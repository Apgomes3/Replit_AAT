import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import EntityCode from '../../components/ui/EntityCode';
import StatusBadge from '../../components/ui/StatusBadge';
import { Ruler, Box, Network, Zap, FileText, FileSearch, FileCheck, Download, Search } from 'lucide-react';

const DRAWING_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'Drawing', label: 'Drawing (General)' },
  { value: 'GA Drawing', label: 'GA Drawing' },
  { value: 'Assembly Drawing', label: 'Assembly Drawing' },
  { value: 'Fabrication Drawing', label: 'Fabrication Drawing' },
  { value: 'As-Built Drawing', label: 'As-Built Drawing' },
  { value: '3D Model', label: '3D Model' },
  { value: 'P&ID', label: 'P&ID' },
  { value: 'Wiring Diagram', label: 'Wiring Diagram' },
];

const ENTITY_FILTERS = [
  { value: '', label: 'All Entities' },
  { value: 'product', label: 'Products Only' },
  { value: 'component', label: 'Components Only' },
];

const STATUS_OPTIONS = ['', 'Draft', 'Internal Review', 'Approved', 'Released', 'Obsolete'];

const typeIcon = (type: string) => {
  switch (type) {
    case 'Drawing':
    case 'GA Drawing':
    case 'Assembly Drawing':
    case 'Fabrication Drawing':
    case 'As-Built Drawing': return <Ruler className="w-4 h-4 text-indigo-500" />;
    case '3D Model': return <Box className="w-4 h-4 text-cyan-500" />;
    case 'P&ID': return <Network className="w-4 h-4 text-teal-500" />;
    case 'Wiring Diagram': return <Zap className="w-4 h-4 text-yellow-500" />;
    case 'Technical Data Sheet': return <FileSearch className="w-4 h-4 text-blue-500" />;
    case 'Test Report': return <FileCheck className="w-4 h-4 text-red-500" />;
    default: return <FileText className="w-4 h-4 text-slate-400" />;
  }
};

const typeBadge = (type: string) => {
  const colors: Record<string, string> = {
    'Drawing': 'bg-indigo-50 text-indigo-700 border-indigo-100',
    'GA Drawing': 'bg-indigo-50 text-indigo-700 border-indigo-100',
    'Assembly Drawing': 'bg-blue-50 text-blue-700 border-blue-100',
    'Fabrication Drawing': 'bg-violet-50 text-violet-700 border-violet-100',
    'As-Built Drawing': 'bg-slate-50 text-slate-700 border-slate-200',
    '3D Model': 'bg-cyan-50 text-cyan-700 border-cyan-100',
    'P&ID': 'bg-teal-50 text-teal-700 border-teal-100',
    'Wiring Diagram': 'bg-amber-50 text-amber-700 border-amber-100',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${colors[type] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
      {type}
    </span>
  );
};

export default function DrawingsLibrary() {
  const [q, setQ] = useState('');
  const [docType, setDocType] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ drawing_types: '1', page: String(page), page_size: '50' });
  if (q) params.set('q', q);
  if (docType) params.set('document_type', docType);
  if (statusFilter) params.set('status', statusFilter);

  const { data, isLoading } = useQuery({
    queryKey: ['drawings-library', q, docType, entityFilter, statusFilter, page],
    queryFn: () => api.get(`/documents?${params}`).then(r => r.data),
  });

  const allItems: any[] = data?.items || [];
  const items = entityFilter === 'product'
    ? allItems.filter(d => d.product_id && !d.component_id)
    : entityFilter === 'component'
    ? allItems.filter(d => d.component_id)
    : allItems;

  const total = data?.pagination?.total || 0;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Drawings &amp; Models Library</h1>
            <p className="text-sm text-slate-500">Approved drawings, 3D models, P&amp;IDs, and diagrams across all products and components</p>
          </div>
          <div className="text-sm text-slate-400">{total} document{total !== 1 ? 's' : ''}</div>
        </div>
      </div>

      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-4">
        <div className="relative min-w-48 max-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" placeholder="Search drawings..." value={q}
            onChange={e => { setQ(e.target.value); setPage(1); }}
            className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
        </div>
        <div className="flex items-center gap-0.5 text-sm">
          {DRAWING_TYPES.map(t => (
            <button key={t.value} onClick={() => { setDocType(t.value); setPage(1); }}
              className={`px-3 py-1.5 transition-colors ${docType === t.value ? 'text-amber-600 font-semibold' : 'text-slate-400 hover:text-slate-600'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-slate-200" />
        <div className="flex items-center gap-0.5 text-sm">
          {ENTITY_FILTERS.map(f => (
            <button key={f.value} onClick={() => { setEntityFilter(f.value); setPage(1); }}
              className={`px-3 py-1.5 transition-colors ${entityFilter === f.value ? 'text-amber-600 font-semibold' : 'text-slate-400 hover:text-slate-600'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-slate-200" />
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="appearance-none bg-transparent text-sm cursor-pointer focus:outline-none text-slate-400 hover:text-slate-600 pr-1">
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s || 'All Statuses'}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-8 text-center text-slate-400">Loading...</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center">
            <Ruler className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <div className="text-slate-400 text-sm">No drawings or models found</div>
            <div className="text-slate-300 text-xs mt-1">Add drawings via a product or component detail page</div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Type</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Code</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Title</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Attached To</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Rev</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((doc: any) => (
                <tr key={doc.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {typeIcon(doc.document_type)}
                      {typeBadge(doc.document_type)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <EntityCode code={doc.document_code} />
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/documents/${doc.id}`} className="font-medium text-amber-600 hover:underline">
                      {doc.document_title}
                    </Link>
                    {doc.discipline && <div className="text-xs text-slate-400">{doc.discipline}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {doc.component_id && doc.component_code ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-400 shrink-0">Component</span>
                        <Link to={`/products/components/${doc.component_code}`}>
                          <EntityCode code={doc.component_code} />
                        </Link>
                        <span className="text-xs text-slate-600 truncate max-w-32">{doc.component_name}</span>
                      </div>
                    ) : doc.product_id && doc.product_code ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-400 shrink-0">Product</span>
                        <Link to={`/products/masters/${doc.product_code}`}>
                          <EntityCode code={doc.product_code} />
                        </Link>
                        <span className="text-xs text-slate-600 truncate max-w-32">{doc.product_name}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono bg-slate-100 px-1.5 py-0.5 rounded">{doc.current_revision}</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={doc.status} />
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/documents/${doc.id}`}
                      className="flex items-center gap-1 text-xs text-slate-400 hover:text-amber-600">
                      <Download className="w-3.5 h-3.5" /> View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data?.pagination && data.pagination.total > 50 && (
        <div className="border-t border-slate-200 px-6 py-3 flex items-center justify-between bg-white text-sm text-slate-500">
          <span>{data.pagination.total} total results</span>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
              className="px-3 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">Previous</button>
            <span className="px-2 py-1">Page {page}</span>
            <button disabled={items.length < 50} onClick={() => setPage(p => p + 1)}
              className="px-3 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
