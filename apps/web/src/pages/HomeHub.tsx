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
        card: 'hover:border-amber-400 hover:shadow-amber-100/60',
        iconBg: 'bg-amber-600',
        badge: 'bg-amber-50 text-amber-700 border border-amber-200',
        btn: 'bg-amber-600 hover:bg-amber-700',
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
        card: 'hover:border-blue-400 hover:shadow-blue-100/60',
        iconBg: 'bg-blue-600',
        badge: 'bg-blue-50 text-blue-700 border border-blue-200',
        btn: 'bg-blue-600 hover:bg-blue-700',
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
        card: 'hover:border-emerald-400 hover:shadow-emerald-100/60',
        iconBg: 'bg-emerald-600',
        badge: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
        btn: 'bg-emerald-600 hover:bg-emerald-700',
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
    <div className="min-h-full bg-[#fafaf9]">
      <div className="max-w-5xl mx-auto px-8 py-12">
        <div className="mb-10">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-2">
            Welcome back, {firstName}
          </p>
          <h1 className="text-3xl font-bold text-stone-800 tracking-tight">Shark OS</h1>
          <p className="text-stone-500 mt-1 text-sm">Choose a module to get started</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
          {modules.map(mod => {
            const Icon = mod.icon;
            return (
              <button
                key={mod.id}
                onClick={() => navigate(mod.href)}
                className={`text-left rounded-2xl border border-stone-200 bg-white shadow-sm hover:shadow-lg ${mod.accent.card} transition-all duration-200 p-6 group cursor-pointer flex flex-col`}
              >
                <div className={`w-12 h-12 rounded-xl ${mod.accent.iconBg} flex items-center justify-center mb-4 shadow-sm shrink-0`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <h2 className="text-base font-semibold text-stone-800 mb-2">{mod.title}</h2>
                <p className="text-sm text-stone-500 leading-relaxed mb-4 flex-1">{mod.description}</p>
                <div className="flex flex-wrap gap-2 mb-5">
                  {mod.stats.map(s => (
                    <span key={s.label} className={`text-xs font-semibold px-2.5 py-1 rounded-full ${mod.accent.badge}`}>
                      {s.value} {s.label}
                    </span>
                  ))}
                </div>
                <div className={`inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg text-white ${mod.accent.btn} transition-colors w-fit`}>
                  Open module <ArrowRight className="w-4 h-4" />
                </div>
              </button>
            );
          })}
        </div>

        <div className="border-t border-stone-200 pt-6">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-3">Quick Access</p>
          <div className="flex flex-wrap gap-2">
            {quickLinks.map(l => {
              const Icon = l.icon;
              return (
                <button
                  key={l.href}
                  onClick={() => navigate(l.href)}
                  className="flex items-center gap-2 text-sm text-stone-600 hover:text-amber-600 bg-white border border-stone-200 hover:border-amber-300 rounded-lg px-3 py-2 transition-all shadow-sm hover:shadow"
                >
                  <Icon className="w-3.5 h-3.5" />
                  {l.label}
                  <ChevronRight className="w-3.5 h-3.5 text-stone-300" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
