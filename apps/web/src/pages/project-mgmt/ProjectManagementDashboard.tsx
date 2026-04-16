import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { ChevronLeft, FolderOpen, ArrowUpRight, Plus } from 'lucide-react';
import StatusBadge from '../../components/ui/StatusBadge';
import { useAuthStore } from '../../store/authStore';

const STATUS_CONFIG: Record<string, { bg: string; text: string; dot: string; border: string }> = {
  'Planning':  { bg: 'bg-stone-50',   text: 'text-stone-600',   dot: 'bg-stone-400',   border: 'border-stone-200' },
  'Active':    { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', border: 'border-emerald-200' },
  'On Hold':   { bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500',   border: 'border-amber-200' },
  'Completed': { bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500',    border: 'border-blue-200' },
  'Cancelled': { bg: 'bg-red-50',     text: 'text-red-600',     dot: 'bg-red-500',     border: 'border-red-200' },
};
const fallbackStatus = { bg: 'bg-stone-50', text: 'text-stone-500', dot: 'bg-stone-400', border: 'border-stone-200' };

function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="skeleton h-3 w-20 shrink-0" />
            <div className="skeleton h-3 w-40" />
          </div>
          <div className="skeleton h-5 w-20 rounded-full" />
        </div>
      ))}
    </>
  );
}

export default function ProjectManagementDashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isPrivileged = user?.role === 'admin' || user?.role === 'engineer';

  const { data: projectsData, isLoading } = useQuery({
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
          className="flex items-center gap-1.5 text-sm text-stone-400 hover:text-amber-600 transition-colors duration-150 group"
        >
          <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform duration-150" />
          Home
        </button>
        <span className="text-stone-300">/</span>
        <span className="text-sm text-stone-600 font-medium">Project Management</span>
      </div>

      <div className="flex items-start justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-stone-800 mb-1">Project Management</h1>
          <p className="text-stone-400 text-sm">Active projects and engineering deliverables</p>
        </div>
        {isPrivileged && (
          <Link
            to="/projects"
            className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 hover:text-emerald-700 border border-emerald-200 hover:border-emerald-400 bg-white px-3 py-1.5 rounded-lg transition-all duration-150 shadow-sm hover:shadow active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" /> All Projects
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-2">
              <div className="skeleton h-5 w-20 rounded-full" />
              <div className="skeleton h-8 w-12 mt-1" />
              <div className="skeleton h-3 w-16" />
            </div>
          ))
        ) : Object.entries(countsByStatus).length === 0 ? (
          <div className="col-span-4 bg-white border border-stone-200 rounded-xl px-4 py-10 flex flex-col items-center gap-2">
            <FolderOpen className="w-8 h-8 text-stone-200" />
            <span className="text-sm text-stone-400">No projects yet</span>
          </div>
        ) : (
          Object.entries(countsByStatus).map(([status, count]) => {
            const cfg = STATUS_CONFIG[status] ?? fallbackStatus;
            return (
              <div key={status} className={`bg-white border rounded-xl p-4 flex flex-col gap-1 shadow-sm hover:shadow-md transition-all duration-200 ${cfg.border}`}>
                <span className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full w-fit ${cfg.bg} ${cfg.text}`}>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                  {status}
                </span>
                <span className="text-3xl font-bold text-stone-800 mt-1 animate-count-up">{count}</span>
                <span className="text-xs text-stone-400">project{count !== 1 ? 's' : ''}</span>
              </div>
            );
          })
        )}
      </div>

      {activeProjects.length > 0 && (
        <div className="bg-white border border-emerald-200/80 rounded-xl overflow-hidden mb-5 shadow-sm hover:shadow-md transition-shadow duration-200">
          <div className="flex items-center justify-between px-4 py-3 border-b border-emerald-100 bg-emerald-50/60">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-sm font-semibold text-emerald-700">Active Projects</span>
            </div>
            <span className="text-xs text-emerald-500 font-medium bg-emerald-100 rounded-full px-2.5 py-0.5">{activeProjects.length} running</span>
          </div>
          <div className="divide-y divide-stone-50/80">
            {activeProjects.slice(0, 6).map((p: any) => (
              <Link key={p.id} to={`/projects/${p.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-stone-50/80 transition-all duration-150 group border-l-2 border-transparent hover:border-emerald-400">
                <div className="flex items-center gap-3 min-w-0">
                  <FolderOpen className="w-4 h-4 text-stone-300 shrink-0 group-hover:text-emerald-500 transition-colors" />
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="font-mono text-xs text-stone-400 shrink-0">{p.project_code}</span>
                    <span className="text-sm text-stone-600 group-hover:text-emerald-700 truncate transition-colors">{p.project_name}</span>
                  </div>
                </div>
                <StatusBadge status={p.project_status} />
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-stone-200/80 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 bg-stone-50/50">
          <span className="text-sm font-semibold text-stone-700">All Projects</span>
          <Link to="/projects" className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-medium transition-colors">
            View all <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="divide-y divide-stone-50/80">
          {isLoading ? (
            <SkeletonRows />
          ) : recent.length === 0 ? (
            <div className="px-4 py-10 flex flex-col items-center gap-2">
              <FolderOpen className="w-8 h-8 text-stone-200" />
              <span className="text-sm text-stone-400">No projects yet</span>
            </div>
          ) : (
            recent.map((p: any) => (
              <Link key={p.id} to={`/projects/${p.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-stone-50/80 transition-all duration-150 group border-l-2 border-transparent hover:border-emerald-400">
                <div className="min-w-0 flex items-center gap-2">
                  <span className="font-mono text-xs text-stone-400 shrink-0">{p.project_code}</span>
                  <span className="text-sm text-stone-600 group-hover:text-emerald-700 truncate transition-colors">{p.project_name}</span>
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
