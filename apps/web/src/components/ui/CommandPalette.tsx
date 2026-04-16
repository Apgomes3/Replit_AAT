import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search, X, ArrowRight, Package, FolderOpen, Network,
  Wrench, BookOpen, FileText, Clock, Hash, ExternalLink,
} from 'lucide-react';
import clsx from 'clsx';
import api from '../../lib/api';
import { useCommandPalette } from '../../store/commandPaletteStore';

const RECENT_KEY = 'cmd-palette-recent';
const MAX_RECENT = 6;

type SearchResult = {
  id: number | string;
  type: string;
  code: string | null;
  name: string;
  status?: string;
  project_code?: string;
  system_id?: number;
};

type RecentItem = { href: string; label: string; code?: string; type: string };

const TYPE_CONFIG: Record<string, { label: string; icon: any; color: string; dot: string }> = {
  project:   { label: 'Project',   icon: FolderOpen, color: 'text-blue-600',   dot: 'bg-blue-500'   },
  system:    { label: 'System',    icon: Network,    color: 'text-sky-600',    dot: 'bg-sky-500'    },
  equipment: { label: 'Equipment', icon: Wrench,     color: 'text-indigo-600', dot: 'bg-indigo-500' },
  product:   { label: 'Product',   icon: Package,    color: 'text-amber-600',  dot: 'bg-amber-500'  },
  material:  { label: 'Material',  icon: BookOpen,   color: 'text-stone-500',  dot: 'bg-stone-400'  },
  document:  { label: 'Document',  icon: FileText,   color: 'text-orange-600', dot: 'bg-orange-500' },
};

function getHref(r: SearchResult): string {
  switch (r.type) {
    case 'project':   return `/projects/${r.id}`;
    case 'system':    return `/systems/${r.id}`;
    case 'equipment': return (r as any).system_id ? `/systems/${(r as any).system_id}` : `/projects/${r.id}`;
    case 'product':   return `/products/masters/${r.id}`;
    case 'material':  return `/knowledge/materials`;
    case 'document':  return `/documents/${r.id}`;
    default:          return '/search';
  }
}

function loadRecent(): RecentItem[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}

function saveRecent(item: RecentItem) {
  const prev = loadRecent().filter(r => r.href !== item.href);
  localStorage.setItem(RECENT_KEY, JSON.stringify([item, ...prev].slice(0, MAX_RECENT)));
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function CommandPalette() {
  const { isOpen, open, close } = useCommandPalette();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(-1);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const debouncedQ = useDebounce(query, 280);

  const { data, isFetching } = useQuery({
    queryKey: ['cmd-search', debouncedQ],
    queryFn: () => api.get(`/search?q=${encodeURIComponent(debouncedQ)}`).then(r => r.data),
    enabled: debouncedQ.trim().length >= 2,
    staleTime: 10000,
  });

  const results: SearchResult[] = data?.results ?? [];

  const grouped = results.reduce((acc: Record<string, SearchResult[]>, r) => {
    (acc[r.type] = acc[r.type] || []).push(r);
    return acc;
  }, {});

  const flatResults: { result: SearchResult; href: string }[] = Object.values(grouped)
    .flat()
    .map(r => ({ result: r, href: getHref(r) }));

  useEffect(() => {
    if (!isOpen) { setQuery(''); setCursor(-1); return; }
    setRecent(loadRecent());
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [isOpen]);

  useEffect(() => { setCursor(-1); }, [debouncedQ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        isOpen ? close() : open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, open, close]);

  const navigate_ = useCallback((href: string, item: RecentItem) => {
    saveRecent(item);
    navigate(href);
    close();
  }, [navigate, close]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { close(); return; }
    if (flatResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(c => Math.min(c + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, -1));
    } else if (e.key === 'Enter' && cursor >= 0) {
      const { result, href } = flatResults[cursor];
      navigate_(href, {
        href,
        label: result.name,
        code: result.code ?? undefined,
        type: result.type,
      });
    }
  };

  useEffect(() => {
    if (cursor < 0) return;
    const el = listRef.current?.querySelector(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!isOpen) return null;

  const showRecent = debouncedQ.trim().length < 2;
  const showResults = !showRecent && results.length > 0;
  const showEmpty = !showRecent && !isFetching && debouncedQ.trim().length >= 2 && results.length === 0;
  const showLoading = !showRecent && isFetching && debouncedQ.trim().length >= 2;

  let flatIdx = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
      onMouseDown={e => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="absolute inset-0 bg-stone-900/30 backdrop-blur-sm" onClick={close} />

      <div
        className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl ring-1 ring-stone-200/80 overflow-hidden animate-fade-in-up"
        style={{ animationDuration: '150ms' }}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-stone-100">
          <Search className={clsx(
            'w-4 h-4 shrink-0 transition-colors',
            isFetching ? 'text-amber-500 animate-pulse' : 'text-stone-400'
          )} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search products, projects, documents…"
            className="flex-1 text-sm text-stone-800 placeholder:text-stone-400 outline-none bg-transparent"
          />
          <div className="flex items-center gap-2 shrink-0">
            {query && (
              <button onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                className="text-stone-400 hover:text-stone-600 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[10px] font-medium text-stone-400">
              esc
            </kbd>
          </div>
        </div>

        <div ref={listRef} className="max-h-[420px] overflow-y-auto overscroll-contain">
          {showRecent && (
            <div>
              {recent.length > 0 ? (
                <>
                  <div className="flex items-center justify-between px-4 pt-3 pb-1">
                    <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Recent</span>
                    <button
                      onClick={() => { localStorage.removeItem(RECENT_KEY); setRecent([]); }}
                      className="text-[10px] text-stone-400 hover:text-stone-600 transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                  {recent.map(item => {
                    const cfg = TYPE_CONFIG[item.type] ?? TYPE_CONFIG['product'];
                    const Icon = cfg.icon;
                    return (
                      <button key={item.href} onClick={() => navigate_(item.href, item)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50 transition-colors group text-left">
                        <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', cfg.dot)} />
                        <Icon className={clsx('w-3.5 h-3.5 shrink-0', cfg.color)} />
                        {item.code && <span className="font-mono text-xs text-stone-400 shrink-0">{item.code}</span>}
                        <span className="text-sm text-stone-600 truncate flex-1">{item.label}</span>
                        <Clock className="w-3 h-3 text-stone-300 shrink-0" />
                      </button>
                    );
                  })}
                </>
              ) : (
                <div className="px-4 py-8 text-center">
                  <Search className="w-8 h-8 text-stone-200 mx-auto mb-2" />
                  <p className="text-sm text-stone-400">Search across products, projects, documents and more</p>
                  <p className="text-xs text-stone-300 mt-1">Type at least 2 characters to start</p>
                </div>
              )}

              <div className="px-4 pt-2 pb-3 border-t border-stone-50 mt-1">
                <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">Quick nav</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { label: 'Products', href: '/products/masters' },
                    { label: 'Projects', href: '/projects' },
                    { label: 'Purchase Orders', href: '/purchase-orders' },
                    { label: 'Components', href: '/products/components' },
                    { label: 'Documents', href: '/documents' },
                    { label: 'Graph', href: '/graph' },
                  ].map(link => (
                    <button key={link.href}
                      onClick={() => { navigate(link.href); close(); }}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-stone-50 hover:bg-amber-50 hover:text-amber-700 text-xs text-stone-500 transition-colors text-left group">
                      <Hash className="w-2.5 h-2.5 shrink-0 group-hover:text-amber-500" />
                      {link.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {showLoading && (
            <div className="divide-y divide-stone-50">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="skeleton w-1.5 h-1.5 rounded-full shrink-0" />
                  <div className="skeleton h-3 w-16 shrink-0" />
                  <div className="skeleton h-3 w-48" />
                  <div className="ml-auto skeleton h-5 w-14 rounded-full shrink-0" />
                </div>
              ))}
            </div>
          )}

          {showEmpty && (
            <div className="px-4 py-10 text-center">
              <Search className="w-8 h-8 text-stone-200 mx-auto mb-2" />
              <p className="text-sm text-stone-400">No results for "<span className="font-medium text-stone-600">{debouncedQ}</span>"</p>
              <p className="text-xs text-stone-300 mt-1">Try a different term or browse via the nav</p>
            </div>
          )}

          {showResults && Object.entries(grouped).map(([type, items]) => {
            const cfg = TYPE_CONFIG[type] ?? TYPE_CONFIG['product'];
            const Icon = cfg.icon;
            return (
              <div key={type}>
                <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                  <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', cfg.dot)} />
                  <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">
                    {cfg.label}s
                  </span>
                  <span className="text-[10px] text-stone-300 ml-auto">{items.length}</span>
                </div>
                {items.map(r => {
                  flatIdx++;
                  const idx = flatIdx;
                  const href = getHref(r);
                  const isHighlighted = cursor === idx;
                  return (
                    <button
                      key={r.id}
                      data-idx={idx}
                      onClick={() => navigate_(href, {
                        href,
                        label: r.name,
                        code: r.code ?? undefined,
                        type: r.type,
                      })}
                      className={clsx(
                        'w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left group border-l-2',
                        isHighlighted
                          ? `bg-amber-50 border-amber-400`
                          : 'border-transparent hover:bg-stone-50 hover:border-stone-200'
                      )}
                    >
                      <Icon className={clsx('w-3.5 h-3.5 shrink-0', isHighlighted ? cfg.color : 'text-stone-300 group-hover:' + cfg.color)} />
                      {r.code && (
                        <span className="font-mono text-xs text-stone-400 shrink-0 bg-stone-100 rounded px-1 py-0.5">
                          {r.code}
                        </span>
                      )}
                      <span className={clsx('text-sm truncate flex-1 transition-colors',
                        isHighlighted ? 'text-stone-900 font-medium' : 'text-stone-600 group-hover:text-stone-800'
                      )}>
                        {r.name}
                      </span>
                      {r.project_code && (
                        <span className="text-xs text-stone-300 shrink-0 hidden sm:block">{r.project_code}</span>
                      )}
                      {r.status && (
                        <span className="text-[10px] text-stone-400 shrink-0">{r.status}</span>
                      )}
                      <ArrowRight className={clsx(
                        'w-3 h-3 shrink-0 transition-all',
                        isHighlighted ? 'text-amber-500 translate-x-0' : 'text-stone-200 -translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100'
                      )} />
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between px-4 py-2.5 border-t border-stone-100 bg-stone-50/60">
          <div className="flex items-center gap-3 text-[11px] text-stone-400">
            <span className="flex items-center gap-1">
              <kbd className="inline-flex items-center rounded border border-stone-200 bg-white px-1 py-0.5 text-[10px] text-stone-500">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="inline-flex items-center rounded border border-stone-200 bg-white px-1 py-0.5 text-[10px] text-stone-500">↵</kbd>
              open
            </span>
            <span className="flex items-center gap-1">
              <kbd className="inline-flex items-center rounded border border-stone-200 bg-white px-1 py-0.5 text-[10px] text-stone-500">esc</kbd>
              close
            </span>
          </div>
          {debouncedQ.trim().length >= 2 && (
            <button
              onClick={() => { navigate(`/search?q=${encodeURIComponent(debouncedQ)}`); close(); }}
              className="flex items-center gap-1 text-[11px] text-amber-600 hover:text-amber-700 font-medium transition-colors"
            >
              Full results <ExternalLink className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
