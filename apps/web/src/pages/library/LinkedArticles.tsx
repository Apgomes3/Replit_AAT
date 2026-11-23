// Published library articles linked to a record, for that record's page. Shows nothing when there
// are none or the person cannot use the library.
import { Link } from 'react-router-dom';
import { Library } from 'lucide-react';
import { LinkType, useLinkedArticles } from './libraryApi';
import { KindChip } from './LibraryParts';

export default function LinkedArticles({ type, id, className = '' }: { type: LinkType; id: string | undefined; className?: string }) {
  const linked = useLinkedArticles(type, id);
  if (!linked.data?.length) return null;
  return <section aria-labelledby={`kb-linked-${type}`} className={`bg-white border border-stone-200 rounded-lg p-4 ${className}`}>
    <h2 id={`kb-linked-${type}`} className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[.1em] text-stone-500 mb-2">
      <Library className="w-3.5 h-3.5" />From the Knowledge Library
    </h2>
    <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">{linked.data.map(a => <li key={a.id} className="min-w-0">
      <Link to={`/knowledge/articles/${a.id}`} className="flex items-center gap-1.5 text-sm hover:text-blue-700 min-w-0">
        <KindChip kind={a.kind} /><span className="font-medium truncate">{a.title}</span>
        <span className="text-xs text-stone-400 shrink-0">{a.pool_name}</span>
      </Link>
    </li>)}</ul>
  </section>;
}
