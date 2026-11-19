import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import api from '../lib/api';
import {
  Package, ShoppingCart, FolderOpen, ArrowRight, ChevronRight,
  Network, FileText, Search, Ruler, BookOpen, BookMarked, Plus, X, Settings,
  Users, LayoutGrid, GitBranch, Layers, Wrench, Keyboard, ClipboardCheck, PencilRuler,
} from 'lucide-react';
import ShortcutMapModal from '../components/ui/ShortcutMapModal';
import MyWorkPlanner from './my-work/MyWorkPlanner';
import { NeedsAttentionPanel, RecentRecordsPanel } from './home/HomePanels';
import { moduleForPath, ROUTES } from '../lib/navigation';
import { supportError } from '../lib/supportError';

const ALL_QUICK_LINKS = [
  { label: 'Graph Explorer',  href: ROUTES.graph,               icon: 'Network'      },
  { label: 'Documents',       href: ROUTES.documents,           icon: 'FileText'     },
  { label: 'Search',          href: ROUTES.search,              icon: 'Search'       },
  { label: 'My Work',         href: '/my-work',                  icon: 'ClipboardCheck' },
  { label: 'Design Rules',    href: ROUTES.designRules,         icon: 'Ruler'        },
  { label: 'Purchase Orders', href: ROUTES.purchaseOrders,      icon: 'ShoppingCart' },
  { label: 'Products',        href: ROUTES.products,            icon: 'Package'      },
  { label: 'Projects',        href: ROUTES.projects,            icon: 'FolderOpen'   },
  { label: 'PIM',             href: ROUTES.pim,                 icon: 'Layers'       },
  { label: 'Components',      href: ROUTES.components,          icon: 'Wrench'       },
  { label: 'Design Books',    href: ROUTES.designBooks,         icon: 'BookMarked'   },
  { label: 'Admin',           href: ROUTES.admin,               icon: 'Settings'     },
  { label: 'Admin Users',     href: '/admin/users',             icon: 'Users'        },
  { label: 'System Types',    href: '/admin/system-types',      icon: 'GitBranch'    },
];

const ICON_MAP: Record<string, any> = {
  Network, FileText, Search, Ruler, ShoppingCart, Package, ClipboardCheck,
  FolderOpen, Layers, Wrench, Settings, Users, GitBranch, BookMarked,
};

const DEFAULT_HREFS = ['/graph', '/documents', '/search', '/knowledge/design-rules'];
const LS_KEY = 'shark_quick_links';

function loadSaved(): string[] {
  try {
    const v = localStorage.getItem(LS_KEY);
    const saved = v ? JSON.parse(v) : DEFAULT_HREFS;
    const routeAliases: Record<string, string> = {
      '/pim/products': '/products/masters',
      '/pim/components': '/products/components',
      '/project-management': '/projects',
    };
    return Array.isArray(saved) ? saved.map(href => routeAliases[href] ?? href) : DEFAULT_HREFS;
  } catch {
    return DEFAULT_HREFS;
  }
}

export default function HomeHub() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const canSeeModule = (key: string | null) => {
    if (!key) return true;
     if (key === 'admin') return user?.role === 'admin';
    return user?.moduleAccess?.[key] !== 'hidden';
  };
  const [pinnedHrefs, setPinnedHrefs] = useState<string[]>(loadSaved);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [shortcutMapOpen, setShortcutMapOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(pinnedHrefs));
  }, [pinnedHrefs]);

  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pickerOpen]);

  const addLink = (href: string) => {
    setPinnedHrefs(prev => prev.includes(href) ? prev : [...prev, href]);
    setPickerOpen(false);
  };

  const removeLink = (href: string) => {
    setPinnedHrefs(prev => prev.filter(h => h !== href));
  };

  const { data: stats, isError: statsError, error: statsFailure, refetch: retryStats } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get('/admin/stats').then(r => r.data),
  });

  const { data: posData, isError: posError, error: posFailure, refetch: retryPos } = useQuery({
    queryKey: ['po-summary'],
    queryFn: () => api.get('/purchase-orders?page_size=1').then(r => r.data),
    enabled: canSeeModule('orders'),
  });
  const { data: workData, isError: workError, error: workFailure, refetch: retryWork } = useQuery({
    queryKey: ['work-summary', 'orders'],
    queryFn: () => api.get('/search/my-work?module=orders&page_size=1').then(r => r.data),
    enabled: canSeeModule('orders'),
  });

  const { data: booksData, isError: booksError, error: booksFailure, refetch: retryBooks } = useQuery({
    queryKey: ['design-books-summary'],
    queryFn: () => api.get('/design-books').then(r => r.data),
    enabled: canSeeModule('design_books'),
  });

  const { data: draftingPlans } = useQuery({
    queryKey: ['drafting', 'plans'],
    queryFn: () => api.get('/drafting/plans').then(r => r.data.data as Array<{ status: string }>),
    enabled: canSeeModule('drafting'),
  });
  const { data: draftingTeams } = useQuery({
    queryKey: ['drafting', 'teams'],
    queryFn: () => api.get('/drafting/teams').then(r => r.data.data as Array<{ active: boolean }>),
    enabled: canSeeModule('drafting'),
  });
  const openDraftingPlans = draftingPlans?.filter(p => p.status !== 'archived' && p.status !== 'completed').length;

  const poTotal = posData?.pagination?.total ?? 0;
  const activePOs = workData?.total ?? 0;

  const firstName = user?.firstName || user?.email?.split('@')[0] || 'there';

  const modules = [
    {
      id: 'pim',
      href: '/pim',
      icon: Package,
      title: 'Products',
      description: 'Master catalog for products, components, pipes & fittings and tanks across all projects.',
      comingSoon: false,
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
        { label: 'Products',   value: stats?.products   ?? '—' },
        { label: 'Components', value: stats?.components ?? '—' },
      ],
    },
    {
      id: 'orders',
      href: '/order-management',
      icon: ShoppingCart,
      title: 'Purchase Orders',
      description: 'Track purchase orders through drafting, approval, engineering review and release.',
      comingSoon: false,
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
        { label: 'Total POs',   value: poTotal   },
         { label: 'Need Action', value: activePOs },
      ],
    },
    {
      id: 'projects',
      href: '/projects',
      icon: FolderOpen,
      title: 'Projects',
      description: 'Manage active projects, systems, equipment lists and engineering deliverables.',
      comingSoon: false,
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
    {
      id: 'design-book-engine',
      href: '/design-book-engine',
      icon: BookMarked,
      title: 'Design Books',
      description: 'Generate, manage and version engineering design books with exhibits, LSS calculations and specifications.',
      comingSoon: false,
      accent: {
        glow: 'hover:shadow-violet-100/80',
        border: 'hover:border-violet-300/60',
        iconGradient: 'from-violet-500 to-violet-700',
        iconShadow: 'shadow-violet-600/30',
        badge: 'bg-violet-50 text-violet-700 border border-violet-200/80',
        badgeDot: 'bg-violet-500',
        btn: 'from-violet-500 to-violet-700 hover:from-violet-600 hover:to-violet-800 shadow-violet-600/25',
        topBar: 'from-violet-400/20 to-transparent',
      },
      stats: [
        { label: 'Design Books', value: (booksData?.items?.length ?? '—') },
      ],
    },
    {
      id: 'drafting',
      href: '/drafting',
      icon: PencilRuler,
      title: 'Drafting',
      description: 'Drafting teams and the plans they deliver for each project.',
      comingSoon: false,
      accent: {
        glow: 'hover:shadow-teal-100/80',
        border: 'hover:border-teal-300/60',
        iconGradient: 'from-teal-500 to-teal-700',
        iconShadow: 'shadow-teal-600/30',
        badge: 'bg-teal-50 text-teal-700 border border-teal-200/80',
        badgeDot: 'bg-teal-500',
        btn: 'from-teal-500 to-teal-700 hover:from-teal-600 hover:to-teal-800 shadow-teal-600/25',
        topBar: 'from-teal-400/20 to-transparent',
      },
      stats: [
        { label: 'Open Plans', value: openDraftingPlans ?? '—' },
        { label: 'Teams', value: draftingTeams?.filter(t => t.active).length ?? '—' },
      ],
    },
  ];

  const visibleModules = modules.filter(module => canSeeModule(
    module.id === 'design-book-engine' ? 'design_books' : module.id,
  ));
  const visibleQuickLinks = ALL_QUICK_LINKS.filter(link => canSeeModule(link.href.startsWith('/admin') ? 'admin' : moduleForPath(link.href)));
  const pinnedLinks = pinnedHrefs
    .map(href => visibleQuickLinks.find(l => l.href === href))
    .filter(Boolean) as typeof ALL_QUICK_LINKS;

  const unpinned = visibleQuickLinks.filter(l => !pinnedHrefs.includes(l.href));

  return (
    <div className="min-h-full" style={{ background: 'linear-gradient(160deg, #fafaf9 0%, #f5f3f0 100%)' }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
        {(statsError || posError || workError || booksError) && (
          <div role="alert" className="mb-6 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
            Some dashboard figures are unavailable or may be out of date.{' '}
            {supportError(statsFailure || posFailure || workFailure || booksFailure, 'Please retry before relying on these figures.')}
            <button type="button" className="ml-2 font-semibold underline" onClick={() => {
              if (statsError) void retryStats();
              if (posError) void retryPos();
              if (workError) void retryWork();
              if (booksError) void retryBooks();
            }}>Retry figures</button>
          </div>
        )}

        <div className="mb-6 animate-fade-in-up">
          <h1
            className="text-3xl font-bold tracking-tight"
            style={{ background: 'linear-gradient(135deg, #1c1917 0%, #44403c 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
          >
            Welcome back, {firstName}
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-stone-400 text-sm">What needs you, what you were working on, and your week</p>
            <button
              onClick={() => setShortcutMapOpen(true)}
              className="flex items-center gap-1 text-xs text-stone-400 hover:text-blue-600 transition-colors"
              aria-label="Open keyboard shortcuts"
            >
              <Keyboard className="w-3.5 h-3.5" />
              Keyboard shortcuts
            </button>
          </div>
        </div>

        {shortcutMapOpen && <ShortcutMapModal onClose={() => setShortcutMapOpen(false)} />}

        <div className="mb-8 grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2"><NeedsAttentionPanel /></div>
          <RecentRecordsPanel />
        </div>

        <MyWorkPlanner />

        <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {visibleModules.map(mod => {
            const Icon = mod.icon;
            return (
              <button
                key={mod.id}
                type="button"
                onClick={() => navigate(mod.href)}
                className="group flex flex-col rounded-xl border border-stone-200 bg-white p-4 text-left shadow-sm transition-all hover:border-blue-300 hover:shadow-md"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-stone-700 group-hover:text-blue-700">
                  <Icon className="h-4 w-4 text-stone-400 group-hover:text-blue-500" />
                  {mod.title}
                </span>
                <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                  {mod.stats.map(s => (
                    <span key={s.label} className="text-xs text-stone-500">
                      <span className="text-lg font-semibold text-stone-800">{s.value}</span> {s.label}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>

        <div className="border-t border-stone-200/60 pt-6 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-stone-400 uppercase tracking-[0.15em]">Quick Access</p>
            <div className="relative" ref={pickerRef}>
              <button
                onClick={() => setPickerOpen(v => !v)}
                className="flex items-center gap-1 text-xs text-stone-400 hover:text-blue-600 transition-colors"
                title="Add shortcut"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
              {pickerOpen && (
                <div className="absolute right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-50 w-52 py-1 overflow-hidden">
                  {unpinned.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-slate-400 text-center">All shortcuts added</div>
                  ) : (
                    unpinned.map(l => {
                      const Icon = ICON_MAP[l.icon] || LayoutGrid;
                      return (
                        <button
                          key={l.href}
                          onClick={() => addLink(l.href)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                        >
                          <Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          {l.label}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {pinnedLinks.map(l => {
              const Icon = ICON_MAP[l.icon] || LayoutGrid;
              return (
                <div key={l.href} className="group/ql relative">
                  <button
                    onClick={() => navigate(l.href)}
                    className="flex items-center gap-2 text-sm text-stone-500 hover:text-blue-600 bg-white/80 border border-stone-200/80 hover:border-blue-300/60 rounded-lg px-3 py-2 transition-all duration-200 shadow-sm hover:shadow active:scale-95 group pr-7"
                  >
                    <Icon className="w-3.5 h-3.5 group-hover:scale-110 transition-transform duration-150" />
                    {l.label}
                    <ChevronRight className="w-3.5 h-3.5 text-stone-300 group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all duration-150" />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); removeLink(l.href); }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover/ql:opacity-100 transition-opacity text-stone-300 hover:text-red-500 rounded p-0.5"
                    title="Remove shortcut"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
            {pinnedLinks.length === 0 && (
              <span className="text-xs text-stone-400 py-2">No shortcuts — click Add to pin pages here.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
