import { NavLink, useLocation, useNavigate } from 'react-router-dom';
 import { FolderOpen, Package, BookOpen, FileText, Network, Search, Users, Upload, Boxes, Pipette, Container, Settings, ChevronRight, Ruler, ShoppingCart, Home, ClipboardList, Layers, GitBranch, DollarSign, BookMarked, PanelLeftClose, PanelLeftOpen, Fish, Activity, Sun, Wind, SlidersHorizontal, BriefcaseBusiness, ClipboardCheck, CalendarRange, PencilRuler, Gauge, Building2, Lightbulb } from 'lucide-react';
import { useState, useRef, useEffect, ReactNode } from 'react';
import clsx from 'clsx';
import { useCommandPalette } from '../../store/commandPaletteStore';
import { useAuthStore } from '../../store/authStore';
import { ModuleKey, ROUTES } from '../../lib/navigation';
import { adminPopupGroups, rememberAdminPage, visibleAdminEntries } from '../../lib/adminRegistry';
import { Department, DEPARTMENT_AREAS } from '../../lib/departments';

type NavItemDef = { id: string; to: string; icon: any; label: string; moduleKey?: ModuleKey; end?: boolean };
/** `emptyFor`: departments that still see the area while it has no pages yet. */
type NavArea = { id: string; label: string; items: NavItemDef[]; emptyFor?: Department[] };

/** Shared records everyone works from: one click, no sub-menus. */
const SHARED_ITEMS: NavItemDef[] = [
  { id: 'projects', to: ROUTES.projects, icon: FolderOpen, label: 'Projects', moduleKey: 'projects' },
  { id: 'clients', to: ROUTES.clients, icon: Building2, label: 'Clients & Contacts', moduleKey: 'clients' },
  { id: 'products', to: ROUTES.products, icon: Package, label: 'Products', moduleKey: 'pim' },
  { id: 'documents', to: ROUTES.documents, icon: FileText, label: 'Documents', moduleKey: 'documents' },
];

/** Department areas: collapsible, shown only when the user can see at least one item. */
const AREAS: NavArea[] = [
  { id: 'business-development', label: 'Business Development', items: [
    { id: 'bid-pipeline', to: ROUTES.businessDevelopment, icon: BriefcaseBusiness, label: 'Bid Pipeline', moduleKey: 'business_development', end: true },
    { id: 'enquiries', to: ROUTES.enquiries, icon: ClipboardCheck, label: 'Enquiries', moduleKey: 'business_development' },
  ] },
  { id: 'procurement', label: 'Procurement', items: [
    { id: 'orders-overview', to: ROUTES.orders, icon: Gauge, label: 'Order Overview', moduleKey: 'orders', end: true },
    { id: 'purchase-orders', to: ROUTES.purchaseOrders, icon: ShoppingCart, label: 'Purchase Orders', moduleKey: 'orders' },
  ] },
  { id: 'engineering', label: 'Engineering', items: [
    { id: 'design-books', to: ROUTES.designBooks, icon: BookMarked, label: 'Design Books', moduleKey: 'design_books' },
    { id: 'drafting', to: ROUTES.drafting, icon: PencilRuler, label: 'Drafting', moduleKey: 'drafting' },
    { id: 'components', to: ROUTES.components, icon: Boxes, label: 'Components', moduleKey: 'pim' },
    { id: 'piping', to: ROUTES.piping, icon: Pipette, label: 'Pipes & Fittings', moduleKey: 'pim' },
    { id: 'tanks', to: ROUTES.tanks, icon: Container, label: 'Tanks', moduleKey: 'pim' },
    { id: 'attributes', to: '/products/attributes', icon: SlidersHorizontal, label: 'Attributes', moduleKey: 'pim' },
    { id: 'lss-catalog', to: ROUTES.lssCompactUnits, icon: Layers, label: 'LSS Unit Catalog', moduleKey: 'design_books' },
    { id: 'species-catalog', to: ROUTES.speciesCatalog, icon: Fish, label: 'Species Catalog', moduleKey: 'design_books' },
    { id: 'materials', to: ROUTES.materials, icon: BookOpen, label: 'Materials', moduleKey: 'knowledge' },
    { id: 'specifications', to: ROUTES.specifications, icon: BookOpen, label: 'Specifications', moduleKey: 'knowledge' },
    { id: 'design-rules', to: ROUTES.designRules, icon: Ruler, label: 'Design Rules', moduleKey: 'knowledge' },
  ] },
  { id: 'management', label: 'Management', items: [
    { id: 'resources', to: ROUTES.resources, icon: Gauge, label: 'Teams & Workload', moduleKey: 'resources' },
    { id: 'initiatives', to: '/initiatives', icon: Lightbulb, label: 'Initiatives', moduleKey: 'initiatives' },
    { id: 'graph', to: ROUTES.graph, icon: Network, label: 'Relationship Graph', moduleKey: 'graph' },
  ] },
  { id: 'logistics', label: 'Logistics', items: [], emptyFor: ['logistics', 'management'] },
  { id: 'factory', label: 'Factory', items: [], emptyFor: ['factory', 'management'] },
];

const STORAGE_KEY = 'nav-collapsed-areas';

/** Areas folded by default: everything outside the person's department (none for management or no department). */
export function defaultCollapsedAreas(department: Department | null | undefined): string[] {
  const open = department ? DEPARTMENT_AREAS[department] : null;
  return open ? AREAS.map(area => area.id).filter(id => !open.includes(id)) : [];
}

/** The person's own fold/unfold choices win over the department default once they make one. */
function loadCollapsedAreas(userId: string | undefined, department: Department | null | undefined): string[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${userId ?? 'anonymous'}`);
    if (raw) return JSON.parse(raw);
  } catch { /* storage unavailable */ }
  return defaultCollapsedAreas(department);
}

function NavItemLink({ item, collapsed, indent = false }: { item: NavItemDef; collapsed: boolean; indent?: boolean }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) => clsx(navLinkClass({ isActive }), collapsed ? 'justify-center px-3' : indent && 'pl-5')}
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-blue-500 rounded-r-full" />}
          <Icon className={clsx(
            'w-4 h-4 shrink-0 transition-all duration-150',
            isActive ? 'text-blue-500' : 'text-stone-400 group-hover:text-stone-600',
          )} />
          {!collapsed && <span className="truncate">{item.label}</span>}
        </>
      )}
    </NavLink>
  );
}

function GroupHeading({ children }: { children: ReactNode }) {
  return <div className="px-4 pt-5 pb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-stone-500">{children}</div>;
}

function NavAreaSection({ area, items, expanded, onToggle, collapsed }: {
  area: NavArea; items: NavItemDef[]; expanded: boolean; onToggle: () => void; collapsed: boolean;
}) {
  const location = useLocation();
  const containsActive = items.some(item => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`));
  const open = expanded || containsActive;
  if (collapsed) {
    return <div className="space-y-0.5 border-t border-stone-200/70 pt-1 mt-1">{items.map(item => <NavItemLink key={item.id} item={item} collapsed />)}</div>;
  }
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between mt-0.5 px-4 py-1.5 rounded-lg text-sm font-medium text-stone-700 hover:bg-white/70 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${area.label}`}
      >
        <span>{area.label}</span>
        <ChevronRight className={clsx('w-3.5 h-3.5 text-stone-400 transition-transform duration-200', open && 'rotate-90')} />
      </button>
      {open && <div className="space-y-0.5 pb-1">
        {items.map(item => <NavItemLink key={item.id} item={item} collapsed={false} indent />)}
        {items.length === 0 && <p className="pl-6 pr-3 py-1.5 text-xs text-stone-400">Nothing here yet</p>}
      </div>}
    </div>
  );
}

function AdminPopup({ onClose, onNavigate }: { onClose: () => void; onNavigate?: () => void }) {
  const navigate = useNavigate();
  const user = useAuthStore(state => state.user);
  const ref = useRef<HTMLDivElement>(null);
  const menuItemRefs = useRef<HTMLButtonElement[]>([]);
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const visibleGroups = adminPopupGroups(visibleAdminEntries(user));

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', keyHandler); };
  }, [onClose]);

  useEffect(() => {
    menuItemRefs.current[0]?.focus();
  }, []);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = menuItemRefs.current;
    if (items.length === 0) return;

    const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
    if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (nextIndex !== null) {
      event.preventDefault();
      setActiveItemIndex(nextIndex);
      items[nextIndex]?.focus();
    }
  };

  menuItemRefs.current = [];

  return (
    <div
      ref={ref}
        id="platform-admin-menu"
        role="menu"
        aria-label="Platform Admin"
      onKeyDown={handleMenuKeyDown}
      className="absolute bottom-14 left-2 right-2 bg-white border border-stone-200 rounded-xl shadow-2xl z-50 overflow-hidden animate-fade-in-up"
    >
      <div className="px-3 py-2.5 border-b border-stone-100 bg-stone-50/60">
        <span className="text-[10px] font-bold text-stone-400 uppercase tracking-[0.12em]">Platform Admin</span>
        {user?.role === 'admin' && <button type="button" tabIndex={-1} onClick={() => { navigate('/admin'); onClose(); onNavigate?.(); }}
          className="float-right text-xs font-medium text-blue-600 hover:text-blue-700">All settings →</button>}
      </div>
      <div className="py-1 max-h-[70vh] overflow-y-auto">
         {visibleGroups.map((group, gi) => (
          <div key={group.label}>
            {gi > 0 && <div className="border-t border-stone-100 my-1" />}
            <div className="px-3 pt-2 pb-0.5 text-[10px] font-bold text-stone-300 uppercase tracking-[0.12em]">{group.label}</div>
            {group.items.map((item, itemOffset) => {
              const Icon = item.icon;
               const itemIndex = visibleGroups.slice(0, gi).reduce((total, previousGroup) => total + previousGroup.items.length, 0) + itemOffset;
              return (
                <button
                  key={item.id}
                  ref={element => { if (element) menuItemRefs.current[itemIndex] = element; }}
                  role="menuitem"
                  tabIndex={itemIndex === activeItemIndex ? 0 : -1}
                  onFocus={() => setActiveItemIndex(itemIndex)}
                  onClick={() => { rememberAdminPage(item.id); navigate(item.to); onClose(); onNavigate?.(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50 hover:text-blue-600 transition-all duration-150 text-left group"
                >
                  <Icon className="w-4 h-4 shrink-0 text-stone-400 group-hover:text-blue-500 transition-colors duration-150" />
                  <span>{item.label}</span>
                  <ChevronRight className="w-3.5 h-3.5 ml-auto text-stone-300 group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all duration-150" />
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

const navLinkClass = ({ isActive }: { isActive: boolean }) => clsx(
  'flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-all duration-150 mx-1 group relative overflow-hidden',
  isActive
    ? 'bg-white text-blue-600 font-semibold shadow-sm border border-stone-200/70'
    : 'text-stone-500 hover:bg-white/70 hover:text-stone-800 hover:shadow-sm'
);

interface LeftNavProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNavigate?: () => void;
}

export default function LeftNav({ collapsed, onToggleCollapsed, onNavigate }: LeftNavProps) {
  const [showAdmin, setShowAdmin] = useState(false);
  const adminTriggerRef = useRef<HTMLButtonElement>(null);
  const { open: openPalette } = useCommandPalette();
  const user = useAuthStore(state => state.user);
  const [collapsedAreas, setCollapsedAreas] = useState<string[]>(() => loadCollapsedAreas(user?.id, user?.department));
  // The user record can arrive after the first render (page reload): apply their default then.
  useEffect(() => { setCollapsedAreas(loadCollapsedAreas(user?.id, user?.department)); }, [user?.id, user?.department]);
  const itemVisible = (item: NavItemDef) => !item.moduleKey || user?.moduleAccess?.[item.moduleKey] !== 'hidden';
  const canAccessPlatformAdmin = visibleAdminEntries(user).length > 0;
  const sharedItems = SHARED_ITEMS.filter(itemVisible);
  const showsEmptyArea = (area: NavArea) => user?.role === 'admin' || (!!user?.department && !!area.emptyFor?.includes(user.department));
  const visibleAreas = AREAS
    .map(area => ({ area, items: area.items.filter(itemVisible) }))
    .filter(entry => entry.items.length > 0 || (entry.area.items.length === 0 && showsEmptyArea(entry.area)));

  const toggleArea = (areaId: string) => {
    setCollapsedAreas(current => {
      const next = current.includes(areaId) ? current.filter(id => id !== areaId) : [...current, areaId];
      try { localStorage.setItem(`${STORAGE_KEY}:${user?.id ?? 'anonymous'}`, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  };

  const closeAdminMenu = () => {
    setShowAdmin(false);
    requestAnimationFrame(() => adminTriggerRef.current?.focus());
  };

  return (
    <nav onClick={event => {
      if ((event.target as HTMLElement).closest('a')) onNavigate?.();
    }} className={clsx(
      'flex flex-col h-full shrink-0 relative border-r border-stone-200/80 shadow-[1px_0_0_0_rgba(0,0,0,0.03)] transition-[width] duration-300 ease-in-out',
      collapsed ? 'w-16' : 'w-56',
    )}
      style={{ background: 'linear-gradient(180deg, #f6f5f3 0%, #f1efed 100%)' }}>

      <div className={clsx('border-b border-stone-200/80', collapsed ? 'px-2 py-3' : 'px-4 py-4')}>
        <div className={clsx('flex items-center', collapsed ? 'flex-col gap-2' : 'justify-between')}>
          <img src="/shark-os-logo.png" alt="Shark OS" className={clsx('w-auto transition-all duration-300', collapsed ? 'h-9' : 'h-20')} />
          <button
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-white/80 hover:text-blue-600 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        <div className={clsx('px-1 space-y-0.5', collapsed && 'px-0.5')}>
          {([
            { to: '/', icon: Home, label: 'Home', end: true, visible: true },
          ] as const).filter(item => item.visible).map(({ to, icon: Icon, label, end }: any) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={collapsed ? label : undefined}
              className={({ isActive }) => clsx(navLinkClass({ isActive }), collapsed && 'justify-center px-3')}
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-blue-500 rounded-r-full" />
                  )}
                  <Icon className={clsx(
                    'w-4 h-4 shrink-0 transition-all duration-150',
                    isActive ? 'text-blue-500' : 'text-stone-400 group-hover:text-stone-600 group-hover:scale-110'
                  )} />
                   {!collapsed && <span>{label}</span>}
                </>
              )}
            </NavLink>
          ))}
          <button
            onClick={openPalette}
            aria-label="Search"
            title={collapsed ? 'Search' : undefined}
            className={clsx(
              'w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-all duration-150 mx-1 group relative overflow-hidden text-stone-500 hover:bg-white/70 hover:text-stone-800 hover:shadow-sm',
              collapsed && 'justify-center mx-0',
            )}
          >
            <Search className="w-4 h-4 shrink-0 text-stone-400 group-hover:text-stone-600 group-hover:scale-110 transition-all duration-150" />
            {!collapsed && <span className="flex-1 text-left">Search</span>}
            {!collapsed && <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-stone-200 bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-stone-400 group-hover:border-blue-200 group-hover:text-blue-500 transition-colors duration-150">
              ⌘K
            </kbd>}
          </button>
          <NavItemLink item={{ id: 'my-work', to: '/my-work', icon: ClipboardCheck, label: 'My Work' }} collapsed={collapsed} />
          <NavItemLink item={{ id: 'plans', to: '/plans', icon: CalendarRange, label: 'My Plans' }} collapsed={collapsed} />
        </div>

        {sharedItems.length > 0 && (
          <div className={clsx('px-1 space-y-0.5', collapsed && 'px-0.5 border-t border-stone-200/70 pt-1 mt-1')}>
            {!collapsed && <GroupHeading>Company</GroupHeading>}
            {sharedItems.map(item => <NavItemLink key={item.id} item={item} collapsed={collapsed} />)}
          </div>
        )}

        {visibleAreas.length > 0 && (
          <div className={clsx('px-1', collapsed && 'px-0.5')}>
            {!collapsed && <GroupHeading>Departments</GroupHeading>}
            {visibleAreas.map(({ area, items }) => (
              <NavAreaSection
                key={area.id}
                area={area}
                items={items}
                expanded={!collapsedAreas.includes(area.id)}
                onToggle={() => toggleArea(area.id)}
                collapsed={collapsed}
              />
            ))}
          </div>
        )}
      </div>

      {canAccessPlatformAdmin && <div className="border-t border-stone-200/80 p-2">
        {!collapsed && <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-stone-500">Administration</div>}
        <button
          ref={adminTriggerRef}
          onClick={() => setShowAdmin(v => !v)}
          aria-expanded={showAdmin}
          aria-controls="platform-admin-menu"
          aria-haspopup="menu"
          aria-label={collapsed ? 'Platform Admin' : undefined}
          title={collapsed ? 'Platform Admin' : undefined}
          className={clsx(
            'w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-all duration-150 group focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1',
            collapsed && 'justify-center px-3',
            showAdmin
              ? 'bg-white text-blue-600 font-semibold shadow-sm border border-stone-200/70'
              : 'text-stone-500 hover:bg-white/70 hover:text-stone-800 hover:shadow-sm'
          )}
        >
          <Settings className={clsx(
            'w-4 h-4 shrink-0 transition-all duration-150',
            showAdmin ? 'text-blue-500' : 'text-stone-400 group-hover:text-stone-600 group-hover:rotate-45'
          )} />
          {!collapsed && <span>Platform Admin</span>}
          {!collapsed && <ChevronRight className={clsx('w-3.5 h-3.5 ml-auto transition-transform duration-200', showAdmin && 'rotate-90')} />}
        </button>
      </div>}

      {canAccessPlatformAdmin && showAdmin && <AdminPopup onClose={closeAdminMenu} onNavigate={onNavigate} />}
    </nav>
  );
}
