import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import api from '../../lib/api';
import {
  ChevronRight, Waves, ThermometerSun, FlaskConical, Fish, Plus,
  Trash2, Check, CheckCircle2, Layers, FolderOpen, LinkIcon,
  SquarePlus, X, Droplets, Pencil, Save, Gauge, ArrowDownToLine,
  ArrowUpToLine, Wind, BookOpen, Mountain, Palette, Calculator,
  ArrowRight, AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';

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

// ─── Species Section ─────────────────────────────────────────────────────────
const BLANK_SPECIES = { species_name: '', common_name: '', quantity: '', avg_size_cm: '', biomass_kg: '' };

function SpeciesSection({ bookId, exhibitId, species, onRefresh }: {
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
const TANK_CONSTRUCTION_TYPES = ['Acrylic', 'Acrylic with FRP', 'FRP/Steel with Window', 'FRP/Steel', 'Glass', 'PP'];

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
  if (shape === 'custom') {
    return parseFloat(tank.operating_volume_m3 ?? tank.design_volume_m3) || null;
  }
  const thick  = tank.wall_thickness_mm ? parseFloat(tank.wall_thickness_mm) : null;
  const outerW = parseFloat(tank.eff_width_mm  || tank.width_mm)  || null;
  const outerL = parseFloat(tank.eff_length_mm || tank.length_mm) || null;
  const wlv    = tank.design_water_level_mm ? parseFloat(tank.design_water_level_mm) : null;
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
  return parseFloat(tank.operating_volume_m3 ?? tank.design_volume_m3) || null;
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

function TankCard({ tank, substrateData, onRefresh }: { tank: any; substrateData?: any | null; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({});
  const [overrideInner, setOverrideInner] = useState(false);

  const { data: matData } = useQuery({
    queryKey: ['materials-list'],
    queryFn: () => api.get('/materials').then(r => r.data),
    staleTime: 300_000,
    enabled: editing,
  });
  const materials: any[] = matData?.items || [];

  const startEdit = () => {
    setForm({
      tank_code:             tank.tank_code || '',
      tank_name:             tank.tank_name || '',
      tank_type:             tank.tank_type || '',
      shape_type:            tank.shape_type || tank.eff_shape || 'Rectangular',
      material_id:           tank.material_id || '',
      primary_material:      tank.primary_material || '',
      wall_thickness_mm:     tank.wall_thickness_mm ?? '',
      length_mm:             tank.length_mm ?? tank.eff_length_mm ?? '',
      width_mm:              tank.width_mm  ?? tank.eff_width_mm  ?? '',
      height_mm:             tank.height_mm ?? tank.eff_height_mm ?? '',
      design_water_level_mm: tank.design_water_level_mm ?? '',
      inner_length_mm:       tank.inner_length_mm ?? '',
      inner_width_mm:        tank.inner_width_mm  ?? '',
      inner_height_mm:       tank.inner_height_mm ?? '',
      gross_volume_m3:       tank.gross_volume_m3 ?? '',
      operating_volume_m3:   tank.operating_volume_m3 ?? tank.design_volume_m3 ?? '',
      status:                tank.status || 'Active',
    });
    setOverrideInner(!!(tank.inner_length_mm || tank.inner_width_mm || tank.inner_height_mm));
    setEditing(true);
  };

  const setF = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const isCyl  = (form.shape_type || '').toLowerCase() === 'cylindrical';
  const isCust = (form.shape_type || '').toLowerCase() === 'custom';

  const computedInner = calcInnerDims(
    form.shape_type,
    parseFloat(form.length_mm) || null,
    parseFloat(form.width_mm)  || null,
    parseFloat(form.height_mm) || null,
    parseFloat(form.wall_thickness_mm) || null,
  );

  const preview = editing
    ? calcVolumes(form.shape_type, form.length_mm, form.width_mm, form.height_mm,
                  form.design_water_level_mm, form.gross_volume_m3, form.operating_volume_m3,
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
        shape_type:            form.shape_type,
        material_id:           form.material_id || null,
        primary_material:      form.primary_material || null,
        wall_thickness_mm:     form.wall_thickness_mm || null,
        length_mm:             form.length_mm || null,
        width_mm:              form.width_mm  || null,
        height_mm:             form.height_mm || null,
        design_water_level_mm: form.design_water_level_mm || null,
        inner_length_mm:       overrideInner ? (form.inner_length_mm || null) : null,
        inner_width_mm:        overrideInner ? (form.inner_width_mm  || null) : null,
        inner_height_mm:       overrideInner ? (form.inner_height_mm || null) : null,
        gross_volume_m3:       isCust ? (form.gross_volume_m3 || null) : undefined,
        operating_volume_m3:   isCust ? (form.operating_volume_m3 || null) : undefined,
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
          const wlv  = tank.design_water_level_mm ? parseFloat(tank.design_water_level_mm) : 0;
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

    const statusCls: Record<string, string> = {
      Active:         'bg-emerald-50 text-emerald-700 border-emerald-200',
      Inactive:       'bg-stone-50 text-stone-500 border-stone-200',
      Design:         'bg-blue-50 text-blue-700 border-blue-200',
      Retired:        'bg-red-50 text-red-600 border-red-200',
      Decommissioned: 'bg-stone-100 text-stone-500 border-stone-200',
    };

    return (
      <div className="rounded-xl border border-blue-200 bg-white shadow-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 bg-blue-50/50 border-b border-blue-100">
          <div>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="font-mono text-xs bg-white text-stone-600 px-2 py-0.5 rounded border border-stone-200">{tank.tank_code}</span>
              <ShapeBadge shape={shape} />
              {tank.tank_type && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium">
                  {tank.tank_type}
                </span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusCls[tank.status] ?? statusCls['Active']}`}>
                {tank.status || 'Active'}
              </span>
            </div>
            <h3 className="text-xl font-bold text-stone-800">{tank.tank_name}</h3>
            {(tank.material_name || tank.primary_material) && (
              <p className="text-sm text-stone-500 mt-0.5 flex items-center gap-1.5">
                {tank.material_code && (
                  <span className="font-mono text-xs bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded">{tank.material_code}</span>
                )}
                {tank.material_name || tank.primary_material}
              </p>
            )}
          </div>
          <button onClick={startEdit}
            className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-blue-600 border border-stone-200 hover:border-blue-300 bg-white rounded-lg px-2.5 py-1.5 transition-colors shrink-0 ml-4">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
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
                  {tank.design_water_level_mm && <DimTile label="Water Level" val={`${fmtDim(tank.design_water_level_mm)} mm`} />}
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
          {(grossVol != null || opVol != null) && (
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
              <div className="grid grid-cols-2 gap-3">
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
              </div>
            </div>
          )}

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
        {/* Tank Code + Construction Type */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Tank Code</label>
            <input type="text" placeholder="TK-01" value={form.tank_code}
              onChange={e => setF('tank_code', e.target.value.toUpperCase())}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Construction Type</label>
            <select value={form.tank_type} onChange={e => setF('tank_type', e.target.value)}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
              <option value="">— Select —</option>
              {TANK_CONSTRUCTION_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
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
            <select value={form.shape_type} onChange={e => setF('shape_type', e.target.value)}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
              {TANK_SHAPES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Material</label>
            <select value={form.material_id}
              onChange={e => {
                const mat = materials.find((m: any) => m.id === e.target.value);
                setF('material_id', e.target.value);
                setF('primary_material', mat ? mat.material_name : '');
              }}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
              <option value="">— Select material —</option>
              {materials.map((m: any) => (
                <option key={m.id} value={m.id}>{m.material_code} — {m.material_name}</option>
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
                <input type="number" placeholder="0" value={form.length_mm}
                  onChange={e => setF('length_mm', e.target.value)}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">{isCyl ? 'Diameter' : 'Width'}</label>
              <input type="number" placeholder="0" value={form.width_mm}
                onChange={e => setF('width_mm', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Height</label>
              <input type="number" placeholder="0" value={form.height_mm}
                onChange={e => setF('height_mm', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Water Level</label>
              <input type="number" placeholder="0" value={form.design_water_level_mm}
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
          <div>
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
          </div>
        )}

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
  );
}

function AssignTankPanel({ exhibit, projectId, unassigned, onRefresh }: {
  exhibit: any;
  projectId: string;
  unassigned: any[];
  onRefresh: () => void;
}) {
  const [mode, setMode] = useState<'assign' | 'new'>('assign');
  const [selected, setSelected] = useState<any | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [newForm, setNewForm] = useState({
    tank_code: '', tank_name: '', shape_type: 'Rectangular',
    length_mm: '', width_mm: '', height_mm: '', design_water_level_mm: '',
    material_id: '', primary_material: '',
  });
  const [saving, setSaving] = useState(false);

  const { data: matData } = useQuery({
    queryKey: ['materials-list'],
    queryFn: () => api.get('/materials').then(r => r.data),
    staleTime: 300_000,
    enabled: mode === 'new',
  });
  const newMaterials: any[] = matData?.items || [];

  const setF = (k: string, v: string) => setNewForm(f => ({ ...f, [k]: v }));

  const handleConfirm = async () => {
    if (!selected) return;
    setConfirming(true);
    try {
      await api.patch(`/tanks/${selected.id}/exhibit`, { exhibit_id: exhibit.id });
      toast.success(`${selected.tank_name} assigned to ${exhibit.exhibit_name}`);
      onRefresh();
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
        material_id: newForm.material_id || null,
        primary_material: newForm.primary_material || null,
        status: 'Active',
      });
      toast.success('Tank created and assigned');
      onRefresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Failed to create tank');
    } finally {
      setSaving(false);
    }
  };

  const isCyl = newForm.shape_type === 'Cylindrical';

  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <div className="flex items-center gap-1 px-4 py-3 border-b border-stone-100 bg-stone-50/50">
        <button
          onClick={() => { setMode('assign'); setSelected(null); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            mode === 'assign' ? 'bg-blue-600 text-white' : 'text-stone-600 hover:bg-stone-100'
          }`}
        >
          <LinkIcon className="w-3.5 h-3.5" /> Assign Existing Tank
        </button>
        <button
          onClick={() => { setMode('new'); setSelected(null); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            mode === 'new' ? 'bg-blue-600 text-white' : 'text-stone-600 hover:bg-stone-100'
          }`}
        >
          <SquarePlus className="w-3.5 h-3.5" /> Create New Tank
        </button>
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

        {mode === 'new' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Tank Code *</label>
                <input type="text" placeholder="e.g. TK-01"
                  value={newForm.tank_code} onChange={e => setF('tank_code', e.target.value)}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-1">Shape</label>
                <select value={newForm.shape_type} onChange={e => setF('shape_type', e.target.value)}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
                  {TANK_SHAPES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1">Tank Name *</label>
              <input type="text" placeholder="e.g. Main Display Tank"
                value={newForm.tank_name} onChange={e => setF('tank_name', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
            <div className={`grid gap-3 ${isCyl ? 'grid-cols-3' : 'grid-cols-4'}`}>
              {!isCyl && (
                <div>
                  <label className="block text-xs text-stone-500 mb-1">Length (mm)</label>
                  <input type="number" placeholder="0" value={newForm.length_mm} onChange={e => setF('length_mm', e.target.value)}
                    className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
                </div>
              )}
              <div>
                <label className="block text-xs text-stone-500 mb-1">{isCyl ? 'Diameter (mm)' : 'Width (mm)'}</label>
                <input type="number" placeholder="0" value={newForm.width_mm} onChange={e => setF('width_mm', e.target.value)}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">Height (mm)</label>
                <input type="number" placeholder="0" value={newForm.height_mm} onChange={e => setF('height_mm', e.target.value)}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">Water Level (mm)</label>
                <input type="number" placeholder="0" value={newForm.design_water_level_mm} onChange={e => setF('design_water_level_mm', e.target.value)}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1">Material</label>
              <select
                value={newForm.material_id}
                onChange={e => {
                  const mat = newMaterials.find((m: any) => m.id === e.target.value);
                  setF('material_id', e.target.value);
                  setF('primary_material', mat ? mat.material_name : '');
                }}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              >
                <option value="">— Select material —</option>
                {newMaterials.map((m: any) => (
                  <option key={m.id} value={m.id}>
                    {m.material_code} — {m.material_name}
                  </option>
                ))}
              </select>
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
        theming_height_mm:   form.theming_height_mm ? parseFloat(form.theming_height_mm) : null,
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
               || substrateData?.theming_type;
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
                  {form.theming_height_mm && !themOverride && (
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

// ─── Weir Allocation ─────────────────────────────────────────────────────────
// Bazin (1888) sharp-crested rectangular weir:
//   Q = m · L · √(2g) · H^1.5      [m³/s]
//   m = 0.405 + 0.0027 / H          [H in metres]
//   Solving for L:  L = Q / ( m · √(2g) · H^1.5 )

const SQRT_2G = Math.sqrt(2 * 9.81); // ≈ 4.4294

function calcBazin(skimM3h: number, headM: number): { L: number; m: number } | null {
  if (headM <= 0 || skimM3h <= 0) return null;
  const Q = skimM3h / 3600;          // m³/s
  const m = 0.405 + 0.0027 / headM;  // Bazin coefficient
  const L = Q / (m * SQRT_2G * Math.pow(headM, 1.5));
  return { L, m };
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

function WeirAllocationSection({ bookId, exhibitId, tank, hydraulics, substrateData, onRefresh }: {
  bookId: string;
  exhibitId: string;
  tank: any | null;
  hydraulics: any | null;
  substrateData?: any | null;
  onRefresh: () => void;
}) {
  const [headVal, setHeadVal]       = useState('');
  const [headUnit, setHeadUnit]     = useState<'mm' | 'm'>('mm');
  const [resultUnit, setResultUnit] = useState<ResultUnit>('mm');
  const [saving, setSaving]         = useState(false);
  const initialized                 = useRef(false);

  // Seed headVal from stored value on first load
  useEffect(() => {
    if (!initialized.current && hydraulics?.weir_head_mm != null) {
      setHeadVal(String(parseFloat(hydraulics.weir_head_mm)));
      initialized.current = true;
    }
  }, [hydraulics?.weir_head_mm]);

  // Derive surface skim flow from hydraulics (same logic as WaterFlowTab)
  const opVol    = computeEffectiveOpVol(tank, substrateData) ?? 0;
  const turnover = parseFloat(hydraulics?.target_turnover_rate) || 0;
  const skimPct  = parseFloat(hydraulics?.surface_skim_pct) || 30;
  const totalM3h = opVol > 0 && turnover > 0 ? opVol * turnover : null;
  const skimM3h  = totalM3h != null ? totalM3h * skimPct / 100 : null;
  const skimLmin = skimM3h != null ? skimM3h * 1000 / 60 : null;

  const headRaw    = parseFloat(headVal) || 0;
  const headM      = headUnit === 'mm' ? headRaw / 1000 : headRaw;
  const currentMm  = headM > 0 ? headM * 1000 : null;
  const storedMm   = hydraulics?.weir_head_mm != null ? parseFloat(String(hydraulics.weir_head_mm)) : null;
  const isDirty    = currentMm !== storedMm;

  const result  = skimM3h != null ? calcBazin(skimM3h, headM) : null;
  const noFlow  = skimM3h == null;
  const noHead  = headM <= 0;
  const lowHead = headM > 0 && headM < 0.05;

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
      });
      toast.success('Head saved');
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
        <span className="text-xs text-indigo-500 ml-1">— Bazin formula, sharp-crested rectangular weir</span>
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
              {isDirty && headM > 0 && (
                <button onClick={handleSave} disabled={saving}
                  className="flex items-center gap-1 text-xs text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg px-3 py-2 font-medium transition-colors shrink-0">
                  <Save className="w-3 h-3" />{saving ? '…' : 'Save'}
                </button>
              )}
            </div>
            {lowHead && (
              <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />H &lt; 50 mm — Bazin formula less reliable at very low heads
              </p>
            )}
            {headM > 0 && (
              <p className="text-xs text-stone-400 mt-1">
                = {headUnit === 'mm' ? `${headM.toFixed(4)} m` : `${(headM * 1000).toFixed(1)} mm`}
                {!isDirty && storedMm != null && <span className="ml-2 text-indigo-400">✓ saved</span>}
              </p>
            )}
          </div>

          {/* Formula reference */}
          <div className="bg-stone-50 border border-stone-200 rounded-lg px-4 py-3 space-y-1 text-xs text-stone-500">
            <p className="font-semibold text-stone-600 mb-1.5">Bazin (1888) Formula</p>
            <p className="font-mono">Q = m · L · √(2g) · H<sup>3/2</sup></p>
            <p className="font-mono">m = 0.405 + 0.0027 / H</p>
            <p className="font-mono">√(2g) = {SQRT_2G.toFixed(4)} m<sup>½</sup>/s</p>
            {result && <p className="font-mono text-indigo-600">m used = {result.m.toFixed(4)}</p>}
            <p className="text-stone-400 mt-1.5">Sharp-crested rectangular weir. Valid for H &gt; 50 mm.</p>
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
                  {fmtWeir(result.L, resultUnit)}
                </p>
                <p className="text-base font-medium text-indigo-500 mt-0.5">{resultUnit}</p>
              </div>
              {/* Calculation breakdown */}
              <div className="bg-white border border-stone-200 rounded-lg px-4 py-3 text-xs space-y-1 text-stone-500">
                <p className="font-semibold text-stone-600 mb-1">Calculation Summary</p>
                <div className="flex justify-between"><span>Q (skim flow)</span><span className="font-mono text-stone-700">{(skimM3h! / 3600).toFixed(6)} m³/s</span></div>
                <div className="flex justify-between"><span>H (head)</span><span className="font-mono text-stone-700">{headM.toFixed(4)} m ({(headM * 1000).toFixed(1)} mm)</span></div>
                <div className="flex justify-between"><span>m (Bazin coeff.)</span><span className="font-mono text-stone-700">{result.m.toFixed(4)}</span></div>
                <div className="flex justify-between font-semibold text-indigo-700 pt-1 border-t border-stone-100">
                  <span>L (weir length)</span><span className="font-mono">{(result.L * 1000).toFixed(1)} mm</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-stone-400 text-center py-6">Enter a positive head value to calculate</p>
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

function WaterFlowTab({ bookId, exhibitId, tank, species, hydraulics, substrateData, onRefresh }: {
  bookId: string;
  exhibitId: string;
  tank: any;
  species: any[];
  hydraulics: any | null;
  substrateData?: any | null;
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

  const opVol   = computeEffectiveOpVol(tank, substrateData) ?? 0;
  const turnover = parseFloat(src.target_turnover_rate) || 0;
  const skimPct  = parseFloat(src.surface_skim_pct) || 0;
  const drainPct = parseFloat(src.bottom_drain_pct) || 0;

  const totalM3h  = opVol > 0 && turnover > 0 ? opVol * turnover : null;
  const totalLmin = totalM3h != null ? totalM3h * 1000 / 60 : null;
  const skimM3h   = totalM3h != null ? totalM3h * skimPct / 100 : null;
  const skimLmin  = skimM3h  != null ? skimM3h  * 1000 / 60 : null;
  const drainM3h  = totalM3h != null ? totalM3h * drainPct / 100 : null;
  const drainLmin = drainM3h != null ? drainM3h * 1000 / 60 : null;
  const splitOk   = Math.abs(skimPct + drainPct - 100) < 0.01;

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

          {/* AAT Reference */}
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

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ExhibitDetail() {
  const { bookId, exhibitId } = useParams<{ bookId: string; exhibitId: string }>();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<'tank' | 'species' | 'flow' | 'weir'>('tank');

  const { data: book, isLoading } = useQuery({
    queryKey: ['design-book', bookId],
    queryFn: () => api.get(`/design-books/${bookId}`).then(r => r.data),
    enabled: !!bookId,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['design-book', bookId] });

  if (isLoading) return <div className="p-10 text-center text-stone-400">Loading…</div>;
  if (!book) return <div className="p-10 text-center text-stone-500">Design book not found.</div>;

  const exhibits: any[] = book.exhibits || [];
  const tanks: any[] = book.tanks || [];
  const allSpecies: any[] = book.species || [];
  const allHydraulics: any[] = book.hydraulics || [];
  const allSubstrate: any[]  = book.substrate  || [];

  const exhibit = exhibits.find((e: any) => e.id === exhibitId);
  if (!exhibit) return <div className="p-10 text-center text-stone-500">Exhibit not found.</div>;

  const tank = tanks.find((t: any) => t.exhibit_id === exhibitId);
  const species = allSpecies.filter((s: any) => s.exhibit_id === exhibitId);
  const hydraulics  = allHydraulics.find((h: any) => h.exhibit_id === exhibitId) ?? null;
  const substrateData = allSubstrate.find((s: any) => s.exhibit_id === exhibitId) ?? null;
  const unassigned = tanks.filter((t: any) => !t.exhibit_id);

  const TABS = [
    { id: 'tank',    label: 'Tank',         icon: <Layers     className="w-3.5 h-3.5" /> },
    { id: 'species', label: 'Species',      icon: <Fish       className="w-3.5 h-3.5" />, badge: species.length || undefined },
    { id: 'flow',    label: 'Water Flow',   icon: <Gauge      className="w-3.5 h-3.5" /> },
    { id: 'weir',    label: 'Weir Design',  icon: <Calculator className="w-3.5 h-3.5" /> },
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

      {/* Exhibit Header */}
      <div className="bg-white rounded-2xl border border-stone-200 px-6 py-5 mb-5 shadow-sm">
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
          <Link
            to={`/design-books/${bookId}`}
            className="shrink-0 text-xs text-stone-500 hover:text-stone-700 border border-stone-200 rounded-lg px-3 py-1.5 bg-white hover:bg-stone-50 transition-colors"
          >
            ← Back to Design Book
          </Link>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center gap-1 border-b border-stone-200 mb-6">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
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
      {activeTab === 'tank' && (
        <div className="space-y-5">
          {tank ? (
            <TankCard tank={tank} substrateData={substrateData} onRefresh={refresh} />
          ) : book.project_id ? (
            <AssignTankPanel
              exhibit={exhibit}
              projectId={book.project_id}
              unassigned={unassigned}
              onRefresh={refresh}
            />
          ) : (
            <div className="bg-white rounded-xl border border-stone-200 py-14 text-center">
              <FolderOpen className="w-8 h-8 text-stone-200 mx-auto mb-2" />
              <p className="text-stone-400 text-sm">No tank assigned. Link a project to this design book to manage tanks.</p>
            </div>
          )}
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
          onRefresh={refresh}
        />
      )}
    </div>
  );
}
