import { ReactNode, useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import { GripVertical } from 'lucide-react';
import ContextMenu, { ContextMenuItem } from './ContextMenu';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  contextMenuItems?: (row: T) => ContextMenuItem[];
  loading?: boolean;
  emptyMessage?: string;
  tableId?: string;
}

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

export default function DataTable<T extends Record<string, any>>({
  columns, data, onRowClick, contextMenuItems, loading, emptyMessage = 'No records found', tableId
}: DataTableProps<T>) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; row: T } | null>(null);
  const [orderedCols, setOrderedCols] = useState<Column<T>[]>(() =>
    tableId ? applyOrder(columns, loadColOrder(tableId)) : columns
  );

  useEffect(() => {
    setOrderedCols(tableId ? applyOrder(columns, loadColOrder(tableId)) : columns);
  }, [columns.map(c => c.key).join(',')]);

  const dragIdx = useRef<number | null>(null);
  const overIdx = useRef<number | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    dragIdx.current = idx;
    setDraggingKey(orderedCols[idx].key);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
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

  if (loading) return (
    <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Loading...</div>
  );

  const cols = tableId ? orderedCols : columns;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            {cols.map((col, idx) => {
              const isDragging = draggingKey === col.key;
              const isOver = overKey === col.key && draggingKey !== col.key;
              return (
                <th
                  key={col.key}
                  draggable={!!tableId}
                  onDragStart={tableId ? e => handleDragStart(e, idx) : undefined}
                  onDragOver={tableId ? e => handleDragOver(e, idx) : undefined}
                  onDrop={tableId ? handleDrop : undefined}
                  onDragEnd={tableId ? handleDragEnd : undefined}
                  className={clsx(
                    'group text-left px-4 py-2.5 text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap',
                    col.className,
                    tableId && 'select-none',
                    isDragging && 'opacity-40',
                    isOver && 'bg-blue-100 text-blue-700',
                    tableId && 'cursor-grab active:cursor-grabbing',
                  )}
                >
                  <div className="flex items-center gap-1">
                    {tableId && (
                      <GripVertical className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 -ml-1" />
                    )}
                    {col.header}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr><td colSpan={cols.length} className="text-center py-12 text-slate-400">{emptyMessage}</td></tr>
          ) : data.map((row, i) => (
            <tr
              key={row.id || i}
              onClick={() => onRowClick?.(row)}
              onContextMenu={contextMenuItems ? e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, row }); } : undefined}
              className={clsx(
                'border-b border-slate-100 transition-colors',
                onRowClick && 'cursor-pointer hover:bg-blue-50',
                !onRowClick && contextMenuItems && 'hover:bg-slate-50',
              )}
            >
              {cols.map(col => (
                <td key={col.key} className="px-4 py-3 text-slate-700">
                  {col.render ? col.render(row) : row[col.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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
