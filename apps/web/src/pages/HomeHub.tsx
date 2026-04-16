import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import api from '../lib/api';
import { Package, ShoppingCart, FolderOpen, ArrowRight, ChevronRight, Network, FileText, Search, Ruler } from 'lucide-react';

export default function HomeHub() {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get('/admin/stats').then(r => r.data),
  });

  const { data: posData } = useQuery({
    queryKey: ['po-summary'],
    queryFn: () => api.get('/purchase-orders?page_size=200').then(r => r.data),
  });

  const poTotal = posData?.total ?? posData?.items?.length ?? 0;
  const activeStatuses = ['pending_approval', 'purchase_order', 'po_review', 'engineering_review'];
  const activePOs = posData?.items?.filter((p: any) => activeStatuses.includes(p.status)).length ?? 0;

  const firstName = user?.firstName || user?.email?.split('@')[0] || 'there';

  const modules = [
    {
      id: 'pim',
      href: '/pim',
      icon: Package,
      title: 'PIM Management',
      description: 'Master catalog for products, components, pipes & fittings and tanks across all projects.',
      accent: {
        glow: 'hover:shadow-amber-100/80',
        border: 'hover:border-amber-300/60',
        iconGradient: 'from-amber-500 to-amber-700',
        iconShadow: 'shadow-amber-600/30',
        badge: 'bg-amber-50 text-amber-700 border border-amber-200/80',
        badgeDot: 'bg-amber-500',
        btn: 'from-amber-500 to-amber-700 hover:from-amber-600 hover:to-amber-800 shadow-amber-600/25',
        topBar: 'from-amber-400/20 to-transparent',
      },
      stats: [
        { label: 'Products', value: stats?.products ?? '—' },
        { label: 'Components', value: stats?.components ?? '—' },
      ],
    },
    {
      id: 'orders',
      href: '/order-management',
      icon: ShoppingCart,
      title: 'Order Management',
      description: 'Track purchase orders through drafting, approval, engineering review and release.',
      accent: {
        glow: 'hover:shadow-blue-100/80',
        border: 'hover:border-blue-300/60',
        iconGradient: 'from-blue-500 to-blue-700',
        iconShadow: 'shadow-blue-600/30',
        badge: 'bg-blue-50 text-blue-700 border border-blue-200/80',
        badgeDot: 'bg-blue-500',
        btn: 'from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800 shadow-blue-600/25',
        topBar: 'from-blue-400/20 to-transparent',
      },
      stats: [
        { label: 'Total POs', value: poTotal },
        { label: 'In Progress', value: activePOs },
      ],
    },
    {
      id: 'projects',
      href: '/project-management',
      icon: FolderOpen,
      title: 'Project Management',
      description: 'Manage active projects, systems, equipment lists and engineering deliverables.',
      accent: {
        glow: 'hover:shadow-emerald-100/80',
        border: 'hover:border-emerald-300/60',
        iconGradient: 'from-emerald-500 to-emerald-700',
        iconShadow: 'shadow-emerald-600/30',
        badge: 'bg-emerald-50 text-emerald-700 border border-emerald-200/80',
        badgeDot: 'bg-emerald-500',
        btn: 'from-emerald-500 to-emerald-700 hover:from-emerald-600 hover:to-emerald-800 shadow-emerald-600/25',
        topBar: 'from-emerald-400/20 to-transparent',
      },
      stats: [
        { label: 'Projects', value: stats?.projects ?? '—' },
      ],
    },
  ];

  const quickLinks = [
    { label: 'Graph Explorer', href: '/graph', icon: Network },
    { label: 'Documents', href: '/documents', icon: FileText },
    { label: 'Search', href: '/search', icon: Search },
    { label: 'Design Rules', href: '/knowledge/design-rules', icon: Ruler },
  ];

  return (
    <div className="min-h-full" style={{ background: 'linear-gradient(160deg, #fafaf9 0%, #f5f3f0 100%)' }}>
      <div className="max-w-5xl mx-auto px-8 py-12">
        <div className="mb-10 animate-fade-in-up">
          <p className="text-xs font-bold text-stone-400 uppercase tracking-[0.15em] mb-2">
            Welcome back, {firstName}
          </p>
          <h1 className="text-3xl font-bold tracking-tight"
            style={{ background: 'linear-gradient(135deg, #1c1917 0%, #44403c 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Shark OS
          </h1>
          <p className="text-stone-400 mt-1 text-sm">Choose a module to get started</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
          {modules.map((mod, i) => {
            const Icon = mod.icon;
            return (
              <button
                key={mod.id}
                onClick={() => navigate(mod.href)}
                style={{ animationDelay: `${i * 60}ms` }}
                className={`animate-fade-in-up text-left rounded-2xl border border-stone-200/80 bg-white/80 backdrop-blur-sm shadow-sm hover:shadow-xl ${mod.accent.glow} ${mod.accent.border} transition-all duration-300 p-6 group cursor-pointer flex flex-col active:scale-[0.98] overflow-hidden relative`}
              >
                <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r ${mod.accent.topBar}`} />

                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${mod.accent.iconGradient} flex items-center justify-center mb-4 shadow-lg ${mod.accent.iconShadow} shrink-0 group-hover:scale-105 group-hover:shadow-xl transition-all duration-300`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>

                <h2 className="text-base font-semibold text-stone-800 mb-2 group-hover:text-stone-900 transition-colors">{mod.title}</h2>
                <p className="text-sm text-stone-400 leading-relaxed mb-4 flex-1">{mod.description}</p>

                <div className="flex flex-wrap gap-2 mb-5">
                  {mod.stats.map(s => (
                    <span key={s.label} className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${mod.accent.badge}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${mod.accent.badgeDot} shrink-0`} />
                      {s.value} {s.label}
                    </span>
                  ))}
                </div>

                <div className={`inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg text-white bg-gradient-to-r ${mod.accent.btn} transition-all duration-200 w-fit shadow-md group-hover:shadow-lg group-hover:gap-3`}>
                  Open module
                  <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" />
                </div>
              </button>
            );
          })}
        </div>

        <div className="border-t border-stone-200/60 pt-6 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
          <p className="text-xs font-bold text-stone-400 uppercase tracking-[0.15em] mb-3">Quick Access</p>
          <div className="flex flex-wrap gap-2">
            {quickLinks.map(l => {
              const Icon = l.icon;
              return (
                <button
                  key={l.href}
                  onClick={() => navigate(l.href)}
                  className="flex items-center gap-2 text-sm text-stone-500 hover:text-amber-600 bg-white/80 border border-stone-200/80 hover:border-amber-300/60 rounded-lg px-3 py-2 transition-all duration-200 shadow-sm hover:shadow active:scale-95 group"
                >
                  <Icon className="w-3.5 h-3.5 group-hover:scale-110 transition-transform duration-150" />
                  {l.label}
                  <ChevronRight className="w-3.5 h-3.5 text-stone-300 group-hover:text-amber-400 group-hover:translate-x-0.5 transition-all duration-150" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
