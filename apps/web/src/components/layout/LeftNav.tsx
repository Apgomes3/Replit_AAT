import { NavLink } from 'react-router-dom';
import { FolderOpen, Package, BookOpen, FileText, Network, Search, Users, Upload, LayoutDashboard, Database, Boxes, Pipette, Container, GripVertical } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';

type NavItemDef = { id: string; to: string; icon: any; label: string; end?: boolean };

const SECTIONS: { id: string; label: string; items: NavItemDef[] }[] = [
  {
    id: 'asw-library',
    label: 'ASW Library',
    items: [
      { id: 'families', to: '/products', icon: Package, label: 'Families', end: true },
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
      { id: 'materials', to: '/knowledge/materials', icon: BookOpen, label: 'Materials' },
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
  {
    id: 'admin',
    label: 'Admin',
    items: [
      { id: 'users', to: '/admin/users', icon: Users, label: 'Users' },
      { id: 'csv-import', to: '/admin/import', icon: Upload, label: 'CSV Import' },
    ],
  },
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
      <div className="pt-2 pb-1 px-3 text-xs text-[#748CAB] uppercase tracking-wider">{section.label}</div>
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
              'group relative flex items-center rounded-md transition-all',
              isDragging && 'opacity-40',
              isOver && 'ring-1 ring-[#3E5C76] ring-inset bg-[#2d3d5c]/40',
            )}
          >
            <div className="absolute left-0 top-0 bottom-0 flex items-center pl-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing z-10">
              <GripVertical className="w-3 h-3 text-[#748CAB]" />
            </div>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) => clsx(
                'flex-1 flex items-center gap-2.5 pl-5 pr-3 py-2 text-sm rounded-md transition-colors',
                isActive ? 'bg-[#3E5C76] text-white' : 'text-[#A8C4E0] hover:bg-[#2d3d5c] hover:text-white'
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

export default function LeftNav() {
  const [orders, setOrders] = useState<Record<string, string[]>>(loadOrders);

  const handleOrderChange = (sectionId: string, newOrder: string[]) => {
    const next = { ...orders, [sectionId]: newOrder };
    setOrders(next);
    saveOrders(next);
  };

  return (
    <nav className="w-56 bg-[#1F2A44] flex flex-col h-full shrink-0">
      <div className="p-4 border-b border-[#2d3d5c]">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-[#3E5C76]" />
          <div>
            <div className="text-white text-sm font-semibold leading-tight">Eng. Data</div>
            <div className="text-[#748CAB] text-xs">Platform v0.1</div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        <NavLink to="/" end className={({ isActive }) => clsx(
          'flex items-center gap-2.5 px-3 py-2 text-sm rounded-md transition-colors',
          isActive ? 'bg-[#3E5C76] text-white' : 'text-[#A8C4E0] hover:bg-[#2d3d5c] hover:text-white'
        )}>
          <LayoutDashboard className="w-4 h-4 shrink-0" /><span>Dashboard</span>
        </NavLink>
        <NavLink to="/projects" className={({ isActive }) => clsx(
          'flex items-center gap-2.5 px-3 py-2 text-sm rounded-md transition-colors',
          isActive ? 'bg-[#3E5C76] text-white' : 'text-[#A8C4E0] hover:bg-[#2d3d5c] hover:text-white'
        )}>
          <FolderOpen className="w-4 h-4 shrink-0" /><span>Projects</span>
        </NavLink>
        <NavLink to="/search" className={({ isActive }) => clsx(
          'flex items-center gap-2.5 px-3 py-2 text-sm rounded-md transition-colors',
          isActive ? 'bg-[#3E5C76] text-white' : 'text-[#A8C4E0] hover:bg-[#2d3d5c] hover:text-white'
        )}>
          <Search className="w-4 h-4 shrink-0" /><span>Search</span>
        </NavLink>

        {SECTIONS.map(section => (
          <DraggableSection
            key={section.id}
            section={section}
            savedOrder={orders[section.id]}
            onOrderChange={handleOrderChange}
          />
        ))}
      </div>
    </nav>
  );
}
