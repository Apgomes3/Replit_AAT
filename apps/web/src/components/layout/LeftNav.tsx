import { NavLink, useNavigate } from 'react-router-dom';
import { FolderOpen, Package, BookOpen, FileText, Network, Search, Users, Upload, LayoutDashboard, Boxes, Pipette, Container, GripVertical, Settings, ChevronRight, Ruler, ShoppingCart, Home } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';

type NavItemDef = { id: string; to: string; icon: any; label: string; end?: boolean };

const PIM_ITEMS: NavItemDef[] = [
  { id: 'products', to: '/products/masters', icon: Package, label: 'Products' },
  { id: 'components', to: '/products/components', icon: Boxes, label: 'Components' },
  { id: 'piping', to: '/products/piping', icon: Pipette, label: 'Pipes & Fittings' },
  { id: 'tanks', to: '/products/tanks', icon: Container, label: 'Tanks' },
];

const SECTIONS: { id: string; label: string; hub: string; items: NavItemDef[] }[] = [
  { id: 'pim', label: 'PIM Management', hub: '/pim', items: PIM_ITEMS },
  {
    id: 'orders', label: 'Order Management', hub: '/order-management',
    items: [{ id: 'purchase-orders', to: '/purchase-orders', icon: ShoppingCart, label: 'Purchase Orders' }],
  },
  {
    id: 'projects', label: 'Project Management', hub: '/project-management',
    items: [{ id: 'projects', to: '/projects', icon: FolderOpen, label: 'Projects' }],
  },
];

const ADMIN_ITEMS: NavItemDef[] = [
  { id: 'families', to: '/products', icon: Package, label: 'Families', end: true },
  { id: 'materials', to: '/knowledge/materials', icon: BookOpen, label: 'Materials' },
  { id: 'specifications', to: '/knowledge/specifications', icon: BookOpen, label: 'Specifications' },
  { id: 'design-rules', to: '/knowledge/design-rules', icon: Ruler, label: 'Design Rules' },
  { id: 'document-register', to: '/documents', icon: FileText, label: 'Document Register' },
  { id: 'tank-families', to: '/admin/tank-families', icon: Container, label: 'Tank Families' },
  { id: 'categories', to: '/admin/categories', icon: Boxes, label: 'Categories' },
  { id: 'roles', to: '/admin/roles', icon: Users, label: 'Roles' },
  { id: 'users', to: '/admin/users', icon: Users, label: 'Users' },
  { id: 'csv-import', to: '/admin/import', icon: Upload, label: 'CSV Import' },
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

function DraggableSection({ section, savedOrder, onOrderChange }: {
  section: typeof SECTIONS[0];
  savedOrder: string[] | undefined;
  onOrderChange: (sectionId: string, newOrder: string[]) => void;
}) {
  const navigate = useNavigate();
  const [items, setItems] = useState<NavItemDef[]>(() => applySectionOrder(section.items, savedOrder));
  const dragIdx = useRef<number | null>(null);
  const overIdx = useRef<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overItemId, setOverItemId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

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
      <button
        onClick={() => { navigate(section.hub); setExpanded(v => !v); }}
        className="w-full flex items-center justify-between pt-4 pb-1.5 px-3 group"
      >
        <span className="text-[10px] font-bold text-stone-400 uppercase tracking-[0.12em] group-hover:text-amber-600 transition-colors duration-150">
          {section.label}
        </span>
        <ChevronRight className={clsx(
          'w-3 h-3 text-stone-300 group-hover:text-amber-500 transition-all duration-200',
          expanded ? 'rotate-90' : 'rotate-0'
        )} />
      </button>

      {expanded && items.map((item, idx) => {
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
              isOver && 'ring-1 ring-amber-400/40 ring-inset bg-amber-50/60',
            )}
          >
            <div className="absolute left-0 top-0 bottom-0 flex items-center pl-1 opacity-0 group-hover:opacity-60 transition-opacity cursor-grab active:cursor-grabbing z-10">
              <GripVertical className="w-3 h-3 text-stone-400" />
            </div>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) => clsx(
                'flex-1 flex items-center gap-2.5 pl-6 pr-3 py-2 text-sm rounded-lg transition-all duration-150 relative overflow-hidden',
                isActive
                  ? 'bg-white text-amber-600 font-semibold shadow-sm border border-stone-200/70'
                  : 'text-stone-500 hover:bg-white/70 hover:text-stone-800 hover:shadow-sm'
              )}
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-amber-500 rounded-r-full" />
                  )}
                  <Icon className={clsx(
                    'w-4 h-4 shrink-0 transition-all duration-150',
                    isActive ? 'text-amber-500' : 'text-stone-400 group-hover:text-stone-600 group-hover:scale-110'
                  )} />
                  <span>{item.label}</span>
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
  { label: 'Library', items: ADMIN_ITEMS.filter(i => ['families', 'materials', 'specifications', 'design-rules', 'tank-families'].includes(i.id)) },
  { label: 'Documents', items: ADMIN_ITEMS.filter(i => ['document-register'].includes(i.id)) },
  { label: 'System', items: ADMIN_ITEMS.filter(i => ['categories', 'roles', 'users', 'csv-import'].includes(i.id)) },
];

function AdminPopup({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', keyHandler); };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute bottom-14 left-2 right-2 bg-white border border-stone-200 rounded-xl shadow-2xl z-50 overflow-hidden animate-fade-in-up"
    >
      <div className="px-3 py-2.5 border-b border-stone-100 bg-stone-50/60">
        <span className="text-[10px] font-bold text-stone-400 uppercase tracking-[0.12em]">Platform Admin</span>
      </div>
      <div className="py-1 max-h-[70vh] overflow-y-auto">
        {ADMIN_GROUPS.map((group, gi) => (
          <div key={group.label}>
            {gi > 0 && <div className="border-t border-stone-100 my-1" />}
            <div className="px-3 pt-2 pb-0.5 text-[10px] font-bold text-stone-300 uppercase tracking-[0.12em]">{group.label}</div>
            {group.items.map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => { navigate(item.to); onClose(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50 hover:text-amber-600 transition-all duration-150 text-left group"
                >
                  <Icon className="w-4 h-4 shrink-0 text-stone-400 group-hover:text-amber-500 transition-colors duration-150" />
                  <span>{item.label}</span>
                  <ChevronRight className="w-3.5 h-3.5 ml-auto text-stone-300 group-hover:text-amber-400 group-hover:translate-x-0.5 transition-all duration-150" />
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
    ? 'bg-white text-amber-600 font-semibold shadow-sm border border-stone-200/70'
    : 'text-stone-500 hover:bg-white/70 hover:text-stone-800 hover:shadow-sm'
);

export default function LeftNav() {
  const [orders, setOrders] = useState<Record<string, string[]>>(loadOrders);
  const [showAdmin, setShowAdmin] = useState(false);

  const handleOrderChange = (sectionId: string, newOrder: string[]) => {
    const next = { ...orders, [sectionId]: newOrder };
    setOrders(next);
    saveOrders(next);
  };

  return (
    <nav className="w-56 flex flex-col h-full shrink-0 relative border-r border-stone-200/80 shadow-[1px_0_0_0_rgba(0,0,0,0.03)]"
      style={{ background: 'linear-gradient(180deg, #f6f5f3 0%, #f1efed 100%)' }}>

      <div className="px-4 py-4 border-b border-stone-200/80">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-md"
            style={{ background: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)' }}>
            <LayoutDashboard className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-stone-800 text-sm font-bold leading-tight tracking-tight">Shark OS</div>
            <div className="text-stone-400 text-[11px]">Engineering Platform</div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        <div className="px-1 space-y-0.5">
          {([
            { to: '/', icon: Home, label: 'Home', end: true },
            { to: '/search', icon: Search, label: 'Search' },
            { to: '/graph', icon: Network, label: 'Graph Explorer' },
          ] as const).map(({ to, icon: Icon, label, end }: any) => (
            <NavLink key={to} to={to} end={end} className={navLinkClass}>
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-amber-500 rounded-r-full" />
                  )}
                  <Icon className={clsx(
                    'w-4 h-4 shrink-0 transition-all duration-150',
                    isActive ? 'text-amber-500' : 'text-stone-400 group-hover:text-stone-600 group-hover:scale-110'
                  )} />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>

        {SECTIONS.map(section => (
          <DraggableSection
            key={section.id}
            section={section}
            savedOrder={orders[section.id]}
            onOrderChange={handleOrderChange}
          />
        ))}
      </div>

      <div className="border-t border-stone-200/80 p-2">
        <button
          onClick={() => setShowAdmin(v => !v)}
          className={clsx(
            'w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-all duration-150 group',
            showAdmin
              ? 'bg-white text-amber-600 font-semibold shadow-sm border border-stone-200/70'
              : 'text-stone-500 hover:bg-white/70 hover:text-stone-800 hover:shadow-sm'
          )}
        >
          <Settings className={clsx(
            'w-4 h-4 shrink-0 transition-all duration-150',
            showAdmin ? 'text-amber-500' : 'text-stone-400 group-hover:text-stone-600 group-hover:rotate-45'
          )} />
          <span>Platform Admin</span>
          <ChevronRight className={clsx('w-3.5 h-3.5 ml-auto transition-transform duration-200', showAdmin && 'rotate-90')} />
        </button>
      </div>

      {showAdmin && <AdminPopup onClose={() => setShowAdmin(false)} />}
    </nav>
  );
}
