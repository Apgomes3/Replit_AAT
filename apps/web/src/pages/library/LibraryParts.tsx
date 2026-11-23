// Small pieces shared by the library pages: pool icons, article rows and badges.
import { Link } from 'react-router-dom';
import {
  Banknote, BookOpen, Cog, Droplets, HardHat, Lock, PenTool, ShieldCheck, Square, Users,
} from 'lucide-react';
import { ArticleKind, ArticleSummary, fmtDate, KIND_LABEL, KIND_TONE, reviewState } from './libraryApi';

const ICONS: Record<string, typeof BookOpen> = {
  cog: Cog, droplets: Droplets, square: Square, 'hard-hat': HardHat, 'pen-tool': PenTool, shield: ShieldCheck, banknote: Banknote, users: Users, book: BookOpen,
};
export const PoolIcon = ({ icon, className = 'w-5 h-5' }: { icon: string; className?: string }) => {
  const I = ICONS[icon] ?? BookOpen;
  return <I className={className} aria-hidden />;
};

export const KindChip = ({ kind }: { kind: ArticleKind }) =>
  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${KIND_TONE[kind]}`}>{KIND_LABEL[kind]}</span>;

export const Restricted = () => <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded"><Lock className="w-3 h-3" />Restricted</span>;

export function StatusChips({ a }: { a: Pick<ArticleSummary, 'status' | 'in_review' | 'review_by' | 'has_unpublished_changes'> }) {
  const review = a.status === 'published' ? reviewState(a.review_by) : null;
  return <>
    {a.status === 'draft' && !a.in_review && <span className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 text-[10px] font-bold uppercase">Draft</span>}
    {a.in_review && <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 text-[10px] font-bold uppercase">Waiting for approval</span>}
    {a.status === 'archived' && <span className="px-1.5 py-0.5 rounded bg-stone-200 text-stone-600 text-[10px] font-bold uppercase">Archived</span>}
    {a.has_unpublished_changes && !a.in_review && a.status === 'published' && <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 text-[10px] font-bold uppercase">Unpublished changes</span>}
    {review === 'overdue' && <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 text-[10px] font-bold uppercase">Review overdue</span>}
    {review === 'soon' && <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 text-[10px] font-bold uppercase">Review due {fmtDate(a.review_by)}</span>}
  </>;
}

export function ArticleRow({ a, showPool = false }: { a: ArticleSummary; showPool?: boolean }) {
  return <li>
    <Link to={`/knowledge/articles/${a.id}`} className="block px-4 py-3 hover:bg-stone-50">
      <div className="flex flex-wrap items-center gap-1.5">
        <KindChip kind={a.kind} />
        <span className="font-semibold text-stone-800">{a.title}</span>
        <StatusChips a={a} />
      </div>
      {(a.summary || a.excerpt) && <p className="text-sm text-stone-500 mt-0.5 line-clamp-2">{a.summary || a.excerpt}</p>}
      <div className="text-[11px] text-stone-400 mt-1 flex flex-wrap gap-x-2">
        <span className="font-mono">{a.code}</span>
        {showPool && <span>{a.pool_name}</span>}
        {a.category && <span>{a.category}</span>}
        {a.tags?.length > 0 && <span>{a.tags.map(t => `#${t}`).join(' ')}</span>}
        <span>Updated {fmtDate(a.updated_at)}</span>
      </div>
    </Link>
  </li>;
}
