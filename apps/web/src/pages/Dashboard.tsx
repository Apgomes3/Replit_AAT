import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { FolderOpen, Package, FileText, Cpu, FlaskConical } from 'lucide-react';

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
  ];

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-2xl font-semibold text-slate-800 mb-1">Dashboard</h1>
      <p className="text-slate-500 text-sm mb-6">Engineering Data Platform overview</p>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        {cards.map(({ label, value, icon: Icon, href, color }) => (
          <Link key={label} to={href} className={`rounded-lg border p-4 hover:shadow-sm transition-shadow ${color}`}>
            <Icon className="w-5 h-5 mb-2" />
            <div className="text-2xl font-bold">{value ?? '—'}</div>
            <div className="text-xs font-medium mt-0.5 opacity-80">{label}</div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg">
          <div className="px-4 py-3 border-b border-slate-100 text-sm font-medium text-slate-700 flex justify-between items-center">
            Recent Projects
            <Link to="/projects" className="text-xs text-[#3E5C76] hover:underline">View all</Link>
          </div>
          <div className="divide-y divide-slate-100">
            {projects?.items?.map((p: any) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                <div>
                  <div className="font-mono text-xs text-slate-500">{p.project_code}</div>
                  <div className="text-sm text-slate-800">{p.project_name}</div>
                </div>
                <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{p.project_status}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-sm font-medium text-slate-700 mb-3">Quick Links</div>
          <div className="space-y-2 text-sm">
            <Link to="/graph" className="block text-[#3E5C76] hover:underline">→ Graph Explorer — trace relationships</Link>
            <Link to="/products/masters" className="block text-[#3E5C76] hover:underline">→ Product Library — reusable definitions</Link>
            <Link to="/documents" className="block text-[#3E5C76] hover:underline">→ Document Register — controlled files</Link>
            <Link to="/knowledge/design-rules" className="block text-[#3E5C76] hover:underline">→ Design Rules — engineering standards</Link>
            <Link to="/admin/import" className="block text-[#3E5C76] hover:underline">→ CSV Import — bulk data loading</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
