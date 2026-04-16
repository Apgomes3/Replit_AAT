import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

export type CrumbItem = { label: string; href?: string };

export default function Breadcrumb({ items }: { items: CrumbItem[] }) {
  const all: CrumbItem[] = [{ label: 'Home', href: '/' }, ...items];

  return (
    <nav className="flex items-center gap-0.5 flex-wrap" aria-label="Breadcrumb">
      {all.map((item, i) => {
        const isFirst = i === 0;
        const isLast = i === all.length - 1;

        return (
          <span key={i} className="flex items-center gap-0.5">
            {i > 0 && <ChevronRight className="w-3 h-3 text-stone-300 shrink-0 mx-0.5" />}

            {isLast ? (
              <span className="text-xs font-medium text-stone-600 truncate max-w-[200px]">
                {item.label}
              </span>
            ) : item.href ? (
              <Link
                to={item.href}
                className="flex items-center gap-1 text-xs text-stone-400 hover:text-amber-600 transition-colors duration-150 truncate max-w-[140px]"
              >
                {isFirst && <Home className="w-3 h-3 shrink-0" />}
                {!isFirst && item.label}
              </Link>
            ) : (
              <span className="text-xs text-stone-400 truncate max-w-[140px]">
                {isFirst && <Home className="w-3 h-3 shrink-0 inline mr-0.5" />}
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
