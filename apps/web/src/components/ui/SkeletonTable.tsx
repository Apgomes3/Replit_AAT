interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  className?: string;
}

/**
 * Lightweight placeholder rows for list views while their first request is in flight.
 * The varied widths keep the loading state close to the shape of real tabular data.
 */
export default function SkeletonTable({ rows = 5, columns = 4, className = '' }: SkeletonTableProps) {
  return (
    <div role="status" className={`divide-y divide-stone-100 ${className}`}>
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: columns }).map((_, columnIndex) => (
            <div
              key={columnIndex}
              className={`skeleton h-3 rounded ${columnIndex === columns - 1 ? 'ml-auto w-16' : columnIndex % 3 === 0 ? 'w-24' : 'w-40'}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}