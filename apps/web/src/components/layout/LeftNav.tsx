import { NavLink, useNavigate } from 'react-router-dom';
 import { FolderOpen, Package, BookOpen, FileText, Network, Search, Users, Upload, Boxes, Pipette, Container, GripVertical, Settings, ChevronRight, Ruler, ShoppingCart, Home, ClipboardList, Layers, GitBranch, DollarSign, BookMarked, PanelLeftClose, PanelLeftOpen, Fish, Activity, Sun, Wind, SlidersHorizontal, BriefcaseBusiness, ClipboardCheck } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import { useCommandPalette } from '../../store/commandPaletteStore';
import { useAuthStore } from '../../store/authStore';
import { ModuleKey, ROUTES } from '../../lib/navigation';

type NavItemDef = { id: string; to: string; icon: any; label: string; end?: boolean };
type NavSection = { id: string; moduleKey: ModuleKey; group: string; label: string; hub: string; icon: any; items: NavItemDef[] };

const PIM_ITEMS: NavItemDef[] = [
  { id: 'products', to: '/products/masters', icon: Package, label: 'Products' },
  { id: 'components', to: '/products/components', icon: Boxes, label: 'Components' },
  { id: 'piping', to: '/products/piping', icon: Pipette, label: 'Pipes & Fittings' },
  { id: 'tanks', to: '/products/tanks', icon: Container, label: 'Tanks' },
];

const SECTIONS: NavSection[] = [
  { id: 'orders', moduleKey: 'orders', group: 'Operational', label: 'Order Management', hub: ROUTES.orders, icon: ShoppingCart,
    items: [{ id: 'purchase-orders', to: ROUTES.purchaseOrders, icon: ShoppingCart, label: 'Purchase Orders' }] },
  {
    id: 'projects', moduleKey: 'projects', group: 'Operational', label: 'Project Management', hub: ROUTES.projectManagement, icon: FolderOpen,
    items: [{ id: 'projects', to: ROUTES.projects, icon: FolderOpen, label: 'Projects' }],
  },
  {
    id: 'design-book-engine', moduleKey: 'design_books', group: 'Engineering', label: 'Design Book Engine', hub: ROUTES.designBookEngine, icon: BookMarked,
    items: [
      { id: 'design-books', to: ROUTES.designBooks, icon: BookMarked, label: 'Design Books' },
      { id: 'lss-catalog', to: ROUTES.lssCompactUnits, icon: Layers, label: 'LSS Unit Catalog' },
      { id: 'species-catalog', to: ROUTES.speciesCatalog, icon: Fish, label: 'Species Catalog' },
    ],
  },
  { id: 'pim', moduleKey: 'pim', group: 'Engineering', label: 'PIM Management', hub: ROUTES.pim, icon: Package, items: PIM_ITEMS },
  {
    id: 'business-development', moduleKey: 'business_development', group: 'Commercial', label: 'Business Development', hub: ROUTES.businessDevelopment, icon: BriefcaseBusiness,
    items: [
      { id: 'clients', to: '/clients', icon: Users, label: 'Clients' },
      { id: 'enquiries', to: '/enquiries', icon: ClipboardCheck, label: 'Enquiries' },
    ],
  },
  {
    id: 'documents', moduleKey: 'documents', group: 'Reference', label: 'Documents', hub: ROUTES.documents, icon: FileText,
    items: [{ id: 'document-register', to: ROUTES.documents, icon: FileText, label: 'Document Register', end: true }],
  },
  {
    id: 'knowledge', moduleKey: 'knowledge', group: 'Reference', label: 'Engineering Knowledge', hub: ROUTES.materials, icon: BookOpen,
    items: [
      { id: 'materials', to: ROUTES.materials, icon: BookOpen, label: 'Materials' },
      { id: 'specifications', to: ROUTES.specifications, icon: BookOpen, label: 'Specifications' },
      { id: 'design-rules', to: ROUTES.designRules, icon: Ruler, label: 'Design Rules' },
    ],
  },
  {
    id: 'graph', moduleKey: 'graph', group: 'Reference', label: 'Relationships', hub: ROUTES.graph, icon: Network,
    items: [{ id: 'graph-explorer', to: ROUTES.graph, icon: Network, label: 'Graph Explorer', end: true }],
  },
];

const ADMIN_ITEMS: NavItemDef[] = [
  { id: 'families', to: '/products', icon: Package, label: 'Families', end: true },
  { id: 'materials', to: '/knowledge/materials', icon: BookOpen, label: 'Materials' },
  { id: 'specifications', to: '/knowledge/specifications', icon: BookOpen, label: 'Specifications' },
  { id: 'design-rules', to: '/knowledge/design-rules', icon: Ruler, label: 'Design Rules' },
  { id: 'document-register', to: '/documents', icon: FileText, label: 'Document Register' },
  { id: 'tank-families', to: '/admin/tank-families', icon: Container, label: 'Tank Families' },
  { id: 'tank-cost-rates', to: '/admin/tank-cost-rates', icon: DollarSign, label: 'Tank Cost Rates' },
  { id: 'exchange-rates', to: '/admin/exchange-rates', icon: DollarSign, label: 'Exchange Rates' },
  { id: 'system-types', to: '/admin/system-types', icon: Layers, label: 'System Types' },
  { id: 'pump-duty-types', to: '/admin/pump-duty-types', icon: Pipette, label: 'Pump Duty Types' },
  { id: 'field-instruments', to: '/admin/field-instruments', icon: SlidersHorizontal, label: 'Field Instruments' },
  { id: 'pipe-sizing-standards', to: '/admin/pipe-sizing-standards', icon: Pipette, label: 'Pipe Sizing Standards' },
  { id: 'biological-media-profiles', to: '/admin/biological-media-profiles', icon: Activity, label: 'Biological Media Profiles' },
  { id: 'uv-engineering', to: '/admin/uv-engineering', icon: Sun, label: 'UV Engineering Products' },
  { id: 'thermal-wall-constructions', to: '/admin/thermal-wall-constructions', icon: Layers, label: 'Thermal Wall Constructions' },
  { id: 'evaporation-correlations', to: '/admin/evaporation-correlations', icon: Wind, label: 'Evaporation Correlations' },
  { id: 'chemical-parameters', to: '/admin/chemical-parameters', icon: Pipette, label: 'Chemical Parameters' },
  { id: 'categories', to: '/admin/categories', icon: Boxes, label: 'Categories' },
  { id: 'po-stage-roles', to: '/admin/po-stage-roles', icon: GitBranch, label: 'PO Stage Roles' },
  { id: 'roles', to: '/admin/roles', icon: Users, label: 'Roles' },
  { id: 'users', to: '/admin/users', icon: Users, label: 'Users' },
  { id: 'csv-import', to: '/admin/import', icon: Upload, label: 'CSV Import' },
  { id: 'audit-log', to: '/admin/audit-log', icon: ClipboardList, label: 'Audit Log' },
];

const STORAGE_KEY = 'nav-section-orders';

function loadOrders(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveOrders(orders: Record<string, string[]>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
}

function applySectionOrder(items: NavItemDef[], savedIds: string[] | undefined): NavItemDef[] {
  if (!savedIds || savedIds.length === 0) return items;
  const map = new Map(items.map(i => [i.id, i]));
  const ordered: NavItemDef[] = [];
  for (const id of savedIds) { const item = map.get(id); if (item) ordered.push(item); }
  for (const item of items) { if (!ordered.find(o => o.id === item.id)) ordered.push(item); }
  return ordered;
}

function DraggableSection({ section, savedOrder, onOrderChange, collapsed, onNavigate }: {
  section: NavSection;
  savedOrder: string[] | undefined;
  onOrderChange: (sectionId: string, newOrder: string[]) => void;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const [items, setItems] = useState<NavItemDef[]>(() => applySectionOrder(section.items, savedOrder));
  const dragIdx = useRef<number | null>(null);
  const overIdx = useRef<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overItemId, setOverItemId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const HubIcon = section.icon;

  useEffect(() => { setItems(applySectionOrder(section.items, savedOrder)); }, []);

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    dragIdx.current = idx;
    setDraggingId(items[idx].id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', items[idx].id);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    overIdx.current = idx;
    setOverItemId(items[idx].id);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const from = dragIdx.current, to = overIdx.current;
    if (from === null || to === null || from === to) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);
    onOrderChange(section.id, next.map(i => i.id));
    dragIdx.current = null; overIdx.current = null;
  };

  const handleDragEnd = () => { setDraggingId(null); setOverItemId(null); dragIdx.current = null; overIdx.current = null; };

  return (
    <div>
      {!collapsed && (
        <button
          onClick={() => { navigate(section.hub); setExpanded(v => !v); onNavigate?.(); }}
          className="w-full flex items-center justify-between pt-4 pb-1.5 px-3 group focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${section.label}`}
        >
          <span className="text-[10px] font-bold text-stone-400 uppercase tracking-[0.12em] group-hover:text-blue-600 transition-colors duration-150">
            {section.label}
          </span>
          <ChevronRight className={clsx(
            'w-3 h-3 text-stone-300 group-hover:text-blue-500 transition-all duration-200',
            expanded ? 'rotate-90' : 'rotate-0'
          )} />
        </button>
      )}

      {collapsed && (
        <NavLink
          to={section.hub}
          title={section.label}
          aria-label={section.label}
          className={({ isActive }) => clsx(navLinkClass({ isActive }), 'justify-center px-3')}
        >
          <HubIcon className="w-4 h-4 shrink-0 text-stone-400" />
        </NavLink>
      )}

      {(collapsed || expanded) && items.map((item, idx) => {
        const Icon = item.icon;
        const isDragging = draggingId === item.id;
        const isOver = overItemId === item.id && draggingId !== item.id;
        return (
          <div
            key={item.id}
            draggable
            onDragStart={e => handleDragStart(e, idx)}
            onDragOver={e => handleDragOver(e, idx)}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            className={clsx(
              'group relative flex items-center rounded-lg transition-all mx-1',
              isDragging && 'opacity-40 scale-95',
              isOver && 'ring-1 ring-blue-400/40 ring-inset bg-blue-50/60',
            )}
          >
            <div
              className="absolute left-0 top-0 bottom-0 flex items-center pl-1 opacity-0 group-hover:opacity-60 transition-opacity cursor-grab active:cursor-grabbing z-10"
              title={`Drag to reorder ${item.label}`}
              aria-label={`Drag to reorder ${item.label}`}
            >
              <GripVertical className="w-3 h-3 text-stone-400" />
            </div>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) => clsx(
                'flex-1 flex items-center gap-2.5 py-2 text-sm rounded-lg transition-all duration-150 relative overflow-hidden',
                collapsed ? 'justify-center px-3' : 'pl-6 pr-3',
                isActive
                  ? 'bg-white text-blue-600 font-semibold shadow-sm border border-stone-200/70'
                  : 'text-stone-500 hover:bg-white/70 hover:text-stone-800 hover:shadow-sm'
              )}
               title={collapsed ? item.label : undefined}
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
                   {!collapsed && <span>{item.label}</span>}
                </>
              )}
            </NavLink>
          </div>
        );
      })}
    </div>
  );
}

const ADMIN_GROUPS = [
  { label: 'Library', items: ADMIN_ITEMS.filter(i => ['families', 'materials', 'specifications', 'design-rules', 'tank-families', 'tank-cost-rates', 'exchange-rates', 'system-types', 'pump-duty-types', 'field-instruments', 'pipe-sizing-standards', 'biological-media-profiles', 'uv-engineering', 'thermal-wall-constructions', 'evaporation-correlations', 'chemical-parameters'].includes(i.id)) },
  { label: 'Documents', items: ADMIN_ITEMS.filter(i => ['document-register'].includes(i.id)) },
  { label: 'Order Management', items: ADMIN_ITEMS.filter(i => ['po-stage-roles'].includes(i.id)) },
  { label: 'System', items: ADMIN_ITEMS.filter(i => ['categories', 'roles', 'users', 'csv-import', 'audit-log'].includes(i.id)) },
];

function AdminPopup({ onClose, onNavigate }: { onClose: () => void; onNavigate?: () => void }) {
  const navigate = useNavigate();
  const user = useAuthStore(state => state.user);
  const ref = useRef<HTMLDivElement>(null);
  const menuItemRefs = useRef<HTMLButtonElement[]>([]);
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const visibleGroups = user?.role === 'engineer'
    ? ADMIN_GROUPS.map(group => ({
      ...group,
      items: group.items.filter(item => item.id === 'thermal-wall-constructions'),
    })).filter(group => group.items.length > 0)
    : ADMIN_GROUPS;

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
                  onClick={() => { navigate(item.to); onClose(); onNavigate?.(); }}
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
  const [orders, setOrders] = useState<Record<string, string[]>>(loadOrders);
  const [showAdmin, setShowAdmin] = useState(false);
  const adminTriggerRef = useRef<HTMLButtonElement>(null);
  const { open: openPalette } = useCommandPalette();
  const user = useAuthStore(state => state.user);
  const moduleVisible = (moduleKey: ModuleKey) => user?.moduleAccess?.[moduleKey] !== 'hidden';
  const canAccessPlatformAdmin = user?.role === 'admin' ||
    (user?.role === 'engineer' && user?.moduleAccess?.design_books === 'manage');
  const visibleSections = SECTIONS.filter(section => moduleVisible(section.moduleKey));

  const handleOrderChange = (sectionId: string, newOrder: string[]) => {
    const next = { ...orders, [sectionId]: newOrder };
    setOrders(next);
    saveOrders(next);
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
        </div>

        {visibleSections.map((section, index) => (
          <div key={section.id}>
            {!collapsed && (index === 0 || visibleSections[index - 1].group !== section.group) && (
              <div className="px-4 pt-4 text-[10px] font-bold uppercase tracking-[0.16em] text-stone-500">{section.group}</div>
            )}
            <DraggableSection section={section} savedOrder={orders[section.id]} onOrderChange={handleOrderChange} collapsed={collapsed} onNavigate={onNavigate} />
          </div>
        ))}
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
