import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import StatusBadge from '../components/ui/StatusBadge';
import { FolderOpen, Package, FileText, Cpu, FlaskConical, GitBranch, Network, ArrowRight, FileSearch, Wrench, FileCheck, Award } from 'lucide-react';

const docTypeIcon = (type: string) => {
  switch (type) {
    case 'Technical Data Sheet': return <FileSearch className="w-3.5 h-3.5 text-blue-500" />;
    case 'O&M Manual': return <Wrench className="w-3.5 h-3.5 text-amber-500" />;
    case 'Certificate': return <Award className="w-3.5 h-3.5 text-purple-500" />;
    case 'Test Report': return <FileCheck className="w-3.5 h-3.5 text-red-500" />;
    default: return <FileText className="w-3.5 h-3.5 text-slate-400" />;
  }
};

const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-slate-200',
  'Internal Review': 'bg-amber-300',
  'Review Commented': 'bg-orange-300',
  Approved: 'bg-green-400',
  Released: 'bg-blue-400',
  Superseded: 'bg-slate-300',
  Obsolete: 'bg-red-300',
};

export default function Dashboard() {
  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get('/admin/stats').then(r => r.data),
  });

  const { data: projects } = useQuery({
    queryKey: ['recent-projects'],
    queryFn: () => api.get('/projects?page_size=5').then(r => r.data),
  });

  const cards = [
    { label: 'Projects', value: stats?.projects, icon: FolderOpen, href: '/projects', color: 'bg-blue-50 text-blue-600 border-blue-100' },
    { label: 'Products', value: stats?.products, icon: Package, href: '/products/masters', color: 'bg-green-50 text-green-600 border-green-100' },
    { label: 'Documents', value: stats?.documents, icon: FileText, href: '/documents', color: 'bg-amber-50 text-amber-600 border-amber-100' },
    { label: 'Equipment', value: stats?.equipment, icon: Cpu, href: '/projects', color: 'bg-purple-50 text-purple-600 border-purple-100' },
    { label: 'Materials', value: stats?.materials, icon: FlaskConical, href: '/knowledge/materials', color: 'bg-slate-50 text-slate-600 border-slate-200' },
    { label: 'Systems', value: stats?.systems, icon: GitBranch, href: '/projects', color: 'bg-teal-50 text-teal-600 border-teal-100' },
  ];

  const docByStatus: { status: string; count: string }[] = stats?.document_by_status || [];
  const docTotal = docByStatus.reduce((s, r) => s + parseInt(r.count), 0) || 1;

  const recentDocs = stats?.recent_documents || [];

  const quickLinks = [
    { to: '/graph', label: 'Graph Explorer', sub: 'Trace entity relationships' },
    { to: '/products/masters', label: 'Product Library', sub: 'Reusable product definitions' },
    { to: '/documents', label: 'Document Register', sub: 'Controlled files & revisions' },
    { to: '/knowledge/design-rules', label: 'Design Rules', sub: 'Engineering standards' },
    { to: '/admin/import', label: 'CSV Import', sub: 'Bulk data loading' },
  ];

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-2xl font-semibold text-slate-800 mb-1">Dashboard</h1>
      <p className="text-slate-500 text-sm mb-6">Engineering Data Platform overview</p>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-6">
        {cards.map(({ label, value, icon: Icon, href, color }) => (
          <Link key={label} to={href} className={`rounded-lg border p-4 hover:shadow-sm transition-shadow ${color}`}>
            <Icon className="w-5 h-5 mb-2" />
            <div className="text-2xl font-bold">{value ?? '—'}</div>
            <div className="text-xs font-medium mt-0.5 opacity-80">{label}</div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-5">
        <div className="bg-white border border-slate-200 rounded-lg md:col-span-1">
          <div className="px-4 py-3 border-b border-slate-100 text-sm font-medium text-slate-700">
            Document Status
          </div>
          {docByStatus.length === 0
            ? <div className="p-4 text-sm text-slate-400">No documents yet</div>
            : (
              <div className="p-4 space-y-2.5">
                {docByStatus.map(row => (
                  <div key={row.status}>
                    <div className="flex justify-between text-xs text-slate-600 mb-1">
                      <span>{row.status}</span>
                      <span className="font-medium">{row.count}</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full ${STATUS_COLORS[row.status] || 'bg-slate-300'}`}
                        style={{ width: `${(parseInt(row.count) / docTotal) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </div>

        <div className="bg-white border border-slate-200 rounded-lg md:col-span-2">
          <div className="px-4 py-3 border-b border-slate-100 text-sm font-medium text-slate-700 flex justify-between items-center">
            Recent Documents
            <Link to="/documents" className="text-xs text-[#3E5C76] hover:underline">View all</Link>
          </div>
          {recentDocs.length === 0
            ? <div className="p-4 text-sm text-slate-400">No documents yet</div>
            : (
              <div className="divide-y divide-slate-100">
                {recentDocs.map((d: any) => (
                  <Link key={d.id} to={`/documents/${d.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    {docTypeIcon(d.document_type)}
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-xs text-slate-400">{d.document_code}</div>
                      <div className="text-sm text-slate-800 truncate">{d.document_title}</div>
                    </div>
                    <StatusBadge status={d.status} />
                  </Link>
                ))}
              </div>
            )
          }
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200 rounded-lg">
          <div className="px-4 py-3 border-b border-slate-100 text-sm font-medium text-slate-700 flex justify-between items-center">
            Recent Projects
            <Link to="/projects" className="text-xs text-[#3E5C76] hover:underline">View all</Link>
          </div>
          <div className="divide-y divide-slate-100">
            {projects?.items?.map((p: any) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                <div>
                  <div className="font-mono text-xs text-slate-400">{p.project_code}</div>
                  <div className="text-sm text-slate-800">{p.project_name}</div>
                </div>
                <StatusBadge status={p.project_status} />
              </Link>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-sm font-medium text-slate-700 mb-3">Quick Links</div>
          <div className="space-y-1">
            {quickLinks.map(({ to, label, sub }) => (
              <Link key={to} to={to} className="flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-50 group">
                <div>
                  <div className="text-sm text-slate-700 group-hover:text-[#3E5C76] font-medium">{label}</div>
                  <div className="text-xs text-slate-400">{sub}</div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-[#3E5C76]" />
              </Link>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex gap-2">
            <Link to="/graph" className="flex items-center gap-1.5 text-xs text-[#3E5C76] hover:underline font-medium">
              <Network className="w-3.5 h-3.5" /> Graph Explorer
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
