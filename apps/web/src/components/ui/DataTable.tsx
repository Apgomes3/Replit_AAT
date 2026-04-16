import { ReactNode, useState, useRef, useEffect, useCallback } from 'react';
import clsx from 'clsx';
import { GripVertical, ChevronsUpDown, ArrowUp, ArrowDown, Filter, X } from 'lucide-react';
import ContextMenu, { ContextMenuItem } from './ContextMenu';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  className?: string;
  sortable?: boolean;
  filterable?: boolean;
  sortValue?: (row: T) => string | number;
  filterValue?: (row: T) => string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  contextMenuItems?: (row: T) => ContextMenuItem[];
  loading?: boolean;
  emptyMessage?: string;
  tableId?: string;
  defaultSortable?: boolean;
}

type SortDir = 'asc' | 'desc' | null;

function loadColOrder(tableId: string): string[] | null {
  try {
    const raw = localStorage.getItem(`col-order-${tableId}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveColOrder(tableId: string, keys: string[]) {
  localStorage.setItem(`col-order-${tableId}`, JSON.stringify(keys));
}

function applyOrder<T>(columns: Column<T>[], savedKeys: string[] | null): Column<T>[] {
  if (!savedKeys) return columns;
  const map = new Map(columns.map(c => [c.key, c]));
  const ordered: Column<T>[] = [];
  for (const key of savedKeys) {
    const col = map.get(key);
    if (col) ordered.push(col);
  }
  for (const col of columns) {
    if (!ordered.find(o => o.key === col.key)) ordered.push(col);
  }
  return ordered;
}

function sortData<T extends Record<string, any>>(
  data: T[], sortKey: string | null, sortDir: SortDir, col: Column<T> | undefined
): T[] {
  if (!sortKey || !sortDir || !col) return data;
  return [...data].sort((a, b) => {
    const av = col.sortValue ? col.sortValue(a) : a[sortKey] ?? '';
    const bv = col.sortValue ? col.sortValue(b) : b[sortKey] ?? '';
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv), undefined, { numeric: true });
    return sortDir === 'asc' ? cmp : -cmp;
  });
}

function filterData<T extends Record<string, any>>(
  data: T[], filters: Record<string, string>, cols: Column<T>[]
): T[] {
  const active = Object.entries(filters).filter(([, v]) => v.trim() !== '');
  if (active.length === 0) return data;
  return data.filter(row =>
    active.every(([key, val]) => {
      const col = cols.find(c => c.key === key);
      const raw = col?.filterValue ? col.filterValue(row) : String(row[key] ?? '');
      return raw.toLowerCase().includes(val.toLowerCase().trim());
    })
  );
}

export default function DataTable<T extends Record<string, any>>({
  columns, data, onRowClick, contextMenuItems, loading,
  emptyMessage = 'No records found', tableId, defaultSortable = false,
}: DataTableProps<T>) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; row: T } | null>(null);
  const [orderedCols, setOrderedCols] = useState<Column<T>[]>(() =>
    tableId ? applyOrder(columns, loadColOrder(tableId)) : columns
  );
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    setOrderedCols(tableId ? applyOrder(columns, loadColOrder(tableId)) : columns);
  }, [columns.map(c => c.key).join(',')]);

  const dragIdx = useRef<number | null>(null);
  const overIdx = useRef<number | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const didDrag = useRef(false);

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    dragIdx.current = idx;
    didDrag.current = false;
    setDraggingKey(orderedCols[idx].key);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    didDrag.current = true;
    e.dataTransfer.dropEffect = 'move';
    overIdx.current = idx;
    setOverKey(orderedCols[idx].key);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const from = dragIdx.current;
    const to = overIdx.current;
    if (from === null || to === null || from === to) return;
    const next = [...orderedCols];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrderedCols(next);
    if (tableId) saveColOrder(tableId, next.map(c => c.key));
    dragIdx.current = null;
    overIdx.current = null;
  };

  const handleDragEnd = () => {
    setDraggingKey(null);
    setOverKey(null);
    dragIdx.current = null;
    overIdx.current = null;
  };

  const handleHeaderClick = useCallback((col: Column<T>) => {
    if (didDrag.current) { didDrag.current = false; return; }
    const isSortable = col.sortable ?? defaultSortable;
    if (!isSortable) return;
    if (sortKey === col.key) {
      if (sortDir === 'asc') setSortDir('desc');
      else if (sortDir === 'desc') { setSortKey(null); setSortDir(null); }
      else setSortDir('asc');
    } else {
      setSortKey(col.key);
      setSortDir('asc');
    }
  }, [sortKey, sortDir, defaultSortable]);

  const activeFilterCount = Object.values(filters).filter(v => v.trim() !== '').length;
  const hasFilterableCols = orderedCols.some(c => c.filterable);

  const cols = tableId ? orderedCols : columns;
  const activeSortCol = cols.find(c => c.key === sortKey);
  const processed = filterData(sortData(data, sortKey, sortDir, activeSortCol), filters, cols);

  if (loading) return (
    <div className="divide-y divide-stone-100">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <div className="skeleton h-3 w-20 rounded" />
          <div className="skeleton h-3 w-40 rounded" />
          <div className="skeleton h-3 w-24 rounded" />
          <div className="ml-auto skeleton h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {hasFilterableCols && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-stone-100 bg-stone-50/60">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            {showFilters && cols.filter(c => c.filterable).map(col => (
              <div key={col.key} className="relative flex items-center">
                <input
                  value={filters[col.key] || ''}
                  onChange={e => setFilters(f => ({ ...f, [col.key]: e.target.value }))}
                  placeholder={col.header}
                  className={clsx(
                    'h-7 pl-2.5 pr-7 text-xs rounded-lg border outline-none transition-all w-36',
                    filters[col.key]
                      ? 'border-amber-400 bg-amber-50/60 text-stone-800 placeholder:text-amber-400'
                      : 'border-stone-200 bg-white text-stone-700 placeholder:text-stone-400 focus:border-amber-400'
                  )}
                />
                {filters[col.key] && (
                  <button
                    onClick={() => setFilters(f => { const n = { ...f }; delete n[col.key]; return n; })}
                    className="absolute right-1.5 text-stone-400 hover:text-stone-600 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
            {activeFilterCount > 0 && (
              <span className="text-xs text-stone-400">
                {processed.length} of {data.length} rows
              </span>
            )}
          </div>
          <button
            onClick={() => { setShowFilters(v => !v); if (showFilters) setFilters({}); }}
            className={clsx(
              'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all shrink-0',
              showFilters
                ? 'bg-amber-50 border-amber-300 text-amber-700 font-medium'
                : 'bg-white border-stone-200 text-stone-500 hover:border-amber-300 hover:text-amber-600'
            )}
          >
            <Filter className="w-3 h-3" />
            {showFilters ? 'Hide Filters' : 'Filters'}
            {activeFilterCount > 0 && (
              <span className="bg-amber-500 text-white rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      )}

      <div className="overflow-x-auto flex-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-stone-50 border-b border-stone-200">
              {cols.map((col, idx) => {
                const isDragging = draggingKey === col.key;
                const isOver = overKey === col.key && draggingKey !== col.key;
                const isSortable = col.sortable ?? defaultSortable;
                const isActiveSort = sortKey === col.key;
                const SortIcon = isActiveSort
                  ? (sortDir === 'asc' ? ArrowUp : ArrowDown)
                  : ChevronsUpDown;

                return (
                  <th
                    key={col.key}
                    draggable={!!tableId}
                    onDragStart={tableId ? e => handleDragStart(e, idx) : undefined}
                    onDragOver={tableId ? e => handleDragOver(e, idx) : undefined}
                    onDrop={tableId ? handleDrop : undefined}
                    onDragEnd={tableId ? handleDragEnd : undefined}
                    onClick={() => handleHeaderClick(col)}
                    className={clsx(
                      'group text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wide whitespace-nowrap select-none transition-colors duration-100',
                      col.className,
                      isActiveSort ? 'text-amber-600 bg-amber-50/60' : 'text-stone-500',
                      isDragging && 'opacity-40',
                      isOver && 'bg-amber-50 text-amber-600',
                      (isSortable || tableId) && 'cursor-pointer hover:bg-stone-100',
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      {tableId && (
                        <GripVertical className="w-3 h-3 text-stone-300 group-hover:text-stone-400 shrink-0 -ml-1" />
                      )}
                      <span>{col.header}</span>
                      {isSortable && (
                        <SortIcon className={clsx(
                          'w-3 h-3 shrink-0 transition-opacity',
                          isActiveSort ? 'opacity-100 text-amber-500' : 'opacity-0 group-hover:opacity-40'
                        )} />
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {processed.length === 0 ? (
              <tr>
                <td colSpan={cols.length} className="text-center py-12 text-stone-400 text-sm">
                  {activeFilterCount > 0 ? `No rows match the active filters` : emptyMessage}
                </td>
              </tr>
            ) : processed.map((row, i) => (
              <tr
                key={row.id || i}
                onClick={() => onRowClick?.(row)}
                onContextMenu={contextMenuItems
                  ? e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, row }); }
                  : undefined}
                className={clsx(
                  'border-b border-stone-100 transition-colors duration-100',
                  onRowClick && 'cursor-pointer hover:bg-amber-50/40 hover:border-l-2 hover:border-l-amber-300',
                  !onRowClick && contextMenuItems && 'hover:bg-stone-50',
                )}
              >
                {cols.map(col => (
                  <td key={col.key} className={clsx('px-4 py-3 text-stone-700', col.className)}>
                    {col.render ? col.render(row) : row[col.key] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ctxMenu && contextMenuItems && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          items={contextMenuItems(ctxMenu.row)}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
