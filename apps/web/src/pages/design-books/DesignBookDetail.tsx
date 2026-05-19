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
  ChevronDown, ChevronUp, Waves, AlertCircle,
  Fish, Plus, Trash2, Activity, Gauge, GitBranch, Settings2,
  LinkIcon, SquarePlus, Check, CheckCircle2
} from 'lucide-react';
import toast from 'react-hot-toast';
import VersionsTab from './VersionsTab';

const STATUSES = ['Draft', 'In Progress', 'For Review', 'Approved', 'Released'];
type Tab = 'exhibits' | 'lss' | 'piping' | 'versions';

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

function SystemTypeBadge({ type }: { type?: string }) {
  if (!type) return <span className="text-stone-400 text-xs">—</span>;
  const colors: Record<string, string> = {
    Filtration: 'bg-blue-50 text-blue-700 border-blue-200',
    Circulation: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    UV: 'bg-violet-50 text-violet-700 border-violet-200',
    Ozone: 'bg-orange-50 text-orange-700 border-orange-200',
    Heating: 'bg-red-50 text-red-700 border-red-200',
    Chilling: 'bg-sky-50 text-sky-700 border-sky-200',
    Skimming: 'bg-teal-50 text-teal-700 border-teal-200',
  };
  const cls = Object.entries(colors).find(([k]) => type.toLowerCase().includes(k.toLowerCase()))?.[1]
    ?? 'bg-stone-50 text-stone-600 border-stone-200';
  return <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${cls}`}>{type}</span>;
}

function fmtDim(v?: number | null) {
  return v != null ? `${Number(v).toLocaleString()}` : '—';
}
function fmtVol(v?: number | null) {
  if (v == null) return <span className="text-stone-400">—</span>;
  return <span className="font-mono text-xs">{parseFloat(String(v)).toFixed(3)}</span>;
}
function fmtNum(v?: number | null, decimals = 1) {
  if (v == null || v === undefined) return <span className="text-stone-400">—</span>;
  return <span className="font-mono text-xs">{parseFloat(String(v)).toFixed(decimals)}</span>;
}

// ─── Species Section inside each Exhibit ────────────────────────────────────
const BLANK_SPECIES = { species_name: '', common_name: '', quantity: '', avg_size_cm: '', biomass_kg: '' };

function SpeciesSection({ bookId, exhibitId, allSpecies, onRefresh }: {
  bookId: string;
  exhibitId: string;
  allSpecies: any[];
  onRefresh: () => void;
}) {
  const mySpecies = allSpecies.filter(s => s.exhibit_id === exhibitId);
  const [showRow, setShowRow] = useState(false);
  const [row, setRow] = useState({ ...BLANK_SPECIES });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const setR = (k: string, v: string) => setRow(r => ({ ...r, [k]: v }));

  const handleAdd = async () => {
    if (!row.species_name.trim()) return toast.error('Scientific name required');
    setSaving(true);
    try {
      await api.post(`/design-books/${bookId}/species`, {
        exhibit_id: exhibitId,
        species_name: row.species_name.trim(),
        common_name: row.common_name || null,
        quantity: row.quantity ? parseInt(row.quantity) : null,
        avg_size_cm: row.avg_size_cm ? parseFloat(row.avg_size_cm) : null,
        biomass_kg: row.biomass_kg ? parseFloat(row.biomass_kg) : null,
      });
      toast.success('Species added');
      setRow({ ...BLANK_SPECIES });
      onRefresh();
    } catch {
      toast.error('Failed to add species');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
    if (e.key === 'Escape') { setShowRow(false); setRow({ ...BLANK_SPECIES }); }
  };

  const handleDelete = async (speciesId: string) => {
    if (!confirm('Remove this species entry?')) return;
    setDeletingId(speciesId);
    try {
      await api.delete(`/design-books/${bookId}/species/${speciesId}`);
      onRefresh();
    } catch {
      toast.error('Failed to remove');
    } finally {
      setDeletingId(null);
    }
  };

  const inCell = (k: string, type = 'text', placeholder = '') => (
    <input
      type={type}
      step={type === 'number' ? '0.1' : undefined}
      placeholder={placeholder}
      value={(row as any)[k]}
      onChange={e => setR(k, e.target.value)}
      onKeyDown={handleKeyDown}
      className="w-full bg-transparent border-b border-emerald-400 focus:outline-none text-xs py-0.5 placeholder-stone-300 text-stone-800"
    />
  );

  return (
    <div className="border-t border-stone-100 bg-emerald-50/20">
      {/* Section header */}
      <div className="flex items-center justify-between px-5 py-2.5">
        <div className="flex items-center gap-2">
          <Fish className="w-3.5 h-3.5 text-emerald-600" />
          <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Species Allocation</span>
          {mySpecies.length > 0 && (
            <span className="text-xs bg-emerald-100 text-emerald-700 rounded-full px-1.5 py-0.5">{mySpecies.length}</span>
          )}
        </div>
        {!showRow && (
          <button
            onClick={() => setShowRow(true)}
            className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-800 border border-emerald-200 bg-white rounded-md px-2 py-1 transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Species
          </button>
        )}
      </div>

      {/* Species table — always shown when there are rows OR when add-row is open */}
      {(mySpecies.length > 0 || showRow) ? (
        <div className="overflow-x-auto pb-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-t border-stone-100">
                <th className="text-left px-5 py-1.5 text-stone-400 font-medium">Scientific Name</th>
                <th className="text-left px-4 py-1.5 text-stone-400 font-medium">Common Name</th>
                <th className="text-right px-4 py-1.5 text-stone-400 font-medium">Qty</th>
                <th className="text-right px-4 py-1.5 text-stone-400 font-medium">Avg Size (cm)</th>
                <th className="text-right px-4 py-1.5 text-stone-400 font-medium">Biomass (kg)</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {mySpecies.map(sp => (
                <tr key={sp.id} className="border-t border-emerald-100/60 hover:bg-emerald-50/40 transition-colors group">
                  <td className="px-5 py-2 italic text-stone-700">{sp.species_name}</td>
                  <td className="px-4 py-2 text-stone-600">{sp.common_name || <span className="text-stone-300">—</span>}</td>
                  <td className="px-4 py-2 text-right font-mono text-stone-700">{sp.quantity ?? <span className="text-stone-300">—</span>}</td>
                  <td className="px-4 py-2 text-right font-mono text-stone-600">{sp.avg_size_cm != null ? parseFloat(sp.avg_size_cm).toFixed(1) : <span className="text-stone-300">—</span>}</td>
                  <td className="px-4 py-2 text-right font-mono text-stone-600">{sp.biomass_kg != null ? parseFloat(sp.biomass_kg).toFixed(2) : <span className="text-stone-300">—</span>}</td>
                  <td className="px-2 py-2">
                    <button
                      onClick={() => handleDelete(sp.id)}
                      disabled={deletingId === sp.id}
                      className="opacity-0 group-hover:opacity-100 text-stone-300 hover:text-red-500 transition-all p-0.5 rounded"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}

              {/* Inline add row */}
              {showRow && (
                <tr className="border-t-2 border-emerald-300 bg-emerald-50/60">
                  <td className="px-5 py-2 italic">{inCell('species_name', 'text', 'e.g. Acanthurus leucosternon')}</td>
                  <td className="px-4 py-2">{inCell('common_name', 'text', 'Common name')}</td>
                  <td className="px-4 py-2 text-right">{inCell('quantity', 'number', '0')}</td>
                  <td className="px-4 py-2 text-right">{inCell('avg_size_cm', 'number', '0.0')}</td>
                  <td className="px-4 py-2 text-right">{inCell('biomass_kg', 'number', '0.00')}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={handleAdd}
                        disabled={saving}
                        title="Save (Enter)"
                        className="text-emerald-600 hover:text-emerald-800 p-0.5 rounded disabled:opacity-40"
                      >
                        {saving ? <span className="text-xs">…</span> : <Check className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => { setShowRow(false); setRow({ ...BLANK_SPECIES }); }}
                        title="Cancel (Esc)"
                        className="text-stone-300 hover:text-stone-500 p-0.5 rounded"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {/* Biomass total */}
              {mySpecies.some(s => s.biomass_kg != null) && (
                <tr className="border-t border-emerald-200 bg-emerald-50/40">
                  <td colSpan={4} className="px-5 py-1.5 text-xs font-semibold text-emerald-700">Total Biomass</td>
                  <td className="px-4 py-1.5 text-right font-mono font-semibold text-emerald-800">
                    {mySpecies.reduce((s, sp) => s + (parseFloat(sp.biomass_kg) || 0), 0).toFixed(2)} kg
                  </td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
          {showRow && (
            <p className="px-5 pt-1 text-xs text-stone-400">Press <kbd className="font-mono bg-stone-100 px-1 rounded">Enter</kbd> to save · <kbd className="font-mono bg-stone-100 px-1 rounded">Esc</kbd> to cancel</p>
          )}
        </div>
      ) : (
        <div className="px-5 pb-4 text-xs text-stone-400 italic">No species allocated — click Add Species to begin.</div>
      )}
    </div>
  );
}

// ─── LSS Tab ────────────────────────────────────────────────────────────────
function LSSTab({ book }: { book: any }) {
  const systems: any[] = book.systems || [];

  if (!book.project_id) {
    return (
      <div className="bg-white rounded-2xl border border-stone-200 py-16 text-center">
        <FolderOpen className="w-10 h-10 text-stone-300 mx-auto mb-3" />
        <p className="text-stone-500 font-medium">No project linked</p>
        <p className="text-stone-400 text-sm mt-1">Link this design book to a project to import its Life Support Systems.</p>
      </div>
    );
  }

  if (systems.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-stone-200 py-16 text-center">
        <Activity className="w-10 h-10 text-stone-300 mx-auto mb-3" />
        <p className="text-stone-500 font-medium">No systems found</p>
        <p className="text-stone-400 text-sm mt-1">Add Life Support Systems to the linked project to see them here.</p>
        <Link
          to={`/projects/${book.project_id}`}
          className="inline-flex items-center gap-1.5 mt-4 text-sm text-blue-600 hover:text-blue-700 border border-blue-200 bg-white px-3 py-1.5 rounded-lg"
        >
          <FolderOpen className="w-3.5 h-3.5" /> Open Project
        </Link>
      </div>
    );
  }

  // Aggregate stats
  const totalFlow = systems.reduce((s, sys) => s + (parseFloat(sys.design_flow_m3h) || 0), 0);
  const activeSystems = systems.filter(s => s.status === 'Active' || s.status === 'Released').length;
  const totalEquipment = systems.reduce((s, sys) => s + (parseInt(sys.equipment_count) || 0), 0);

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Systems', value: systems.length, icon: <GitBranch className="w-4 h-4 text-blue-500" /> },
          { label: 'Total Design Flow', value: `${totalFlow.toFixed(1)} m³/h`, icon: <Gauge className="w-4 h-4 text-cyan-600" /> },
          { label: 'Equipment Items', value: totalEquipment, icon: <Settings2 className="w-4 h-4 text-violet-500" /> },
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

      {/* Systems table */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 bg-stone-50/50">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-semibold text-stone-700">Life Support Systems</span>
            <span className="text-xs bg-blue-50 text-blue-700 rounded-full px-1.5 py-0.5">{systems.length}</span>
          </div>
          <Link
            to={`/projects/${book.project_id}`}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors flex items-center gap-1"
          >
            <FolderOpen className="w-3 h-3" /> View in Project
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50/80">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Code</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">System Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Type</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Exhibit</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Water Type</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Flow m³/h</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Turnover h</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Equipment</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody>
              {systems.map((sys: any) => (
                <tr key={sys.id} className="border-t border-stone-100 hover:bg-blue-50/20 transition-colors">
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs text-stone-600 bg-stone-100 px-1.5 py-0.5 rounded">{sys.system_code}</span>
                  </td>
                  <td className="px-4 py-2.5 font-medium text-stone-800">{sys.system_name}</td>
                  <td className="px-4 py-2.5"><SystemTypeBadge type={sys.system_type} /></td>
                  <td className="px-4 py-2.5">
                    {sys.exhibit_code
                      ? <span className="text-xs text-stone-600"><span className="font-mono text-stone-400">{sys.exhibit_code}</span> {sys.exhibit_name}</span>
                      : <span className="text-stone-400 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-2.5"><WaterTypeBadge type={sys.water_type} /></td>
                  <td className="px-4 py-2.5 text-right">{fmtNum(sys.design_flow_m3h)}</td>
                  <td className="px-4 py-2.5 text-right">{fmtNum(sys.turnover_rate_hr)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {parseInt(sys.equipment_count) > 0
                      ? <span className="font-mono text-xs text-stone-600">{sys.equipment_count}</span>
                      : <span className="text-stone-400 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge status={sys.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Total row */}
        {totalFlow > 0 && (
          <div className="border-t-2 border-stone-200 bg-stone-50/60 px-4 py-2 flex items-center gap-4 text-xs">
            <span className="font-semibold text-stone-500 uppercase tracking-wide">Total</span>
            <span className="ml-auto font-mono font-semibold text-stone-700">{totalFlow.toFixed(1)} m³/h design flow</span>
          </div>
        )}
      </div>

      {/* Duty descriptions */}
      {systems.some(s => s.duty_description) && (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-100 bg-stone-50/50">
            <span className="text-sm font-semibold text-stone-700">Duty Descriptions</span>
          </div>
          <div className="divide-y divide-stone-50">
            {systems.filter(s => s.duty_description).map((sys: any) => (
              <div key={sys.id} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded">{sys.system_code}</span>
                  <span className="text-sm font-medium text-stone-700">{sys.system_name}</span>
                </div>
                <p className="text-sm text-stone-500 leading-relaxed">{sys.duty_description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── New Exhibit Modal ───────────────────────────────────────────────────────
const WATER_TYPES = ['Marine', 'Freshwater', 'Brackish', 'Salt Water', 'Blackwater'];
const TANK_SHAPES = ['Rectangular', 'Cylindrical', 'Custom'];

function NewExhibitModal({ projectId, onClose, onCreated }: {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    exhibit_code: '', exhibit_name: '', water_type: '',
    design_temperature_min: '', design_temperature_max: '', design_salinity: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.exhibit_code.trim() || !form.exhibit_name.trim()) {
      return toast.error('Exhibit code and name are required');
    }
    setSaving(true);
    try {
      await api.post('/exhibits', {
        exhibit_code: form.exhibit_code.trim().toUpperCase(),
        exhibit_name: form.exhibit_name.trim(),
        project_id: projectId,
        water_type: form.water_type || null,
        design_temperature_min: form.design_temperature_min ? parseFloat(form.design_temperature_min) : null,
        design_temperature_max: form.design_temperature_max ? parseFloat(form.design_temperature_max) : null,
        design_salinity: form.design_salinity ? parseFloat(form.design_salinity) : null,
        notes: form.notes || null,
      });
      toast.success('Exhibit created');
      onCreated();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to create exhibit');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-semibold text-stone-800">New Exhibit</h2>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 p-1 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Exhibit Code *</label>
              <input type="text" placeholder="e.g. EX-01"
                value={form.exhibit_code} onChange={e => set('exhibit_code', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Water Type</label>
              <select value={form.water_type} onChange={e => set('water_type', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
                <option value="">— Select —</option>
                {WATER_TYPES.map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Exhibit Name *</label>
            <input type="text" placeholder="e.g. Coral Reef Display"
              value={form.exhibit_name} onChange={e => set('exhibit_name', e.target.value)}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Temp Min (°C)</label>
              <input type="number" step="0.1" placeholder="24"
                value={form.design_temperature_min} onChange={e => set('design_temperature_min', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Temp Max (°C)</label>
              <input type="number" step="0.1" placeholder="26"
                value={form.design_temperature_max} onChange={e => set('design_temperature_max', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Salinity (ppt)</label>
              <input type="number" step="0.1" placeholder="34"
                value={form.design_salinity} onChange={e => set('design_salinity', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Notes</label>
            <textarea value={form.notes} rows={2} onChange={e => set('notes', e.target.value)} placeholder="Optional notes…"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none" />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-stone-100 bg-stone-50/40 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm text-stone-600 hover:text-stone-800 rounded-lg hover:bg-stone-100">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors">
            {saving ? 'Creating…' : 'Create Exhibit'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Tank Panel (inside each exhibit) ───────────────────────────────────
function AddTankPanel({ exhibit, projectId, unassignedTanks, onRefresh, onClose }: {
  exhibit: any;
  projectId: string;
  unassignedTanks: any[];
  onRefresh: () => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'assign' | 'new'>('assign');
  const [selected, setSelected] = useState<any | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [newForm, setNewForm] = useState({
    tank_code: '', tank_name: '', shape_type: 'Rectangular',
    length_mm: '', width_mm: '', height_mm: '', design_water_level_mm: '',
    primary_material: '',
  });
  const [saving, setSaving] = useState(false);

  const setF = (k: string, v: string) => setNewForm(f => ({ ...f, [k]: v }));

  const handleConfirmAssign = async () => {
    if (!selected) return;
    setConfirming(true);
    try {
      await api.patch(`/tanks/${selected.id}/exhibit`, { exhibit_id: exhibit.id });
      toast.success(`${selected.tank_name} assigned to ${exhibit.exhibit_name}`);
      onRefresh();
      onClose();
    } catch {
      toast.error('Failed to assign tank');
    } finally {
      setConfirming(false);
    }
  };

  const handleCreate = async () => {
    if (!newForm.tank_code.trim() || !newForm.tank_name.trim()) {
      return toast.error('Tank code and name are required');
    }
    setSaving(true);
    try {
      await api.post('/tanks', {
        tank_code: newForm.tank_code.trim().toUpperCase(),
        tank_name: newForm.tank_name.trim(),
        project_id: projectId,
        exhibit_id: exhibit.id,
        shape_type: newForm.shape_type || null,
        length_mm: newForm.length_mm || null,
        width_mm: newForm.width_mm || null,
        height_mm: newForm.height_mm || null,
        design_water_level_mm: newForm.design_water_level_mm || null,
        primary_material: newForm.primary_material || null,
        status: 'Active',
      });
      toast.success('Tank created and added to exhibit');
      onRefresh();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to create tank');
    } finally {
      setSaving(false);
    }
  };

  const isCyl = newForm.shape_type === 'Cylindrical';

  return (
    <div className="border-t border-blue-100 bg-blue-50/20 px-5 py-4">
      {/* Mode tabs + close */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1 rounded-lg border border-blue-200 bg-white p-0.5">
          <button
            onClick={() => { setMode('assign'); setSelected(null); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              mode === 'assign' ? 'bg-blue-600 text-white' : 'text-stone-600 hover:text-stone-800'
            }`}
          >
            <LinkIcon className="w-3 h-3" /> Assign Existing
          </button>
          <button
            onClick={() => { setMode('new'); setSelected(null); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              mode === 'new' ? 'bg-blue-600 text-white' : 'text-stone-600 hover:text-stone-800'
            }`}
          >
            <SquarePlus className="w-3 h-3" /> Create New Tank
          </button>
        </div>
        <button onClick={onClose} className="text-stone-400 hover:text-stone-600 p-1 rounded">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Assign existing */}
      {mode === 'assign' && (
        unassignedTanks.length === 0 ? (
          <div className="text-center py-6 text-stone-400 text-sm">
            <Layers className="w-6 h-6 mx-auto mb-2 opacity-40" />
            No unassigned tanks in this project.<br />
            <button onClick={() => setMode('new')} className="mt-2 text-blue-600 hover:underline text-xs">Create a new tank instead →</button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-stone-500">{unassignedTanks.length} unassigned tank{unassignedTanks.length !== 1 ? 's' : ''} — select one to assign:</p>

            {/* Tank list */}
            <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
              {unassignedTanks.map(tank => {
                const isSelected = selected?.id === tank.id;
                return (
                  <button
                    key={tank.id}
                    onClick={() => setSelected(isSelected ? null : tank)}
                    className={`w-full text-left flex items-center gap-2.5 rounded-lg px-3 py-2 border transition-all ${
                      isSelected
                        ? 'bg-blue-50 border-blue-400 ring-1 ring-blue-300'
                        : 'bg-white border-stone-200 hover:border-blue-300'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                      isSelected ? 'border-blue-500 bg-blue-500' : 'border-stone-300'
                    }`}>
                      {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                    <span className="font-mono text-xs bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded shrink-0">{tank.tank_code}</span>
                    <span className="text-sm text-stone-700 truncate flex-1">{tank.tank_name}</span>
                    {tank.eff_shape && <ShapeBadge shape={tank.eff_shape} />}
                    {tank.gross_volume_m3 && (
                      <span className="text-xs text-stone-400 font-mono shrink-0">{parseFloat(tank.gross_volume_m3).toFixed(2)} m³</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Selected preview + confirm */}
            {selected && (
              <div className="mt-2 rounded-lg bg-blue-600 text-white px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-blue-200" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">{selected.tank_name}</p>
                    <p className="text-xs text-blue-200">
                      {selected.eff_shape || 'Tank'}{selected.gross_volume_m3 ? ` · ${parseFloat(selected.gross_volume_m3).toFixed(2)} m³` : ''}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleConfirmAssign}
                  disabled={confirming}
                  className="shrink-0 flex items-center gap-1.5 bg-white text-blue-700 font-semibold text-xs px-3 py-1.5 rounded-lg hover:bg-blue-50 disabled:opacity-50 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  {confirming ? 'Assigning…' : 'Confirm Assignment'}
                </button>
              </div>
            )}
          </div>
        )
      )}

      {/* Create new */}
      {mode === 'new' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Tank Code *</label>
              <input type="text" placeholder="e.g. TK-01"
                value={newForm.tank_code} onChange={e => setF('tank_code', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-xs uppercase focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Shape</label>
              <select value={newForm.shape_type} onChange={e => setF('shape_type', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
                {TANK_SHAPES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Tank Name *</label>
            <input type="text" placeholder="e.g. Main Display Tank"
              value={newForm.tank_name} onChange={e => setF('tank_name', e.target.value)}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
          </div>
          <div className={`grid gap-3 ${isCyl ? 'grid-cols-3' : 'grid-cols-4'}`}>
            {!isCyl && (
              <div>
                <label className="block text-xs text-stone-500 mb-1">Length (mm)</label>
                <input type="number" placeholder="0" value={newForm.length_mm} onChange={e => setF('length_mm', e.target.value)}
                  className="w-full border border-stone-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
            )}
            <div>
              <label className="block text-xs text-stone-500 mb-1">{isCyl ? 'Diameter (mm)' : 'Width (mm)'}</label>
              <input type="number" placeholder="0" value={newForm.width_mm} onChange={e => setF('width_mm', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1">Height (mm)</label>
              <input type="number" placeholder="0" value={newForm.height_mm} onChange={e => setF('height_mm', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1">Water Level (mm)</label>
              <input type="number" placeholder="0" value={newForm.design_water_level_mm} onChange={e => setF('design_water_level_mm', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Material</label>
            <input type="text" placeholder="e.g. Acrylic, FRP, Concrete"
              value={newForm.primary_material} onChange={e => setF('primary_material', e.target.value)}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-stone-500 hover:text-stone-700">Cancel</button>
            <button onClick={handleCreate} disabled={saving}
              className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors">
              {saving ? 'Creating…' : 'Create & Assign Tank'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Exhibits Tab (list view — click to open exhibit detail page) ─────────────
function ExhibitsTab({
  book, exhibits, tanks, exhibitMap, onRefresh, onNewExhibit,
}: {
  book: any; exhibits: any[]; tanks: any[];
  exhibitMap: Map<string | null, any[]>;
  onRefresh: () => void; onNewExhibit: () => void;
}) {
  const navigate = useNavigate();
  const allSpecies: any[] = book.species || [];
  const unassigned: any[] = exhibitMap.get(null) || [];
  const totalGross = tanks.reduce((s, t) => s + (parseFloat(t.gross_volume_m3) || 0), 0);

  if (!book.project_id) {
    return (
      <div className="bg-white rounded-2xl border border-stone-200 py-16 text-center">
        <FolderOpen className="w-10 h-10 text-stone-300 mx-auto mb-3" />
        <p className="text-stone-500 font-medium">No project linked</p>
        <p className="text-stone-400 text-sm mt-1">Link this design book to a project to see its exhibits and tanks.</p>
      </div>
    );
  }

  if (exhibits.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-stone-200 py-20 text-center">
        <Layers className="w-10 h-10 text-stone-300 mx-auto mb-3" />
        <p className="text-stone-500 font-medium">No exhibits yet</p>
        <p className="text-stone-400 text-sm mt-1 mb-4">Create your first exhibit to start organising tanks and species.</p>
        <button
          onClick={onNewExhibit}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> New Exhibit
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-stone-500">
          {exhibits.length} exhibit{exhibits.length !== 1 ? 's' : ''} · {tanks.length} tank{tanks.length !== 1 ? 's' : ''}
          {totalGross > 0 && <span className="ml-2 font-mono text-stone-400">· {totalGross.toFixed(2)} m³ total</span>}
        </p>
        <button
          onClick={onNewExhibit}
          className="flex items-center gap-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg transition-colors font-medium"
        >
          <Plus className="w-3.5 h-3.5" /> New Exhibit
        </button>
      </div>

      {/* Exhibit list table */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 border-b border-stone-200">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Code</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Exhibit Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Water Type</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Temperature</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Tank</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Volume m³</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">Species</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {exhibits.map((exhibit: any) => {
              const exhibitTank = (exhibitMap.get(exhibit.id) || [])[0];
              const speciesCount = allSpecies.filter(s => s.exhibit_id === exhibit.id).length;
              const gross = exhibitTank ? parseFloat(exhibitTank.gross_volume_m3) || 0 : 0;

              return (
                <tr
                  key={exhibit.id}
                  onClick={() => navigate(`/design-books/${book.id}/exhibits/${exhibit.id}`)}
                  className="border-t border-stone-100 hover:bg-blue-50/30 cursor-pointer transition-colors group"
                >
                  <td className="px-5 py-3.5">
                    <span className="font-mono text-xs text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">{exhibit.exhibit_code}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="font-semibold text-stone-800 group-hover:text-blue-700 transition-colors">{exhibit.exhibit_name}</span>
                    {exhibit.area_name && (
                      <span className="ml-2 text-xs text-stone-400">{exhibit.area_name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <WaterTypeBadge type={exhibit.water_type} />
                  </td>
                  <td className="px-4 py-3.5">
                    {(exhibit.design_temperature_min != null || exhibit.design_temperature_max != null) ? (
                      <span className="flex items-center gap-1 text-xs text-stone-600">
                        <ThermometerSun className="w-3 h-3 text-orange-400" />
                        {exhibit.design_temperature_min ?? '?'}–{exhibit.design_temperature_max ?? '?'} °C
                      </span>
                    ) : (
                      <span className="text-stone-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    {exhibitTank ? (
                      <div>
                        <span className="font-medium text-stone-700 text-xs">{exhibitTank.tank_name}</span>
                        <span className="ml-1.5 font-mono text-xs text-stone-400">{exhibitTank.tank_code}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">No tank</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    {gross > 0 ? (
                      <span className="font-mono text-sm font-semibold text-stone-700">{gross.toFixed(2)}</span>
                    ) : (
                      <span className="text-stone-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    {speciesCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                        <Fish className="w-3 h-3" /> {speciesCount}
                      </span>
                    ) : (
                      <span className="text-stone-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3.5">
                    <ChevronRight className="w-4 h-4 text-stone-300 group-hover:text-blue-500 transition-colors" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Summary footer */}
        {tanks.length > 0 && (
          <div className="border-t-2 border-stone-200 bg-stone-50/80 px-5 py-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
              {tanks.length} tank{tanks.length !== 1 ? 's' : ''} across {exhibits.length} exhibits
            </span>
            <span className="font-mono text-sm font-bold text-stone-700">{totalGross.toFixed(3)} m³</span>
          </div>
        )}
      </div>

      {/* Unassigned tanks notice */}
      {unassigned.length > 0 && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3.5">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
          <span className="text-sm text-amber-800">
            <span className="font-semibold">{unassigned.length} unassigned tank{unassigned.length !== 1 ? 's' : ''}</span>
            {' '}— open an exhibit and use "Assign Tank" to link {unassigned.length === 1 ? 'it' : 'them'}.
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function DesignBookDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('exhibits');
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [showNewExhibit, setShowNewExhibit] = useState(false);

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

  const refresh = () => qc.invalidateQueries({ queryKey: ['design-book', id] });

  if (isLoading) return <div className="p-8 text-center text-stone-400">Loading…</div>;
  if (!book) return <div className="p-8 text-center text-stone-500">Design book not found.</div>;

  const exhibits: any[] = book.exhibits || [];
  const tanks: any[] = book.tanks || [];
  const systems: any[] = book.systems || [];

  const exhibitMap = new Map<string | null, any[]>();
  for (const t of tanks) {
    const key = t.exhibit_id || null;
    if (!exhibitMap.has(key)) exhibitMap.set(key, []);
    exhibitMap.get(key)!.push(t);
  }

  const totalTanks = tanks.length;
  const totalGross = tanks.reduce((s: number, t: any) => s + (parseFloat(t.gross_volume_m3) || 0), 0);
  const marineVol = tanks
    .filter((t: any) => { const wt = (t.exhibit_water_type || t.water_type || '').toLowerCase(); return wt.includes('marine') || wt.includes('salt'); })
    .reduce((s: number, t: any) => s + (parseFloat(t.gross_volume_m3) || 0), 0);
  const freshVol = tanks
    .filter((t: any) => { const wt = (t.exhibit_water_type || t.water_type || '').toLowerCase(); return wt.includes('fresh'); })
    .reduce((s: number, t: any) => s + (parseFloat(t.gross_volume_m3) || 0), 0);

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

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'exhibits', label: 'Exhibits', count: exhibits.length },
    { key: 'lss', label: 'Life Support Systems', count: systems.length },
    { key: 'piping', label: 'Piping & Fittings' },
    { key: 'versions', label: 'Versions' },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* New Exhibit Modal */}
      {showNewExhibit && book.project_id && (
        <NewExhibitModal
          projectId={book.project_id}
          onClose={() => setShowNewExhibit(false)}
          onCreated={() => { setShowNewExhibit(false); refresh(); }}
        />
      )}

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-stone-500 mb-4">
        <Link to="/design-book-engine" className="hover:text-blue-600 transition-colors">Design Book Engine</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link to="/design-books" className="hover:text-blue-600 transition-colors">Design Books</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-stone-800 font-medium">{book.book_code}</span>
      </nav>

      {/* Header card */}
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
              <div className="w-12 h-12 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center flex-shrink-0">
                <BookMarked className="w-6 h-6 text-violet-600" />
              </div>
              <div>
                <div className="flex items-center gap-2.5 mb-1 flex-wrap">
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
            { label: 'Exhibits', value: exhibits.length, icon: <Layers className="w-4 h-4 text-blue-500" /> },
            { label: 'Total Tanks', value: totalTanks, icon: <FlaskConical className="w-4 h-4 text-violet-500" /> },
            { label: 'Total Volume', value: `${totalGross.toFixed(2)} m³`, icon: <Droplets className="w-4 h-4 text-cyan-600" /> },
            { label: 'Marine / Fresh', value: `${marineVol.toFixed(1)} / ${freshVol.toFixed(1)} m³`, icon: <Waves className="w-4 h-4 text-teal-500" /> },
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
          onRefresh={refresh}
          onNewExhibit={() => setShowNewExhibit(true)}
        />
      )}

      {tab === 'lss' && <LSSTab book={book} />}

      {tab === 'piping' && (
        <div className="bg-white rounded-2xl border border-stone-200 border-dashed py-20 text-center">
          <AlertCircle className="w-10 h-10 text-stone-300 mx-auto mb-3" />
          <p className="text-stone-600 font-semibold text-lg">Piping & Fittings</p>
          <p className="text-stone-400 text-sm mt-1 max-w-sm mx-auto">Pipe sizing, pressure drop calculations, and fitting schedules will appear here.</p>
          <span className="inline-block mt-4 px-3 py-1 bg-stone-100 text-stone-500 rounded-full text-xs font-medium">Coming Soon</span>
        </div>
      )}

      {tab === 'versions' && (
        <VersionsTab bookId={id!} onBookRefresh={refresh} />
      )}
    </div>
  );
}
