import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { ChevronLeft, FolderOpen, ArrowUpRight, Plus } from 'lucide-react';
import StatusBadge from '../../components/ui/StatusBadge';
import { useAuthStore } from '../../store/authStore';

const STATUS_COLORS: Record<string, string> = {
  'Planning': 'bg-stone-100 text-stone-600',
  'Active': 'bg-emerald-50 text-emerald-700',
  'On Hold': 'bg-amber-50 text-amber-700',
  'Completed': 'bg-blue-50 text-blue-700',
  'Cancelled': 'bg-red-50 text-red-600',
};

export default function ProjectManagementDashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isPrivileged = user?.role === 'admin' || user?.role === 'engineer';

  const { data: projectsData } = useQuery({
    queryKey: ['all-projects'],
    queryFn: () => api.get('/projects?page_size=100').then(r => r.data),
  });

  const projects: any[] = projectsData?.items ?? [];

  const countsByStatus: Record<string, number> = {};
  for (const p of projects) {
    const s = p.project_status || 'Unknown';
    countsByStatus[s] = (countsByStatus[s] || 0) + 1;
  }

  const activeProjects = projects.filter(p => p.project_status === 'Active');
  const recent = projects.slice(0, 8);

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-amber-600 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Home
        </button>
        <span className="text-stone-300">/</span>
        <span className="text-sm text-stone-600 font-medium">Project Management</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800 mb-1">Project Management</h1>
          <p className="text-stone-500 text-sm">Active projects and engineering deliverables</p>
        </div>
        {isPrivileged && (
          <Link
            to="/projects"
            className="flex items-center gap-1.5 text-sm font-medium text-amber-600 hover:text-amber-700 border border-amber-200 hover:border-amber-400 bg-white px-3 py-1.5 rounded-lg transition-all"
          >
            <Plus className="w-3.5 h-3.5" /> All Projects
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {Object.entries(countsByStatus).length === 0 ? (
          <div className="col-span-4 bg-white border border-stone-200 rounded-xl px-4 py-8 text-sm text-stone-400 text-center">
            No projects yet
          </div>
        ) : (
          Object.entries(countsByStatus).map(([status, count]) => (
            <div key={status} className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-1">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full w-fit ${STATUS_COLORS[status] || 'bg-stone-100 text-stone-600'}`}>
                {status}
              </span>
              <span className="text-3xl font-bold text-stone-800 mt-1">{count}</span>
              <span className="text-xs text-stone-400">project{count !== 1 ? 's' : ''}</span>
            </div>
          ))
        )}
      </div>

      {activeProjects.length > 0 && (
        <div className="bg-white border border-emerald-200 rounded-xl overflow-hidden mb-5">
          <div className="flex items-center justify-between px-4 py-3 border-b border-emerald-100 bg-emerald-50">
            <span className="text-sm font-semibold text-emerald-700">Active Projects</span>
            <span className="text-xs text-emerald-500 font-medium">{activeProjects.length} running</span>
          </div>
          <div className="divide-y divide-stone-50">
            {activeProjects.slice(0, 6).map((p: any) => (
              <Link key={p.id} to={`/projects/${p.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-stone-50 transition-colors group">
                <div className="flex items-center gap-3 min-w-0">
                  <FolderOpen className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div className="min-w-0">
                    <span className="font-mono text-xs text-stone-400 mr-2">{p.project_code}</span>
                    <span className="text-sm text-stone-700 group-hover:text-amber-600 truncate">{p.project_name}</span>
                  </div>
                </div>
                <StatusBadge status={p.project_status} />
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100">
          <span className="text-sm font-semibold text-stone-700">All Projects</span>
          <Link to="/projects" className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-medium">
            View all <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="divide-y divide-stone-50">
          {recent.length === 0 ? (
            <div className="px-4 py-8 text-sm text-stone-400 text-center">No projects yet</div>
          ) : (
            recent.map((p: any) => (
              <Link key={p.id} to={`/projects/${p.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-stone-50 transition-colors group">
                <div className="min-w-0">
                  <span className="font-mono text-xs text-stone-400 mr-2">{p.project_code}</span>
                  <span className="text-sm text-stone-700 group-hover:text-amber-600 truncate">{p.project_name}</span>
                </div>
                <StatusBadge status={p.project_status} />
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
