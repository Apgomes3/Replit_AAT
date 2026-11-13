import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import Button from '../../components/ui/Button';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import QueryError from '../../components/ui/QueryError';
import { Plus, BookMarked, FolderOpen, X, ChevronRight, PackageCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';
import { isEditorRole } from '../../lib/roles';

const SEARCH_DEBOUNCE_MS = 300;

const EMPTY_FORM = {
  book_code: '',
  book_title: '',
  project_id: '',
  description: '',
  revision: 'A',
  status: 'Draft',
};

export default function DesignBooksList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore(state => state.user);
  const canCreate = isEditorRole(user?.role);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [search]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['design-books', debouncedSearch],
    queryFn: () => api.get(`/design-books${debouncedSearch ? `?q=${encodeURIComponent(debouncedSearch)}` : ''}`).then(r => r.data),
  });

  const { data: projectsData } = useQuery({
    queryKey: ['projects-for-select'],
    queryFn: () => api.get('/projects').then(r => r.data),
    enabled: showNew,
    staleTime: 60_000,
  });

  const items: any[] = data?.items || [];
  const projects: any[] = projectsData?.items || [];
  const hasSearch = search.trim().length > 0;
  const searchIsDebouncing = search !== debouncedSearch;

  const handleCreate = async () => {
    if (!form.book_code.trim() || !form.book_title.trim()) {
      toast.error('Book code and title are required');
      return;
    }
    setSaving(true);
    try {
      const res = await api.post('/design-books', {
        ...form,
        project_id: form.project_id || null,
      });
      toast.success('Design book created');
      qc.invalidateQueries({ queryKey: ['design-books'] });
      setShowNew(false);
      setForm(EMPTY_FORM);
      navigate(`/design-books/${res.data.id}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to create design book');
    } finally {
      setSaving(false);
    }
  };

  const handleProjectPick = (projectId: string) => {
    const p = projects.find((x: any) => x.id === projectId);
    setForm(f => ({
      ...f,
      project_id: projectId,
      book_title: f.book_title || (p ? `${p.project_name} — Design Book` : f.book_title),
      book_code: f.book_code || (p ? `DB-${p.project_code}` : f.book_code),
    }));
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Design Books"
        subtitle="Engineering design documentation for aquarium projects"
        actions={canCreate ? (
          <Button onClick={() => setShowNew(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> New Design Book
          </Button>
        ) : undefined}
      />

      {/* Search */}
      <div className="mt-6 mb-4">
        <input
          type="text"
          placeholder="Search by code, title or project…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-md border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 bg-white"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        {isLoading || searchIsDebouncing ? (
          <div className="py-16 text-center text-stone-400 text-sm">Loading…</div>
        ) : isError ? (
          <QueryError
            message="Could not load design books"
            onRetry={() => refetch()}
          />
        ) : items.length === 0 ? (
          hasSearch ? (
            <div className="py-16 text-center">
              <BookMarked className="w-10 h-10 text-stone-300 mx-auto mb-3" />
              <p className="text-stone-500 font-medium">No design books found for “{search}”</p>
              <p className="text-stone-400 text-sm mt-1">Try a different code, title or project</p>
              <button
                onClick={() => setSearch('')}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 border border-stone-200 text-stone-600 rounded-lg text-sm font-medium hover:bg-stone-50"
              >
                Clear search
              </button>
            </div>
          ) : (
            <div className="py-16 text-center">
              <BookMarked className="w-10 h-10 text-stone-300 mx-auto mb-3" />
              <p className="text-stone-500 font-medium">No design books yet</p>
              <p className="text-stone-400 text-sm mt-1">Create one from scratch or link to an existing project</p>
              {canCreate && <button
                onClick={() => setShowNew(true)}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" /> New Design Book
              </button>}
            </div>
          )
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Code</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Title</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Project</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Rev</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Created By</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Equipment</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {items.map((book: any) => (
                <tr
                  key={book.id}
                  onClick={() => navigate(`/design-books/${book.id}`)}
                  className="border-b border-stone-100 hover:bg-blue-50/40 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <EntityCode code={book.book_code} />
                  </td>
                  <td className="px-4 py-3 font-medium text-stone-800">{book.book_title}</td>
                  <td className="px-4 py-3">
                    {book.project_code ? (
                      <span className="inline-flex items-center gap-1.5 text-stone-600">
                        <FolderOpen className="w-3.5 h-3.5 text-stone-400" />
                        <span className="font-mono text-xs text-stone-500">{book.project_code}</span>
                        <span className="text-stone-700 text-xs">{book.project_name}</span>
                      </span>
                    ) : (
                      <span className="text-stone-400 text-xs italic">Standalone</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded">Rev {book.revision}</span>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={book.status} /></td>
                  <td className="px-4 py-3 text-stone-500 text-xs">{book.created_by_name || '—'}</td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/design-books/${book.id}?tab=equipment-breakdown`}
                      onClick={event => event.stopPropagation()}
                      className="inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                      aria-label={`Open Equipment Breakdown for ${book.book_title}`}
                    >
                      <PackageCheck className="h-3.5 w-3.5" />
                      Equipment Breakdown
                    </Link>
                  </td>
                  <td className="px-4 py-3"><ChevronRight className="w-4 h-4 text-stone-400" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* New Design Book Modal */}
      {showNew && canCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200">
              <div className="flex items-center gap-2.5">
                <BookMarked className="w-5 h-5 text-blue-600" />
                <h2 className="font-semibold text-stone-800">New Design Book</h2>
              </div>
              <button onClick={() => { setShowNew(false); setForm(EMPTY_FORM); }} className="text-stone-400 hover:text-stone-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Link to project */}
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1.5">Link to Project <span className="text-stone-400 font-normal">(optional)</span></label>
                <select
                  value={form.project_id}
                  onChange={e => e.target.value ? handleProjectPick(e.target.value) : setForm(f => ({ ...f, project_id: '' }))}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                >
                  <option value="">— Standalone (no project) —</option>
                  {projects.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.project_code} — {p.project_name}</option>
                  ))}
                </select>
                {form.project_id && (
                  <p className="text-xs text-blue-600 mt-1">Exhibits and tanks will be imported from this project automatically.</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1.5">Book Code <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={form.book_code}
                    onChange={e => setForm(f => ({ ...f, book_code: e.target.value }))}
                    placeholder="DB-001"
                    className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1.5">Revision</label>
                  <input
                    type="text"
                    value={form.revision}
                    onChange={e => setForm(f => ({ ...f, revision: e.target.value }))}
                    placeholder="A"
                    className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1.5">Title <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.book_title}
                  onChange={e => setForm(f => ({ ...f, book_title: e.target.value }))}
                  placeholder="Taoyuan Aquarium — Design Book"
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1.5">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                  placeholder="Brief description of this design book…"
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none"
                />
              </div>

              <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                New Design Books start as <strong>Draft</strong>. Designers submit them through the review workflow when ready.
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-stone-100 bg-stone-50 rounded-b-2xl">
              <button
                onClick={() => { setShowNew(false); setForm(EMPTY_FORM); }}
                className="px-4 py-2 text-sm text-stone-600 hover:text-stone-800 font-medium"
              >
                Cancel
              </button>
              <Button onClick={handleCreate} disabled={saving}>
                {saving ? 'Creating…' : 'Create Design Book'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
