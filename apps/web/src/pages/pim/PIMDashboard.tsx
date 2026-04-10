import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { Package, Boxes, Pipette, Container, ArrowRight, ChevronLeft, ArrowUpRight } from 'lucide-react';
import StatusBadge from '../../components/ui/StatusBadge';

export default function PIMDashboard() {
  const navigate = useNavigate();

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get('/admin/stats').then(r => r.data),
  });

  const { data: productsData } = useQuery({
    queryKey: ['pim-products-recent'],
    queryFn: () => api.get('/product-masters?page_size=5').then(r => r.data),
  });

  const { data: componentsData } = useQuery({
    queryKey: ['pim-components-recent'],
    queryFn: () => api.get('/components?page_size=5').then(r => r.data),
  });

  const { data: pipingData } = useQuery({
    queryKey: ['pim-piping-recent'],
    queryFn: () => api.get('/product-masters?category=Piping&page_size=5').then(r => r.data),
  });

  const { data: tanksData } = useQuery({
    queryKey: ['pim-tanks-recent'],
    queryFn: () => api.get('/tank-families').then(r => r.data),
  });

  const sections = [
    {
      id: 'products',
      label: 'Products',
      href: '/products/masters',
      icon: Package,
      color: 'text-amber-600 bg-amber-50 border-amber-200',
      count: stats?.products ?? '—',
      items: (productsData?.items ?? []).slice(0, 5),
      renderRow: (item: any) => (
        <Link key={item.id} to={`/products/masters/${item.id}`}
          className="flex items-center justify-between px-4 py-2.5 hover:bg-stone-50 transition-colors group">
          <div className="min-w-0">
            <span className="font-mono text-xs text-stone-400 mr-2">{item.product_code}</span>
            <span className="text-sm text-stone-700 group-hover:text-amber-600 truncate">{item.product_name}</span>
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
      color: 'text-indigo-600 bg-indigo-50 border-indigo-200',
      count: stats?.components ?? '—',
      items: (componentsData?.items ?? []).slice(0, 5),
      renderRow: (item: any) => (
        <Link key={item.id} to={`/products/components/${item.id}`}
          className="flex items-center justify-between px-4 py-2.5 hover:bg-stone-50 transition-colors group">
          <div className="min-w-0">
            <span className="font-mono text-xs text-stone-400 mr-2">{item.component_code}</span>
            <span className="text-sm text-stone-700 group-hover:text-indigo-600 truncate">{item.component_name}</span>
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
      color: 'text-cyan-600 bg-cyan-50 border-cyan-200',
      count: pipingData?.total ?? pipingData?.items?.length ?? '—',
      items: (pipingData?.items ?? []).slice(0, 5),
      renderRow: (item: any) => (
        <Link key={item.id} to={`/products/masters/${item.id}`}
          className="flex items-center justify-between px-4 py-2.5 hover:bg-stone-50 transition-colors group">
          <div className="min-w-0">
            <span className="font-mono text-xs text-stone-400 mr-2">{item.product_code}</span>
            <span className="text-sm text-stone-700 group-hover:text-cyan-600 truncate">{item.product_name}</span>
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
      color: 'text-teal-600 bg-teal-50 border-teal-200',
      count: tanksData?.items?.length ?? '—',
      items: (tanksData?.items ?? []).slice(0, 5),
      renderRow: (item: any) => (
        <div key={item.id}
          className="flex items-center justify-between px-4 py-2.5 hover:bg-stone-50 transition-colors">
          <div className="min-w-0">
            <span className="font-mono text-xs text-stone-400 mr-2">{item.code}</span>
            <span className="text-sm text-stone-700 truncate">{item.name}</span>
          </div>
          {item.product_count !== undefined && (
            <span className="text-xs text-stone-400">{item.product_count} products</span>
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
          className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-amber-600 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Home
        </button>
        <span className="text-stone-300">/</span>
        <span className="text-sm text-stone-600 font-medium">PIM Management</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800 mb-1">PIM Management</h1>
          <p className="text-stone-500 text-sm">Product Information Management — master catalog overview</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {sections.map(sec => {
          const Icon = sec.icon;
          return (
            <div key={sec.id} className="bg-white border border-stone-200 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100">
                <div className="flex items-center gap-2.5">
                  <div className={`w-7 h-7 rounded-lg border flex items-center justify-center ${sec.color}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-semibold text-stone-700">{sec.label}</span>
                  <span className="text-xs font-bold text-stone-400 bg-stone-100 rounded-full px-2 py-0.5">{sec.count}</span>
                </div>
                <Link
                  to={sec.href}
                  className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-medium"
                >
                  View all <ArrowUpRight className="w-3 h-3" />
                </Link>
              </div>
              <div className="divide-y divide-stone-50">
                {sec.items.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-stone-400 text-center">No items yet</div>
                ) : (
                  sec.items.map((item: any) => sec.renderRow(item))
                )}
              </div>
              <div className="px-4 py-2.5 bg-stone-50 border-t border-stone-100">
                <Link
                  to={sec.href}
                  className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-amber-600 font-medium transition-colors"
                >
                  Go to {sec.label} <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
