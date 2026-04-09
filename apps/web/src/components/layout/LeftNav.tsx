import { NavLink, useNavigate } from 'react-router-dom';
import { FolderOpen, Package, BookOpen, FileText, Network, Search, Users, Upload, LayoutDashboard, Database, Boxes, Pipette, Container, GripVertical, Settings, ChevronRight, Ruler, ShoppingCart } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';

type NavItemDef = { id: string; to: string; icon: any; label: string; end?: boolean };

const SECTIONS: { id: string; label: string; items: NavItemDef[] }[] = [
  {
    id: 'asw-library',
    label: 'ASW Library',
    items: [
      { id: 'products', to: '/products/masters', icon: Package, label: 'Products' },
      { id: 'components', to: '/products/components', icon: Boxes, label: 'Components' },
      { id: 'piping', to: '/products/piping', icon: Pipette, label: 'Pipes & Fittings' },
      { id: 'tanks', to: '/products/tanks', icon: Container, label: 'Tanks' },
    ],
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
  } catch {
    return {};
  }
}

function saveOrders(orders: Record<string, string[]>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
}

function applySectionOrder(section: typeof SECTIONS[0], savedIds: string[] | undefined): NavItemDef[] {
  if (!savedIds || savedIds.length === 0) return section.items;
  const map = new Map(section.items.map(i => [i.id, i]));
  const ordered: NavItemDef[] = [];
  for (const id of savedIds) {
    const item = map.get(id);
    if (item) ordered.push(item);
  }
  for (const item of section.items) {
    if (!ordered.find(o => o.id === item.id)) ordered.push(item);
  }
  return ordered;
}

function DraggableSection({ section, savedOrder, onOrderChange }: {
  section: typeof SECTIONS[0];
  savedOrder: string[] | undefined;
  onOrderChange: (sectionId: string, newOrder: string[]) => void;
}) {
  const [items, setItems] = useState<NavItemDef[]>(() => applySectionOrder(section, savedOrder));
  const dragIdx = useRef<number | null>(null);
  const overIdx = useRef<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overItemId, setOverItemId] = useState<string | null>(null);

  useEffect(() => {
    setItems(applySectionOrder(section, savedOrder));
  }, []);

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
    const from = dragIdx.current;
    const to = overIdx.current;
    if (from === null || to === null || from === to) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);
    onOrderChange(section.id, next.map(i => i.id));
    dragIdx.current = null;
    overIdx.current = null;
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setOverItemId(null);
    dragIdx.current = null;
    overIdx.current = null;
  };

  return (
    <div>
      <div className="pt-4 pb-1.5 px-3 text-[10px] font-semibold text-stone-400 uppercase tracking-widest">{section.label}</div>
      {items.map((item, idx) => {
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
              isDragging && 'opacity-40',
              isOver && 'ring-1 ring-amber-500/30 ring-inset bg-amber-50',
            )}
          >
            <div className="absolute left-0 top-0 bottom-0 flex items-center pl-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing z-10">
              <GripVertical className="w-3 h-3 text-stone-300" />
            </div>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) => clsx(
                'flex-1 flex items-center gap-2.5 pl-6 pr-3 py-2 text-sm rounded-lg transition-all',
                isActive
                  ? 'bg-white text-amber-600 font-medium shadow-sm border border-stone-200/60'
                  : 'text-stone-600 hover:bg-stone-200/50 hover:text-stone-900'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          </div>
        );
      })}
    </div>
  );
}

const ADMIN_GROUPS = [
  {
    label: 'Library',
    items: ADMIN_ITEMS.filter(i => ['families', 'materials', 'specifications', 'design-rules', 'tank-families'].includes(i.id)),
  },
  {
    label: 'Documents',
    items: ADMIN_ITEMS.filter(i => ['document-register'].includes(i.id)),
  },
  {
    label: 'System',
    items: ADMIN_ITEMS.filter(i => ['categories', 'roles', 'users', 'csv-import'].includes(i.id)),
  },
];

function AdminPopup({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute bottom-14 left-2 right-2 bg-white border border-stone-200 rounded-xl shadow-2xl z-50 overflow-hidden"
    >
      <div className="px-3 py-2.5 border-b border-stone-100">
        <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest">Platform Admin</span>
      </div>
      <div className="py-1 max-h-[70vh] overflow-y-auto">
        {ADMIN_GROUPS.map((group, gi) => (
          <div key={group.label}>
            {gi > 0 && <div className="border-t border-stone-100 my-1" />}
            <div className="px-3 pt-2 pb-0.5 text-[10px] font-semibold text-stone-300 uppercase tracking-widest">{group.label}</div>
            {group.items.map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => { navigate(item.to); onClose(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 hover:text-stone-900 transition-colors text-left"
                >
                  <Icon className="w-4 h-4 shrink-0 text-stone-400" />
                  <span>{item.label}</span>
                  <ChevronRight className="w-3.5 h-3.5 ml-auto text-stone-300" />
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
  'flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-all mx-1',
  isActive
    ? 'bg-white text-amber-600 font-medium shadow-sm border border-stone-200/60'
    : 'text-stone-600 hover:bg-stone-200/50 hover:text-stone-900'
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
    <nav className="w-56 bg-stone-100 border-r border-stone-200 flex flex-col h-full shrink-0 relative">
      <div className="px-4 py-4 border-b border-stone-200">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-600 flex items-center justify-center shrink-0 shadow-sm">
            <Database className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-stone-800 text-sm font-semibold leading-tight">ASW Library</div>
            <div className="text-stone-400 text-xs">Eng. Data Platform</div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        <div className="px-1 space-y-0.5">
          <NavLink to="/" end className={navLinkClass}>
            <LayoutDashboard className="w-4 h-4 shrink-0" /><span>Dashboard</span>
          </NavLink>
          <NavLink to="/projects" className={navLinkClass}>
            <FolderOpen className="w-4 h-4 shrink-0" /><span>Projects</span>
          </NavLink>
          <NavLink to="/search" className={navLinkClass}>
            <Search className="w-4 h-4 shrink-0" /><span>Search</span>
          </NavLink>
          <NavLink to="/graph" className={navLinkClass}>
            <Network className="w-4 h-4 shrink-0" /><span>Graph Explorer</span>
          </NavLink>
        </div>

        {SECTIONS.map(section => (
          <DraggableSection
            key={section.id}
            section={section}
            savedOrder={orders[section.id]}
            onOrderChange={handleOrderChange}
          />
        ))}

        <div className="pt-4 pb-1.5 px-3 text-[10px] font-semibold text-stone-400 uppercase tracking-widest">Procurement</div>
        <div className="px-1">
          <NavLink to="/purchase-orders" className={navLinkClass}>
            <ShoppingCart className="w-4 h-4 shrink-0" /><span>Purchase Orders</span>
          </NavLink>
        </div>
      </div>

      <div className="border-t border-stone-200 p-2">
        <button
          onClick={() => setShowAdmin(v => !v)}
          className={clsx(
            'w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-all',
            showAdmin
              ? 'bg-white text-amber-600 font-medium shadow-sm border border-stone-200/60'
              : 'text-stone-600 hover:bg-stone-200/50 hover:text-stone-900'
          )}
        >
          <Settings className="w-4 h-4 shrink-0" />
          <span>Platform Admin</span>
          <ChevronRight className={clsx('w-3.5 h-3.5 ml-auto transition-transform', showAdmin && 'rotate-90')} />
        </button>
      </div>

      {showAdmin && <AdminPopup onClose={() => setShowAdmin(false)} />}
    </nav>
  );
}
