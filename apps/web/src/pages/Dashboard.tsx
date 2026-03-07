import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import StatusBadge from '../components/ui/StatusBadge';
import { useAuthStore } from '../store/authStore';
import {
  FolderOpen, Package, Network, ArrowRight, FileSearch, Wrench, FileCheck, Award,
  Boxes, FileText, Plus, Trash2, CheckSquare, Square, Clock, ChevronUp, ChevronDown,
  X, LayoutDashboard, Eye
} from 'lucide-react';

type CardState = 'visible' | 'minimized' | 'hidden';
type Prefs = Record<string, CardState>;

const STORAGE_KEY = (userId: string) => `edp_dash_prefs_${userId}`;

function useCardPrefs(userId: string | undefined) {
  const [prefs, setPrefsState] = useState<Prefs>(() => {
    if (!userId) return {};
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY(userId)) || '{}'); }
    catch { return {}; }
  });

  const setPrefs = (p: Prefs) => {
    setPrefsState(p);
    if (userId) localStorage.setItem(STORAGE_KEY(userId), JSON.stringify(p));
  };

  const state = (id: string): CardState => prefs[id] || 'visible';
  const update = (id: string, s: CardState) => setPrefs({ ...prefs, [id]: s });

  return { prefs, state, update, setPrefs };
}

function DashboardCard({
  id, title, badge, headerRight, children, state, onUpdate, className = '',
}: {
  id: string; title: React.ReactNode; badge?: React.ReactNode;
  headerRight?: React.ReactNode; children: React.ReactNode;
  state: CardState; onUpdate: (s: CardState) => void; className?: string;
}) {
  if (state === 'hidden') return null;
  const minimized = state === 'minimized';
  return (
    <div className={`bg-white border border-slate-200 rounded-lg ${className}`}>
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 group">
        <span className="text-sm font-medium text-slate-700 flex items-center gap-2 flex-1">
          {title}{badge}
        </span>
        {!minimized && headerRight}
        <button
          onClick={() => onUpdate(minimized ? 'visible' : 'minimized')}
          title={minimized ? 'Expand' : 'Minimize'}
          className="text-slate-300 hover:text-slate-500 transition-colors"
        >
          {minimized ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={() => onUpdate('hidden')}
          title="Remove card"
          className="text-slate-300 hover:text-red-400 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {!minimized && children}
    </div>
  );
}

const docTypeIcon = (type: string) => {
  switch (type) {
    case 'Technical Data Sheet': return <FileSearch className="w-3.5 h-3.5 text-blue-500" />;
    case 'O&M Manual': return <Wrench className="w-3.5 h-3.5 text-amber-500" />;
    case 'Certificate': return <Award className="w-3.5 h-3.5 text-purple-500" />;
    case 'Test Report': return <FileCheck className="w-3.5 h-3.5 text-red-500" />;
    default: return <FileText className="w-3.5 h-3.5 text-slate-400" />;
  }
};

const typeHref = (type: string, id: string) => {
  if (type === 'Project') return `/projects/${id}`;
  if (type === 'Product') return `/products/masters/${id}`;
  if (type === 'Document') return `/documents/${id}`;
  return '#';
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
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [todoInput, setTodoInput] = useState('');
  const [showManage, setShowManage] = useState(false);
  const isPrivileged = user?.role === 'admin' || user?.role === 'engineer';

  const { prefs, state, update, setPrefs } = useCardPrefs(user?.id);

  useEffect(() => {
    if (!user?.id) return;
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY(user.id)) || '{}');
      setPrefs(stored);
    } catch {}
  }, [user?.id]);

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get('/admin/stats').then(r => r.data),
  });

  const { data: projects } = useQuery({
    queryKey: ['recent-projects'],
    queryFn: () => api.get('/projects?page_size=5').then(r => r.data),
  });

  const { data: approvalsData } = useQuery({
    queryKey: ['pending-approvals'],
    queryFn: () => api.get('/admin/pending-approvals').then(r => r.data),
    enabled: isPrivileged,
  });

  const { data: todosData } = useQuery({
    queryKey: ['todos'],
    queryFn: () => api.get('/admin/todos').then(r => r.data),
  });

  const addTodo = useMutation({
    mutationFn: (text: string) => api.post('/admin/todos', { text }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['todos'] }); setTodoInput(''); },
  });
  const toggleTodo = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => api.patch(`/admin/todos/${id}`, { done }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['todos'] }),
  });
  const deleteTodo = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/todos/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['todos'] }),
  });

  const statCards = [
    { label: 'Projects', value: stats?.projects, icon: FolderOpen, href: '/projects', color: 'bg-blue-50 text-blue-600 border-blue-100' },
    { label: 'Products', value: stats?.products, icon: Package, href: '/products/masters', color: 'bg-green-50 text-green-600 border-green-100' },
    { label: 'Components', value: stats?.components, icon: Boxes, href: '/products/components', color: 'bg-indigo-50 text-indigo-600 border-indigo-100' },
  ];

  const docByStatus: { status: string; count: string }[] = stats?.document_by_status || [];
  const docTotal = docByStatus.reduce((s, r) => s + parseInt(r.count), 0) || 1;
  const recentDocs = stats?.recent_documents || [];
  const approvals: any[] = approvalsData?.items || [];
  const todos: any[] = todosData?.items || [];
  const pendingTodos = todos.filter(t => !t.done);
  const doneTodos = todos.filter(t => t.done);

  const quickLinks = [
    { to: '/graph', label: 'Graph Explorer', sub: 'Trace entity relationships' },
    { to: '/products/masters', label: 'ASW Library', sub: 'Reusable product definitions' },
    { to: '/documents', label: 'Document Register', sub: 'Controlled files & revisions' },
    { to: '/knowledge/design-rules', label: 'Design Rules', sub: 'Engineering standards' },
    { to: '/admin/import', label: 'CSV Import', sub: 'Bulk data loading' },
  ];

  type CardDef = { id: string; label: string; adminOnly?: boolean };
  const allCards: CardDef[] = [
    { id: 'stat-counts', label: 'Statistics (Projects / Products / Components)' },
    { id: 'doc-status', label: 'Document Status' },
    { id: 'recent-docs', label: 'Recent Documents' },
    { id: 'recent-projects', label: 'Recent Projects' },
    { id: 'quick-links', label: 'Quick Links' },
    { id: 'pending-approvals', label: 'Pending Approvals', adminOnly: true },
    { id: 'todos', label: 'To-Do' },
  ];

  const hiddenCards = allCards.filter(c => {
    if (c.adminOnly && !isPrivileged) return false;
    return state(c.id) === 'hidden';
  });

  const docStatusHidden = state('doc-status') === 'hidden';
  const recentDocsHidden = state('recent-docs') === 'hidden';
  const recentProjectsHidden = state('recent-projects') === 'hidden';
  const quickLinksHidden = state('quick-links') === 'hidden';
  const approvalsHidden = state('pending-approvals') === 'hidden';
  const todosHidden = state('todos') === 'hidden';

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800 mb-1">Dashboard</h1>
          <p className="text-slate-500 text-sm">Engineering Data Platform overview</p>
        </div>
        <div className="relative">
          <button
            onClick={() => setShowManage(v => !v)}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-[#3E5C76] border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors"
          >
            <LayoutDashboard className="w-4 h-4" />
            Customize
            {hiddenCards.length > 0 && (
              <span className="bg-[#3E5C76] text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {hiddenCards.length}
              </span>
            )}
          </button>

          {showManage && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-700">Manage Dashboard Cards</span>
                <button onClick={() => setShowManage(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {hiddenCards.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-3">All cards are visible</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Hidden cards</p>
                  {hiddenCards.map(c => (
                    <div key={c.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50">
                      <span className="text-sm text-slate-700">{c.label}</span>
                      <button
                        onClick={() => update(c.id, 'visible')}
                        className="flex items-center gap-1 text-xs text-[#3E5C76] hover:underline font-medium"
                      >
                        <Eye className="w-3.5 h-3.5" /> Show
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 pt-3 border-t border-slate-100">
                <button
                  onClick={() => { setPrefs({}); setShowManage(false); }}
                  className="text-xs text-slate-400 hover:text-slate-600 hover:underline"
                >
                  Reset all to default
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {state('stat-counts') !== 'hidden' && (
        <div className="mb-6">
          {state('stat-counts') === 'minimized' ? (
            <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex items-center gap-2">
              <span className="text-sm font-medium text-slate-700 flex-1">Statistics</span>
              <button onClick={() => update('stat-counts', 'visible')} className="text-slate-300 hover:text-slate-500"><ChevronDown className="w-3.5 h-3.5" /></button>
              <button onClick={() => update('stat-counts', 'hidden')} className="text-slate-300 hover:text-red-400"><X className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <div className="relative">
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                {statCards.map(({ label, value, icon: Icon, href, color }) => (
                  <Link key={label} to={href} className={`rounded-lg border p-4 hover:shadow-sm transition-shadow ${color}`}>
                    <Icon className="w-5 h-5 mb-2" />
                    <div className="text-2xl font-bold">{value ?? '—'}</div>
                    <div className="text-xs font-medium mt-0.5 opacity-80">{label}</div>
                  </Link>
                ))}
              </div>
              <div className="absolute top-2 right-2 flex gap-1">
                <button onClick={() => update('stat-counts', 'minimized')} className="text-slate-300 hover:text-slate-500 bg-white/80 rounded p-0.5"><ChevronUp className="w-3.5 h-3.5" /></button>
                <button onClick={() => update('stat-counts', 'hidden')} className="text-slate-300 hover:text-red-400 bg-white/80 rounded p-0.5"><X className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          )}
        </div>
      )}

      {(!docStatusHidden || !recentDocsHidden) && (
        <div className={`grid grid-cols-1 gap-5 mb-5 ${!docStatusHidden && !recentDocsHidden ? 'md:grid-cols-3' : ''}`}>
          {!docStatusHidden && (
            <DashboardCard id="doc-status" title="Document Status" state={state('doc-status')} onUpdate={s => update('doc-status', s)}
              className={!recentDocsHidden ? 'md:col-span-1' : ''}>
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
                          <div className={`h-1.5 rounded-full ${STATUS_COLORS[row.status] || 'bg-slate-300'}`}
                            style={{ width: `${(parseInt(row.count) / docTotal) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )
              }
            </DashboardCard>
          )}
          {!recentDocsHidden && (
            <DashboardCard id="recent-docs" title="Recent Documents" state={state('recent-docs')} onUpdate={s => update('recent-docs', s)}
              className={!docStatusHidden ? 'md:col-span-2' : ''}
              headerRight={<Link to="/documents" className="text-xs text-[#3E5C76] hover:underline">View all</Link>}>
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
            </DashboardCard>
          )}
        </div>
      )}

      {(!recentProjectsHidden || !quickLinksHidden) && (
        <div className={`grid grid-cols-1 gap-5 mb-5 ${!recentProjectsHidden && !quickLinksHidden ? 'md:grid-cols-2' : ''}`}>
          {!recentProjectsHidden && (
            <DashboardCard id="recent-projects" title="Recent Projects" state={state('recent-projects')} onUpdate={s => update('recent-projects', s)}
              headerRight={<Link to="/projects" className="text-xs text-[#3E5C76] hover:underline">View all</Link>}>
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
            </DashboardCard>
          )}
          {!quickLinksHidden && (
            <DashboardCard id="quick-links" title="Quick Links" state={state('quick-links')} onUpdate={s => update('quick-links', s)}>
              <div className="p-4">
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
            </DashboardCard>
          )}
        </div>
      )}

      {(isPrivileged || !todosHidden) && (!approvalsHidden || !todosHidden) && (
        <div className={`grid grid-cols-1 gap-5 ${isPrivileged && !approvalsHidden && !todosHidden ? 'md:grid-cols-2' : ''}`}>
          {isPrivileged && !approvalsHidden && (
            <DashboardCard
              id="pending-approvals"
              title={<><Clock className="w-4 h-4 text-amber-500" />Pending Approvals</>}
              badge={approvals.length > 0 ? (
                <span className="bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-0.5 rounded-full">{approvals.length}</span>
              ) : undefined}
              state={state('pending-approvals')} onUpdate={s => update('pending-approvals', s)}
            >
              {approvals.length === 0 ? (
                <div className="p-4 text-sm text-slate-400">Nothing pending — all clear</div>
              ) : (
                <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                  {approvals.map((item: any) => (
                    <Link key={item.id} to={typeHref(item.type, item.id)} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                      <span className="text-xs font-medium bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded shrink-0">{item.type}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-xs text-slate-400">{item.code}</div>
                        <div className="text-sm text-slate-800 truncate">{item.name}</div>
                      </div>
                      <StatusBadge status={item.status} />
                    </Link>
                  ))}
                </div>
              )}
            </DashboardCard>
          )}

          {!todosHidden && (
            <DashboardCard
              id="todos"
              title={<><CheckSquare className="w-4 h-4 text-[#3E5C76]" />To-Do</>}
              badge={pendingTodos.length > 0 ? (
                <span className="bg-[#3E5C76]/10 text-[#3E5C76] text-xs font-semibold px-2 py-0.5 rounded-full">{pendingTodos.length}</span>
              ) : undefined}
              state={state('todos')} onUpdate={s => update('todos', s)}
              className={!isPrivileged || approvalsHidden ? 'md:col-span-full' : ''}
            >
              <div className="p-3">
                <form onSubmit={e => { e.preventDefault(); if (todoInput.trim()) addTodo.mutate(todoInput); }} className="flex gap-2 mb-3">
                  <input value={todoInput} onChange={e => setTodoInput(e.target.value)} placeholder="Add a task..."
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#3E5C76]/30" />
                  <button type="submit" disabled={!todoInput.trim() || addTodo.isPending}
                    className="bg-[#3E5C76] text-white px-3 py-1.5 rounded-lg text-sm hover:bg-[#2d4a63] disabled:opacity-40 flex items-center gap-1">
                    <Plus className="w-4 h-4" />
                  </button>
                </form>
                <div className="space-y-1 max-h-56 overflow-y-auto">
                  {todos.length === 0 && <p className="text-sm text-slate-400 px-1 py-2">No tasks yet — add one above</p>}
                  {pendingTodos.map(t => (
                    <div key={t.id} className="flex items-center gap-2 group px-1 py-1.5 rounded hover:bg-slate-50">
                      <button onClick={() => toggleTodo.mutate({ id: t.id, done: true })} className="text-slate-300 hover:text-[#3E5C76] shrink-0">
                        <Square className="w-4 h-4" />
                      </button>
                      <span className="flex-1 text-sm text-slate-700">{t.text}</span>
                      <button onClick={() => deleteTodo.mutate(t.id)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {doneTodos.length > 0 && (
                    <>
                      <div className="text-xs text-slate-400 uppercase tracking-wide px-1 pt-2 pb-1">Done</div>
                      {doneTodos.map(t => (
                        <div key={t.id} className="flex items-center gap-2 group px-1 py-1.5 rounded hover:bg-slate-50">
                          <button onClick={() => toggleTodo.mutate({ id: t.id, done: false })} className="text-[#3E5C76] shrink-0">
                            <CheckSquare className="w-4 h-4" />
                          </button>
                          <span className="flex-1 text-sm text-slate-400 line-through">{t.text}</span>
                          <button onClick={() => deleteTodo.mutate(t.id)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 shrink-0">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </DashboardCard>
          )}
        </div>
      )}
    </div>
  );
}
