import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { Package, Boxes, Pipette, Container, ArrowRight, ChevronLeft, ArrowUpRight } from 'lucide-react';
import StatusBadge from '../../components/ui/StatusBadge';

function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div className="divide-y divide-stone-50">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="skeleton h-3 w-16 shrink-0" />
            <div className="skeleton h-3 w-32" />
          </div>
          <div className="skeleton h-5 w-16 rounded-full shrink-0" />
        </div>
      ))}
    </div>
  );
}

export default function PIMDashboard() {
  const navigate = useNavigate();

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get('/admin/stats').then(r => r.data),
  });

  const { data: productsData, isLoading: loadingProducts } = useQuery({
    queryKey: ['pim-products-recent'],
    queryFn: () => api.get('/product-masters?page_size=5').then(r => r.data),
  });

  const { data: componentsData, isLoading: loadingComponents } = useQuery({
    queryKey: ['pim-components-recent'],
    queryFn: () => api.get('/components?page_size=5').then(r => r.data),
  });

  const { data: pipingData, isLoading: loadingPiping } = useQuery({
    queryKey: ['pim-piping-recent'],
    queryFn: () => api.get('/product-masters?category=Piping&page_size=5').then(r => r.data),
  });

  const { data: tanksData, isLoading: loadingTanks } = useQuery({
    queryKey: ['pim-tanks-recent'],
    queryFn: () => api.get('/tank-families').then(r => r.data),
  });

  const sections = [
    {
      id: 'products',
      label: 'Products',
      href: '/products/masters',
      icon: Package,
      color: 'text-amber-600',
      iconBg: 'from-amber-500 to-amber-700',
      iconShadow: 'shadow-amber-600/30',
      headerBg: 'bg-amber-50/50',
      count: stats?.products ?? '—',
      isLoading: loadingProducts,
      items: (productsData?.items ?? []).slice(0, 5),
      renderRow: (item: any) => (
        <Link key={item.id} to={`/products/masters/${item.id}`}
          className="flex items-center justify-between px-4 py-2.5 hover:bg-stone-50/80 transition-all duration-150 group border-l-2 border-transparent hover:border-amber-400">
          <div className="min-w-0 flex items-center gap-2">
            <span className="font-mono text-xs text-stone-400">{item.product_code}</span>
            <span className="text-sm text-stone-600 group-hover:text-amber-700 truncate transition-colors">{item.product_name}</span>
          </div>
          <StatusBadge status={item.standard_status} />
        </Link>
      ),
    },
    {
      id: 'components',
      label: 'Components',
      href: '/products/components',
      icon: Boxes,
      color: 'text-indigo-600',
      iconBg: 'from-indigo-500 to-indigo-700',
      iconShadow: 'shadow-indigo-600/30',
      headerBg: 'bg-indigo-50/50',
      count: stats?.components ?? '—',
      isLoading: loadingComponents,
      items: (componentsData?.items ?? []).slice(0, 5),
      renderRow: (item: any) => (
        <Link key={item.id} to={`/products/components/${item.id}`}
          className="flex items-center justify-between px-4 py-2.5 hover:bg-stone-50/80 transition-all duration-150 group border-l-2 border-transparent hover:border-indigo-400">
          <div className="min-w-0 flex items-center gap-2">
            <span className="font-mono text-xs text-stone-400">{item.component_code}</span>
            <span className="text-sm text-stone-600 group-hover:text-indigo-700 truncate transition-colors">{item.component_name}</span>
          </div>
          <StatusBadge status={item.status} />
        </Link>
      ),
    },
    {
      id: 'piping',
      label: 'Pipes & Fittings',
      href: '/products/piping',
      icon: Pipette,
      color: 'text-cyan-600',
      iconBg: 'from-cyan-500 to-cyan-700',
      iconShadow: 'shadow-cyan-600/30',
      headerBg: 'bg-cyan-50/50',
      count: pipingData?.total ?? pipingData?.items?.length ?? '—',
      isLoading: loadingPiping,
      items: (pipingData?.items ?? []).slice(0, 5),
      renderRow: (item: any) => (
        <Link key={item.id} to={`/products/masters/${item.id}`}
          className="flex items-center justify-between px-4 py-2.5 hover:bg-stone-50/80 transition-all duration-150 group border-l-2 border-transparent hover:border-cyan-400">
          <div className="min-w-0 flex items-center gap-2">
            <span className="font-mono text-xs text-stone-400">{item.product_code}</span>
            <span className="text-sm text-stone-600 group-hover:text-cyan-700 truncate transition-colors">{item.product_name}</span>
          </div>
          <StatusBadge status={item.standard_status} />
        </Link>
      ),
    },
    {
      id: 'tanks',
      label: 'Tanks',
      href: '/products/tanks',
      icon: Container,
      color: 'text-teal-600',
      iconBg: 'from-teal-500 to-teal-700',
      iconShadow: 'shadow-teal-600/30',
      headerBg: 'bg-teal-50/50',
      count: tanksData?.items?.length ?? '—',
      isLoading: loadingTanks,
      items: (tanksData?.items ?? []).slice(0, 5),
      renderRow: (item: any) => (
        <div key={item.id}
          className="flex items-center justify-between px-4 py-2.5 hover:bg-stone-50/80 transition-all duration-150 border-l-2 border-transparent hover:border-teal-400">
          <div className="min-w-0 flex items-center gap-2">
            <span className="font-mono text-xs text-stone-400">{item.code}</span>
            <span className="text-sm text-stone-600 truncate">{item.name}</span>
          </div>
          {item.product_count !== undefined && (
            <span className="text-xs text-stone-400 bg-stone-100 rounded-full px-2 py-0.5">{item.product_count} products</span>
          )}
        </div>
      ),
    },
  ];

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
        <span className="text-sm text-stone-600 font-medium">PIM Management</span>
      </div>

      <div className="flex items-start justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold text-stone-800 mb-1">PIM Management</h1>
          <p className="text-stone-400 text-sm">Product Information Management — master catalog overview</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {sections.map(sec => {
          const Icon = sec.icon;
          return (
            <div key={sec.id} className="bg-white border border-stone-200/80 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-200">
              <div className={`flex items-center justify-between px-4 py-3 border-b border-stone-100 ${sec.headerBg}`}>
                <div className="flex items-center gap-2.5">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center bg-gradient-to-br ${sec.iconBg} shadow-md ${sec.iconShadow}`}>
                    <Icon className="w-3.5 h-3.5 text-white" />
                  </div>
                  <span className="text-sm font-semibold text-stone-700">{sec.label}</span>
                  <span className={`text-xs font-bold rounded-full px-2 py-0.5 ${sec.color} bg-white border border-current/20`}>
                    {sec.count}
                  </span>
                </div>
                <Link
                  to={sec.href}
                  className={`flex items-center gap-1 text-xs ${sec.color} hover:opacity-70 font-medium transition-opacity`}
                >
                  View all <ArrowUpRight className="w-3 h-3" />
                </Link>
              </div>

              <div className="divide-y divide-stone-50/80">
                {sec.isLoading ? (
                  <SkeletonRows />
                ) : sec.items.length === 0 ? (
                  <div className="px-4 py-8 flex flex-col items-center gap-2">
                    <Icon className="w-8 h-8 text-stone-200" />
                    <span className="text-sm text-stone-400">No items yet</span>
                  </div>
                ) : (
                  sec.items.map((item: any) => sec.renderRow(item))
                )}
              </div>

              <div className="px-4 py-2.5 bg-stone-50/60 border-t border-stone-100">
                <Link
                  to={sec.href}
                  className={`flex items-center gap-1.5 text-xs text-stone-400 hover:${sec.color} font-medium transition-colors duration-150 group`}
                >
                  Go to {sec.label}
                  <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform duration-150" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
