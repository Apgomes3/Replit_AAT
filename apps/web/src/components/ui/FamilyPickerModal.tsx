import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';
import { X, Search, Check } from 'lucide-react';

interface Family {
  id: string;
  product_family_code: string;
  product_family_name: string;
  category_code: string | null;
  product_count: number;
}

interface Props {
  currentFamilyId?: string | null;
  onSelect: (family: { id: string; code: string; name: string }) => void;
  onClose: () => void;
}

export default function FamilyPickerModal({ currentFamilyId, onSelect, onClose }: Props) {
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['product-families'],
    queryFn: () => api.get('/product-families').then(r => r.data),
  });

  const families: Family[] = (data?.items || []).filter((f: Family) =>
    !search.trim() ||
    f.product_family_code.toLowerCase().includes(search.toLowerCase()) ||
    f.product_family_name.toLowerCase().includes(search.toLowerCase()) ||
    (f.category_code || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-lg font-semibold text-slate-800">Change Family</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-4 py-3 border-b border-slate-100 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by code, name or category..."
              className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          {isLoading && (
            <div className="text-center py-10 text-slate-400 text-sm">Loading families...</div>
          )}
          {!isLoading && families.length === 0 && (
            <div className="text-center py-10 text-slate-400 text-sm">No families match "{search}"</div>
          )}
          {families.map(f => (
            <button
              key={f.id}
              onClick={() => onSelect({ id: f.id, code: f.product_family_code, name: f.product_family_name })}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 border-b border-slate-100 last:border-0 text-left transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{f.product_family_code}</span>
                  <span className="text-sm font-medium text-slate-800 truncate">{f.product_family_name}</span>
                </div>
                {f.category_code && (
                  <div className="text-xs text-slate-400 mt-0.5">{f.category_code}</div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-slate-400">{f.product_count} product{f.product_count !== 1 ? 's' : ''}</span>
                {f.id === currentFamilyId && <Check className="w-4 h-4 text-amber-600" />}
              </div>
            </button>
          ))}
        </div>

        <div className="px-6 py-3 border-t border-slate-200 shrink-0">
          <button
            onClick={() => onSelect({ id: '', code: '', name: '' })}
            className="text-sm text-slate-400 hover:text-slate-600 hover:underline"
          >
            Clear family assignment
          </button>
        </div>
      </div>
    </div>
  );
}
