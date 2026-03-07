import { NavLink, useNavigate } from 'react-router-dom';
import { FolderOpen, Package, BookOpen, FileText, Network, Search, Users, Upload, LayoutDashboard, Database, Boxes, Pipette, Container, GripVertical, ShieldCheck, Settings, ChevronRight } from 'lucide-react';
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
  {
    id: 'knowledge-hub',
    label: 'Knowledge Hub',
    items: [
      { id: 'specifications', to: '/knowledge/specifications', icon: BookOpen, label: 'Specifications' },
      { id: 'design-rules', to: '/knowledge/design-rules', icon: BookOpen, label: 'Design Rules' },
    ],
  },
  {
    id: 'documents',
    label: 'Documents',
    items: [
      { id: 'document-register', to: '/documents', icon: FileText, label: 'Document Register' },
    ],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    items: [
      { id: 'graph', to: '/graph', icon: Network, label: 'Graph Explorer' },
    ],
  },
];

const ADMIN_ITEMS: NavItemDef[] = [
  { id: 'families', to: '/products', icon: Package, label: 'Families', end: true },
  { id: 'materials', to: '/knowledge/materials', icon: BookOpen, label: 'Materials' },
  { id: 'categories', to: '/admin/categories', icon: Boxes, label: 'Categories' },
  { id: 'roles', to: '/admin/roles', icon: ShieldCheck, label: 'Roles' },
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
      <div className="pt-4 pb-1.5 px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">{section.label}</div>
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
              isOver && 'ring-1 ring-[#3E5C76]/30 ring-inset bg-blue-50',
            )}
          >
            <div className="absolute left-0 top-0 bottom-0 flex items-center pl-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing z-10">
              <GripVertical className="w-3 h-3 text-slate-300" />
            </div>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) => clsx(
                'flex-1 flex items-center gap-2.5 pl-6 pr-3 py-2 text-sm rounded-lg transition-colors',
                isActive
                  ? 'bg-[#3E5C76] text-white font-medium shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
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
      className="absolute bottom-14 left-2 right-2 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 overflow-hidden"
    >
      <div className="px-3 py-2.5 border-b border-slate-100">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Platform Admin</span>
      </div>
      <div className="py-1">
        {ADMIN_ITEMS.map(item => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => { navigate(item.to); onClose(); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors text-left"
            >
              <Icon className="w-4 h-4 shrink-0 text-slate-400" />
              <span>{item.label}</span>
              <ChevronRight className="w-3.5 h-3.5 ml-auto text-slate-300" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function LeftNav() {
  const [orders, setOrders] = useState<Record<string, string[]>>(loadOrders);
  const [showAdmin, setShowAdmin] = useState(false);

  const handleOrderChange = (sectionId: string, newOrder: string[]) => {
    const next = { ...orders, [sectionId]: newOrder };
    setOrders(next);
    saveOrders(next);
  };

  return (
    <nav className="w-56 bg-white border-r border-slate-200 flex flex-col h-full shrink-0 relative">
      <div className="px-4 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#3E5C76] flex items-center justify-center shrink-0">
            <Database className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-slate-800 text-sm font-semibold leading-tight">ASW Library</div>
            <div className="text-slate-400 text-xs">Eng. Data Platform</div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        <div className="px-1 space-y-0.5">
          <NavLink to="/" end className={({ isActive }) => clsx(
            'flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors mx-1',
            isActive ? 'bg-[#3E5C76] text-white font-medium shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
          )}>
            <LayoutDashboard className="w-4 h-4 shrink-0" /><span>Dashboard</span>
          </NavLink>
          <NavLink to="/projects" className={({ isActive }) => clsx(
            'flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors mx-1',
            isActive ? 'bg-[#3E5C76] text-white font-medium shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
          )}>
            <FolderOpen className="w-4 h-4 shrink-0" /><span>Projects</span>
          </NavLink>
          <NavLink to="/search" className={({ isActive }) => clsx(
            'flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors mx-1',
            isActive ? 'bg-[#3E5C76] text-white font-medium shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
          )}>
            <Search className="w-4 h-4 shrink-0" /><span>Search</span>
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
      </div>

      <div className="border-t border-slate-100 p-2">
        <button
          onClick={() => setShowAdmin(v => !v)}
          className={clsx(
            'w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors',
            showAdmin
              ? 'bg-[#3E5C76] text-white font-medium shadow-sm'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
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
