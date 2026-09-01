import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GitFork, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';

type NewRevisionDestination = {
  systemId: string;
  tab: string;
};

export default function NewRevisionModal({
  book,
  onClose,
  destination,
}: {
  book: any;
  onClose: () => void;
  destination?: NewRevisionDestination;
}) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    revision: '',
    book_code: `${book.book_code}-`,
    book_title: book.book_title,
    notes: '',
  });
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!form.revision.trim() || !form.book_code.trim()) {
      return toast.error('Revision and Design Book code are required');
    }
    setCreating(true);
    try {
      const result = await api.post(`/design-books/${book.id}/revisions`, form);
      toast.success(`Revision ${form.revision.trim()} created`);
      navigate(destination
        ? `/design-books/${result.data.id}/lss/${destination.systemId}?tab=${encodeURIComponent(destination.tab)}`
        : `/design-books/${result.data.id}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to create revision');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-revision-title"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitFork className="w-5 h-5 text-violet-600" />
            <h2 id="new-revision-title" className="font-semibold">Create New Revision</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close new revision dialog">
            <X className="w-5 h-5 text-stone-400" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-stone-600">
            The released package stays unchanged. A new Draft Design Book will copy its species, hydraulics, and theming data.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="new-revision-code" className="block text-xs font-medium text-stone-600 mb-1">New revision *</label>
              <input
                id="new-revision-code"
                value={form.revision}
                onChange={event => setForm(current => ({ ...current, revision: event.target.value }))}
                placeholder="B"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="new-revision-book-code" className="block text-xs font-medium text-stone-600 mb-1">Unique book code *</label>
              <input
                id="new-revision-book-code"
                value={form.book_code}
                onChange={event => setForm(current => ({ ...current, book_code: event.target.value }))}
                placeholder="DB-001-B"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label htmlFor="new-revision-title-input" className="block text-xs font-medium text-stone-600 mb-1">Title</label>
            <input
              id="new-revision-title-input"
              value={form.book_title}
              onChange={event => setForm(current => ({ ...current, book_title: event.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="new-revision-notes" className="block text-xs font-medium text-stone-600 mb-1">Revision notes</label>
            <textarea
              id="new-revision-notes"
              rows={2}
              value={form.notes}
              onChange={event => setForm(current => ({ ...current, notes: event.target.value }))}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm resize-none"
            />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-stone-100 bg-stone-50 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-stone-600">Cancel</button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-2 text-sm text-white bg-violet-600 hover:bg-violet-700 rounded-lg font-medium disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create Draft Revision'}
          </button>
        </div>
      </div>
    </div>
  );
}