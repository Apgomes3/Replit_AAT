import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export type CrumbItem = { label: string; href?: string };

export default function Breadcrumb({ items }: { items: CrumbItem[] }) {
  const all: CrumbItem[] = [{ label: 'Home', href: '/' }, ...items];

  return (
    <nav className="flex items-center gap-2 flex-wrap" aria-label="Breadcrumb">
      {all.map((item, i) => {
        const isFirst = i === 0;
        const isLast = i === all.length - 1;

        return (
          <span key={i} className="flex items-center gap-2">
            {i > 0 && <span className="text-stone-300 text-sm select-none">/</span>}

            {isLast ? (
              <span className="text-sm font-medium text-stone-600 truncate max-w-[200px]">
                {item.label}
              </span>
            ) : item.href ? (
              <Link
                to={item.href}
                className="flex items-center gap-1 text-sm text-stone-400 hover:text-amber-600 transition-colors duration-150 group truncate max-w-[160px]"
              >
                {isFirst && (
                  <ChevronLeft className="w-4 h-4 shrink-0 group-hover:-translate-x-0.5 transition-transform duration-150" />
                )}
                {item.label}
              </Link>
            ) : (
              <span className="text-sm text-stone-400 truncate max-w-[160px]">
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
