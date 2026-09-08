import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import api from '../../lib/api';
import {
  ChevronRight, Waves, ThermometerSun, FlaskConical, Fish, Plus,
  Trash2, Check, CheckCircle2, Layers, FolderOpen, LinkIcon,
  SquarePlus, X, Droplets, Pencil, Save, Gauge, ArrowDownToLine,
  ArrowUpToLine, Wind, BookOpen, Mountain, Palette, Calculator,
  ArrowRight, ArrowLeft, AlertTriangle, MoreHorizontal, LockKeyhole,
  LibraryBig, Lightbulb, Search, Pipette,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';
import SpeciesSection from './SpeciesAllocationSection';
import CustomFootprintEditor, {
  FootprintPreview,
  FootprintPrompt,
  footprintMeasurement,
} from '../../components/design-books/CustomFootprintEditor';
import {
  calculateBazinWeir,
  calculateFrancisWeir,
  BAZIN_COEFFICIENT_BASE,
  BAZIN_HEAD_COEFFICIENT,
  BAZIN_MIN_HEAD_M,
  FRANCIS_COEFFICIENT,
  FRANCIS_MAX_HEAD_M,
  FRANCIS_MAX_HEAD_TO_LENGTH_RATIO,
  FRANCIS_MIN_HEAD_M,
  WeirMethod,
} from '../../lib/weir';

type ExhibitTab = 'tank' | 'species' | 'flow' | 'weir' | 'pipes' | 'lights';

function isExhibitTab(value: string | null): value is ExhibitTab {
  return value === 'tank' || value === 'species' || value === 'flow' || value === 'weir' || value === 'pipes' || value === 'lights';
}

function isEditingField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.matches('input, select, textarea, [contenteditable="true"]') || target.isContentEditable);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
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
    Custom: 'bg-blue-100 text-blue-700',
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${colors[shape] ?? 'bg-stone-100 text-stone-600'}`}>
      {shape}
    </span>
  );
}

function fmtDim(v?: number | null) {
  return v != null ? Number(v).toLocaleString() : '—';
}
function fmtVol(v?: number | null) {
  if (v == null) return '—';
  return parseFloat(String(v)).toFixed(3);
}

function waterSurfaceAreaM2(shape: unknown, lengthMm: unknown, widthMm: unknown): number | null {
  const width = Number(widthMm);
  if (!(width > 0)) return null;
  const normalizedShape = String(shape || '').toLowerCase();
  if (normalizedShape === 'cylindrical') return Math.PI * (width / 2) ** 2 / 1e6;
  const length = Number(lengthMm);
  return length > 0 ? length * width / 1e6 : null;
}

function CalculationTrace({ calculation, title = 'Calculation Trace' }: {
  calculation?: any | null;
  title?: string;
}) {
  if (!calculation) return null;
  const valid = calculation.status === 'valid';
  const timestamp = calculation.calculated_at
    ? new Date(calculation.calculated_at).toLocaleString()
    : '—';
  return (
    <div className={`rounded-xl border px-4 py-3 ${valid ? 'border-emerald-200 bg-emerald-50/40' : 'border-red-200 bg-red-50/40'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        {valid
          ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          : <AlertTriangle className="w-4 h-4 text-red-600" />}
        <span className={`text-xs font-semibold uppercase tracking-wide ${valid ? 'text-emerald-700' : 'text-red-700'}`}>{title}</span>
        <span className={`text-xs rounded-full px-2 py-0.5 ${valid ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
          {valid ? 'Current' : 'Blocked'}
        </span>
        <span className="text-xs text-stone-400 ml-auto">{calculation.calculation_version} · {timestamp}</span>
      </div>
      <p className="text-xs text-stone-600 mt-2">{calculation.formula}</p>
      <p className="text-xs text-stone-400 mt-1">{calculation.rounding}</p>
      {calculation.reasons?.length > 0 && (
        <ul className="mt-2 text-xs text-red-700 list-disc list-inside">
          {calculation.reasons.map((reason: string) => <li key={reason}>{reason}</li>)}
        </ul>
      )}
    </div>
  );
}
const BLANK_SPECIES = { species_name: '', common_name: '', quantity: '', avg_size_cm: '', biomass_kg: '' };

function LegacySpeciesSection({ bookId, exhibitId, species, onRefresh }: {
  bookId: string;
  exhibitId: string;
  species: any[];
  onRefresh: () => void;
}) {
  const [showRow, setShowRow] = useState(false);
  const [row, setRow] = useState({ ...BLANK_SPECIES });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Inline editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState({ ...BLANK_SPECIES });
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const setR = (k: string, v: string) => setRow(r => ({ ...r, [k]: v }));
  const setE = (k: string, v: string) => setEditRow(r => ({ ...r, [k]: v }));

  const startEdit = (sp: any) => {
    setEditingId(sp.id);
    setEditRow({
      species_name: sp.species_name || '',
      common_name:  sp.common_name  || '',
      quantity:     sp.quantity  != null ? String(sp.quantity)  : '',
      avg_size_cm:  sp.avg_size_cm != null ? String(sp.avg_size_cm) : '',
      biomass_kg:   sp.biomass_kg  != null ? String(sp.biomass_kg)  : '',
    });
    setShowRow(false); // close add-row if open
  };

  const cancelEdit = () => { setEditingId(null); setEditRow({ ...BLANK_SPECIES }); };

  const handleUpdate = async (speciesId: string) => {
    if (!editRow.species_name.trim()) return toast.error('Scientific name required');
    setUpdatingId(speciesId);
    try {
      await api.put(`/design-books/${bookId}/species/${speciesId}`, {
        species_name: editRow.species_name.trim(),
        common_name:  editRow.common_name  || null,
        quantity:     editRow.quantity     ? parseInt(editRow.quantity)        : null,
        avg_size_cm:  editRow.avg_size_cm  ? parseFloat(editRow.avg_size_cm)  : null,
        biomass_kg:   editRow.biomass_kg   ? parseFloat(editRow.biomass_kg)   : null,
      });
      setEditingId(null);
      onRefresh();
    } catch {
      toast.error('Failed to update species');
    } finally {
      setUpdatingId(null);
    }
  };

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

  const editKeyDown = (e: React.KeyboardEvent, speciesId: string) => {
    if (e.key === 'Enter') { e.preventDefault(); handleUpdate(speciesId); }
    if (e.key === 'Escape') cancelEdit();
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

  // Shared input cell style
  const cellCls = 'w-full bg-transparent border-b border-emerald-400 focus:outline-none text-sm py-0.5 placeholder-stone-300 text-stone-800';

  const inCell = (k: string, type = 'text', placeholder = '') => (
    <input type={type} step={type === 'number' ? 'any' : undefined} placeholder={placeholder}
      value={(row as any)[k]} onChange={e => setR(k, e.target.value)} onKeyDown={handleKeyDown}
      className={cellCls} />
  );

  const editCell = (k: string, speciesId: string, type = 'text', placeholder = '', extraCls = '') => (
    <input type={type} step={type === 'number' ? 'any' : undefined} placeholder={placeholder}
      value={(editRow as any)[k]} onChange={e => setE(k, e.target.value)}
      onKeyDown={e => editKeyDown(e, speciesId)}
      className={`${cellCls} ${extraCls}`} autoFocus={k === 'species_name'} />
  );

  // Total biomass = sum of (quantity × biomass per unit) for each species
  const totalBiomass = species.reduce((s, sp) => {
    const perUnit = parseFloat(sp.biomass_kg) || 0;
    const qty = parseFloat(sp.quantity) || 0;
    return s + perUnit * qty;
  }, 0);

  // Preview total for the add-row
  const previewTotal = (() => {
    const perUnit = parseFloat(row.biomass_kg) || 0;
    const qty = parseFloat(row.quantity) || 0;
    return perUnit > 0 && qty > 0 ? perUnit * qty : null;
  })();

  // Live total preview for the edit-row
  const editPreviewTotal = (() => {
    const perUnit = parseFloat(editRow.biomass_kg) || 0;
    const qty = parseFloat(editRow.quantity) || 0;
    return perUnit > 0 && qty > 0 ? perUnit * qty : null;
  })();

  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-100 bg-emerald-50/30">
        <div className="flex items-center gap-2 flex-wrap">
          <Fish className="w-4 h-4 text-emerald-600" />
          <span className="text-sm font-semibold text-emerald-800">Species Allocation</span>
          {species.length > 0 && (
            <span className="text-xs bg-emerald-100 text-emerald-700 rounded-full px-1.5 py-0.5">{species.length}</span>
          )}
          {totalBiomass > 0 && (
            <span className="text-xs text-emerald-600 font-mono ml-1 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
              Total biomass: <strong>{totalBiomass.toFixed(2)} kg</strong>
            </span>
          )}
        </div>
        {!showRow && !editingId && (
          <button
            onClick={() => setShowRow(true)}
            className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-800 border border-emerald-200 bg-white rounded-md px-2.5 py-1 transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Species
          </button>
        )}
      </div>

      {(species.length > 0 || showRow) ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50/80">
              <tr>
                <th className="text-left px-5 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Scientific Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Common Name</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Qty</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">Avg Size (cm)</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-stone-500 uppercase tracking-wide">
                  Biomass/unit (kg)
                </th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-emerald-600 uppercase tracking-wide bg-emerald-50/60">
                  Total Biomass (kg)
                </th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {species.map(sp => {
                const isEditing = editingId === sp.id;
                const perUnit = sp.biomass_kg != null ? parseFloat(sp.biomass_kg) : null;
                const qty = sp.quantity != null ? parseFloat(sp.quantity) : null;
                const rowTotal = perUnit != null && qty != null ? perUnit * qty : null;

                if (isEditing) {
                  return (
                    <tr key={sp.id} className="border-t-2 border-emerald-400 bg-emerald-50/60">
                      <td className="px-5 py-2 italic">{editCell('species_name', sp.id, 'text', 'Scientific name', 'italic')}</td>
                      <td className="px-4 py-2">{editCell('common_name', sp.id, 'text', 'Common name')}</td>
                      <td className="px-4 py-2">{editCell('quantity', sp.id, 'number', '0')}</td>
                      <td className="px-4 py-2">{editCell('avg_size_cm', sp.id, 'number', '0.0')}</td>
                      <td className="px-4 py-2">{editCell('biomass_kg', sp.id, 'number', '0.000')}</td>
                      <td className="px-4 py-2 text-right bg-emerald-50/60">
                        {editPreviewTotal != null
                          ? <span className="font-mono font-semibold text-emerald-700">{editPreviewTotal.toFixed(2)}</span>
                          : <span className="text-stone-300 text-xs">auto</span>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-0.5">
                          <button onClick={() => handleUpdate(sp.id)} disabled={updatingId === sp.id}
                            title="Save (Enter)"
                            className="text-emerald-600 hover:text-emerald-800 p-0.5 rounded disabled:opacity-40">
                            {updatingId === sp.id ? <span className="text-xs">…</span> : <Check className="w-4 h-4" />}
                          </button>
                          <button onClick={cancelEdit} title="Cancel (Esc)"
                            className="text-stone-300 hover:text-stone-500 p-0.5 rounded">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={sp.id}
                    onClick={() => !editingId && startEdit(sp)}
                    className={`border-t border-stone-100 transition-colors group ${editingId ? 'opacity-40' : 'hover:bg-emerald-50/30 cursor-pointer'}`}
                  >
                    <td className="px-5 py-3 italic text-stone-700">{sp.species_name}</td>
                    <td className="px-4 py-3 text-stone-600">{sp.common_name || <span className="text-stone-300">—</span>}</td>
                    <td className="px-4 py-3 text-right font-mono text-stone-700">
                      {qty != null ? qty : <span className="text-stone-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-stone-600">
                      {sp.avg_size_cm != null ? parseFloat(sp.avg_size_cm).toFixed(1) : <span className="text-stone-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-stone-600">
                      {perUnit != null ? perUnit.toFixed(3) : <span className="text-stone-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold bg-emerald-50/40">
                      {rowTotal != null
                        ? <span className="text-emerald-800">{rowTotal.toFixed(2)}</span>
                        : <span className="text-stone-300">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(sp.id); }}
                        disabled={deletingId === sp.id}
                        className="opacity-0 group-hover:opacity-100 text-stone-300 hover:text-red-500 transition-all p-0.5 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}

              {showRow && (
                <tr className="border-t-2 border-emerald-300 bg-emerald-50/50">
                  <td className="px-5 py-2.5 italic">{inCell('species_name', 'text', 'e.g. Acanthurus leucosternon')}</td>
                  <td className="px-4 py-2.5">{inCell('common_name', 'text', 'Common name')}</td>
                  <td className="px-4 py-2.5">{inCell('quantity', 'number', '0')}</td>
                  <td className="px-4 py-2.5">{inCell('avg_size_cm', 'number', '0.0')}</td>
                  <td className="px-4 py-2.5">{inCell('biomass_kg', 'number', '0.000')}</td>
                  <td className="px-4 py-2.5 text-right bg-emerald-50/40">
                    {previewTotal != null
                      ? <span className="font-mono text-sm font-semibold text-emerald-700">{previewTotal.toFixed(2)}</span>
                      : <span className="text-stone-300 text-xs">auto</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={handleAdd}
                        disabled={saving}
                        title="Save (Enter)"
                        className="text-emerald-600 hover:text-emerald-800 p-0.5 rounded disabled:opacity-40"
                      >
                        {saving ? <span className="text-xs">…</span> : <Check className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => { setShowRow(false); setRow({ ...BLANK_SPECIES }); }}
                        title="Cancel (Esc)"
                        className="text-stone-300 hover:text-stone-500 p-0.5 rounded"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {totalBiomass > 0 && (
                <tr className="border-t-2 border-emerald-300 bg-emerald-100/50">
                  <td colSpan={5} className="px-5 py-2.5 text-xs font-bold text-emerald-700 uppercase tracking-wide">
                    Grand Total Biomass
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-900 text-base">
                    {totalBiomass.toFixed(2)} kg
                  </td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
          {showRow && (
            <p className="px-5 py-2 text-xs text-stone-400 border-t border-stone-100">
              Press <kbd className="font-mono bg-stone-100 px-1 rounded">Enter</kbd> to save ·{' '}
              <kbd className="font-mono bg-stone-100 px-1 rounded">Esc</kbd> to cancel
            </p>
          )}
        </div>
      ) : (
        <div className="px-5 py-10 text-center">
          <Fish className="w-8 h-8 text-stone-200 mx-auto mb-2" />
          <p className="text-stone-400 text-sm">No species allocated yet.</p>
          <button
            onClick={() => setShowRow(true)}
            className="mt-3 text-xs text-emerald-600 hover:text-emerald-800 border border-emerald-200 bg-emerald-50 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus className="w-3 h-3 inline mr-1" />Add First Species
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Tank Card with Inline Edit ───────────────────────────────────────────────
const TANK_SHAPES = ['Rectangular', 'Cylindrical', 'Custom'];
const TANK_CREATE_FIELD_LABELS: Record<string, string> = {
  tank_code: 'Tank code',
  tank_name: 'Tank name',
  shape_type: 'Shape',
  length_mm: 'Length',
  width_mm: 'Width',
  height_mm: 'Height',
  design_water_level_mm: 'Water level',
  material_id: 'Material',
  primary_material: 'Material',
};

function calcVolumes(shape: string, l: string, w: string, h: string, wl: string, gv: string, ov: string, wallThickness?: string) {
  const s = shape.toLowerCase();
  if (s === 'custom') {
    return { gross: parseFloat(gv) || null, op: parseFloat(ov) || null, fromInner: false };
  }
  const thick = parseFloat(wallThickness || '') || 0;
  const isCyl = s === 'cylindrical';
  // Apply wall thickness to get inner dims (open-top: height loses one wall panel)
  let lv = parseFloat(l) || 0;
  let wv = parseFloat(w) || 0;
  let hv = parseFloat(h) || 0;
  const wlv = parseFloat(wl) || 0;
  const fromInner = thick > 0;
  if (fromInner) {
    if (!isCyl && lv) lv = lv - 2 * thick;
    if (wv) wv = wv - 2 * thick;
    if (hv) hv = hv - thick; // open-top: subtract one bottom wall from height
  }
  if (isCyl) {
    const r = wv / 2;
    const gross = wv && hv ? Math.round(Math.PI * r * r * hv / 1e9 * 1e4) / 1e4 : null;
    const op    = wv && wlv ? Math.round(Math.PI * r * r * wlv / 1e9 * 1e4) / 1e4 : null;
    return { gross, op, fromInner };
  }
  const gross = lv && wv && hv ? Math.round(lv * wv * hv / 1e9 * 1e4) / 1e4 : null;
  const op    = lv && wv && wlv ? Math.round(lv * wv * wlv / 1e9 * 1e4) / 1e4 : null;
  return { gross, op, fromInner };
}

function calcInnerDims(
  shape: string,
  outerL: number | null,
  outerW: number | null,
  outerH: number | null,
  thickness: number | null,
) {
  if (!thickness) return { il: null, iw: null, ih: null };
  const t = Number(thickness);
  const isCyl = (shape || '').toLowerCase() === 'cylindrical';
  return {
    il: isCyl ? null : (outerL ? outerL - 2 * t : null),
    iw: outerW ? outerW - 2 * t : null,
    ih: outerH ? outerH - t : null, // open-top: subtract one bottom panel only
  };
}

// Returns effective operating volume (m³) using inner dims when wall thickness
// is set, outer dims otherwise.  Falls back to the stored operating_volume_m3 /
// design_volume_m3 when critical dimensions are missing.
function computeTankOpVol(tank: any): number | null {
  if (!tank) return null;
  const shape = (tank.eff_shape || tank.shape_type || '').toLowerCase();
  const projectStored = parseFloat(
    tank.project_operating_volume_m3 ?? tank.operating_volume_m3,
  ) || null;
  const pimStored = parseFloat(tank.pim_operating_volume_m3) || null;
  const stored = projectStored ?? pimStored;
  if (shape === 'custom') {
    return stored ?? (parseFloat(tank.design_volume_m3) || null);
  }
  if (stored != null) return stored;
  const thick  = tank.wall_thickness_mm ? parseFloat(tank.wall_thickness_mm) : null;
  const outerW = parseFloat(tank.eff_width_mm  || tank.width_mm)  || null;
  const outerL = parseFloat(tank.eff_length_mm || tank.length_mm) || null;
  const wlv    = parseFloat(tank.eff_water_level_mm ?? tank.design_water_level_mm) || null;
  // Prefer explicitly stored inner dims, then compute from outer − wall
  const innerW = tank.inner_width_mm  ? parseFloat(tank.inner_width_mm)  : (thick && outerW ? outerW - 2 * thick : outerW);
  const innerL = tank.inner_length_mm ? parseFloat(tank.inner_length_mm) : (thick && outerL ? outerL - 2 * thick : outerL);
  const effW = thick ? innerW : outerW;
  const effL = thick ? innerL : outerL;
  if (wlv && effW) {
    if (shape === 'cylindrical') {
      const r = effW / 2;
      return Math.round(Math.PI * r * r * wlv / 1e9 * 1e4) / 1e4;
    }
    if (effL) return Math.round(effL * effW * wlv / 1e9 * 1e4) / 1e4;
  }
  // Fall back to stored value (e.g. product master with pre-computed volume)
  return parseFloat(tank.design_volume_m3) || null;
}

// Returns raw op vol minus substrate + theming displacement.
function computeEffectiveOpVol(tank: any, substrateData: any | null): number | null {
  const raw = computeTankOpVol(tank);
  if (raw == null) return null;
  const sub  = parseFloat(substrateData?.substrate_volume_m3 || '0') || 0;
  const them = parseFloat(substrateData?.theming_volume_m3   || '0') || 0;
  return Math.max(0, raw - sub - them);
}

function DimTile({ label, val, inner }: { label: string; val: string; inner?: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2.5 border ${inner ? 'bg-teal-50 border-teal-100' : 'bg-stone-50 border-stone-100'}`}>
      <div className={`text-xs mb-0.5 ${inner ? 'text-teal-500' : 'text-stone-400'}`}>{label}</div>
      <div className={`font-mono text-sm font-semibold ${inner ? 'text-teal-700' : 'text-stone-700'}`}>{val}</div>
    </div>
  );
}

function tankSheetValue(value: any, suffix = '') {
  return value === null || value === undefined || value === '' ? 'No value' : `${value}${suffix}`;
}

function TankDesignSheetDetails({ tank, projectId, overflowLevel, onOverflowChange, readOnly = false }: {
  tank: any;
  projectId: string;
  overflowLevel?: any;
  onOverflowChange?: (value: string) => void;
  readOnly?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const { data: preview, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['tank-design-sheet-preview', projectId, tank.id],
    queryFn: () => api.get(`/projects/${projectId}/tanks/${tank.id}/design-sheet`).then(response => response.data),
    enabled: expanded && Boolean(projectId),
    retry: false,
  });
  const model = preview?.design_sheet || preview?.data || preview || {};
  const values = model.values || model.inputs || model;
  const rawWarnings = model.validation_warnings || model.warnings || model.reasons || model.validation?.errors || [];
  const validationWarnings: string[] = (Array.isArray(rawWarnings) ? rawWarnings : [rawWarnings])
    .map(warning => typeof warning === 'string' ? warning : warning?.message || String(warning));
  const rawTbc = model.tbc_items || model.tbc || model.tbcs;
  const tbcItems: string[] = Array.isArray(rawTbc) ? rawTbc : rawTbc ? [String(rawTbc)] : [
    'Seismic loads', 'Wind loads', 'Access platform loads', 'Nozzle sizes and loads', 'Supports and anchorage',
  ];
  const basis = model.design_basis || values.design_basis || {};
  const hydrostatic = model.hydrostatic_pressure || values.hydrostatic_pressure || {};
  const densityProvenance = basis.density_provenance || {};
  const source = values.density_source || values.liquid_density_source || values.density?.source ||
    values.liquid_density?.source || densityProvenance.catalog_source || basis.density_source;
  const density = values.liquid_density_kg_m3 ?? values.density_kg_m3 ?? values.density?.value ?? values.liquid_density?.value ?? basis.density_kg_m3;
  const ambient = values.ambient_temperature_c ?? values.ambient_temp_c ?? values.ambient_temperature?.value ?? basis.ambient_air_temperature_c;
  const waterTemperature = values.water_temperature_c ?? values.exhibit_water_temperature_c ?? basis.water_temperature_c;
  const pressure = values.design_pressure_kpa ?? values.design_pressure?.kpa ?? values.design_pressure?.value ?? hydrostatic.pressure_kpa ?? values.design_pressure;
  const pressureBasis = values.pressure_basis || values.design_pressure_basis || hydrostatic.formula
    || 'Hydrodynamic load at maximum water level + 20% allowance';
  const previewInvalid = model.validation?.valid === false;

  const downloadPdf = async () => {
    if (pdfLoading) return;
    setPdfLoading(true);
    try {
      const response = await api.get(`/projects/${projectId}/tanks/${tank.id}/design-sheet.pdf`, { responseType: 'blob' });
      const disposition = response.headers?.['content-disposition'] || response.headers?.['Content-Disposition'] || '';
      const filename = disposition.match(/filename\*?=(?:UTF-8''|")?([^";\n]+)/i)?.[1]?.replace(/"/g, '')
        || `tank-design-sheet-${tank.tank_code || tank.id}.pdf`;
      const blob = response.data instanceof Blob
        ? response.data
        : new Blob([response.data], { type: String(response.headers?.['content-type'] || 'application/pdf') });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = decodeURIComponent(filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Could not create the tank design sheet PDF.');
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <details className="rounded-xl border border-indigo-200 bg-indigo-50/30" onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/40">
        Advanced Details <span className="ml-1 text-xs font-normal text-indigo-600">Design-sheet basis and tank overflow</span>
      </summary>
      <div className="space-y-4 border-t border-indigo-100 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs font-medium text-stone-600">Overflow level (mm)
            <input aria-label="Overflow level (mm)" type="number" min="0" step="any" disabled={readOnly || !onOverflowChange}
              value={overflowLevel ?? tank.overflow_level_mm ?? ''}
              onChange={event => onOverflowChange?.(event.target.value)}
              className="mt-1 block w-full rounded-lg border border-stone-200 px-3 py-2 text-sm disabled:bg-stone-50 disabled:text-stone-400" />
          </label>
          <div className="rounded-lg border border-stone-100 bg-stone-50 px-3 py-2 text-xs text-stone-600">
            <p className="font-medium text-stone-700">Source-owned values</p>
            <p className="mt-1">Dimensions, working volume, maximum water level, and water temperature are read-only here.</p>
          </div>
        </div>
        {isLoading && <p role="status" className="text-sm text-stone-400">Loading canonical design-sheet preview…</p>}
        {isError && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <span>Design-sheet preview could not be loaded: {(error as any)?.response?.data?.error?.message || 'Please retry before creating the sheet.'}</span>
          <button type="button" onClick={() => void refetch()} disabled={isFetching}
            className="shrink-0 rounded-md border border-amber-300 bg-white px-2.5 py-1 font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50">
            {isFetching ? 'Retrying…' : 'Retry preview'}
          </button>
        </div>}
        {!isLoading && !isError && (
          <>
            <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-lg bg-stone-50 p-3">
                <span className="block text-stone-400">Liquid density</span>
                <strong>{tankSheetValue(density, density != null ? ` ${densityProvenance.unit || 'kg/m³'}` : '')}</strong>
                <span className="mt-1 block text-stone-500">Source: {tankSheetValue(source)}</span>
                {densityProvenance.conditions && <span className="mt-1 block text-stone-500">Conditions: {densityProvenance.conditions}</span>}
                {densityProvenance.parameter_id && <span className="mt-1 block font-mono text-[10px] text-stone-400">Reference: {densityProvenance.parameter_id}</span>}
              </div>
              <div className="rounded-lg bg-stone-50 p-3"><span className="block text-stone-400">Ambient temperature</span><strong>{tankSheetValue(ambient, ambient != null ? ' °C' : '')}</strong><span className="mt-1 block text-stone-500">Water temperature: {tankSheetValue(waterTemperature, waterTemperature != null ? ' °C' : '')}</span></div>
              <div className="rounded-lg bg-stone-50 p-3"><span className="block text-stone-400">Design pressure</span><strong>{tankSheetValue(pressure, pressure != null ? ' kPa' : '')}</strong><span className="mt-1 block text-stone-500">{pressureBasis}</span></div>
            </div>
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3 text-xs text-indigo-900">
              <p className="font-semibold">Design assumptions</p>
              <p className="mt-1">{values.design_assumptions || values.assumptions || 'Open to atmosphere · external pressure atmospheric · no vacuum · hydrostatic design pressure at maximum water level plus 20%.'}</p>
              <p className="mt-1 font-medium">Required design life: {values.design_life_years ?? basis.required_life_years ?? 50} years</p>
            </div>
            <div className="text-xs text-stone-600"><span className="font-semibold">TBC:</span> {tbcItems.join(' · ')}</div>
            {validationWarnings.length > 0 && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><p className="font-semibold">Design-sheet validation warnings</p><ul className="mt-1 list-disc pl-4">{validationWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
          </>
        )}
        <button type="button" onClick={() => void downloadPdf()} disabled={pdfLoading || isLoading || isFetching || isError || !preview || previewInvalid}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
          <ArrowDownToLine className="h-3.5 w-3.5" />
          {pdfLoading ? 'Preparing design sheet…' : previewInvalid ? 'Resolve required inputs to create sheet' : 'Create tank design sheet'}
        </button>
      </div>
    </details>
  );
}

function TankCard({ tank, projectId, substrateData, onRefresh, readOnly = false }: { tank: any; projectId: string; substrateData?: any | null; onRefresh: () => void; readOnly?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({});
  const [overrideInner, setOverrideInner] = useState(false);
  const [footprintPromptOpen, setFootprintPromptOpen] = useState(false);
  const [footprintEditorOpen, setFootprintEditorOpen] = useState(false);

  const { data: thermalConstructionData } = useQuery({
    queryKey: ['thermal-wall-constructions'],
    queryFn: () => api.get('/thermal-wall-constructions').then(r => r.data),
    staleTime: 300_000,
    enabled: editing,
  });
  const thermalConstructions: any[] = thermalConstructionData?.items || [];

  const startEdit = () => {
    setForm({
      tank_code:             tank.tank_code || '',
      tank_name:             tank.tank_name || '',
      tank_type:             tank.tank_type || '',
      shape_type:            tank.shape_type || '',
      material_id:           '',
      // Do not turn a PIM material default into a project override when an
      // unrelated field is saved. The select's placeholder presents it instead.
      primary_material:      tank.primary_material || tank.material_name || '',
      wall_thickness_mm:     tank.wall_thickness_mm ?? '',
      length_mm:             tank.length_mm ?? '',
      width_mm:              tank.width_mm  ?? '',
      height_mm:             tank.height_mm ?? '',
      design_water_level_mm: tank.design_water_level_mm ?? '',
      overflow_level_mm:     tank.overflow_level_mm ?? '',
      inner_length_mm:       tank.inner_length_mm ?? '',
      inner_width_mm:        tank.inner_width_mm  ?? '',
      inner_height_mm:       tank.inner_height_mm ?? '',
      gross_volume_m3:       tank.project_gross_volume_m3 ?? (tank.product_master_id ? '' : tank.gross_volume_m3 ?? ''),
      operating_volume_m3:   tank.project_operating_volume_m3 ?? (tank.product_master_id ? '' : tank.operating_volume_m3 ?? tank.design_volume_m3 ?? ''),
      surface_area_m2:       tank.surface_area_m2 ?? '',
       custom_footprint:      tank.custom_footprint ?? null,
      status:                tank.status || 'Active',
    });
    setOverrideInner(!!(tank.inner_length_mm || tank.inner_width_mm || tank.inner_height_mm));
    setEditing(true);
  };

  const setF = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const handleShapeChange = (shape: string) => {
    setF('shape_type', shape);
    if (shape.toLowerCase() === 'custom' && !form.custom_footprint) setFootprintPromptOpen(true);
    if (shape.toLowerCase() !== 'custom' && form.custom_footprint) {
      setF('custom_footprint', null);
      toast('Custom footprint cleared because the tank shape changed.', { icon: 'i' });
    }
  };

  const effectiveEditShape = form.shape_type || tank.eff_shape || 'Rectangular';
  const isCyl  = effectiveEditShape.toLowerCase() === 'cylindrical';
  const isCust = effectiveEditShape.toLowerCase() === 'custom';
  const hasAcceptedCustomFootprint = isCust && !!form.custom_footprint;
  const outerLengthForArea = Number(form.length_mm || tank.eff_length_mm || tank.product_length_mm);
  const outerWidthForArea = Number(form.width_mm || tank.eff_width_mm || tank.product_width_mm);

  const computedInner = calcInnerDims(
    effectiveEditShape,
    parseFloat(form.length_mm || tank.eff_length_mm) || null,
    parseFloat(form.width_mm || tank.eff_width_mm)  || null,
    parseFloat(form.height_mm || tank.eff_height_mm) || null,
    parseFloat(form.wall_thickness_mm) || null,
  );

  const preview = editing
    ? calcVolumes(effectiveEditShape,
                  form.length_mm || tank.eff_length_mm,
                  form.width_mm || tank.eff_width_mm,
                  form.height_mm || tank.eff_height_mm,
                  form.design_water_level_mm || tank.eff_water_level_mm,
                  form.gross_volume_m3 || tank.gross_volume_m3,
                  form.operating_volume_m3 || tank.design_volume_m3,
                  form.wall_thickness_mm)
    : null;

  const handleSave = async () => {
    if (!form.tank_name.trim()) return toast.error('Tank name is required');
    setSaving(true);
    try {
      await api.put(`/tanks/${tank.id}`, {
        tank_code:             form.tank_code || undefined,
        tank_name:             form.tank_name,
        tank_type:             form.tank_type || null,
        shape_type:            form.shape_type || null,
        material_id:           form.material_id || null,
        primary_material:      form.primary_material || null,
        wall_thickness_mm:     form.wall_thickness_mm || null,
        length_mm:             form.length_mm || null,
        width_mm:              form.width_mm  || null,
        height_mm:             form.height_mm || null,
        design_water_level_mm: form.design_water_level_mm || null,
        overflow_level_mm:     form.overflow_level_mm || null,
        inner_length_mm:       overrideInner ? (form.inner_length_mm || null) : null,
        inner_width_mm:        overrideInner ? (form.inner_width_mm  || null) : null,
        inner_height_mm:       overrideInner ? (form.inner_height_mm || null) : null,
        gross_volume_m3:       isCust ? (form.gross_volume_m3 || null) : undefined,
        operating_volume_m3:   isCust ? (form.operating_volume_m3 || null) : undefined,
        surface_area_m2:       isCust ? (form.surface_area_m2 || null) : undefined,
         custom_footprint:      isCust ? form.custom_footprint : null,
        status:                form.status,
      });
      toast.success('Tank updated');
      setEditing(false);
      onRefresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to save tank');
    } finally {
      setSaving(false);
    }
  };

  // ── View mode ──
  if (!editing) {
    const shape = tank.eff_shape || tank.shape_type || '';
    const viewIsCyl = shape.toLowerCase() === 'cylindrical';
    const thick = tank.wall_thickness_mm ? parseFloat(tank.wall_thickness_mm) : null;
    const outerL = parseFloat(tank.eff_length_mm || tank.length_mm) || null;
    const outerW = parseFloat(tank.eff_width_mm  || tank.width_mm)  || null;
    const outerH = parseFloat(tank.eff_height_mm || tank.height_mm) || null;
    const viewComp = calcInnerDims(shape, outerL, outerW, outerH, thick);
    const viewInnerL = tank.inner_length_mm ? parseFloat(tank.inner_length_mm) : viewComp.il;
    const viewInnerW = tank.inner_width_mm  ? parseFloat(tank.inner_width_mm)  : viewComp.iw;
    const viewInnerH = tank.inner_height_mm ? parseFloat(tank.inner_height_mm) : viewComp.ih;
    const innerOverridden = !!(tank.inner_length_mm || tank.inner_width_mm || tank.inner_height_mm);
    const hasDims  = !!(outerL || outerW || outerH);
    const hasInner = !!(viewInnerL || viewInnerW || viewInnerH);

    // Compute volumes — use inner dims when wall thickness is set, outer otherwise.
    // For custom shapes always use the stored values.
    const isCust = shape.toLowerCase() === 'custom';
    const volCalc = isCust
      ? { gross: parseFloat(String(tank.gross_volume_m3)) || null,
          op:    parseFloat(String(tank.operating_volume_m3 ?? tank.design_volume_m3)) || null,
          fromInner: false }
      : (() => {
          const effL = thick && viewInnerL != null ? viewInnerL : outerL;
          const effW = thick && viewInnerW != null ? viewInnerW : outerW;
          const effH = thick && viewInnerH != null ? viewInnerH : outerH;
          const wlv  = (tank.eff_water_level_mm ?? tank.design_water_level_mm)
            ? parseFloat(tank.eff_water_level_mm ?? tank.design_water_level_mm)
            : 0;
          const fi   = !!thick;
          if (viewIsCyl) {
            const r = (effW ?? 0) / 2;
            return {
              gross: effW && effH ? Math.round(Math.PI * r * r * effH! / 1e9 * 1e4) / 1e4 : null,
              op:    effW && wlv  ? Math.round(Math.PI * r * r * wlv  / 1e9 * 1e4) / 1e4 : null,
              fromInner: fi,
            };
          }
          return {
            gross: effL && effW && effH ? Math.round(effL! * effW! * effH! / 1e9 * 1e4) / 1e4 : null,
            op:    effL && effW && wlv  ? Math.round(effL! * effW! * wlv  / 1e9 * 1e4) / 1e4 : null,
            fromInner: fi,
          };
        })();
    const grossVol = volCalc.gross;
    const opVol    = volCalc.op;
    const volFromInner = volCalc.fromInner;
    const surfaceArea = tank.surface_area_m2 != null
      ? Number(tank.surface_area_m2)
      : waterSurfaceAreaM2(shape, viewIsCyl ? null : (thick ? viewInnerL : outerL), thick ? viewInnerW : outerW);

    const statusCls: Record<string, string> = {
      Active:         'bg-emerald-50 text-emerald-700 border-emerald-200',
      Inactive:       'bg-stone-50 text-stone-500 border-stone-200',
      Design:         'bg-blue-50 text-blue-700 border-blue-200',
      Retired:        'bg-red-50 text-red-600 border-red-200',
      Decommissioned: 'bg-stone-100 text-stone-500 border-stone-200',
    };

    const savedFootprintMeasurement = isCust ? footprintMeasurement(tank.custom_footprint) : null;
    return (
      <div className="rounded-xl border border-blue-200 bg-white shadow-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 bg-blue-50/50 border-b border-blue-100">
          <div>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="font-mono text-xs bg-white text-stone-600 px-2 py-0.5 rounded border border-stone-200">{tank.tank_code}</span>
              <ShapeBadge shape={shape} />
              {(tank.eff_tank_type || tank.tank_type) && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium">
                  {tank.eff_tank_type || tank.tank_type}
                </span>
              )}
              {tank.product_master_id && (
                <span
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium"
                  title="This project tank is linked to a reusable PIM library item"
                >
                  <LibraryBig className="w-3 h-3" /> PIM {tank.pim_product_code || tank.product_code}
                </span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusCls[tank.status] ?? statusCls['Active']}`}>
                {tank.status || 'Active'}
              </span>
            </div>
            <h3 className="text-xl font-bold text-stone-800">{tank.tank_name}</h3>
            {(tank.material_name || tank.eff_primary_material || tank.primary_material) && (
              <p className="text-sm text-stone-500 mt-0.5 flex items-center gap-1.5">
                {tank.material_code && (
                  <span className="font-mono text-xs bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded">{tank.material_code}</span>
                )}
                {tank.material_name || tank.eff_primary_material || tank.primary_material}
              </p>
            )}
            {tank.product_master_id && (
              <p className="text-xs text-stone-500 mt-1">
                Source: {tank.pim_tank_family_name ? `${tank.pim_tank_family_name} · ` : ''}{tank.pim_product_name || tank.product_name}
              </p>
            )}
          </div>
          {!readOnly && (
            <button onClick={startEdit}
              className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-blue-600 border border-stone-200 hover:border-blue-300 bg-white rounded-lg px-2.5 py-1.5 transition-colors shrink-0 ml-4">
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          )}
        </div>

        <div className="p-5 space-y-4">
          {/* Outer + Inner Dimensions */}
          {hasDims && (
            <div className={`grid gap-5 ${hasInner ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {/* Outer */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide">Outer Dimensions</p>
                  {thick && (
                    <span className="text-xs bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded-full font-mono">wall {thick} mm</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {!viewIsCyl && outerL && <DimTile label="Length"   val={`${fmtDim(outerL)} mm`} />}
                  {outerW &&               <DimTile label={viewIsCyl ? 'Diameter' : 'Width'} val={`${fmtDim(outerW)} mm`} />}
                  {outerH &&               <DimTile label="Height"   val={`${fmtDim(outerH)} mm`} />}
                  {(tank.eff_water_level_mm ?? tank.design_water_level_mm) && (
                    <DimTile label="Water Level" val={`${fmtDim(tank.eff_water_level_mm ?? tank.design_water_level_mm)} mm`} />
                  )}
                </div>
              </div>
              {/* Inner */}
              {hasInner && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide">Inner Dimensions</p>
                    {innerOverridden && (
                      <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">overridden</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {!viewIsCyl && viewInnerL && <DimTile label="Inner Length" val={`${fmtDim(viewInnerL)} mm`} inner />}
                    {viewInnerW && <DimTile label={viewIsCyl ? 'Inner Dia.' : 'Inner Width'} val={`${fmtDim(viewInnerW)} mm`} inner />}
                    {viewInnerH && <DimTile label="Inner Height" val={`${fmtDim(viewInnerH)} mm`} inner />}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Volumes */}
          {(grossVol != null || opVol != null || surfaceArea != null || isCust) && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide">Volumes</p>
                <span className={`text-xs px-1.5 py-0.5 rounded-full border font-medium ${
                  volFromInner
                    ? 'bg-teal-50 text-teal-600 border-teal-200'
                    : 'bg-stone-50 text-stone-400 border-stone-200'
                }`}>
                  {volFromInner ? 'inner dims' : 'outer dims'}
                </span>
              </div>
              <div className={`grid gap-3 ${surfaceArea != null || isCust ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <div className="bg-blue-50 rounded-xl px-4 py-3 border border-blue-100">
                  <div className="text-xs text-blue-500 mb-1">Gross Volume</div>
                  <div className="text-2xl font-bold text-blue-700 font-mono leading-none">{fmtVol(grossVol)}</div>
                  <div className="text-xs text-blue-400 mt-0.5">m³</div>
                </div>
                <div className="bg-sky-50 rounded-xl px-4 py-3 border border-sky-100">
                  {(() => {
                    const subD  = parseFloat(substrateData?.substrate_volume_m3 || '0') || 0;
                    const themD = parseFloat(substrateData?.theming_volume_m3   || '0') || 0;
                    const displaced = subD + themD;
                    const effVol = opVol != null ? Math.max(0, opVol - displaced) : null;
                    return <>
                      <div className="text-xs text-sky-500 mb-1">{displaced > 0 ? 'Effective Op. Volume' : 'Operating Volume'}</div>
                      <div className="text-2xl font-bold text-sky-700 font-mono leading-none">{fmtVol(effVol)}</div>
                      {displaced > 0
                        ? <div className="text-xs text-sky-400 mt-0.5">m³ · -{displaced.toFixed(3)} displaced</div>
                        : <div className="text-xs text-sky-400 mt-0.5">m³</div>
                      }
                    </>;
                  })()}
                </div>
                {surfaceArea != null && (
                  <div className="bg-teal-50 rounded-xl px-4 py-3 border border-teal-100">
                    <div className="text-xs text-teal-600 mb-1">Water-Surface Area</div>
                    <div className="text-2xl font-bold text-teal-700 font-mono leading-none">{surfaceArea.toFixed(3)}</div>
                    <div className="text-xs text-teal-500 mt-0.5">m² footprint</div>
                  </div>
                )}
                {surfaceArea == null && isCust && (
                  <div className="bg-amber-50 rounded-xl px-4 py-3 border border-amber-200">
                    <div className="text-xs text-amber-700 mb-1">Water-Surface Area</div>
                    <div className="text-sm font-semibold text-amber-800">Not set</div>
                    <div className="text-xs text-amber-600 mt-0.5">Edit tank to confirm footprint</div>
                  </div>
                )}
              </div>
            </div>
          )}
           {isCust && tank.custom_footprint && (
             <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-3">
               <div className="mb-2 flex items-center justify-between gap-3">
                 <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Custom Footprint</p>
                 {savedFootprintMeasurement?.approximate && <span className="text-xs text-amber-700">Approximate sampling</span>}
               </div>
               <FootprintPreview document={tank.custom_footprint} />
               {savedFootprintMeasurement && (
                 <p className="mt-2 text-xs text-stone-600">
                   {savedFootprintMeasurement.perimeter.toFixed(1)} mm perimeter · {savedFootprintMeasurement.area.toFixed(3)} m² water surface · {tank.custom_footprint.segments.length} segments
                 </p>
               )}
             </div>
           )}
            <TankDesignSheetDetails tank={tank} projectId={projectId} readOnly={readOnly} />

          {/* System link */}
          {tank.system_code && (
            <div className="flex items-center gap-2 text-xs text-stone-500 pt-1 border-t border-stone-100">
              <span className="text-stone-400">Linked system:</span>
              <span className="font-mono bg-stone-100 px-1.5 py-0.5 rounded text-stone-600">{tank.system_code}</span>
              {tank.system_name && <span>{tank.system_name}</span>}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Edit mode ──
  return (
    <>
    <div className="rounded-xl border border-blue-400 bg-white shadow-sm">
      <div className="flex items-center justify-between px-5 py-3 border-b border-blue-100 bg-blue-50/40">
        <span className="text-sm font-semibold text-blue-700">Edit Tank</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditing(false)}
            className="text-xs text-stone-500 hover:text-stone-700 px-3 py-1.5 rounded-lg border border-stone-200 bg-white transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-3 py-1.5 rounded-lg font-medium transition-colors">
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Tank Code */}
        <div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Tank Code</label>
            <input type="text" placeholder="TK-01" value={form.tank_code}
              onChange={e => setF('tank_code', e.target.value.toUpperCase())}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
          </div>
        </div>

        {/* Tank Name */}
        <div>
          <label className="block text-xs font-medium text-stone-500 mb-1">Tank Name <span className="text-red-400">*</span></label>
          <input type="text" placeholder="e.g. Main Display Tank" value={form.tank_name}
            onChange={e => setF('tank_name', e.target.value)}
            className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
        </div>

        {/* Shape + Material */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Shape</label>
            <select aria-label="Shape" value={form.shape_type} onChange={e => handleShapeChange(e.target.value)}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
              {tank.product_master_id && <option value="">Use PIM default ({tank.eff_shape || 'not set'})</option>}
              {TANK_SHAPES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Material</label>
            <select value={form.primary_material}
              onChange={e => {
                setF('material_id', '');
                setF('primary_material', e.target.value);
              }}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
              <option value="">{tank.product_master_id ? `Use PIM default (${tank.eff_primary_material || 'not set'})` : '— Select material —'}</option>
              {thermalConstructions.map((construction: any) => (
                <option key={construction.code} value={construction.material}>
                  {construction.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Outer Dimensions */}
        <div>
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">Outer Dimensions (mm)</p>
          <div className={`grid gap-3 ${isCyl ? 'grid-cols-3' : 'grid-cols-4'}`}>
            {!isCyl && (
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Length</label>
                <input type="number" aria-label="Length" placeholder={tank.product_master_id && tank.eff_length_mm ? String(tank.eff_length_mm) : '0'} value={form.length_mm}
                  disabled={hasAcceptedCustomFootprint}
                  onChange={e => setF('length_mm', e.target.value)}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400 disabled:border-stone-200" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">{isCyl ? 'Diameter' : 'Width'}</label>
              <input type="number" aria-label={isCyl ? 'Diameter' : 'Width'} placeholder={tank.product_master_id && tank.eff_width_mm ? String(tank.eff_width_mm) : '0'} value={form.width_mm}
                disabled={hasAcceptedCustomFootprint}
                onChange={e => setF('width_mm', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400 disabled:border-stone-200" />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Height</label>
              <input type="number" aria-label="Height" placeholder={tank.product_master_id && tank.eff_height_mm ? String(tank.eff_height_mm) : '0'} value={form.height_mm}
                onChange={e => setF('height_mm', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Water Level</label>
              <input type="number" aria-label="Water Level" placeholder={tank.product_master_id && tank.eff_water_level_mm ? String(tank.eff_water_level_mm) : '0'} value={form.design_water_level_mm}
                onChange={e => setF('design_water_level_mm', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
          </div>
        </div>

        {/* Wall Thickness */}
        <div>
          <label className="block text-xs font-medium text-stone-500 mb-1">Wall Thickness (mm)</label>
          <div className="flex items-center gap-3 flex-wrap">
            <input type="number" placeholder="e.g. 20" value={form.wall_thickness_mm}
              onChange={e => setF('wall_thickness_mm', e.target.value)}
              className="w-36 border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            {!overrideInner && (computedInner.il || computedInner.iw) && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-stone-400">→ inner:</span>
                {!isCyl && computedInner.il && (
                  <span className="text-xs text-teal-600 bg-teal-50 border border-teal-200 px-2 py-1 rounded font-mono">L {Math.round(computedInner.il)} mm</span>
                )}
                {computedInner.iw && (
                  <span className="text-xs text-teal-600 bg-teal-50 border border-teal-200 px-2 py-1 rounded font-mono">{isCyl ? 'D' : 'W'} {Math.round(computedInner.iw)} mm</span>
                )}
                {computedInner.ih && (
                  <span className="text-xs text-teal-600 bg-teal-50 border border-teal-200 px-2 py-1 rounded font-mono">H {Math.round(computedInner.ih)} mm</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Inner Dimensions */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide">Inner Dimensions (mm)</p>
            <label className="flex items-center gap-1.5 text-xs text-stone-500 cursor-pointer">
              <input type="checkbox" checked={overrideInner} onChange={e => setOverrideInner(e.target.checked)}
                className="rounded border-stone-300" />
              Override computed values
            </label>
          </div>
          {overrideInner ? (
            <div className={`grid gap-3 ${isCyl ? 'grid-cols-2' : 'grid-cols-3'}`}>
              {!isCyl && (
                <div>
                  <label className="block text-xs text-stone-500 mb-1">Inner Length</label>
                  <input type="number" value={form.inner_length_mm}
                    placeholder={computedInner.il ? String(Math.round(computedInner.il)) : '0'}
                    onChange={e => setF('inner_length_mm', e.target.value)}
                    className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 bg-blue-50/40" />
                </div>
              )}
              <div>
                <label className="block text-xs text-stone-500 mb-1">Inner {isCyl ? 'Diameter' : 'Width'}</label>
                <input type="number" value={form.inner_width_mm}
                  placeholder={computedInner.iw ? String(Math.round(computedInner.iw)) : '0'}
                  onChange={e => setF('inner_width_mm', e.target.value)}
                  className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 bg-blue-50/40" />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">Inner Height</label>
                <input type="number" value={form.inner_height_mm}
                  placeholder={computedInner.ih ? String(Math.round(computedInner.ih)) : '0'}
                  onChange={e => setF('inner_height_mm', e.target.value)}
                  className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 bg-blue-50/40" />
              </div>
            </div>
          ) : (
            <div className="bg-teal-50 border border-teal-200 rounded-lg px-4 py-3 text-xs text-teal-600">
              {form.wall_thickness_mm && (computedInner.il || computedInner.iw) ? (
                <span>Auto-computed from outer − 2 × wall (open-top: height − 1 × wall). Check "Override" to enter custom values.</span>
              ) : (
                <span className="text-teal-400">Enter outer dimensions and wall thickness above to auto-compute inner dimensions.</span>
              )}
            </div>
          )}
        </div>

        {/* Volumes */}
        {isCust ? (
          <div className="space-y-4">
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">Volumes (m³) — direct input</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Gross Volume</label>
                <input type="number" placeholder="0.000" value={form.gross_volume_m3}
                  onChange={e => setF('gross_volume_m3', e.target.value)}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Operating Volume</label>
                <input type="number" placeholder="0.000" value={form.operating_volume_m3}
                  onChange={e => setF('operating_volume_m3', e.target.value)}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4 bg-blue-50 rounded-lg px-4 py-3 border border-blue-100">
            <div className="text-xs text-stone-500">Calculated from outer dimensions:</div>
            <div className="flex items-center gap-6">
              <div>
                <div className="text-xs text-stone-400">Gross</div>
                <div className="font-mono text-sm font-bold text-blue-700">
                  {preview?.gross != null ? `${preview.gross.toFixed(3)} m³` : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-stone-400">Operating</div>
                <div className="font-mono text-sm font-bold text-blue-600">
                  {preview?.op != null ? `${preview.op.toFixed(3)} m³` : '—'}
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3">
              <label className="block text-xs font-medium text-amber-800 mb-1">Water-Surface Area (m²)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  placeholder="Enter confirmed footprint area"
                  value={form.surface_area_m2}
                  onChange={e => setF('surface_area_m2', e.target.value)}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                />
                {outerLengthForArea > 0 && outerWidthForArea > 0 && (
                  <button
                    type="button"
                    onClick={() => setF('surface_area_m2', (outerLengthForArea * outerWidthForArea / 1e6).toFixed(4))}
                    className="shrink-0 whitespace-nowrap rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100"
                  >
                    Use L × W
                  </button>
                )}
              </div>
              <p className="mt-1.5 text-xs text-amber-700">
                Uses the outer length × outer width as the water footprint.
              </p>
            </div>
          </div>
        )}
        {isCust && (
          <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-sky-800">Custom footprint</p>
                <p className="mt-1 text-xs text-stone-600">
                  {form.custom_footprint ? 'A saved model-space outline will determine the water-surface area.' : 'No footprint saved yet. You can continue with a manual custom tank and draw one later.'}
                </p>
              </div>
              <button type="button" onClick={() => setFootprintEditorOpen(true)} className="rounded-lg border border-sky-300 bg-white px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-100">
                {form.custom_footprint ? 'Edit footprint' : 'Open footprint tool'}
              </button>
            </div>
            {form.custom_footprint && (() => {
              const measurement = footprintMeasurement(form.custom_footprint);
              return measurement ? <div className="mt-3"><FootprintPreview document={form.custom_footprint} /><p className="mt-2 text-xs text-stone-600">{measurement.perimeter.toFixed(1)} mm perimeter · {measurement.area.toFixed(3)} m² · {form.custom_footprint.segments.length} segments{measurement.approximate ? ' · approximate' : ''}</p></div> : null;
            })()}
          </div>
        )}
        <TankDesignSheetDetails
          tank={tank}
          projectId={projectId}
          overflowLevel={form.overflow_level_mm}
          onOverflowChange={value => setF('overflow_level_mm', value)}
          readOnly={readOnly}
        />

        {/* Status */}
        <div>
          <label className="block text-xs font-medium text-stone-500 mb-1">Status</label>
          <select value={form.status} onChange={e => setF('status', e.target.value)}
            className="w-48 border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
            {['Design', 'Active', 'Inactive', 'Decommissioned'].map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>
    </div>
    {footprintPromptOpen && (
      <FootprintPrompt
        onLaunch={() => { setFootprintPromptOpen(false); setFootprintEditorOpen(true); }}
        onContinue={() => setFootprintPromptOpen(false)}
      />
    )}
    {footprintEditorOpen && (
      <CustomFootprintEditor
        initialValue={form.custom_footprint}
        onCancel={() => setFootprintEditorOpen(false)}
        onAccept={value => { setF('custom_footprint', value); setFootprintEditorOpen(false); }}
      />
    )}
    </>
  );
}

function AssignTankPanel({ exhibit, projectId, designBookId, unassigned, assignedTanks, canUsePim, onRefresh }: {
  exhibit: any;
  projectId: string;
  designBookId: string;
  unassigned: any[];
  assignedTanks: any[];
  canUsePim: boolean;
  onRefresh: () => void;
}) {
  const [mode, setMode] = useState<'assign' | 'pim' | 'new'>('assign');
  const [selected, setSelected] = useState<any | null>(null);
  const [selectedPim, setSelectedPim] = useState<any | null>(null);
  const [pimSearch, setPimSearch] = useState('');
  const [pimFamilyId, setPimFamilyId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [newForm, setNewForm] = useState({
    tank_code: '', tank_name: exhibit.exhibit_name || '', shape_type: 'Rectangular',
    length_mm: '', width_mm: '', height_mm: '', design_water_level_mm: '',
    material_id: '', primary_material: '', custom_footprint: null as any,
  });
  const [newFieldErrors, setNewFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(assignedTanks.length === 0);
  const [footprintPromptOpen, setFootprintPromptOpen] = useState(false);
  const [footprintEditorOpen, setFootprintEditorOpen] = useState(false);
  const currentTank = assignedTanks[0] || null;

  const closeAddPanel = () => {
    setShowAddPanel(false);
    setMode('assign');
    setSelected(null);
    setSelectedPim(null);
  };

  useEffect(() => {
    if (assignedTanks.length === 0) setShowAddPanel(true);
  }, [assignedTanks.length]);

  useEffect(() => {
    if (!showAddPanel || assignedTanks.length === 0 || footprintPromptOpen || footprintEditorOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeAddPanel();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [showAddPanel, assignedTanks.length, footprintPromptOpen, footprintEditorOpen]);

  const { data: thermalConstructionData } = useQuery({
    queryKey: ['thermal-wall-constructions'],
    queryFn: () => api.get('/thermal-wall-constructions').then(r => r.data),
    staleTime: 300_000,
    enabled: mode === 'new',
  });
  const thermalConstructions: any[] = thermalConstructionData?.items || [];
  const { data: pimFamiliesData } = useQuery({
    queryKey: ['tank-families'],
    queryFn: () => api.get('/tank-families').then(r => r.data),
    staleTime: 300_000,
    enabled: mode === 'pim' && canUsePim,
  });
  const pimFamilies: any[] = pimFamiliesData?.items || [];

  const { data: pimTanksData, isLoading: pimLoading } = useQuery({
    queryKey: ['pim-tanks-for-exhibit', pimSearch, pimFamilyId],
    queryFn: () => {
      const params = new URLSearchParams({ category: 'Tank', page_size: '200' });
      if (pimSearch.trim()) params.set('q', pimSearch.trim());
      if (pimFamilyId) params.set('tank_family_id', pimFamilyId);
      return api.get(`/product-masters?${params.toString()}`).then(r => r.data);
    },
    enabled: mode === 'pim' && canUsePim,
  });
  const pimTanks: any[] = pimTanksData?.items || [];

  const setF = (k: string, v: any) => {
    setNewForm(f => ({ ...f, [k]: v }));
    setNewFieldErrors(errors => {
      if (!errors[k]) return errors;
      const next = { ...errors };
      delete next[k];
      return next;
    });
  };
  const handleNewShapeChange = (shape: string) => {
    setF('shape_type', shape);
    if (shape === 'Custom' && !newForm.custom_footprint) setFootprintPromptOpen(true);
    if (shape !== 'Custom' && newForm.custom_footprint) {
      setF('custom_footprint', null);
      toast('Custom footprint cleared because the tank shape changed.', { icon: 'i' });
    }
  };

  const newInputClass = (field: string, extra = '') => [
    'w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2',
    newFieldErrors[field]
      ? 'border border-red-400 bg-red-50/30 focus:ring-red-500/30'
      : 'border border-stone-200 focus:ring-blue-500/30',
    extra,
  ].join(' ');

  const fieldError = (field: string) => newFieldErrors[field] ? (
    <p id={`new-tank-${field}-error`} role="alert" className="mt-1 text-xs font-medium text-red-600">
      {newFieldErrors[field]}
    </p>
  ) : null;

  const handleConfirm = async () => {
    if (!selected) return;
    if (currentTank && !window.confirm(
      `${currentTank.tank_code} — ${currentTank.tank_name} is currently in use. Replace it with ${selected.tank_code} — ${selected.tank_name}?`,
    )) return;
    setConfirming(true);
    try {
      await api.patch(`/tanks/${selected.id}/exhibit`, {
        exhibit_id: exhibit.id,
        replace_tank_id: currentTank?.id || null,
      });
      toast.success(currentTank
        ? `${currentTank.tank_name} replaced with ${selected.tank_name}`
        : `${selected.tank_name} assigned to ${exhibit.exhibit_name}`);
      onRefresh();
      closeAddPanel();
    } catch {
      toast.error('Failed to assign tank');
    } finally {
      setConfirming(false);
    }
  };

  const handleCreate = async () => {
    const validationErrors: Record<string, string> = {};
    if (!newForm.tank_code.trim()) validationErrors.tank_code = 'Tank code is required.';
    else if (newForm.tank_code.trim().length > 50) validationErrors.tank_code = 'Tank code must be 50 characters or fewer.';
    if (!newForm.tank_name.trim()) validationErrors.tank_name = 'Tank name is required.';
    else if (newForm.tank_name.trim().length > 255) validationErrors.tank_name = 'Tank name must be 255 characters or fewer.';
    ([
      ['length_mm', 'Length'],
      ['width_mm', 'Width'],
      ['height_mm', 'Height'],
      ['design_water_level_mm', 'Water level'],
    ] as const).forEach(([field, label]) => {
      const value = newForm[field];
      if (value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
        validationErrors[field] = `${label} must be a non-negative number.`;
      }
    });
    if (Object.keys(validationErrors).length > 0) {
      setNewFieldErrors(validationErrors);
      toast.error(Object.values(validationErrors)[0]);
      return;
    }
    if (currentTank) {
      if (!window.confirm(
        `${currentTank.tank_code} — ${currentTank.tank_name} is currently in use. Replace it with the new tank?`,
      )) return;
    }
    setNewFieldErrors({});
    setSaving(true);
    try {
      const payload = {
        tank_code: newForm.tank_code.trim().toUpperCase(),
        tank_name: newForm.tank_name.trim(),
        shape_type: newForm.shape_type || null,
        length_mm: newForm.length_mm || null,
        width_mm: newForm.width_mm || null,
        height_mm: newForm.height_mm || null,
        design_water_level_mm: newForm.design_water_level_mm || null,
        material_id: newForm.material_id || null,
        primary_material: newForm.primary_material || null,
        custom_footprint: newForm.shape_type === 'Custom' ? newForm.custom_footprint : null,
        product_master_id: null,
        status: 'Active',
      };
      if (currentTank) {
        await api.put(`/tanks/${currentTank.id}`, payload);
      } else {
        await api.post('/tanks', {
          ...payload,
          project_id: projectId,
          exhibit_id: exhibit.id,
        });
      }
      toast.success(currentTank ? 'Existing tank replaced' : 'Tank created and assigned');
      onRefresh();
      closeAddPanel();
    } catch (err: any) {
      const serverError = err?.response?.data?.error;
      const message = serverError?.message || 'Failed to create tank';
      const field = typeof serverError?.field === 'string' ? serverError.field : '';
      if (field && Object.prototype.hasOwnProperty.call(newForm, field)) {
        setNewFieldErrors({ [field]: message });
        toast.error(`${TANK_CREATE_FIELD_LABELS[field] || 'Tank field'}: ${message}`);
      } else {
        toast.error(message);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCreateFromPim = async () => {
    if (!selectedPim) return;
    if (currentTank) {
      if (!window.confirm(
        `${currentTank.tank_code} — ${currentTank.tank_name} is currently in use. Replace it with ${selectedPim.product_code} — ${selectedPim.product_name}?`,
      )) return;
    }
    setConfirming(true);
    try {
      await api.post('/tanks/from-pim', {
        project_id: projectId,
        exhibit_id: exhibit.id,
        design_book_id: designBookId,
        product_master_id: selectedPim.id,
        ...(currentTank ? { replace_tank_id: currentTank.id } : {}),
      });
      toast.success(currentTank
        ? `${currentTank.tank_name} replaced with ${selectedPim.product_name}`
        : `${selectedPim.product_name} linked from the PIM Tank Library`);
      onRefresh();
      closeAddPanel();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to create linked project tank');
    } finally {
      setConfirming(false);
    }
  };

  const isCyl = newForm.shape_type === 'Cylindrical';
  const hasAcceptedNewCustomFootprint = newForm.shape_type === 'Custom' && !!newForm.custom_footprint;
  const newFootprintMeasurement = footprintMeasurement(newForm.custom_footprint);
  const newSurfaceArea = newForm.shape_type === 'Custom' && newFootprintMeasurement
    ? newFootprintMeasurement.area
    : waterSurfaceAreaM2(newForm.shape_type, newForm.length_mm, newForm.width_mm);

  if (assignedTanks.length > 0 && !showAddPanel) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => { setMode('new'); setShowAddPanel(true); }}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
        >
          <SquarePlus className="w-4 h-4" /> Add a New Tank
        </button>
      </div>
    );
  }

  return (
    <>
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-stone-100 bg-stone-50/50">
        <div className="flex items-center gap-1">
          <button
          onClick={() => { setMode('assign'); setSelected(null); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            mode === 'assign' ? 'bg-blue-600 text-white' : 'text-stone-600 hover:bg-stone-100'
          }`}
        >
          <LinkIcon className="w-3.5 h-3.5" /> Project Tanks
          </button>
          {canUsePim && (
            <button
            onClick={() => { setMode('pim'); setSelected(null); setSelectedPim(null); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              mode === 'pim' ? 'bg-blue-600 text-white' : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            <LibraryBig className="w-3.5 h-3.5" /> PIM Tank Library
            </button>
          )}
          <button
          onClick={() => { setMode('new'); setSelected(null); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            mode === 'new' ? 'bg-blue-600 text-white' : 'text-stone-600 hover:bg-stone-100'
          }`}
        >
          <SquarePlus className="w-3.5 h-3.5" /> Create New Tank
          </button>
        </div>
        {assignedTanks.length > 0 && (
          <button
            type="button"
            onClick={closeAddPanel}
            className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100"
          >
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
        )}
      </div>

      <div className="p-5">
        {mode === 'assign' && (
          unassigned.length === 0 ? (
            <div className="text-center py-8 text-stone-400">
              <Layers className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No unassigned tanks in this project.</p>
              <button onClick={() => setMode('new')} className="mt-2 text-blue-600 hover:underline text-sm">
                Create a new tank instead →
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-stone-500 mb-3">
                {unassigned.length} unassigned tank{unassigned.length !== 1 ? 's' : ''} — select one to assign:
              </p>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {unassigned.map(tank => {
                  const isSel = selected?.id === tank.id;
                  return (
                    <button
                      key={tank.id}
                      onClick={() => setSelected(isSel ? null : tank)}
                      className={`w-full text-left flex items-center gap-3 rounded-xl px-4 py-3 border transition-all ${
                        isSel
                          ? 'bg-blue-50 border-blue-400 ring-1 ring-blue-300'
                          : 'bg-stone-50 border-stone-200 hover:border-blue-300 hover:bg-blue-50/30'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        isSel ? 'border-blue-500 bg-blue-500' : 'border-stone-300'
                      }`}>
                        {isSel && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                      <span className="font-mono text-xs bg-white text-stone-600 px-1.5 py-0.5 rounded border border-stone-200 shrink-0">{tank.tank_code}</span>
                      <span className="font-medium text-stone-700 flex-1">{tank.tank_name}</span>
                      <ShapeBadge shape={tank.eff_shape} />
                      {tank.gross_volume_m3 && (
                        <span className="text-sm font-mono text-stone-500">{parseFloat(tank.gross_volume_m3).toFixed(2)} m³</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {selected && (
                <div className="mt-3 rounded-xl bg-blue-600 text-white px-5 py-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle2 className="w-5 h-5 shrink-0 text-blue-200" />
                    <div>
                      <p className="font-semibold">{selected.tank_name}</p>
                      <p className="text-sm text-blue-200">
                        {selected.eff_shape || 'Tank'}{selected.gross_volume_m3 ? ` · ${parseFloat(selected.gross_volume_m3).toFixed(2)} m³` : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleConfirm}
                    disabled={confirming}
                    className="shrink-0 flex items-center gap-2 bg-white text-blue-700 font-semibold text-sm px-4 py-2 rounded-lg hover:bg-blue-50 disabled:opacity-50 transition-colors"
                  >
                    <Check className="w-4 h-4" />
                    {confirming ? 'Assigning…' : 'Confirm Assignment'}
                  </button>
                </div>
              )}
            </div>
          )
        )}

        {mode === 'pim' && canUsePim && (
          <div className="space-y-4">
            {assignedTanks.length > 0 && (
              <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-semibold">Tank already in use</p>
                <p className="mt-0.5">
                  {assignedTanks.map(tank => `${tank.tank_code} — ${tank.tank_name}`).join(', ')} is already assigned to this exhibit.
                  Creating a linked tank may change which tank the Design Book uses.
                </p>
              </div>
            )}
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3">
              <p className="text-sm font-semibold text-blue-800">Create a linked project tank</p>
              <p className="text-xs text-blue-700 mt-0.5">
                The selected library item stays unchanged. A new tank will be created for this project and exhibit, with PIM dimensions and reusable details available as defaults.
              </p>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-3">
              <input
                type="search"
                value={pimSearch}
                onChange={event => { setPimSearch(event.target.value); setSelectedPim(null); }}
                placeholder="Search PIM tanks by code or name…"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
              <select
                value={pimFamilyId}
                onChange={event => { setPimFamilyId(event.target.value); setSelectedPim(null); }}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                aria-label="Filter by PIM tank family"
              >
                <option value="">All tank families</option>
                {pimFamilies.map(family => (
                  <option key={family.id} value={family.id}>{family.name} ({family.product_count})</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {pimLoading ? (
                <p className="py-8 text-center text-sm text-stone-400">Loading PIM tanks…</p>
              ) : pimTanks.length === 0 ? (
                <p className="py-8 text-center text-sm text-stone-400">No PIM tanks match this search or family.</p>
              ) : pimTanks.map(pimTank => {
                const isSelected = selectedPim?.id === pimTank.id;
                const surfaceArea = pimTank.surface_area_m2
                  ?? waterSurfaceAreaM2(pimTank.shape_type, pimTank.length_mm, pimTank.width_mm);
                return (
                  <button
                    key={pimTank.id}
                    type="button"
                    onClick={() => setSelectedPim(isSelected ? null : pimTank)}
                    className={`w-full text-left flex items-center gap-3 rounded-xl px-4 py-3 border transition-all ${
                      isSelected
                        ? 'bg-blue-50 border-blue-400 ring-1 ring-blue-300'
                        : 'bg-stone-50 border-stone-200 hover:border-blue-300 hover:bg-blue-50/30'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      isSelected ? 'border-blue-500 bg-blue-500' : 'border-stone-300'
                    }`}>
                      {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                    <span className="font-mono text-xs bg-white text-stone-600 px-1.5 py-0.5 rounded border border-stone-200 shrink-0">
                      {pimTank.product_code}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-stone-700 truncate">{pimTank.product_name}</p>
                      <p className="text-xs text-stone-400 truncate">{pimTank.tank_family_name || 'Unclassified PIM tank'}</p>
                    </div>
                    <ShapeBadge shape={pimTank.shape_type} />
                    {surfaceArea != null && (
                      <span className="text-xs font-mono text-stone-500">{Number(surfaceArea).toFixed(3)} m²</span>
                    )}
                    {pimTank.gross_volume_m3 && (
                      <span className="text-sm font-mono text-stone-500">{parseFloat(pimTank.gross_volume_m3).toFixed(2)} m³</span>
                    )}
                  </button>
                );
              })}
            </div>

            {selectedPim && (
              <div className="rounded-xl bg-blue-600 text-white px-5 py-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <LibraryBig className="w-5 h-5 shrink-0 text-blue-200" />
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{selectedPim.product_name}</p>
                    <p className="text-sm text-blue-200 truncate">
                      {selectedPim.product_code} · creates a new linked project tank
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCreateFromPim}
                  disabled={confirming}
                  className="shrink-0 flex items-center gap-2 bg-white text-blue-700 font-semibold text-sm px-4 py-2 rounded-lg hover:bg-blue-50 disabled:opacity-50 transition-colors"
                >
                  <Check className="w-4 h-4" />
                  {confirming ? 'Creating…' : 'Create & Assign Linked Tank'}
                </button>
              </div>
            )}
          </div>
        )}

        {mode === 'new' && (
          <div className="space-y-4">
            {assignedTanks.length > 0 && (
              <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-semibold">Tank already in use</p>
                <p className="mt-0.5">
                  {assignedTanks.map(tank => `${tank.tank_code} — ${tank.tank_name}`).join(', ')} is already assigned to this exhibit.
                  Creating a new tank may change which tank the Design Book uses. You will be asked to confirm before it is created.
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="new-tank-code" className="block text-xs font-medium text-stone-500 mb-1">Tank Code *</label>
                <input id="new-tank-code" type="text" placeholder="e.g. TK-01" maxLength={50}
                  value={newForm.tank_code} onChange={e => setF('tank_code', e.target.value)}
                  aria-invalid={!!newFieldErrors.tank_code}
                  aria-describedby={newFieldErrors.tank_code ? 'new-tank-tank_code-error' : undefined}
                  className={newInputClass('tank_code', 'uppercase')} />
                {fieldError('tank_code')}
              </div>
              <div>
                <label htmlFor="new-tank-shape" className="block text-xs font-medium text-stone-500 mb-1">Shape</label>
                <select id="new-tank-shape" value={newForm.shape_type} onChange={e => handleNewShapeChange(e.target.value)}
                  aria-invalid={!!newFieldErrors.shape_type}
                  aria-describedby={newFieldErrors.shape_type ? 'new-tank-shape_type-error' : undefined}
                  className={newInputClass('shape_type', 'bg-white')}>
                  {TANK_SHAPES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {fieldError('shape_type')}
              </div>
            </div>
            <div>
              <label htmlFor="new-tank-name" className="block text-xs font-medium text-stone-500 mb-1">Tank Name *</label>
              <input id="new-tank-name" type="text" placeholder="e.g. Main Display Tank" maxLength={255}
                value={newForm.tank_name} onChange={e => setF('tank_name', e.target.value)}
                aria-invalid={!!newFieldErrors.tank_name}
                aria-describedby={newFieldErrors.tank_name ? 'new-tank-tank_name-error' : undefined}
                className={newInputClass('tank_name')} />
              {fieldError('tank_name')}
            </div>
            <div className={`grid gap-3 ${isCyl ? 'grid-cols-3' : 'grid-cols-4'}`}>
              {!isCyl && (
                <div>
                  <label htmlFor="new-tank-length" className="block text-xs text-stone-500 mb-1">Length (mm)</label>
                  <input id="new-tank-length" type="number" min="0" placeholder="0" value={newForm.length_mm} onChange={e => setF('length_mm', e.target.value)}
                    disabled={hasAcceptedNewCustomFootprint}
                    aria-invalid={!!newFieldErrors.length_mm}
                    aria-describedby={newFieldErrors.length_mm ? 'new-tank-length_mm-error' : undefined}
                    className={newInputClass('length_mm', 'disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400 disabled:border-stone-200')} />
                  {fieldError('length_mm')}
                </div>
              )}
              <div>
                <label htmlFor="new-tank-width" className="block text-xs text-stone-500 mb-1">{isCyl ? 'Diameter (mm)' : 'Width (mm)'}</label>
                <input id="new-tank-width" type="number" min="0" placeholder="0" value={newForm.width_mm} onChange={e => setF('width_mm', e.target.value)}
                  disabled={hasAcceptedNewCustomFootprint}
                  aria-invalid={!!newFieldErrors.width_mm}
                  aria-describedby={newFieldErrors.width_mm ? 'new-tank-width_mm-error' : undefined}
                  className={newInputClass('width_mm', 'disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400 disabled:border-stone-200')} />
                {fieldError('width_mm')}
              </div>
              <div>
                <label htmlFor="new-tank-height" className="block text-xs text-stone-500 mb-1">Height (mm)</label>
                <input id="new-tank-height" type="number" min="0" placeholder="0" value={newForm.height_mm} onChange={e => setF('height_mm', e.target.value)}
                  aria-invalid={!!newFieldErrors.height_mm}
                  aria-describedby={newFieldErrors.height_mm ? 'new-tank-height_mm-error' : undefined}
                  className={newInputClass('height_mm')} />
                {fieldError('height_mm')}
              </div>
              <div>
                <label htmlFor="new-tank-water-level" className="block text-xs text-stone-500 mb-1">Water Level (mm)</label>
                <input id="new-tank-water-level" type="number" min="0" placeholder="0" value={newForm.design_water_level_mm} onChange={e => setF('design_water_level_mm', e.target.value)}
                  aria-invalid={!!newFieldErrors.design_water_level_mm}
                  aria-describedby={newFieldErrors.design_water_level_mm ? 'new-tank-design_water_level_mm-error' : undefined}
                  className={newInputClass('design_water_level_mm')} />
                {fieldError('design_water_level_mm')}
              </div>
            </div>
            <div className="rounded-lg bg-stone-50 border border-stone-100 px-4 py-3 flex items-center justify-between">
              <span className="text-xs font-medium text-stone-500">Water-surface area</span>
              <span className="font-mono text-sm font-semibold text-stone-700">
                {newSurfaceArea == null ? '—' : `${newSurfaceArea.toFixed(3)} m²`}
              </span>
            </div>
            {newForm.shape_type === 'Custom' && (
              <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-sky-800">Custom footprint</p>
                    <p className="mt-1 text-xs text-stone-600">
                      {newForm.custom_footprint ? 'This outline will be saved with the tank.' : 'No footprint attached. You may create the tank now and draw one later.'}
                    </p>
                  </div>
                  <button type="button" onClick={() => setFootprintEditorOpen(true)} className="rounded-lg border border-sky-300 bg-white px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-100">
                    {newForm.custom_footprint ? 'Edit footprint' : 'Open footprint tool'}
                  </button>
                </div>
                {newForm.custom_footprint && newFootprintMeasurement && (
                  <div className="mt-3">
                    <FootprintPreview document={newForm.custom_footprint} />
                    <p className="mt-2 text-xs text-stone-600">{newFootprintMeasurement.perimeter.toFixed(1)} mm perimeter · {newFootprintMeasurement.area.toFixed(3)} m² · {newForm.custom_footprint.segments.length} segments{newFootprintMeasurement.approximate ? ' · approximate' : ''}</p>
                  </div>
                )}
              </div>
            )}
            <div>
              <label htmlFor="new-tank-material" className="block text-xs text-stone-500 mb-1">Material</label>
              <select
                id="new-tank-material"
                value={newForm.primary_material}
                onChange={e => {
                  setF('material_id', '');
                  setF('primary_material', e.target.value);
                }}
                aria-invalid={!!newFieldErrors.material_id}
                aria-describedby={newFieldErrors.material_id ? 'new-tank-material_id-error' : undefined}
                className={newInputClass('material_id', 'bg-white')}
              >
                <option value="">— Select material —</option>
                {thermalConstructions.map((construction: any) => (
                  <option key={construction.code} value={construction.material}>
                    {construction.label}
                  </option>
                ))}
              </select>
              {fieldError('material_id')}
            </div>
            <div className="flex justify-end">
              <button onClick={handleCreate} disabled={saving}
                className="flex items-center gap-2 px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors">
                <SquarePlus className="w-4 h-4" />
                {saving ? 'Creating…' : 'Create & Assign Tank'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
    {footprintPromptOpen && (
      <FootprintPrompt
        onLaunch={() => { setFootprintPromptOpen(false); setFootprintEditorOpen(true); }}
        onContinue={() => setFootprintPromptOpen(false)}
      />
    )}
    {footprintEditorOpen && (
      <CustomFootprintEditor
        initialValue={newForm.custom_footprint}
        onCancel={() => setFootprintEditorOpen(false)}
        onAccept={value => { setF('custom_footprint', value); setFootprintEditorOpen(false); }}
      />
    )}
    </>
  );
}

// ─── Theming & Substrate Section ─────────────────────────────────────────────
const SUBSTRATE_TYPES = [
  'None', 'Silica Sand', 'Coral Sand', 'Coral Rubble', 'Live Rock',
  'Gravel', 'Crushed Coral', 'Concrete', 'Bare Bottom', 'Other',
];

function SubstrateSection({ bookId, exhibitId, tank, substrateData, onRefresh }: {
  bookId: string;
  exhibitId: string;
  tank: any;
  substrateData: any | null;
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [subOverride, setSubOverride] = useState(false);
  const [themVolumeMode, setThemVolumeMode] = useState<'height' | 'pct' | 'direct'>('height');
  const [form, setForm] = useState({
    substrate_type:      substrateData?.substrate_type      || 'None',
    substrate_height_mm: substrateData?.substrate_height_mm != null ? String(substrateData.substrate_height_mm) : '',
    substrate_volume_m3: substrateData?.substrate_volume_m3 != null ? String(substrateData.substrate_volume_m3) : '',
    theming_type:        substrateData?.theming_type        || '',
    theming_height_mm:   substrateData?.theming_height_mm   != null ? String(substrateData.theming_height_mm)   : '',
    theming_volume_m3:   substrateData?.theming_volume_m3   != null ? String(substrateData.theming_volume_m3)   : '',
    theming_volume_pct:  substrateData?.theming_volume_pct  != null ? String(substrateData.theming_volume_pct)  : '',
    notes:               substrateData?.notes               || '',
  });

  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // Resolve tank inner footprint (L × W) for volume calculation
  const wall   = parseFloat(tank?.wall_thickness_mm) || null;
  const outerL = parseFloat(tank?.eff_length_mm || tank?.length_mm) || null;
  const outerW = parseFloat(tank?.eff_width_mm  || tank?.width_mm)  || null;
  const tankInnerL: number | null = tank?.inner_length_mm
    ? parseFloat(tank.inner_length_mm)
    : (wall && outerL ? outerL - 2 * wall : outerL);
  const tankInnerW: number | null = tank?.inner_width_mm
    ? parseFloat(tank.inner_width_mm)
    : (wall && outerW ? outerW - 2 * wall : outerW);
  const hasTankFootprint = !!(tankInnerL && tankInnerW);

  const calcVol = (heightStr: string): number | null => {
    if (!heightStr) return null;                        // empty → no value
    const h = parseFloat(heightStr);
    if (isNaN(h) || !tankInnerL || !tankInnerW) return null;
    return h <= 0 ? 0 : Math.round(tankInnerL * tankInnerW * h / 1e9 * 1e6) / 1e6;
  };

  const subComputed  = calcVol(form.substrate_height_mm);
  const themComputed = calcVol(form.theming_height_mm);

  const opVol = computeTankOpVol(tank) ?? 0;

  // Effective volumes for the displaced preview
  const subEffVol  = editing
    ? (subOverride  ? (parseFloat(form.substrate_volume_m3) || 0) : ((subComputed  ?? parseFloat(form.substrate_volume_m3))  || 0))
    : (parseFloat(substrateData?.substrate_volume_m3  || '') || 0);
  const themPctVol = themVolumeMode === 'pct' && form.theming_volume_pct
    ? opVol * (parseFloat(form.theming_volume_pct) || 0) / 100
    : 0;
  const themEffVol = editing
    ? (themVolumeMode === 'pct'    ? themPctVol
     : themVolumeMode === 'direct' ? (parseFloat(form.theming_volume_m3) || 0)
     : ((themComputed ?? parseFloat(form.theming_volume_m3)) || 0))
    : (parseFloat(substrateData?.theming_volume_m3    || '') || 0);

  const displaced    = subEffVol + themEffVol;
  const effectiveVol = opVol > 0 ? Math.max(0, opVol - displaced) : null;

  const handleEdit = () => {
    setForm({
      substrate_type:      substrateData?.substrate_type      || 'None',
      substrate_height_mm: substrateData?.substrate_height_mm != null ? String(substrateData.substrate_height_mm) : '',
      substrate_volume_m3: substrateData?.substrate_volume_m3 != null ? String(substrateData.substrate_volume_m3) : '',
      theming_type:        substrateData?.theming_type        || '',
      theming_height_mm:   substrateData?.theming_height_mm   != null ? String(substrateData.theming_height_mm)   : '',
      theming_volume_m3:   substrateData?.theming_volume_m3   != null ? String(substrateData.theming_volume_m3)   : '',
      theming_volume_pct:  substrateData?.theming_volume_pct  != null ? String(substrateData.theming_volume_pct)  : '',
      notes:               substrateData?.notes               || '',
    });
    setSubOverride(!substrateData?.substrate_height_mm && !!substrateData?.substrate_volume_m3);
    if (substrateData?.theming_volume_pct != null) {
      setThemVolumeMode('pct');
    } else if (!substrateData?.theming_height_mm && substrateData?.theming_volume_m3) {
      setThemVolumeMode('direct');
    } else {
      setThemVolumeMode('height');
    }
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const finalSubVol  = subOverride
        ? (form.substrate_volume_m3  ? parseFloat(form.substrate_volume_m3)  : null)
        : (subComputed  ?? (form.substrate_volume_m3  ? parseFloat(form.substrate_volume_m3)  : null));
      const finalThemPct = themVolumeMode === 'pct' ? (form.theming_volume_pct ? parseFloat(form.theming_volume_pct) : null) : null;
      const finalThemVol = themVolumeMode === 'pct'
        ? (opVol > 0 && form.theming_volume_pct ? Math.round(opVol * parseFloat(form.theming_volume_pct) / 100 * 1e6) / 1e6 : null)
        : themVolumeMode === 'direct'
          ? (form.theming_volume_m3 ? parseFloat(form.theming_volume_m3) : null)
          : (themComputed ?? (form.theming_volume_m3 ? parseFloat(form.theming_volume_m3) : null));
      await api.put(`/design-books/${bookId}/exhibits/${exhibitId}/substrate`, {
        substrate_type:      form.substrate_type !== 'None' ? form.substrate_type : null,
        substrate_height_mm: form.substrate_height_mm ? parseFloat(form.substrate_height_mm) : null,
        substrate_volume_m3: finalSubVol,
        theming_type:        form.theming_type    || null,
        theming_height_mm:   themVolumeMode === 'height' && form.theming_height_mm ? parseFloat(form.theming_height_mm) : null,
        theming_volume_m3:   finalThemVol,
        theming_volume_pct:  finalThemPct,
        notes:               form.notes           || null,
      });
      toast.success('Theming & substrate saved');
      setEditing(false);
      onRefresh();
    } catch (err: any) {
      console.error('Substrate save error:', err);
      toast.error(err?.response?.data?.error?.message || 'Failed to save substrate');
    } finally {
      setSaving(false);
    }
  };

  const hasData = (substrateData?.substrate_type && substrateData.substrate_type !== 'None')
               || substrateData?.theming_type
               || (parseFloat(substrateData?.substrate_volume_m3 || '0') > 0)
               || (parseFloat(substrateData?.theming_volume_m3   || '0') > 0)
               || (parseFloat(substrateData?.theming_volume_pct  || '0') > 0)
               || (parseFloat(substrateData?.substrate_height_mm || '0') > 0)
               || (parseFloat(substrateData?.theming_height_mm   || '0') > 0);
  const inputCls = 'w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/40';

  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-100 bg-blue-50/30">
        <div className="flex items-center gap-2">
          <Mountain className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-semibold text-blue-800">Theming &amp; Substrate</span>
          {effectiveVol != null && displaced > 0 && (
            <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full font-mono ml-1">
              {effectiveVol.toFixed(3)} m³ effective
            </span>
          )}
        </div>
        {!editing ? (
          <button onClick={handleEdit}
            className="flex items-center gap-1 text-xs text-blue-700 hover:text-blue-900 border border-blue-200 bg-white rounded-md px-2.5 py-1 transition-colors">
            <Pencil className="w-3 h-3" /> Edit
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-md px-2.5 py-1 transition-colors disabled:opacity-50">
              <Save className="w-3 h-3" /> {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)}
              className="text-xs text-stone-400 hover:text-stone-600 border border-stone-200 bg-white rounded-md px-2 py-1">
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="p-5">
        {editing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Substrate */}
              <div className="space-y-3 p-4 rounded-xl bg-stone-50 border border-stone-100">
                <div className="flex items-center gap-1.5 mb-1">
                  <Mountain className="w-3.5 h-3.5 text-stone-500" />
                  <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Substrate</span>
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1">Type</label>
                  <select value={form.substrate_type} onChange={e => setF('substrate_type', e.target.value)}
                    className={`${inputCls} bg-white`}>
                    {SUBSTRATE_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1">Layer Height (mm)</label>
                  <input type="number" min="0" placeholder="e.g. 150"
                    value={form.substrate_height_mm} onChange={e => setF('substrate_height_mm', e.target.value)}
                    className={inputCls} />
                  {form.substrate_height_mm && !subOverride && (
                    <div className="mt-1.5">
                      {hasTankFootprint && subComputed != null ? (
                        <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 px-2 py-1 rounded font-mono">
                          {(tankInnerL! / 1000).toFixed(3)} × {(tankInnerW! / 1000).toFixed(3)} × {(parseFloat(form.substrate_height_mm) / 1000).toFixed(3)} = {subComputed.toFixed(4)} m³
                        </span>
                      ) : (
                        <span className="text-xs text-stone-400">No tank footprint — enter volume directly below</span>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-stone-500">Displaced Volume (m³)</label>
                    <label className="flex items-center gap-1.5 text-xs text-stone-400 cursor-pointer">
                      <input type="checkbox" checked={subOverride} onChange={e => setSubOverride(e.target.checked)}
                        className="rounded border-stone-300" />
                      Override
                    </label>
                  </div>
                  {subOverride || !form.substrate_height_mm || !hasTankFootprint ? (
                    <input type="number" step="0.0001" min="0" placeholder="0.0000"
                      value={form.substrate_volume_m3} onChange={e => setF('substrate_volume_m3', e.target.value)}
                      className={subOverride ? `${inputCls} border-blue-300 bg-blue-50/30` : inputCls} />
                  ) : (
                    <div className="px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 font-mono text-sm text-blue-800 font-semibold">
                      {subComputed != null ? `${subComputed.toFixed(4)} m³` : '—'}
                    </div>
                  )}
                </div>
              </div>

              {/* Theming */}
              <div className="space-y-3 p-4 rounded-xl bg-stone-50 border border-stone-100">
                <div className="flex items-center gap-1.5 mb-1">
                  <Palette className="w-3.5 h-3.5 text-stone-500" />
                  <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Theming</span>
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1">Type</label>
                  <input type="text" placeholder="e.g. Artificial Coral, Rock Work, Wreck…"
                    value={form.theming_type} onChange={e => setF('theming_type', e.target.value)}
                    className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1">Layer Height (mm)</label>
                  <input type="number" min="0" placeholder="e.g. 300"
                    value={form.theming_height_mm} onChange={e => setF('theming_height_mm', e.target.value)}
                    className={inputCls} />
                  {form.theming_height_mm && themVolumeMode === 'height' && (
                    <div className="mt-1.5">
                      {hasTankFootprint && themComputed != null ? (
                        <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 px-2 py-1 rounded font-mono">
                          {(tankInnerL! / 1000).toFixed(3)} × {(tankInnerW! / 1000).toFixed(3)} × {(parseFloat(form.theming_height_mm) / 1000).toFixed(3)} = {themComputed.toFixed(4)} m³
                        </span>
                      ) : (
                        <span className="text-xs text-stone-400">No tank footprint — enter volume directly below</span>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-stone-500">Displaced Volume</label>
                    <div className="flex rounded-md border border-stone-200 overflow-hidden text-xs font-medium">
                      {(['height', 'pct', 'direct'] as const).map(m => (
                        <button key={m} type="button" onClick={() => setThemVolumeMode(m)}
                          className={`px-2.5 py-1 transition-colors ${themVolumeMode === m ? 'bg-blue-600 text-white' : 'bg-white text-stone-500 hover:bg-stone-50'}`}>
                          {m === 'height' ? 'Height' : m === 'pct' ? '% Vol' : 'Direct m³'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {themVolumeMode === 'height' && (
                    themComputed != null && themComputed > 0 ? (
                      <div className="px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 font-mono text-sm text-blue-800 font-semibold">
                        {themComputed.toFixed(4)} m³
                      </div>
                    ) : (
                      <div className="px-3 py-2 rounded-lg bg-stone-50 border border-stone-200 text-sm text-stone-400">
                        {form.theming_height_mm ? 'No tank footprint — use Direct m³' : 'Enter height above to auto-calculate'}
                      </div>
                    )
                  )}

                  {themVolumeMode === 'pct' && (
                    <div className="space-y-1.5">
                      <div className="relative">
                        <input type="number" step="0.1" min="0" max="100" placeholder="e.g. 15"
                          value={form.theming_volume_pct} onChange={e => setF('theming_volume_pct', e.target.value)}
                          className={`${inputCls} pr-8`} />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm pointer-events-none">%</span>
                      </div>
                      {opVol > 0 && form.theming_volume_pct ? (
                        <div className="flex items-center gap-1.5 text-xs text-stone-500">
                          <span className="font-mono">{form.theming_volume_pct}%</span>
                          <span className="text-stone-300">×</span>
                          <span className="font-mono">{opVol.toFixed(3)} m³</span>
                          <span className="text-stone-300">=</span>
                          <span className="font-mono font-semibold text-blue-700">
                            {(opVol * (parseFloat(form.theming_volume_pct) || 0) / 100).toFixed(4)} m³
                          </span>
                        </div>
                      ) : opVol === 0 ? (
                        <p className="text-xs text-stone-400">Assign a tank with known dimensions first</p>
                      ) : null}
                    </div>
                  )}

                  {themVolumeMode === 'direct' && (
                    <input type="number" step="0.0001" min="0" placeholder="0.0000"
                      value={form.theming_volume_m3} onChange={e => setF('theming_volume_m3', e.target.value)}
                      className={inputCls} />
                  )}
                </div>
              </div>
            </div>

            {/* Volume impact preview */}
            {opVol > 0 && (subEffVol > 0 || themEffVol > 0) && (
              <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm">
                <span className="text-stone-500">Operating</span>
                <span className="font-mono font-semibold text-stone-700">{opVol.toFixed(3)} m³</span>
                <span className="text-stone-400">−</span>
                <span className="text-stone-500">Displaced</span>
                <span className="font-mono font-semibold text-blue-700">{displaced.toFixed(4)} m³</span>
                <span className="text-stone-400">=</span>
                <span className="text-stone-500">Effective</span>
                <span className="font-mono font-bold text-emerald-700 text-base">{effectiveVol?.toFixed(3)} m³</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Notes</label>
              <textarea rows={2} placeholder="Material specifications, installation notes…"
                value={form.notes} onChange={e => setF('notes', e.target.value)}
                className={`${inputCls} resize-none`} />
            </div>
          </div>
        ) : hasData ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Substrate view */}
              <div className="p-4 rounded-xl bg-stone-50 border border-stone-100">
                <div className="flex items-center gap-1.5 mb-3">
                  <Mountain className="w-3.5 h-3.5 text-stone-500" />
                  <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Substrate</span>
                </div>
                <p className="text-base font-semibold text-stone-800">{substrateData?.substrate_type || <span className="text-stone-300 font-normal">None</span>}</p>
                {substrateData?.substrate_height_mm != null && parseFloat(substrateData.substrate_height_mm) > 0 && (
                  <p className="text-xs text-stone-400 mt-1 font-mono">Layer height: {parseFloat(substrateData.substrate_height_mm)} mm</p>
                )}
                {substrateData?.substrate_volume_m3 != null && parseFloat(substrateData.substrate_volume_m3) > 0 && (
                  <p className="text-sm text-stone-500 mt-0.5 font-mono">{parseFloat(substrateData.substrate_volume_m3).toFixed(4)} m³ displaced</p>
                )}
              </div>
              {/* Theming view */}
              <div className="p-4 rounded-xl bg-stone-50 border border-stone-100">
                <div className="flex items-center gap-1.5 mb-3">
                  <Palette className="w-3.5 h-3.5 text-stone-500" />
                  <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Theming</span>
                </div>
                <p className="text-base font-semibold text-stone-800">{substrateData?.theming_type || <span className="text-stone-300 font-normal">None</span>}</p>
                {substrateData?.theming_height_mm != null && parseFloat(substrateData.theming_height_mm) > 0 && (
                  <p className="text-xs text-stone-400 mt-1 font-mono">Layer height: {parseFloat(substrateData.theming_height_mm)} mm</p>
                )}
                {substrateData?.theming_volume_pct != null && parseFloat(substrateData.theming_volume_pct) > 0 ? (
                  <p className="text-sm text-stone-500 mt-0.5 font-mono">
                    {parseFloat(substrateData.theming_volume_pct)}% of op. vol
                    {substrateData.theming_volume_m3 && parseFloat(substrateData.theming_volume_m3) > 0
                      ? ` = ${parseFloat(substrateData.theming_volume_m3).toFixed(4)} m³`
                      : ''}{' '}displaced
                  </p>
                ) : substrateData?.theming_volume_m3 != null && parseFloat(substrateData.theming_volume_m3) > 0 ? (
                  <p className="text-sm text-stone-500 mt-0.5 font-mono">{parseFloat(substrateData.theming_volume_m3).toFixed(4)} m³ displaced</p>
                ) : null}
              </div>
            </div>

            {/* Effective volume */}
            {opVol > 0 && displaced > 0 && (
              <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm">
                <span className="text-stone-500">Operating</span>
                <span className="font-mono font-semibold text-stone-700">{opVol.toFixed(3)} m³</span>
                <span className="text-stone-400">−</span>
                <span className="text-stone-500">Displaced</span>
                <span className="font-mono font-semibold text-blue-700">{displaced.toFixed(4)} m³</span>
                <span className="text-stone-400">=</span>
                <span className="text-stone-500">Effective</span>
                <span className="font-mono font-bold text-emerald-700 text-base">{effectiveVol?.toFixed(3)} m³</span>
              </div>
            )}

            {substrateData?.notes && (
              <p className="text-sm text-stone-500 italic">{substrateData.notes}</p>
            )}
          </div>
        ) : (
          <div className="py-8 text-center">
            <Mountain className="w-8 h-8 text-stone-200 mx-auto mb-2" />
            <p className="text-stone-400 text-sm">No theming or substrate defined yet.</p>
            <button onClick={handleEdit}
              className="mt-3 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 bg-blue-50 px-3 py-1.5 rounded-lg transition-colors">
              <Plus className="w-3 h-3 inline mr-1" />Define Substrate &amp; Theming
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

type ResultUnit = 'mm' | 'm' | 'cm' | 'in';
const RESULT_UNITS: ResultUnit[] = ['mm', 'm', 'cm', 'in'];

function fmtWeir(L: number, unit: ResultUnit): string {
  switch (unit) {
    case 'mm': return (L * 1000).toFixed(0);
    case 'm':  return L.toFixed(4);
    case 'cm': return (L * 100).toFixed(2);
    case 'in': return (L * 1000 / 25.4).toFixed(2);
  }
}

export function PipeSizingSection({ bookId, exhibitId, hydraulics, calculation, readOnly, onRefresh }: {
  bookId: string; exhibitId: string; hydraulics: any | null; calculation: any | null; readOnly: boolean; onRefresh: () => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ['pipe-sizing-standards'],
    queryFn: () => api.get('/admin/pipe-sizing-standards').then(response => response.data),
    staleTime: 60_000,
  });
  const allStandards: any[] = (data?.items || [])
    .sort((a: any, b: any) => Number(a.dn) - Number(b.dn));
  const standards = allStandards.filter((item: any) => item.is_active !== false);
  const velocity = (flow: any, diameter: any) => {
    const q = Number(flow); const d = Number(diameter) / 1000;
    const value = q / 3600 / (Math.PI * d * d / 4);
    return Number.isFinite(value) ? value : null;
  };
  const renderPipe = (key: 'inlet' | 'discharge' | 'bottom_drain', title: string, flow: any) => {
    const pressureService = key === 'inlet';
    const savedDn = hydraulics?.[`${key}_pipe_dn`];
    const savedEvidence = hydraulics?.[`${key}_pipe_evidence`] || null;
    const recommended = standards.find(item => {
      const value = velocity(flow, item.internal_diameter_mm);
       const min = Number(item[pressureService ? 'pressure_velocity_min_m_s' : 'gravity_velocity_min_m_s']);
       const max = Number(item[pressureService ? 'pressure_velocity_max_m_s' : 'gravity_velocity_max_m_s']);
      return value != null && value >= min && value <= max;
    }) || null;
    const selected = savedEvidence ? {
      dn: savedEvidence.dn,
      internal_diameter_mm: savedEvidence.internal_diameter_mm,
      [pressureService ? 'pressure_velocity_min_m_s' : 'gravity_velocity_min_m_s']: savedEvidence.velocity_min_m_s,
      [pressureService ? 'pressure_velocity_max_m_s' : 'gravity_velocity_max_m_s']: savedEvidence.velocity_max_m_s,
    } : allStandards.find(item => Number(item.dn) === Number(savedDn)) || null;
    const hasSavedSelection = savedEvidence != null || savedDn != null;
    const current = selected || recommended;
    const next = current ? standards.find(item => Number(item.dn) > Number(current.dn)) || null : null;
    const minimumVelocity = Number(current?.[pressureService ? 'pressure_velocity_min_m_s' : 'gravity_velocity_min_m_s']);
    const maximumVelocity = Number(current?.[pressureService ? 'pressure_velocity_max_m_s' : 'gravity_velocity_max_m_s']);
    const currentVelocity = savedEvidence
      ? Number(savedEvidence.computed_velocity_m_s)
      : current ? velocity(flow, current.internal_diameter_mm) : null;
    const currentWithinBand = savedEvidence
      ? savedEvidence.within_band === true
      : currentVelocity != null && currentVelocity >= minimumVelocity && currentVelocity <= maximumVelocity;
    const displayedFlow = savedEvidence ? Number(savedEvidence.authoritative_flow_m3h) : Number(flow);
    const nextVelocity = next ? velocity(flow, next.internal_diameter_mm) : null;
    const nextMinimumVelocity = Number(next?.[pressureService ? 'pressure_velocity_min_m_s' : 'gravity_velocity_min_m_s']);
    const nextMaximumVelocity = Number(next?.[pressureService ? 'pressure_velocity_max_m_s' : 'gravity_velocity_max_m_s']);
    const nextWithinBand = nextVelocity != null && nextVelocity >= nextMinimumVelocity && nextVelocity <= nextMaximumVelocity;
    const save = async (dn: number) => {
      setSaving(key);
      try {
        await api.put(`/design-books/${bookId}/exhibits/${exhibitId}/hydraulics`, {
          target_turnover_rate: hydraulics?.target_turnover_rate ?? null,
          surface_skim_pct: hydraulics?.surface_skim_pct ?? 30,
          bottom_drain_pct: hydraulics?.bottom_drain_pct ?? 70,
          notes: hydraulics?.notes ?? null,
          [`${key}_pipe_dn`]: dn,
        });
        toast.success(`${title} DN ${dn} saved`);
        onRefresh();
      } catch { toast.error('Failed to save pipe selection'); } finally { setSaving(null); }
    };
    return <div className="rounded-xl border border-stone-200 p-4 space-y-3" key={key}>
      <div className="flex justify-between gap-3"><div><h3 className="font-semibold text-stone-800">{title}</h3>
        <p className="text-xs text-stone-500">{key === 'inlet' ? 'Exhibit design flow · pressure' : key === 'discharge' ? 'Weir discharge flow · gravity' : 'Bottom-drain flow · gravity'}{current && Number.isFinite(minimumVelocity) && Number.isFinite(maximumVelocity) ? ` · target ${minimumVelocity.toFixed(1)}–${maximumVelocity.toFixed(1)} m/s` : ''}</p></div>
        <div className="text-right text-sm font-mono text-blue-700">{Number.isFinite(displayedFlow) ? `${displayedFlow.toFixed(3)} m³/h` : 'Flow unavailable'}</div></div>
      {!current ? <p className="text-sm text-amber-700">No active standard is within the velocity band for this flow.</p> : <>
        <div className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2 text-sm">
          <span>{hasSavedSelection ? 'Saved selection' : 'Recommendation'}: <b>DN {current.dn}</b> ({Number(current.internal_diameter_mm).toFixed(1)} mm ID)</span>
          <span className={`font-mono ${currentWithinBand ? '' : 'text-amber-700'}`}>{currentVelocity?.toFixed(3)} m/s{currentWithinBand ? '' : ' · outside target'}</span>
        </div>
        {hasSavedSelection && !recommended && <p className="text-xs text-amber-700">The saved engineering basis is retained, but no currently active standard is within the target band.</p>}
        {!hasSavedSelection && recommended && !readOnly && <button onClick={() => save(Number(recommended.dn))} disabled={saving === key}
          className="text-xs rounded-lg bg-blue-600 px-3 py-2 font-medium text-white disabled:opacity-50">Save recommendation</button>}
        {next && !readOnly && <button onClick={() => save(Number(next.dn))} disabled={saving === key}
          className="ml-2 text-xs rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 font-medium text-blue-700 disabled:opacity-50">
          Go one size up · DN {next.dn} ({nextVelocity?.toFixed(3)} m/s{nextWithinBand ? '' : ', outside target'})
        </button>}
      </>}
    </div>;
  };
  return <div className="bg-white rounded-xl border border-stone-200 overflow-hidden"><div className="px-5 py-3.5 border-b border-stone-100 bg-blue-50/40">
    <span className="text-sm font-semibold text-blue-800">Exhibit Pipe Sizing</span>
  </div><div className="p-5 grid gap-4 md:grid-cols-3">
    {renderPipe('inlet', 'Inlet pipe', calculation?.results?.total_return_flow_m3h)}
    {renderPipe('discharge', 'Discharge after weir', calculation?.results?.surface_skim_flow_m3h)}
    {renderPipe('bottom_drain', 'Bottom drain pipe', calculation?.results?.bottom_drain_flow_m3h)}
  </div></div>;
}

function WeirAllocationSection({ bookId, exhibitId, tank, hydraulics, substrateData, calculation, onRefresh }: {
  bookId: string;
  exhibitId: string;
  tank: any | null;
  hydraulics: any | null;
  substrateData?: any | null;
  calculation?: any | null;
  onRefresh: () => void;
}) {
  const [headVal, setHeadVal]       = useState('');
  const [headUnit, setHeadUnit]     = useState<'mm' | 'm'>('mm');
  const [resultUnit, setResultUnit] = useState<ResultUnit>('mm');
  const [geometry, setGeometry] = useState(hydraulics?.weir_geometry || 'sharp_rectangular');
  const [contractions, setContractions] = useState(
    hydraulics?.weir_end_contractions != null ? String(hydraulics.weir_end_contractions) : '2',
  );
  const [dischargeCondition, setDischargeCondition] = useState(
    hydraulics?.weir_discharge_condition || 'free',
  );
  const [downstreamHeadVal, setDownstreamHeadVal] = useState(
    hydraulics?.weir_downstream_head_mm != null ? String(parseFloat(hydraulics.weir_downstream_head_mm)) : '0',
  );
  const [method, setMethod] = useState<WeirMethod>(
    hydraulics?.weir_formula_method === 'bazin_1888' ? 'bazin_1888' : 'francis_184',
  );
  const [saving, setSaving]         = useState(false);
  const initialized                 = useRef(false);

  // Seed the saved values once. Legacy head-only records intentionally keep
  // their head but have no confirmed method/boundary conditions.
  useEffect(() => {
    if (!initialized.current) {
      if (hydraulics?.weir_head_mm != null) {
        setHeadVal(String(parseFloat(hydraulics.weir_head_mm)));
      }
      setGeometry(hydraulics?.weir_geometry || 'sharp_rectangular');
      setContractions(hydraulics?.weir_end_contractions != null ? String(hydraulics.weir_end_contractions) : '2');
      setDischargeCondition(hydraulics?.weir_discharge_condition || 'free');
      setDownstreamHeadVal(hydraulics?.weir_downstream_head_mm != null
        ? String(parseFloat(hydraulics.weir_downstream_head_mm))
        : '0');
      setMethod(hydraulics?.weir_formula_method === 'bazin_1888' ? 'bazin_1888' : 'francis_184');
      initialized.current = true;
    }
  }, [hydraulics]);

  // Derive surface skim flow from hydraulics (same logic as WaterFlowTab)
  const opVol    = calculation?.results?.operating_volume_m3 ?? 0;
  const turnover = parseFloat(hydraulics?.target_turnover_rate) || 0;
  const skimPct  = parseFloat(hydraulics?.surface_skim_pct) || 30;
  const totalM3h = calculation?.results?.total_return_flow_m3h ?? null;
  const skimM3h  = calculation?.results?.surface_skim_flow_m3h ?? null;
  const skimLmin = skimM3h != null ? skimM3h * 1000 / 60 : null;

  const headRaw    = parseFloat(headVal) || 0;
  const headM      = headUnit === 'mm' ? headRaw / 1000 : headRaw;
  const currentMm  = headM > 0 ? headM * 1000 : null;
  const storedMm   = hydraulics?.weir_head_mm != null ? parseFloat(String(hydraulics.weir_head_mm)) : null;
  const storedLengthMm = hydraulics?.weir_length_mm != null
    ? parseFloat(String(hydraulics.weir_length_mm))
    : null;
  const storedContractions = hydraulics?.weir_end_contractions != null
    ? String(hydraulics.weir_end_contractions)
    : null;
  const storedDownstreamMm = hydraulics?.weir_downstream_head_mm != null
    ? parseFloat(String(hydraulics.weir_downstream_head_mm))
    : null;
  const basisConfirmed = ['francis_184', 'bazin_1888'].includes(hydraulics?.weir_formula_method)
    && hydraulics?.weir_geometry != null
    && hydraulics?.weir_end_contractions != null
    && hydraulics?.weir_discharge_condition != null
    && storedDownstreamMm != null;
  const basisComplete = geometry === 'sharp_rectangular'
    && ['0', '1', '2'].includes(contractions)
    && ['free', 'submerged'].includes(dischargeCondition)
    && downstreamHeadVal.trim() !== ''
    && Number.isFinite(parseFloat(downstreamHeadVal))
    && parseFloat(downstreamHeadVal) >= 0;
  const isDirty = currentMm !== storedMm
    || method !== (hydraulics?.weir_formula_method || null)
    || geometry !== (hydraulics?.weir_geometry || null)
    || contractions !== storedContractions
    || dischargeCondition !== (hydraulics?.weir_discharge_condition || null)
    || (Number.isFinite(parseFloat(downstreamHeadVal)) ? parseFloat(downstreamHeadVal) : null) !== storedDownstreamMm;

  const calculationInputs = skimM3h != null && basisComplete
    ? {
      flowM3h: skimM3h,
      headM,
      geometry,
      endContractions: parseInt(contractions, 10),
      dischargeCondition,
      downstreamHeadM: parseFloat(downstreamHeadVal) / 1000,
    }
    : null;
  const francisPreview = calculationInputs ? calculateFrancisWeir(calculationInputs) : null;
  const bazinPreview = calculationInputs ? calculateBazinWeir(calculationInputs) : null;
  const basisResult = method === 'bazin_1888' ? bazinPreview : francisPreview;
  const calculatedLengthMm = basisResult?.status === 'valid' && basisResult.lengthM != null
    ? Math.round(basisResult.lengthM * 1000 * 100) / 100
    : null;
  const lengthIsDirty = calculatedLengthMm !== storedLengthMm;
  const isCalculationStale = isDirty || lengthIsDirty;
  const result = basisConfirmed ? basisResult : null;
  const noFlow  = skimM3h == null;
  const noHead  = headM <= 0;
  const needsBasisConfirmation = !basisConfirmed;

  const nextUnit = RESULT_UNITS[(RESULT_UNITS.indexOf(resultUnit) + 1) % RESULT_UNITS.length];

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/design-books/${bookId}/exhibits/${exhibitId}/hydraulics`, {
        target_turnover_rate: hydraulics?.target_turnover_rate ?? null,
        surface_skim_pct:     hydraulics?.surface_skim_pct     ?? 30,
        bottom_drain_pct:     hydraulics?.bottom_drain_pct     ?? 70,
        notes:                hydraulics?.notes                ?? null,
        weir_head_mm:         currentMm,
        weir_length_mm:       calculatedLengthMm,
        weir_formula_method:  method,
        weir_geometry:        geometry,
        weir_end_contractions: parseInt(contractions, 10),
        weir_discharge_condition: dischargeCondition,
        weir_downstream_head_mm: parseFloat(downstreamHeadVal),
      });
      toast.success('Weir design saved');
      initialized.current = false; // allow re-seed after refresh
      onRefresh();
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-stone-100 bg-indigo-50/40">
        <Calculator className="w-4 h-4 text-indigo-600" />
        <span className="text-sm font-semibold text-indigo-800">Weir Allocation</span>
        <span className="text-xs text-indigo-500 ml-1">
          — {method === 'bazin_1888' ? 'Bazin alternative' : 'Francis recommended case'}
        </span>
      </div>
      <div className="px-5 pt-5">
        <CalculationTrace calculation={calculation} title="Surface Skim Source Trace" />
      </div>

      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Left — inputs */}
        <div className="space-y-4">

          {/* Upstream flow */}
          <div>
            <p className="text-xs font-medium text-stone-500 mb-2">Surface Skim Flow <span className="font-normal text-stone-400">(from Water Flow tab)</span></p>
            {noFlow ? (
              <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                Set tank volume &amp; turnover rate in the Water Flow tab first
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 text-center min-w-0">
                  <p className="text-lg font-bold text-sky-700 font-mono">{skimM3h!.toFixed(3)}</p>
                  <p className="text-xs text-sky-500">m³/h</p>
                </div>
                <ArrowRight className="w-4 h-4 text-stone-300 shrink-0" />
                <div className="bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 text-center min-w-0">
                  <p className="text-lg font-bold text-sky-700 font-mono">{skimLmin!.toFixed(1)}</p>
                  <p className="text-xs text-sky-500">L/min</p>
                </div>
                <span className="text-xs text-stone-400">{skimPct}% of total flow</span>
              </div>
            )}
          </div>

          {/* Head over weir input + save */}
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1.5">Head Over Weir (H)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step={headUnit === 'mm' ? '5' : '0.005'}
                min="0"
                placeholder={headUnit === 'mm' ? 'e.g. 50' : 'e.g. 0.050'}
                value={headVal}
                onChange={e => setHeadVal(e.target.value)}
                className="flex-1 border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
              />
              <div className="flex rounded-lg border border-stone-200 overflow-hidden text-xs font-medium">
                {(['mm', 'm'] as const).map(u => (
                  <button key={u}
                    onClick={() => {
                      if (headUnit !== u && headVal) {
                        const v = parseFloat(headVal);
                        if (!isNaN(v)) setHeadVal(u === 'm' ? (v / 1000).toFixed(4) : (v * 1000).toFixed(0));
                      }
                      setHeadUnit(u);
                    }}
                    className={`px-3 py-2 transition-colors ${headUnit === u ? 'bg-indigo-600 text-white' : 'bg-white text-stone-500 hover:bg-stone-50'}`}
                  >{u}</button>
                ))}
              </div>
              {isCalculationStale && headM > 0 && basisComplete && (
                <button onClick={handleSave} disabled={saving}
                  className="flex items-center gap-1 text-xs text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg px-3 py-2 font-medium transition-colors shrink-0">
                  <Save className="w-3 h-3" />{saving ? '…' : basisConfirmed ? 'Save' : 'Confirm & Save'}
                </button>
              )}
            </div>
            {headM > 0 && (
              <p className="text-xs text-stone-400 mt-1">
                = {headUnit === 'mm' ? `${headM.toFixed(4)} m` : `${(headM * 1000).toFixed(1)} mm`}
                {!isCalculationStale && storedMm != null && <span className="ml-2 text-indigo-400">✓ saved</span>}
              </p>
            )}
          </div>

          {/* Applicability and operating conditions */}
          <div className="border border-indigo-200 bg-indigo-50/40 rounded-lg px-4 py-3 space-y-3">
            <div>
              <p className="text-xs font-semibold text-indigo-800">Applicability &amp; operating conditions</p>
              <p className="text-xs text-indigo-600/80 mt-0.5">These conditions are part of the saved design basis, not optional calculation notes.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Calculation method</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {([
                  { value: 'francis_184' as const, label: 'Francis', detail: 'Recommended standard case' },
                  { value: 'bazin_1888' as const, label: 'Bazin', detail: 'Alternative comparison method' },
                ]).map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setMethod(option.value)}
                    className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                      method === option.value
                        ? 'border-indigo-400 bg-indigo-50 text-indigo-800'
                        : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
                    }`}
                  >
                    <span className="block text-xs font-semibold">{option.label}</span>
                    <span className="block text-[11px] text-stone-400 mt-0.5">{option.detail}</span>
                  </button>
                ))}
              </div>
              {basisComplete && (
                <p className="text-xs text-stone-400 mt-1.5">
                  {francisPreview?.status === 'valid'
                    ? francisPreview.warnings.length > 0
                      ? `Francis is available with a head-height review warning at H/L ${francisPreview.headToLengthRatio!.toFixed(2)}.`
                      : `Francis is within its preferred reference range at H/L ${francisPreview.headToLengthRatio!.toFixed(2)}.`
                    : bazinPreview?.status === 'valid'
                      ? 'Francis is outside its approved range; Bazin is available as an alternative with review.'
                      : 'Neither method is currently valid for these operating conditions.'}
                </p>
              )}
              <p className="text-xs text-stone-400 mt-1">Heads below 50 mm are permitted for both methods and are flagged for engineering review.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Weir geometry</label>
              <select value={geometry} onChange={e => setGeometry(e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400/30">
                <option value="sharp_rectangular">Sharp-crested rectangular</option>
              </select>
              <p className="text-xs text-stone-400 mt-1">Broad-crested, V-notch, and proprietary weirs are outside this calculator.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">End contractions (n)</label>
                <select value={contractions} onChange={e => setContractions(e.target.value)}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400/30">
                  <option value="0">0 — suppressed / no end contractions</option>
                  <option value="1">1 — one end contraction</option>
                  <option value="2">2 — two end contractions</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Discharge condition</label>
                <select value={dischargeCondition} onChange={e => setDischargeCondition(e.target.value)}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400/30">
                  <option value="free">Free discharge</option>
                  <option value="submerged">Submerged / drowned (not supported)</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Downstream water above crest</label>
              <div className="flex items-center gap-2">
                <input type="number" min="0" step="1" value={downstreamHeadVal}
                  onChange={e => setDownstreamHeadVal(e.target.value)}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400/30" />
                <span className="text-xs text-stone-500 shrink-0">mm</span>
              </div>
              <p className="text-xs text-stone-400 mt-1">Use 0 mm only when the downstream water surface is below the crest and discharge is demonstrably free.</p>
            </div>
            {needsBasisConfirmation && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                Confirm and save these conditions before relying on the sizing result.
              </p>
            )}
          </div>

          {/* Formula reference */}
          <div className="bg-stone-50 border border-stone-200 rounded-lg px-4 py-3 space-y-1 text-xs text-stone-500">
            {method === 'bazin_1888' ? (
              <>
                <p className="font-semibold text-stone-600 mb-1.5">Bazin (1888) Alternative</p>
                <p className="font-mono">Q = m · L · √(2g) · H<sup>3/2</sup></p>
                <p className="font-mono">m = {BAZIN_COEFFICIENT_BASE.toFixed(3)} + {BAZIN_HEAD_COEFFICIENT.toFixed(4)} / H</p>
                <p>Q in m³/s · L and H in m · n is recorded but not applied by this alternative</p>
                <p className="text-stone-400 mt-1.5">Use as an explicit comparison method for the same sharp-crested rectangular, free-discharge case.</p>
                <p className="text-stone-400">Preferred reference: H ≥ {BAZIN_MIN_HEAD_M * 1000} mm; lower heads are permitted with a review warning. Review the displayed H/L ratio before adopting the result.</p>
              </>
            ) : (
              <>
                <p className="font-semibold text-stone-600 mb-1.5">Francis (SI) Formula</p>
                <p className="font-mono">Q = {FRANCIS_COEFFICIENT.toFixed(2)} · (L − 0.1 · n · H) · H<sup>3/2</sup></p>
                <p className="font-mono">L = Q / ({FRANCIS_COEFFICIENT.toFixed(2)} · H<sup>3/2</sup>) + 0.1 · n · H</p>
                <p>Q in m³/s · L and H in m · n = number of end contractions</p>
                <p className="text-stone-400 mt-1.5">Source: Francis, <em>Lowell Hydraulic Experiments</em> (1852), SI form used by the project design basis.</p>
                <p className="text-stone-400">Preferred reference: sharp-crested rectangular, free discharge, H = {FRANCIS_MIN_HEAD_M * 1000}–{FRANCIS_MAX_HEAD_M * 1000} mm, H/L ≤ {FRANCIS_MAX_HEAD_TO_LENGTH_RATIO.toFixed(2)}, tailwater above crest = 0 mm. Below {FRANCIS_MIN_HEAD_M * 1000} mm is permitted with a review warning.</p>
              </>
            )}
          </div>
        </div>

        {/* Right — result */}
        <div className="flex flex-col justify-center items-center">
          {noFlow || noHead ? (
            <div className="text-center space-y-2 py-6">
              <Calculator className="w-10 h-10 text-stone-200 mx-auto" />
              <p className="text-sm text-stone-400">
                {noFlow ? 'Set flow data in Water Flow tab' : 'Enter head over weir to calculate'}
              </p>
            </div>
          ) : needsBasisConfirmation ? (
            <div className="text-center space-y-2 py-6">
              <AlertTriangle className="w-10 h-10 text-amber-300 mx-auto" />
              <p className="text-sm font-medium text-amber-700">Design basis confirmation required</p>
              <p className="text-xs text-stone-500 max-w-sm mx-auto">The previous head value is retained, but no complete method and applicability basis was saved with it. Confirm the method and operating conditions, then save.</p>
            </div>
          ) : basisResult?.status === 'invalid' ? (
            <div className="w-full bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                <AlertTriangle className="w-4 h-4" /> {method === 'bazin_1888' ? 'Bazin' : 'Francis'} sizing unavailable
              </div>
              <ul className="list-disc pl-5 space-y-1 text-xs text-amber-700">
                {basisResult.reasons.map(reason => <li key={reason}>{reason}</li>)}
              </ul>
              <p className="text-xs text-amber-700/80 pt-1">Obtain a project hydraulic review or use an approved alternate method; this panel does not size unsupported weirs.</p>
            </div>
          ) : result ? (
            <div className="w-full space-y-4">
              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide text-center">
                Skimmer Box Opening Width
              </p>
              {/* Primary result — cycling unit */}
              <div className="bg-indigo-50 border-2 border-indigo-200 rounded-2xl px-6 py-5 text-center relative">
                <button
                  onClick={() => setResultUnit(nextUnit)}
                  title={`Switch to ${nextUnit}`}
                  className="absolute top-2.5 right-3 text-xs text-indigo-400 hover:text-indigo-700 bg-white border border-indigo-200 rounded-md px-2 py-0.5 font-medium transition-colors"
                >
                  {nextUnit} →
                </button>
                <p className="text-4xl font-bold text-indigo-700 font-mono tracking-tight">
                  {fmtWeir(result.lengthM!, resultUnit)}
                </p>
                <p className="text-base font-medium text-indigo-500 mt-0.5">{resultUnit}</p>
                <p className={`text-xs mt-2 ${isCalculationStale ? 'text-amber-700' : 'text-indigo-500'}`}>
                  {isCalculationStale
                    ? 'Recalculated from current inputs — save to persist this value.'
                    : `Saved calculated length: ${storedLengthMm?.toFixed(2)} mm`}
                </p>
              </div>
              {/* Calculation breakdown */}
              <div className="bg-white border border-stone-200 rounded-lg px-4 py-3 text-xs space-y-1 text-stone-500">
                <p className="font-semibold text-stone-600 mb-1">Calculation Summary</p>
                <div className="flex justify-between"><span>Q (skim flow)</span><span className="font-mono text-stone-700">{(skimM3h! / 3600).toFixed(6)} m³/s</span></div>
                <div className="flex justify-between"><span>H (head)</span><span className="font-mono text-stone-700">{headM.toFixed(4)} m ({(headM * 1000).toFixed(1)} mm)</span></div>
                {method === 'bazin_1888' ? (
                  <div className="flex justify-between"><span>Bazin coefficient</span><span className="font-mono text-stone-700">{(BAZIN_COEFFICIENT_BASE + BAZIN_HEAD_COEFFICIENT / headM).toFixed(4)}</span></div>
                ) : (
                  <div className="flex justify-between"><span>Francis coefficient</span><span className="font-mono text-stone-700">{FRANCIS_COEFFICIENT.toFixed(2)}</span></div>
                )}
                <div className="flex justify-between"><span>Method</span><span className="font-mono text-stone-700">{method === 'bazin_1888' ? 'Bazin' : 'Francis'}</span></div>
                <div className="flex justify-between"><span>n (end contractions)</span><span className="font-mono text-stone-700">{contractions}{method === 'bazin_1888' ? ' (recorded only)' : ''}</span></div>
                <div className="flex justify-between">
                  <span>H/L ratio</span>
                  <span className={`font-mono ${result.headToLengthRatio! <= FRANCIS_MAX_HEAD_TO_LENGTH_RATIO ? 'text-stone-700' : 'text-amber-700'}`}>
                    {result.headToLengthRatio!.toFixed(2)} {result.headToLengthRatio! <= FRANCIS_MAX_HEAD_TO_LENGTH_RATIO ? `≤ ${FRANCIS_MAX_HEAD_TO_LENGTH_RATIO.toFixed(2)}` : `> ${FRANCIS_MAX_HEAD_TO_LENGTH_RATIO.toFixed(2)}`}
                  </span>
                </div>
                {result.warnings.map(warning => <p key={warning} className="text-amber-700 pt-1">{warning}</p>)}
                <div className="flex justify-between font-semibold text-indigo-700 pt-1 border-t border-stone-100">
                  <span>L (weir length)</span><span className="font-mono">{(result.lengthM! * 1000).toFixed(1)} mm</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-stone-400 text-center py-6">Enter a positive head value and complete the applicability conditions</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── AAT Turnover Reference ───────────────────────────────────────────────────
const AAT_REFERENCE = [
  { category: 'Coral Reef / SPS', rate: '8–12', notes: 'High flow, strong circulation' },
  { category: 'Marine Fish Display', rate: '4–8', notes: 'General marine fish' },
  { category: 'Shark / Predator', rate: '4–6', notes: 'Large pelagic species' },
  { category: 'Jellyfish', rate: '2–4', notes: 'Gentle laminar flow' },
  { category: 'Freshwater Tropical', rate: '3–5', notes: 'General tropical fish' },
  { category: 'Freshwater Predator', rate: '4–6', notes: 'Arapaima, arapaima etc.' },
  { category: 'Brackish / Estuary', rate: '4–6', notes: 'Mixed salinity displays' },
  { category: 'Touch Pool', rate: '6–10', notes: 'High bioload, public contact' },
];

// ─── Water Flow Tab ───────────────────────────────────────────────────────────
// ─── Flow unit helpers ────────────────────────────────────────────────────────
type FlowUnit = 'm3h' | 'lh' | 'lmin' | 'ls' | 'gpm';

const FLOW_UNITS: { key: FlowUnit; label: string; factor: number; decimals: number }[] = [
  { key: 'm3h',  label: 'm³/h',  factor: 1,               decimals: 3 },
  { key: 'lh',   label: 'L/h',   factor: 1000,             decimals: 1 },
  { key: 'lmin', label: 'L/min', factor: 1000 / 60,        decimals: 1 },
  { key: 'ls',   label: 'L/s',   factor: 1000 / 3600,      decimals: 2 },
  { key: 'gpm',  label: 'GPM',   factor: 4.40287,          decimals: 1 },
];

function convertFlow(m3h: number | null, unit: FlowUnit): string {
  if (m3h == null) return '—';
  const u = FLOW_UNITS.find(u => u.key === unit)!;
  return (m3h * u.factor).toFixed(u.decimals);
}

function WaterFlowTab({ bookId, exhibitId, tank, species, hydraulics, substrateData, calculation, onRefresh }: {
  bookId: string;
  exhibitId: string;
  tank: any;
  species: any[];
  hydraulics: any | null;
  substrateData?: any | null;
  calculation?: any | null;
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flowUnit, setFlowUnit] = useState<FlowUnit>('lmin');
  const [form, setForm] = useState({
    target_turnover_rate: hydraulics?.target_turnover_rate != null ? String(hydraulics.target_turnover_rate) : '',
    surface_skim_pct:     hydraulics?.surface_skim_pct     != null ? String(hydraulics.surface_skim_pct)     : '30',
    bottom_drain_pct:     hydraulics?.bottom_drain_pct     != null ? String(hydraulics.bottom_drain_pct)     : '70',
    notes:               hydraulics?.notes || '',
  });

  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // live-recalc from form while editing, otherwise from saved hydraulics
  const src = editing ? form : {
    target_turnover_rate: hydraulics?.target_turnover_rate != null ? String(hydraulics.target_turnover_rate) : '',
    surface_skim_pct:     hydraulics?.surface_skim_pct     != null ? String(hydraulics.surface_skim_pct)     : '30',
    bottom_drain_pct:     hydraulics?.bottom_drain_pct     != null ? String(hydraulics.bottom_drain_pct)     : '70',
    notes:               hydraulics?.notes || '',
  };

  const opVol = !editing && calculation?.results?.operating_volume_m3 != null
    ? calculation.results.operating_volume_m3
    : editing ? computeEffectiveOpVol(tank, substrateData) ?? 0 : 0;
  const turnover = parseFloat(src.target_turnover_rate) || 0;
  const skimPct  = parseFloat(src.surface_skim_pct) || 0;
  const drainPct = parseFloat(src.bottom_drain_pct) || 0;

  const totalM3h = !editing && calculation?.results?.total_return_flow_m3h != null
    ? calculation.results.total_return_flow_m3h
    : editing && opVol > 0 && turnover > 0 ? opVol * turnover : null;
  const totalLmin = totalM3h != null ? totalM3h * 1000 / 60 : null;
  const skimM3h = !editing && calculation?.results?.surface_skim_flow_m3h != null
    ? calculation.results.surface_skim_flow_m3h
    : totalM3h != null ? totalM3h * skimPct / 100 : null;
  const skimLmin  = skimM3h  != null ? skimM3h  * 1000 / 60 : null;
  const drainM3h = !editing && calculation?.results?.bottom_drain_flow_m3h != null
    ? calculation.results.bottom_drain_flow_m3h
    : totalM3h != null ? totalM3h * drainPct / 100 : null;
  const drainLmin = drainM3h != null ? drainM3h * 1000 / 60 : null;
  const splitOk   = Math.abs(skimPct + drainPct - 100) < 0.01;
  const aatReference = calculation?.aat_reference ?? null;
  const aatResults = aatReference?.results ?? {};
  const aatPayloadStale = calculation?.is_stale === true || aatReference?.is_stale === true;
  const aatPayloadIncomplete = calculation != null && (
    aatReference == null
    || (
      aatReference?.status === 'valid'
      && (
        aatReference?.inputs?.effective_operating_volume_m3 == null
        || aatResults.recommended_flow_m3h == null
      )
    )
  );
  const aatAvailable = aatReference?.status === 'valid'
    && !aatPayloadStale
    && !aatPayloadIncomplete
    && aatResults.recommended_flow_m3h != null;
  const aatUnavailableReason = aatPayloadStale
    ? 'The AAT calculation is stale. Refresh the Design Book before using this reference.'
    : aatPayloadIncomplete
      ? 'The AAT calculation payload is incomplete. Refresh the Design Book to recalculate it.'
      : aatReference?.reasons?.[0]
        || 'Enter a valid net/effective operating volume to calculate a reference.';

  // Total biomass from species
  const totalBiomass = species.reduce((s, sp) => {
    return s + (parseFloat(sp.biomass_kg) || 0) * (parseFloat(sp.quantity) || 0);
  }, 0);

  const handleSave = async () => {
    if (!form.target_turnover_rate) return toast.error('Enter a target turnover rate');
    if (!splitOk) return toast.error('Surface skim % + bottom drain % must total 100');
    setSaving(true);
    try {
      await api.put(`/design-books/${bookId}/exhibits/${exhibitId}/hydraulics`, {
        target_turnover_rate: parseFloat(form.target_turnover_rate),
        surface_skim_pct:     parseFloat(form.surface_skim_pct),
        bottom_drain_pct:     parseFloat(form.bottom_drain_pct),
        notes:               form.notes || null,
        weir_head_mm:        hydraulics?.weir_head_mm ?? null,
        weir_formula_method: hydraulics?.weir_formula_method ?? null,
        weir_geometry: hydraulics?.weir_geometry ?? null,
        weir_end_contractions: hydraulics?.weir_end_contractions ?? null,
        weir_discharge_condition: hydraulics?.weir_discharge_condition ?? null,
        weir_downstream_head_mm: hydraulics?.weir_downstream_head_mm ?? null,
      });
      toast.success('Water flow saved');
      setEditing(false);
      onRefresh();
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = () => {
    setForm({
      target_turnover_rate: hydraulics?.target_turnover_rate != null ? String(hydraulics.target_turnover_rate) : '',
      surface_skim_pct:     hydraulics?.surface_skim_pct     != null ? String(hydraulics.surface_skim_pct)     : '30',
      bottom_drain_pct:     hydraulics?.bottom_drain_pct     != null ? String(hydraulics.bottom_drain_pct)     : '70',
      notes:               hydraulics?.notes || '',
    });
    setEditing(true);
  };

  const fmtFlow = (v: number | null, decimals = 2) =>
    v != null ? v.toFixed(decimals) : '—';

  const inputCls = 'w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30';

  return (
    <div className="space-y-5">
      {/* Context banner — volume + biomass from other tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Operating Volume', value: opVol > 0 ? `${opVol.toFixed(3)} m³` : '—', sub: opVol > 0 && (parseFloat(substrateData?.substrate_volume_m3 || '0') + parseFloat(substrateData?.theming_volume_m3 || '0')) > 0 ? `after ${(parseFloat(substrateData?.substrate_volume_m3 || '0') + parseFloat(substrateData?.theming_volume_m3 || '0')).toFixed(3)} m³ displacement` : 'from inner dimensions', color: 'blue' },
          { label: 'Total Biomass', value: totalBiomass > 0 ? `${totalBiomass.toFixed(2)} kg` : '—', sub: `${species.length} species`, color: 'emerald' },
          { label: 'Turnover Rate', value: turnover > 0 ? `${turnover}×/h` : '—', sub: 'target', color: 'violet' },
          { label: 'Required Flow', value: totalM3h != null ? `${convertFlow(totalM3h, flowUnit)} ${FLOW_UNITS.find(u => u.key === flowUnit)!.label}` : '—', sub: totalM3h != null ? `${fmtFlow(totalM3h, 3)} m³/h` : 'set turnover to calculate', color: 'blue' },
        ].map(c => (
          <div key={c.label} className={`bg-white rounded-xl border border-stone-200 px-4 py-3`}>
            <p className="text-xs text-stone-400 mb-0.5">{c.label}</p>
            <p className={`text-lg font-bold ${c.color === 'blue' ? 'text-blue-700' : c.color === 'emerald' ? 'text-emerald-700' : c.color === 'violet' ? 'text-violet-700' : 'text-stone-700'}`}>{c.value}</p>
            <p className="text-xs text-stone-400 mt-0.5">{c.sub}</p>
          </div>
        ))}
      </div>
      <CalculationTrace calculation={calculation} title="Hydraulic Calculation Trace" />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Left — inputs */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-100 bg-blue-50/30">
            <div className="flex items-center gap-2">
              <Gauge className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-semibold text-blue-800">Flow Parameters</span>
            </div>
            {!editing ? (
              <button onClick={handleEdit}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 bg-white rounded-md px-2.5 py-1 transition-colors">
                <Pencil className="w-3 h-3" /> Edit
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <button onClick={handleSave} disabled={saving}
                  className="flex items-center gap-1 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-md px-2.5 py-1 transition-colors disabled:opacity-50">
                  <Save className="w-3 h-3" /> {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setEditing(false)}
                  className="text-xs text-stone-400 hover:text-stone-600 border border-stone-200 bg-white rounded-md px-2 py-1">
                  Cancel
                </button>
              </div>
            )}
          </div>
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">
                Target Turnover Rate <span className="text-stone-400 font-normal">(×/hour)</span>
              </label>
              {editing ? (
                <input type="number" step="0.5" min="0" placeholder="e.g. 5"
                  value={form.target_turnover_rate} onChange={e => setF('target_turnover_rate', e.target.value)}
                  className={inputCls} autoFocus />
              ) : (
                <p className="text-2xl font-bold text-blue-700">
                  {hydraulics?.target_turnover_rate != null ? `${hydraulics.target_turnover_rate}×` : <span className="text-stone-300 text-base font-normal">Not set</span>}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Flow Split</label>
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <ArrowUpToLine className="w-4 h-4 text-sky-500 shrink-0" />
                  <span className="text-xs text-stone-500 w-28 shrink-0">Surface Skim</span>
                  {editing ? (
                    <input type="number" step="5" min="0" max="100"
                      value={form.surface_skim_pct} onChange={e => setF('surface_skim_pct', e.target.value)}
                      className="w-20 border border-stone-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  ) : (
                    <span className="text-sm font-semibold text-stone-700">{src.surface_skim_pct}%</span>
                  )}
                  {skimM3h != null && <span className="text-xs font-mono text-sky-600 ml-auto">{convertFlow(skimM3h, flowUnit)} {FLOW_UNITS.find(u => u.key === flowUnit)!.label}</span>}
                </div>
                <div className="flex items-center gap-3">
                  <ArrowDownToLine className="w-4 h-4 text-indigo-500 shrink-0" />
                  <span className="text-xs text-stone-500 w-28 shrink-0">Bottom Drain</span>
                  {editing ? (
                    <input type="number" step="5" min="0" max="100"
                      value={form.bottom_drain_pct} onChange={e => setF('bottom_drain_pct', e.target.value)}
                      className="w-20 border border-stone-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  ) : (
                    <span className="text-sm font-semibold text-stone-700">{src.bottom_drain_pct}%</span>
                  )}
                  {drainM3h != null && <span className="text-xs font-mono text-indigo-600 ml-auto">{convertFlow(drainM3h, flowUnit)} {FLOW_UNITS.find(u => u.key === flowUnit)!.label}</span>}
                </div>
                {editing && !splitOk && (
                  <p className="text-xs text-red-500">Surface + drain must total 100% (currently {skimPct + drainPct}%)</p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">Design Rationale / Notes</label>
              {editing ? (
                <textarea rows={3} placeholder="Species requirements, references, assumptions…"
                  value={form.notes} onChange={e => setF('notes', e.target.value)}
                  className={`${inputCls} resize-none`} />
              ) : (
                <p className="text-sm text-stone-600 whitespace-pre-wrap">
                  {hydraulics?.notes || <span className="text-stone-300 italic">No notes</span>}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right — calculated results */}
        <div className="lg:col-span-3 space-y-5">
          {/* Flow breakdown */}
          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-stone-100 bg-stone-50/50 flex items-center gap-2 flex-wrap">
              <Wind className="w-4 h-4 text-stone-500 shrink-0" />
              <span className="text-sm font-semibold text-stone-700 shrink-0">Flow Rate Breakdown</span>
              {/* Unit selector pills */}
              <div className="flex items-center gap-1 ml-auto">
                {FLOW_UNITS.map(u => (
                  <button
                    key={u.key}
                    onClick={() => setFlowUnit(u.key)}
                    className={`text-xs px-2 py-0.5 rounded-md border transition-colors font-medium ${
                      flowUnit === u.key
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-stone-500 border-stone-200 hover:border-blue-300 hover:text-blue-600'
                    }`}
                  >
                    {u.label}
                  </button>
                ))}
              </div>
              {!opVol && <span className="w-full text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">Assign a tank to calculate</span>}
              {opVol > 0 && !turnover && <span className="w-full text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">Set turnover rate to calculate</span>}
            </div>
            <table className="w-full text-sm">
              <thead className="bg-stone-50/60">
                <tr>
                  <th className="text-left px-5 py-2 text-xs font-semibold text-stone-400 uppercase tracking-wide">Stream</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-stone-400 uppercase tracking-wide">m³/h</th>
                  <th className="text-right px-5 py-2 text-xs font-semibold text-blue-500 uppercase tracking-wide">
                    {FLOW_UNITS.find(u => u.key === flowUnit)!.label}
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'Total Return Flow',   icon: <Gauge className="w-3.5 h-3.5 text-blue-500" />,   m3h: totalM3h, cls: 'font-semibold text-stone-800' },
                  { label: 'Surface Skimmer Box', icon: <ArrowUpToLine className="w-3.5 h-3.5 text-sky-500" />,    m3h: skimM3h,  cls: 'text-stone-700' },
                  { label: 'Bottom Drain',         icon: <ArrowDownToLine className="w-3.5 h-3.5 text-indigo-500" />, m3h: drainM3h, cls: 'text-stone-700' },
                ].map(row => (
                  <tr key={row.label} className="border-t border-stone-100">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        {row.icon}
                        <span className={row.cls}>{row.label}</span>
                      </div>
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-stone-400`}>
                      {row.m3h != null ? row.m3h.toFixed(3) : '—'}
                    </td>
                    <td className={`px-5 py-3 text-right font-mono font-semibold text-blue-700`}>
                      {convertFlow(row.m3h, flowUnit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* AAT calculated reference */}
          <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-amber-100 bg-amber-50/60 flex items-center gap-2 flex-wrap">
              <Calculator className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-semibold text-amber-900">AAT Recommended Exhibit Flow</span>
              <span className="text-xs text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5">
                Reference only
              </span>
            </div>
            {aatAvailable ? (
              <div className="p-5">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-lg border border-stone-100 bg-stone-50/60 px-3 py-2.5">
                    <p className="text-xs text-stone-400">Net / effective volume</p>
                    <p className="font-mono text-sm font-semibold text-stone-700 mt-0.5">
                      {Number(aatReference.inputs.effective_operating_volume_m3).toFixed(3)} m³
                    </p>
                  </div>
                  <div className="rounded-lg border border-stone-100 bg-stone-50/60 px-3 py-2.5">
                    <p className="text-xs text-stone-400">Target turnover time</p>
                    <p className="font-mono text-sm font-semibold text-stone-700 mt-0.5">
                      {Number(aatResults.target_turnover_time_hours).toFixed(3)} h
                    </p>
                    <p className="text-xs text-stone-400">{Number(aatResults.target_turnover_time_minutes).toFixed(1)} min</p>
                  </div>
                  <div className="rounded-lg border border-stone-100 bg-stone-50/60 px-3 py-2.5">
                    <p className="text-xs text-stone-400">Recommended turnover</p>
                    <p className="font-mono text-sm font-semibold text-stone-700 mt-0.5">
                      {Number(aatResults.recommended_turnover_rate_cycles_per_hour).toFixed(3)}×/h
                    </p>
                  </div>
                  <div className="rounded-lg border border-amber-100 bg-amber-50/50 px-3 py-2.5">
                    <p className="text-xs text-amber-700">Recommended flow</p>
                    <p className="font-mono text-sm font-semibold text-amber-900 mt-0.5">
                      {Number(aatResults.recommended_flow_m3h).toFixed(3)} m³/h
                    </p>
                    <p className="text-xs text-amber-700">
                      {convertFlow(aatResults.recommended_flow_m3h, flowUnit)} {FLOW_UNITS.find(u => u.key === flowUnit)!.label}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-stone-500 mt-4">
                  Informational AAT reference based on net/effective volume. It does not set or replace the designer&apos;s selected Target Turnover Rate.
                </p>
              </div>
            ) : (
              <div className="px-5 py-4">
                <p className="text-sm text-stone-500">AAT reference unavailable.</p>
                <p className="text-xs text-stone-400 mt-1">
                  {aatUnavailableReason}
                </p>
              </div>
            )}
          </div>

          {/* AAT category reference */}
          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-stone-100 bg-stone-50/50 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-stone-400" />
              <span className="text-sm font-semibold text-stone-600">AAT Turnover Rate Reference</span>
              <span className="text-xs text-stone-400 ml-1">(×/hour)</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-stone-50/40">
                <tr>
                  <th className="text-left px-5 py-2 text-xs font-semibold text-stone-400 uppercase tracking-wide">Exhibit Type</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-stone-400 uppercase tracking-wide">Rate ×/h</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-stone-400 uppercase tracking-wide hidden sm:table-cell">Notes</th>
                </tr>
              </thead>
              <tbody>
                {AAT_REFERENCE.map(r => (
                  <tr key={r.category} className="border-t border-stone-100 hover:bg-stone-50/50">
                    <td className="px-5 py-2.5 text-stone-700">{r.category}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-blue-700">{r.rate}</td>
                    <td className="px-4 py-2.5 text-stone-400 text-xs hidden sm:table-cell">{r.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

type LightForm = {
  product_master_id: string;
  model: string;
  description: string;
  lighting_type: string;
  custom_type: string;
  quantity: string;
  power_value: string;
  power_unit: 'W' | 'kW';
};

const emptyLightForm = (): LightForm => ({
  product_master_id: '',
  model: '',
  description: '',
  lighting_type: 'LED',
  custom_type: '',
  quantity: '1',
  power_value: '',
  power_unit: 'W',
});

function displayLightType(light: any) {
  return light.lighting_type || '—';
}

function formatPower(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function LightsSection({ bookId, exhibitId, lights, readOnly, onRefresh }: {
  bookId: string;
  exhibitId: string;
  lights: any[];
  readOnly: boolean;
  onRefresh: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mode, setMode] = useState<'manual' | 'pim'>('manual');
  const [form, setForm] = useState<LightForm>(emptyLightForm);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const isOpen = editingId !== null;

  const { data: productData, isFetching: searchingProducts } = useQuery({
    queryKey: ['design-book-lighting-products', bookId, search],
    queryFn: () => api.get(`/design-books/${bookId}/lighting-products`, { params: { q: search } }).then(r => r.data),
    enabled: isOpen && mode === 'pim',
  });
  const products: any[] = productData?.items || [];

  const selectedType = form.lighting_type === 'Other' ? form.custom_type.trim() : form.lighting_type;
  const quantity = Number(form.quantity);
  const unitPower = Number(form.power_value);
  const total = Number.isFinite(quantity) && Number.isFinite(unitPower) ? quantity * unitPower : null;
  const valid = !!form.model.trim() && !!form.description.trim() && !!selectedType
    && Number.isInteger(quantity) && quantity > 0 && Number.isFinite(unitPower) && unitPower > 0;

  const openNew = () => {
    setEditingId('new');
    setMode('manual');
    setForm(emptyLightForm());
    setSearch('');
    setError('');
  };

  const openEdit = (light: any) => {
    const commonType = ['LED', 'T8', 'T5', 'Metal Halide'].includes(light.lighting_type);
    setEditingId(light.id);
    setMode(light.product_master_id ? 'pim' : 'manual');
    setForm({
      product_master_id: light.product_master_id || '',
      model: light.model || '',
      description: light.description || '',
      lighting_type: commonType ? light.lighting_type : 'Other',
      custom_type: commonType ? '' : (light.lighting_type || ''),
      quantity: String(light.quantity ?? 1),
      power_value: String(light.power_value ?? ''),
      power_unit: light.power_unit === 'kW' ? 'kW' : 'W',
    });
    setSearch('');
    setError('');
  };

  const selectProduct = (product: any) => {
    setForm(current => ({
      ...current,
      product_master_id: product.id,
      model: product.model || product.product_code,
      description: product.description || product.product_name,
      power_value: String(product.power_kw),
      power_unit: 'kW',
    }));
    setError('');
  };

  const changeUnit = (nextUnit: 'W' | 'kW') => {
    setForm(current => {
      if (current.power_unit === nextUnit) return current;
      const currentValue = Number(current.power_value);
      if (!Number.isFinite(currentValue)) return { ...current, power_unit: nextUnit };
      return {
        ...current,
        power_unit: nextUnit,
        power_value: String(nextUnit === 'W' ? currentValue * 1000 : currentValue / 1000),
      };
    });
  };

  const save = async () => {
    if (!valid) {
      setError('Complete every required field with a positive quantity and power.');
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      product_master_id: form.product_master_id || null,
      model: form.model.trim(),
      description: form.description.trim(),
      lighting_type: selectedType,
      quantity,
      power_value: unitPower,
      power_unit: form.power_unit,
    };
    try {
      if (editingId === 'new') {
        await api.post(`/design-books/${bookId}/exhibits/${exhibitId}/lights`, payload);
        toast.success('Light added');
      } else {
        await api.put(`/design-books/${bookId}/exhibits/${exhibitId}/lights/${editingId}`, payload);
        toast.success('Light updated');
      }
      setEditingId(null);
      onRefresh();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Could not save this light.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (light: any) => {
    if (!window.confirm(`Remove ${light.model} from this exhibit lighting schedule?`)) return;
    setRemovingId(light.id);
    setError('');
    try {
      await api.delete(`/design-books/${bookId}/exhibits/${exhibitId}/lights/${light.id}`);
      toast.success('Light removed');
      onRefresh();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Could not remove this light.');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-stone-800 flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-amber-500" /> Exhibit Lighting Schedule
          </h2>
          <p className="text-sm text-stone-500 mt-1">Point-in-time fixture details and electrical load for this exhibit.</p>
        </div>
        {!readOnly && !isOpen && (
          <button type="button" onClick={openNew}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            <Plus className="w-4 h-4" /> Add Light
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {isOpen && (
        <div className="rounded-xl border border-blue-200 bg-white p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-stone-800">{editingId === 'new' ? 'Add exhibit light' : 'Edit exhibit light'}</h3>
            <button type="button" onClick={() => setEditingId(null)} aria-label="Close light editor" className="text-stone-400 hover:text-stone-700">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setMode('manual'); setForm(current => ({ ...current, product_master_id: '' })); }}
              className={`rounded-lg border px-3 py-2 text-sm ${mode === 'manual' ? 'border-blue-300 bg-blue-50 text-blue-700 font-semibold' : 'border-stone-200 text-stone-600'}`}>
              Manual light
            </button>
            <button type="button" onClick={() => setMode('pim')}
              className={`rounded-lg border px-3 py-2 text-sm ${mode === 'pim' ? 'border-blue-300 bg-blue-50 text-blue-700 font-semibold' : 'border-stone-200 text-stone-600'}`}>
              PIM Product Master
            </button>
          </div>
          {mode === 'pim' && (
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
              <label htmlFor="lighting-product-search" className="block text-xs font-semibold text-stone-600 mb-1.5">Search eligible lighting products</label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-stone-400" />
                <input id="lighting-product-search" value={search} onChange={event => setSearch(event.target.value)}
                  placeholder="Search model or product name…" className="w-full rounded-lg border border-stone-200 bg-white py-2 pl-9 pr-3 text-sm" />
              </div>
              <div className="mt-2 max-h-44 overflow-auto space-y-1">
                {searchingProducts ? <p className="py-3 text-center text-xs text-stone-400">Loading lighting products…</p>
                  : products.length === 0 ? <p className="py-3 text-center text-xs text-stone-400">No eligible powered lighting products found.</p>
                    : products.map(product => (
                      <button type="button" key={product.id} onClick={() => selectProduct(product)}
                        className={`w-full rounded-lg border p-2.5 text-left text-sm hover:border-blue-300 hover:bg-blue-50 ${
                          form.product_master_id === product.id ? 'border-blue-400 bg-blue-50' : 'border-stone-200 bg-white'
                        }`}>
                        <span className="font-semibold text-stone-800">{product.model || product.product_code}</span>
                        <span className="ml-2 text-stone-500">{product.product_name}</span>
                        <span className="float-right font-mono text-xs text-blue-700">{formatPower(product.power_kw)} kW</span>
                      </button>
                    ))}
              </div>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm text-stone-600">Model *
              <input aria-label="Light model" value={form.model} disabled={mode === 'pim' && !!form.product_master_id}
                onChange={event => setForm(current => ({ ...current, model: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 disabled:bg-stone-100" />
            </label>
            <label className="text-sm text-stone-600">Description *
              <input aria-label="Light description" value={form.description} disabled={mode === 'pim' && !!form.product_master_id}
                onChange={event => setForm(current => ({ ...current, description: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 disabled:bg-stone-100" />
            </label>
            <label className="text-sm text-stone-600">Lighting type *
              <select aria-label="Lighting type" value={form.lighting_type}
                onChange={event => setForm(current => ({ ...current, lighting_type: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2">
                {['LED', 'T8', 'T5', 'Metal Halide', 'Other'].map(type => <option key={type}>{type}</option>)}
              </select>
            </label>
            {form.lighting_type === 'Other' && (
              <label className="text-sm text-stone-600">Custom lighting type *
                <input aria-label="Custom lighting type" value={form.custom_type}
                  onChange={event => setForm(current => ({ ...current, custom_type: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2" />
              </label>
            )}
            <label className="text-sm text-stone-600">Quantity *
              <input aria-label="Light quantity" type="number" min="1" step="1" value={form.quantity}
                onChange={event => setForm(current => ({ ...current, quantity: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2" />
            </label>
            <div>
              <label htmlFor="light-power" className="text-sm text-stone-600">Power per light *</label>
              <div className="mt-1 flex">
                <input id="light-power" aria-label="Power per light" type="number" min="0" step="any" value={form.power_value}
                  disabled={!!form.product_master_id}
                  onChange={event => setForm(current => ({ ...current, power_value: event.target.value }))}
                  className="min-w-0 flex-1 rounded-l-lg border border-stone-200 px-3 py-2 disabled:bg-stone-100" />
                <select aria-label="Power unit" value={form.power_unit} onChange={event => changeUnit(event.target.value as 'W' | 'kW')}
                  className="rounded-r-lg border border-l-0 border-stone-200 bg-stone-50 px-3 py-2">
                  <option>W</option><option>kW</option>
                </select>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2 text-sm">
            <span className="text-stone-500">Calculated row total</span>
            <strong className="font-mono text-stone-800">{total != null && Number.isFinite(total) ? formatPower(total) : '—'} {form.power_unit}</strong>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditingId(null)} className="rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-600">Cancel</button>
            <button type="button" onClick={save} disabled={saving || !valid}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? 'Saving…' : editingId === 'new' ? 'Add Light' : 'Save Light'}
            </button>
          </div>
        </div>
      )}

      {lights.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-white py-14 text-center">
          <Lightbulb className="w-8 h-8 text-stone-250 mx-auto mb-2" />
          <p className="text-sm font-medium text-stone-600">No lights scheduled</p>
          <p className="mt-1 text-xs text-stone-400">{readOnly ? 'This frozen revision has no lighting rows.' : 'Add a manual light or select an eligible PIM product.'}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="min-w-[880px] w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-3">Model</th><th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Type</th><th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Power / light</th><th className="px-4 py-3 text-right">Total</th>
                {!readOnly && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {lights.map(light => (
                <tr key={light.id}>
                  <td className="px-4 py-3 font-semibold text-stone-800">
                    {light.model}
                    {light.product_master_id && <span className="ml-2 inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700"><LibraryBig className="w-3 h-3" /> PIM {light.pim_product_code}</span>}
                  </td>
                  <td className="px-4 py-3 text-stone-600">{light.description}</td>
                  <td className="px-4 py-3 text-stone-600">{displayLightType(light)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{light.quantity}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatPower(light.power_value)} {light.power_unit}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">{formatPower(Number(light.quantity) * Number(light.power_value))} {light.power_unit}</td>
                  {!readOnly && (
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => openEdit(light)} aria-label={`Edit ${light.model}`} className="rounded p-1.5 text-blue-600 hover:bg-blue-50"><Pencil className="w-4 h-4" /></button>
                        <button type="button" onClick={() => remove(light)} disabled={removingId === light.id} aria-label={`Remove ${light.model}`} className="rounded p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ExhibitDetail() {
  const { bookId, exhibitId } = useParams<{ bookId: string; exhibitId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore(state => state.user);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: ExhibitTab = isExhibitTab(tabParam) ? tabParam : 'tank';
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [toolsMenuPosition, setToolsMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const toolsMenuRef = useRef<HTMLDivElement>(null);

  const { data: book, isLoading } = useQuery({
    queryKey: ['design-book', bookId],
    queryFn: () => api.get(`/design-books/${bookId}`).then(r => r.data),
    enabled: !!bookId,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['design-book', bookId] });

  const handleTabChange = (nextTab: ExhibitTab) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', nextTab);
    setSearchParams(nextParams);
    setShowToolsMenu(false);
    setToolsMenuPosition(null);
  };

  useEffect(() => {
    const closeMenu = () => {
      setShowToolsMenu(false);
      setToolsMenuPosition(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (showToolsMenu) {
        closeMenu();
        return;
      }
      if (event.defaultPrevented || isEditingField(event.target)) return;
      navigate(-1);
    };
    document.addEventListener('keydown', handleKeyDown);
    if (!showToolsMenu) {
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
    const handleMouseDown = (event: MouseEvent) => {
      if (!toolsMenuRef.current?.contains(event.target as Node)) closeMenu();
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [navigate, showToolsMenu]);

  const openToolsMenu = (event?: React.MouseEvent) => {
    if (event?.type === 'contextmenu') {
      event.preventDefault();
      setToolsMenuPosition({
        x: Math.min(event.clientX, window.innerWidth - 240),
        y: Math.min(event.clientY, window.innerHeight - 260),
      });
      setShowToolsMenu(true);
      return;
    }
    setToolsMenuPosition(null);
    setShowToolsMenu(current => !current);
  };

  if (isLoading) return <div className="p-10 text-center text-stone-400">Loading…</div>;
  if (!book) return <div className="p-10 text-center text-stone-500">Design book not found.</div>;

  const exhibits: any[] = book.exhibits || [];
  const tanks: any[] = book.tanks || [];
  const allSpecies: any[] = book.species || [];
  const allHydraulics: any[] = book.hydraulics || [];
  const allSubstrate: any[]  = book.substrate  || [];
  const allLights: any[] = book.lights || [];

  const exhibit = exhibits.find((e: any) => e.id === exhibitId);
  if (!exhibit) return <div className="p-10 text-center text-stone-500">Exhibit not found.</div>;

  const exhibitTanks = tanks.filter((t: any) => t.exhibit_id === exhibitId);
  const tank = exhibitTanks[0];
  const species = allSpecies.filter((s: any) => s.exhibit_id === exhibitId);
  const hydraulics  = allHydraulics.find((h: any) => h.exhibit_id === exhibitId) ?? null;
  const substrateData = allSubstrate.find((s: any) => s.exhibit_id === exhibitId) ?? null;
  const lights = allLights.filter((light: any) => light.exhibit_id === exhibitId);
  const engineeringCalculation = book.engineering_calculations?.exhibits?.find(
    (calculation: any) => calculation.inputs?.exhibit_id === exhibitId,
  ) ?? null;
  const unassigned = tanks.filter((t: any) => !t.exhibit_id && !t.product_master_id);
  const canEdit = user?.role === 'admin' || user?.role === 'engineer';
  const readOnly = !canEdit || !['Draft', 'In Progress'].includes(book.status);
  const canUsePim = canEdit && user?.moduleAccess?.pim !== 'hidden';

  const TABS = [
    { id: 'tank',    label: 'Tank',         icon: <Layers     className="w-3.5 h-3.5" /> },
    { id: 'species', label: 'Species',      icon: <Fish       className="w-3.5 h-3.5" />, badge: species.length || undefined },
    { id: 'flow',    label: 'Water Flow',   icon: <Gauge      className="w-3.5 h-3.5" /> },
    { id: 'weir',    label: 'Weir Design',  icon: <Calculator className="w-3.5 h-3.5" /> },
    { id: 'pipes',   label: 'Pipe Sizing',  icon: <Pipette className="w-3.5 h-3.5" /> },
    { id: 'lights',  label: 'Lights',        icon: <Lightbulb  className="w-3.5 h-3.5" />, badge: lights.length || undefined },
  ] as const;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-stone-500 mb-5">
        <Link to="/design-book-engine" className="hover:text-blue-600 transition-colors">Design Book Engine</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link to="/design-books" className="hover:text-blue-600 transition-colors">Design Books</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link to={`/design-books/${bookId}`} className="hover:text-blue-600 transition-colors">{book.book_title || book.book_code}</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-stone-700 font-medium">{exhibit.exhibit_name}</span>
      </nav>
      {readOnly && (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 flex items-center gap-2">
          <LockKeyhole className="w-4 h-4 shrink-0" />
          Released revision — exhibit engineering data is read-only.
        </div>
      )}

      {/* Exhibit Header */}
      <div
        className="bg-white rounded-2xl border border-stone-200 px-6 py-5 mb-5 shadow-sm"
        onContextMenu={openToolsMenu}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
              <Layers className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="font-mono text-sm text-stone-400 bg-stone-100 px-2 py-0.5 rounded">{exhibit.exhibit_code}</span>
                <WaterTypeBadge type={exhibit.water_type} />
                {exhibit.area_name && (
                  <span className="text-xs text-stone-400 bg-stone-50 border border-stone-200 px-2 py-0.5 rounded">
                    Area: {exhibit.area_name}
                  </span>
                )}
              </div>
              <h1 className="text-2xl font-bold text-stone-800">{exhibit.exhibit_name}</h1>
              <div className="flex items-center gap-5 mt-2 flex-wrap">
                {(exhibit.design_temperature_min != null || exhibit.design_temperature_max != null) && (
                  <span className="flex items-center gap-1.5 text-sm text-stone-500">
                    <ThermometerSun className="w-4 h-4 text-stone-400" />
                    {exhibit.design_temperature_min ?? '?'}–{exhibit.design_temperature_max ?? '?'} °C
                  </span>
                )}
                {exhibit.design_salinity != null && (
                  <span className="flex items-center gap-1.5 text-sm text-stone-500">
                    <FlaskConical className="w-4 h-4 text-blue-400" />
                    {exhibit.design_salinity} ppt salinity
                  </span>
                )}
                {exhibit.design_ph_min != null && (
                  <span className="flex items-center gap-1.5 text-sm text-stone-500">
                    <Droplets className="w-4 h-4 text-cyan-400" />
                    pH {exhibit.design_ph_min}–{exhibit.design_ph_max}
                  </span>
                )}
                <span className="flex items-center gap-1.5 text-sm text-stone-500">
                  <Fish className="w-4 h-4 text-emerald-500" />
                  {species.length} species
                </span>
              </div>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2 relative" ref={toolsMenuRef}>
            <Link
              to={`/design-books/${bookId}`}
              className="inline-flex items-center gap-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl px-4 py-2.5 shadow-sm transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Design Book
            </Link>
            <button
              type="button"
              onClick={() => openToolsMenu()}
              aria-label="Open exhibit tools"
              aria-expanded={showToolsMenu}
              className="inline-flex items-center justify-center w-10 h-10 text-stone-600 hover:text-stone-800 border border-stone-200 rounded-xl bg-white hover:bg-stone-50 transition-colors"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
            {showToolsMenu && (
              <div
                className={`z-30 w-56 rounded-xl border border-stone-200 bg-white p-1.5 shadow-xl ${
                  toolsMenuPosition ? 'fixed' : 'absolute right-0 top-full mt-2'
                }`}
                style={toolsMenuPosition ? { left: toolsMenuPosition.x, top: toolsMenuPosition.y } : undefined}
                role="menu"
                aria-label="Exhibit tools"
              >
                <Link
                  to={`/design-books/${bookId}`}
                  onClick={() => {
                    setShowToolsMenu(false);
                    setToolsMenuPosition(null);
                  }}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                  role="menuitem"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to Design Book
                </Link>
                <div className="my-1 border-t border-stone-100" />
                {TABS.map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => handleTabChange(tab.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      activeTab === tab.id
                        ? 'bg-blue-50 font-semibold text-blue-700'
                        : 'text-stone-600 hover:bg-stone-50'
                    }`}
                    role="menuitem"
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center gap-1 border-b border-stone-200 mb-6">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-stone-500 hover:text-stone-700 hover:border-stone-300'
            }`}
          >
            {tab.icon}
            {tab.label}
            {'badge' in tab && tab.badge ? (
              <span className={`text-xs rounded-full px-1.5 py-0.5 ${activeTab === tab.id ? 'bg-blue-100 text-blue-700' : 'bg-stone-100 text-stone-500'}`}>
                {tab.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <fieldset disabled={readOnly} className={readOnly ? 'opacity-90' : ''}>
      {activeTab === 'tank' && (
        <div className="space-y-5">
          {book.project_id ? (
            <AssignTankPanel
              exhibit={exhibit}
              projectId={book.project_id}
              designBookId={book.id}
              unassigned={unassigned}
              assignedTanks={exhibitTanks}
              canUsePim={canUsePim}
              onRefresh={refresh}
            />
          ) : !tank ? (
            <div className="bg-white rounded-xl border border-stone-200 py-14 text-center">
              <FolderOpen className="w-8 h-8 text-stone-200 mx-auto mb-2" />
              <p className="text-stone-400 text-sm">No tank assigned. Link a project to this design book to manage tanks.</p>
            </div>
          ) : null}
          {exhibitTanks.map((exhibitTank: any) => (
            <TankCard
              key={exhibitTank.id}
              tank={exhibitTank}
              projectId={book.project_id}
              substrateData={substrateData}
              onRefresh={refresh}
              readOnly={readOnly}
            />
          ))}
          <SubstrateSection
            bookId={book.id}
            exhibitId={exhibitId!}
            tank={tank}
            substrateData={substrateData}
            onRefresh={refresh}
          />
        </div>
      )}

      {activeTab === 'species' && (
        <SpeciesSection
          bookId={book.id}
          exhibitId={exhibitId!}
          species={species}
          onRefresh={refresh}
        />
      )}

      {activeTab === 'flow' && (
        <WaterFlowTab
          bookId={book.id}
          exhibitId={exhibitId!}
          tank={tank}
          species={species}
          hydraulics={hydraulics}
          substrateData={substrateData}
          calculation={engineeringCalculation}
          onRefresh={refresh}
        />
      )}

      {activeTab === 'weir' && (
        <WeirAllocationSection
          key={exhibitId}
          bookId={book.id}
          exhibitId={exhibitId!}
          tank={tank}
          hydraulics={hydraulics}
          substrateData={substrateData}
          calculation={engineeringCalculation}
          onRefresh={refresh}
        />
      )}
      {activeTab === 'pipes' && (
        <PipeSizingSection bookId={book.id} exhibitId={exhibitId!} hydraulics={hydraulics}
          calculation={engineeringCalculation} readOnly={readOnly} onRefresh={refresh} />
      )}

      {activeTab === 'lights' && (
        <LightsSection
          bookId={book.id}
          exhibitId={exhibitId!}
          lights={lights}
          readOnly={readOnly}
          onRefresh={refresh}
        />
      )}
      </fieldset>
    </div>
  );
}
