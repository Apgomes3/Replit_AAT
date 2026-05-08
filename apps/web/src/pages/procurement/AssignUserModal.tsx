import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import api from '../../lib/api';
import { Search, X, UserCheck } from 'lucide-react';

interface Props {
  selectedCount: number;
  onAssign: (userId: string, userName: string) => void;
  onClose: () => void;
}

export default function AssignUserModal({ selectedCount, onAssign, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string } | null>(null);

  const { data } = useQuery({
    queryKey: ['po-users'],
    queryFn: () => api.get('/purchase-orders/users').then(r => r.data),
  });

  const users: any[] = Array.isArray(data) ? data : (data?.items ?? []);
  const filtered = users.filter(u =>
    !search ||
    `${u.first_name || ''} ${u.last_name || ''} ${u.email}`.toLowerCase().includes(search.toLowerCase())
  );

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md flex flex-col max-h-[80vh]">
        <div className="flex items-start justify-between p-5 border-b border-slate-100">
          <div>
            <h3 className="text-base font-semibold text-slate-800">Assign Designated User</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Assign to {selectedCount} selected PO{selectedCount > 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 -mr-1 -mt-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search users…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1 divide-y divide-slate-50">
          {filtered.length === 0 ? (
            <div className="p-6 text-sm text-slate-400 text-center">No users found</div>
          ) : (
            filtered.map((u: any) => {
              const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email;
              const isSelected = selectedUser?.id === u.id;
              return (
                <button
                  key={u.id}
                  onClick={() => setSelectedUser(isSelected ? null : { id: u.id, name })}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                    isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${
                      isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-700 truncate">{name}</div>
                    <div className="text-xs text-slate-400 truncate">{u.email}</div>
                  </div>
                  {isSelected && <UserCheck className="w-4 h-4 text-blue-600 shrink-0" />}
                </button>
              );
            })
          )}
        </div>

        <div className="p-4 border-t border-slate-100 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => selectedUser && onAssign(selectedUser.id, selectedUser.name)}
            disabled={!selectedUser}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Assign
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
