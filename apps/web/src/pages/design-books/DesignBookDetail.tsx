import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useState } from 'react';
import api from '../../lib/api';
import StatusBadge from '../../components/ui/StatusBadge';
import EntityCode from '../../components/ui/EntityCode';
import Button from '../../components/ui/Button';
import {
  BookMarked, FolderOpen, ChevronRight, Pencil, Save, X,
  Droplets, ThermometerSun, FlaskConical, Layers,
  ChevronDown, ChevronUp, Waves, AlertCircle, FlaskRound
} from 'lucide-react';
import toast from 'react-hot-toast';

const STATUSES = ['Draft', 'In Progress', 'For Review', 'Approved', 'Released'];
type Tab = 'exhibits' | 'lss' | 'piping';

function WaterTypeBadge({ type }: { type?: string }) {
  if (!type) return <span className="text-stone-400 text-xs italic">—</span>;
  const styles: Record<string, string> = {
    Marine: 'bg-blue-100 text-blue-700 border-blue-200',
    'Salt Water': 'bg-blue-100 text-blue-700 border-blue-200',
    Freshwater: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    Brackish: 'bg-teal-100 text-teal-700 border-teal-200',
  };
  const cls = styles[type] ?? 'bg-stone-100 text-stone-600 border-stone-200';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      <Waves className="w-3 h-3" /> {type}
    </span>
  );
}

function ShapeBadge({ shape }: { shape?: string }) {
  if (!shape) return <span className="text-stone-400 text-xs">—</span>;
  const colors: Record<string, string> = {
    Rectangular: 'bg-slate-100 text-slate-600',
    Cylindrical: 'bg-violet-100 text-violet-700',
    Custom: 'bg-amber-100 text-amber-700',
  };
  return <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${colors[shape] ?? 'bg-stone-100 text-stone-600'}`}>{shape}</span>;
}

function fmtDim(v?: number | null) {
  return v != null ? `${Number(v).toLocaleString()}` : '—';
}
function fmtVol(v?: number | null) {
  if (v == null) return <span className="text-stone-400">—</span>;
  return <span className="font-mono text-xs">{parseFloat(String(v)).toFixed(3)}</span>;
}

export default function DesignBookDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('exhibits');
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [expandedExhibits, setExpandedExhibits] = useState<Set<string>>(new Set());
  const [expandAll, setExpandAll] = useState(true);

  const { data: book, isLoading } = useQuery({
    queryKey: ['design-book', id],
    queryFn: () => api.get(`/design-books/${id}`).then(r => r.data),
    enabled: !!id,
  });

  const { data: projectsData } = useQuery({
    queryKey: ['projects-for-select'],
    queryFn: () => api.get('/projects').then(r => r.data),
    enabled: editMode,
    staleTime: 60_000,
  });
  const projects: any[] = projectsData?.items || [];

  if (isLoading) return <div className="p-8 text-center text-stone-400">Loading…</div>;
  if (!book) return <div className="p-8 text-center text-stone-500">Design book not found.</div>;

  const exhibits: any[] = book.exhibits || [];
  const tanks: any[] = book.tanks || [];

  // Group tanks by exhibit
  const exhibitMap = new Map<string | null, any[]>();
  for (const t of tanks) {
    const key = t.exhibit_id || null;
    if (!exhibitMap.has(key)) exhibitMap.set(key, []);
    exhibitMap.get(key)!.push(t);
  }

  // Summary stats
  const totalTanks = tanks.length;
  const totalGross = tanks.reduce((s: number, t: any) => s + (parseFloat(t.gross_volume_m3) || 0), 0);
  const marineVol = tanks
    .filter((t: any) => {
      const wt = (t.exhibit_water_type || t.water_type || '').toLowerCase();
      return wt.includes('marine') || wt.includes('salt');
    })
    .reduce((s: number, t: any) => s + (parseFloat(t.gross_volume_m3) || 0), 0);
  const freshVol = tanks
    .filter((t: any) => {
      const wt = (t.exhibit_water_type || t.water_type || '').toLowerCase();
      return wt.includes('fresh');
    })
    .reduce((s: number, t: any) => s + (parseFloat(t.gross_volume_m3) || 0), 0);

  const toggleExhibit = (id: string) => {
    setExpandedExhibits(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    if (expandAll) {
      setExpandedExhibits(new Set());
      setExpandAll(false);
    } else {
      setExpandedExhibits(new Set(exhibits.map((e: any) => e.id).concat(['__none__'])));
      setExpandAll(true);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/design-books/${id}`, editForm);
      toast.success('Design book updated');
      qc.invalidateQueries({ queryKey: ['design-book', id] });
      qc.invalidateQueries({ queryKey: ['design-books'] });
      setEditMode(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = () => {
    setEditForm({
      book_title: book.book_title,
      project_id: book.project_id || '',
      description: book.description || '',
      revision: book.revision || 'A',
      status: book.status || 'Draft',
      notes: book.notes || '',
    });
    setEditMode(true);
  };

  const TABS: { key: Tab; label: string; count?: number; soon?: boolean }[] = [
    { key: 'exhibits', label: 'Exhibits', count: exhibits.length },
    { key: 'lss', label: 'Life Support Systems', soon: true },
    { key: 'piping', label: 'Piping & Fittings', soon: true },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-stone-500 mb-4">
        <Link to="/design-books" className="hover:text-blue-600 transition-colors">Design Books</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-stone-800 font-medium">{book.book_code}</span>
      </nav>

      {/* Header */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 mb-5">
        {editMode ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Title</label>
                <input type="text" value={editForm.book_title}
                  onChange={e => setEditForm((f: any) => ({ ...f, book_title: e.target.value }))}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Linked Project</label>
                <select value={editForm.project_id}
                  onChange={e => setEditForm((f: any) => ({ ...f, project_id: e.target.value }))}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
                  <option value="">— Standalone —</option>
                  {projects.map((p: any) => <option key={p.id} value={p.id}>{p.project_code} — {p.project_name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Description</label>
              <textarea value={editForm.description} rows={2} onChange={e => setEditForm((f: any) => ({ ...f, description: e.target.value }))}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Revision</label>
                <input type="text" value={editForm.revision} onChange={e => setEditForm((f: any) => ({ ...f, revision: e.target.value }))}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Status</label>
                <select value={editForm.status} onChange={e => setEditForm((f: any) => ({ ...f, status: e.target.value }))}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2 border-t border-stone-100">
              <button onClick={() => setEditMode(false)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-stone-600 hover:text-stone-800">
                <X className="w-4 h-4" /> Cancel
              </button>
              <Button onClick={handleSave} disabled={saving}>
                <Save className="w-4 h-4 mr-1.5" />{saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center flex-shrink-0">
                <BookMarked className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <div className="flex items-center gap-2.5 mb-1">
                  <EntityCode code={book.book_code} />
                  <span className="font-mono text-xs bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded">Rev {book.revision}</span>
                  <StatusBadge status={book.status} />
                </div>
                <h1 className="text-xl font-bold text-stone-900">{book.book_title}</h1>
                {book.description && <p className="text-stone-500 text-sm mt-1">{book.description}</p>}
                {book.project_code && (
                  <Link
                    to={`/projects/${book.project_id}`}
                    className="inline-flex items-center gap-1.5 mt-2 text-sm text-blue-600 hover:text-blue-700"
                    onClick={e => e.stopPropagation()}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    {book.project_code} — {book.project_name}
                    {book.client_name && <span className="text-stone-500"> · {book.client_name}</span>}
                  </Link>
                )}
              </div>
            </div>
            <button onClick={startEdit} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-stone-200 rounded-lg text-stone-600 hover:bg-stone-50">
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      {book.project_id && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Exhibits', value: exhibits.length, icon: <Layers className="w-4 h-4 text-blue-500" />, color: 'blue' },
            { label: 'Total Tanks', value: totalTanks, icon: <FlaskConical className="w-4 h-4 text-violet-500" />, color: 'violet' },
            { label: 'Total Volume', value: `${totalGross.toFixed(2)} m³`, icon: <Droplets className="w-4 h-4 text-cyan-600" />, color: 'cyan' },
            { label: 'Marine / Fresh', value: `${marineVol.toFixed(1)} / ${freshVol.toFixed(1)} m³`, icon: <Waves className="w-4 h-4 text-teal-500" />, color: 'teal' },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-xl border border-stone-200 px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-stone-50 flex items-center justify-center">{c.icon}</div>
              <div>
                <div className="text-xs text-stone-500">{c.label}</div>
                <div className="font-semibold text-stone-800 text-sm">{c.value}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-0.5 border-b border-stone-200 mb-5">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'text-blue-600 border-b-2 border-blue-600 -mb-px'
                : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            {t.label}
            {t.count != null && (
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-blue-100 text-blue-700' : 'bg-stone-100 text-stone-500'}`}>
                {t.count}
              </span>
            )}
            {t.soon && (
              <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-400">Soon</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'exhibits' && (
        <ExhibitsTab
          book={book}
          exhibits={exhibits}
          tanks={tanks}
          exhibitMap={exhibitMap}
          expandAll={expandAll}
          expandedExhibits={expandedExhibits}
          onToggleExhibit={toggleExhibit}
          onToggleAll={toggleAll}
        />
      )}

      {tab === 'lss' && <ComingSoonTab label="Life Support Systems" description="LSS calculations, system sizing, and hydraulic design will appear here." icon={<FlaskRound className="w-10 h-10 text-stone-300 mx-auto mb-3" />} />}
      {tab === 'piping' && <ComingSoonTab label="Piping & Fittings" description="Pipe sizing, pressure drop calculations, and fitting schedules will appear here." icon={<AlertCircle className="w-10 h-10 text-stone-300 mx-auto mb-3" />} />}
    </div>
  );
}

function ComingSoonTab({ label, description, icon }: { label: string; description: string; icon: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-stone-200 border-dashed py-20 text-center">
      {icon}
      <p className="text-stone-600 font-semibold text-lg">{label}</p>
      <p className="text-stone-400 text-sm mt-1 max-w-sm mx-auto">{description}</p>
      <span className="inline-block mt-4 px-3 py-1 bg-stone-100 text-stone-500 rounded-full text-xs font-medium">Coming Soon</span>
    </div>
  );
}

function ExhibitsTab({
  book, exhibits, tanks, exhibitMap, expandAll, expandedExhibits, onToggleExhibit, onToggleAll
}: {
  book: any; exhibits: any[]; tanks: any[];
  exhibitMap: Map<string | null, any[]>;
  expandAll: boolean; expandedExhibits: Set<string>;
  onToggleExhibit: (id: string) => void; onToggleAll: () => void;
}) {
  if (!book.project_id) {
    return (
      <div className="bg-white rounded-2xl border border-stone-200 py-16 text-center">
        <FolderOpen className="w-10 h-10 text-stone-300 mx-auto mb-3" />
        <p className="text-stone-500 font-medium">No project linked</p>
        <p className="text-stone-400 text-sm mt-1">Link this design book to a project to see its exhibits and tanks.</p>
      </div>
    );
  }

  if (exhibits.length === 0 && tanks.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-stone-200 py-16 text-center">
        <Layers className="w-10 h-10 text-stone-300 mx-auto mb-3" />
        <p className="text-stone-500 font-medium">No exhibits found</p>
        <p className="text-stone-400 text-sm mt-1">Add exhibits and tanks to the linked project to see them here.</p>
      </div>
    );
  }

  // Unassigned tanks (no exhibit_id)
  const unassigned: any[] = exhibitMap.get(null) || [];

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-stone-500">{exhibits.length} exhibit{exhibits.length !== 1 ? 's' : ''} · {tanks.length} tank{tanks.length !== 1 ? 's' : ''}</p>
        <button
          onClick={onToggleAll}
          className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-700 px-3 py-1.5 border border-stone-200 rounded-lg bg-white"
        >
          {expandAll ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {expandAll ? 'Collapse All' : 'Expand All'}
        </button>
      </div>

      {/* Exhibit cards */}
      {exhibits.map((exhibit: any) => {
        const exhibitTanks: any[] = exhibitMap.get(exhibit.id) || [];
        const exGross = exhibitTanks.reduce((s, t) => s + (parseFloat(t.gross_volume_m3) || 0), 0);
        const isOpen = expandedExhibits.has(exhibit.id) || expandAll;

        return (
          <div key={exhibit.id} className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            {/* Exhibit header */}
            <button
              onClick={() => onToggleExhibit(exhibit.id)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-stone-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center flex-shrink-0">
                  <Layers className="w-4 h-4 text-blue-600" />
                </div>
                <div className="text-left">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-stone-500">{exhibit.exhibit_code}</span>
                    <span className="font-semibold text-stone-800">{exhibit.exhibit_name}</span>
                    <WaterTypeBadge type={exhibit.water_type} />
                  </div>
                  <div className="flex items-center gap-4 mt-0.5">
                    {(exhibit.design_temperature_min != null || exhibit.design_temperature_max != null) && (
                      <span className="flex items-center gap-1 text-xs text-stone-500">
                        <ThermometerSun className="w-3 h-3" />
                        {exhibit.design_temperature_min ?? '?'}–{exhibit.design_temperature_max ?? '?'}°C
                      </span>
                    )}
                    {exhibit.design_salinity != null && (
                      <span className="flex items-center gap-1 text-xs text-stone-500">
                        <FlaskConical className="w-3 h-3" />
                        {exhibit.design_salinity} ppt
                      </span>
                    )}
                    {exhibit.area_name && (
                      <span className="text-xs text-stone-400">Area: {exhibit.area_name}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 flex-shrink-0">
                <div className="text-right hidden sm:block">
                  <div className="text-xs text-stone-400">{exhibitTanks.length} tank{exhibitTanks.length !== 1 ? 's' : ''}</div>
                  <div className="text-sm font-semibold text-stone-700">{exGross.toFixed(2)} m³</div>
                </div>
                {isOpen ? <ChevronUp className="w-4 h-4 text-stone-400" /> : <ChevronDown className="w-4 h-4 text-stone-400" />}
              </div>
            </button>

            {/* Tanks table */}
            {isOpen && (
              <div className="border-t border-stone-100">
                {exhibitTanks.length === 0 ? (
                  <div className="px-5 py-5 text-center text-sm text-stone-400 italic">No tanks in this exhibit</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-stone-50/80">
                        <tr>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Code</th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Tank Name</th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Shape</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">L mm</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">W / Ø mm</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">H mm</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Gross m³</th>
                          <th className="text-right px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Op. m³</th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Material</th>
                          <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">System</th>
                        </tr>
                      </thead>
                      <tbody>
                        {exhibitTanks.map((tank: any) => (
                          <tr key={tank.id} className="border-t border-stone-100 hover:bg-blue-50/20 transition-colors">
                            <td className="px-4 py-2.5">
                              <span className="font-mono text-xs text-stone-600 bg-stone-100 px-1.5 py-0.5 rounded">{tank.tank_code}</span>
                            </td>
                            <td className="px-4 py-2.5 font-medium text-stone-800">{tank.tank_name}</td>
                            <td className="px-4 py-2.5"><ShapeBadge shape={tank.eff_shape} /></td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs text-stone-600">
                              {tank.eff_shape === 'Cylindrical' ? <span className="text-stone-400">—</span> : fmtDim(tank.eff_length_mm)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs text-stone-600">{fmtDim(tank.eff_width_mm)}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs text-stone-600">{fmtDim(tank.eff_height_mm)}</td>
                            <td className="px-4 py-2.5 text-right">{fmtVol(tank.gross_volume_m3)}</td>
                            <td className="px-4 py-2.5 text-right">{fmtVol(tank.design_volume_m3)}</td>
                            <td className="px-4 py-2.5 text-xs text-stone-600">{tank.primary_material || <span className="text-stone-400">—</span>}</td>
                            <td className="px-4 py-2.5">
                              {tank.system_code
                                ? <span className="font-mono text-xs text-stone-500">{tank.system_code}</span>
                                : <span className="text-stone-400 text-xs">—</span>}
                            </td>
                          </tr>
                        ))}
                        {/* Exhibit subtotal row */}
                        {exhibitTanks.length > 1 && (
                          <tr className="border-t-2 border-stone-200 bg-stone-50/60">
                            <td colSpan={6} className="px-4 py-2 text-xs font-semibold text-stone-500 uppercase tracking-wide">
                              Subtotal — {exhibitTanks.length} tanks
                            </td>
                            <td className="px-4 py-2 text-right font-semibold text-stone-700 font-mono text-xs">{exGross.toFixed(3)}</td>
                            <td colSpan={3} />
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Unassigned tanks */}
      {unassigned.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
          <button
            onClick={() => onToggleExhibit('__none__')}
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-amber-50/30 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center">
                <AlertCircle className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-left">
                <span className="font-semibold text-stone-700">Unassigned Tanks</span>
                <p className="text-xs text-stone-400 mt-0.5">Tanks not linked to any exhibit</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm font-semibold text-stone-700">{unassigned.length} tank{unassigned.length !== 1 ? 's' : ''}</span>
              {(expandedExhibits.has('__none__') || expandAll) ? <ChevronUp className="w-4 h-4 text-stone-400" /> : <ChevronDown className="w-4 h-4 text-stone-400" />}
            </div>
          </button>
          {(expandedExhibits.has('__none__') || expandAll) && (
            <div className="border-t border-amber-100 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-amber-50/50">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Code</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Tank Name</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Shape</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Gross m³</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Op. m³</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">System</th>
                  </tr>
                </thead>
                <tbody>
                  {unassigned.map((tank: any) => (
                    <tr key={tank.id} className="border-t border-amber-100 hover:bg-amber-50/20">
                      <td className="px-4 py-2.5"><span className="font-mono text-xs bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded">{tank.tank_code}</span></td>
                      <td className="px-4 py-2.5 font-medium text-stone-800">{tank.tank_name}</td>
                      <td className="px-4 py-2.5"><ShapeBadge shape={tank.eff_shape} /></td>
                      <td className="px-4 py-2.5 text-right">{fmtVol(tank.gross_volume_m3)}</td>
                      <td className="px-4 py-2.5 text-right">{fmtVol(tank.design_volume_m3)}</td>
                      <td className="px-4 py-2.5 text-xs text-stone-500">{tank.system_code || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
