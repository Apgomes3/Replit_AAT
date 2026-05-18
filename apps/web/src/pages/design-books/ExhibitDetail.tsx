import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { useState } from 'react';
import api from '../../lib/api';
import {
  ChevronRight, Waves, ThermometerSun, FlaskConical, Fish, Plus,
  Trash2, Check, CheckCircle2, Layers, FolderOpen, LinkIcon,
  SquarePlus, X, Droplets, Pencil, Save
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
    Custom: 'bg-amber-100 text-amber-700',
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

function calcVolumes(shape: string, l: string, w: string, h: string, wl: string, gv: string, ov: string) {
  const lv = parseFloat(l) || 0;
  const wv = parseFloat(w) || 0;
  const hv = parseFloat(h) || 0;
  const wlv = parseFloat(wl) || 0;
  const s = shape.toLowerCase();
  if (s === 'custom') {
    return { gross: parseFloat(gv) || null, op: parseFloat(ov) || null };
  }
  if (s === 'cylindrical') {
    const r = wv / 2;
    const gross = wv && hv ? Math.round(Math.PI * r * r * hv / 1e9 * 1e4) / 1e4 : null;
    const op = wv && wlv ? Math.round(Math.PI * r * r * wlv / 1e9 * 1e4) / 1e4 : null;
    return { gross, op };
  }
  // rectangular
  const gross = lv && wv && hv ? Math.round(lv * wv * hv / 1e9 * 1e4) / 1e4 : null;
  const op = lv && wv && wlv ? Math.round(lv * wv * wlv / 1e9 * 1e4) / 1e4 : null;
  return { gross, op };
}

function TankCard({ tank, onRefresh }: { tank: any; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({});

  const startEdit = () => {
    setForm({
      tank_code:              tank.tank_code || '',
      tank_name:              tank.tank_name || '',
      shape_type:             tank.shape_type || tank.eff_shape || 'Rectangular',
      length_mm:              tank.length_mm ?? tank.eff_length_mm ?? '',
      width_mm:               tank.width_mm  ?? tank.eff_width_mm  ?? '',
      height_mm:              tank.height_mm ?? tank.eff_height_mm ?? '',
      design_water_level_mm:  tank.design_water_level_mm ?? '',
      gross_volume_m3:        tank.gross_volume_m3 ?? '',
      operating_volume_m3:    tank.operating_volume_m3 ?? tank.design_volume_m3 ?? '',
      primary_material:       tank.primary_material || '',
      status:                 tank.status || 'Active',
    });
    setEditing(true);
  };

  const setF = (k: string, v: string) => setForm((f: any) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.tank_name.trim()) return toast.error('Tank name is required');
    setSaving(true);
    try {
      await api.put(`/tanks/${tank.id}`, {
        tank_code:            form.tank_code || undefined,
        tank_name:            form.tank_name,
        shape_type:           form.shape_type,
        length_mm:            form.length_mm || null,
        width_mm:             form.width_mm || null,
        height_mm:            form.height_mm || null,
        design_water_level_mm: form.design_water_level_mm || null,
        gross_volume_m3:      form.gross_volume_m3 || null,
        operating_volume_m3:  form.operating_volume_m3 || null,
        primary_material:     form.primary_material || null,
        status:               form.status,
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

  const isCyl  = (form.shape_type || '').toLowerCase() === 'cylindrical';
  const isCust = (form.shape_type || '').toLowerCase() === 'custom';
  const preview = editing
    ? calcVolumes(form.shape_type, form.length_mm, form.width_mm, form.height_mm,
                  form.design_water_level_mm, form.gross_volume_m3, form.operating_volume_m3)
    : null;

  // ── View mode ──
  if (!editing) {
    const viewIsCyl = (tank.eff_shape || '').toLowerCase() === 'cylindrical';
    const dims = [
      !viewIsCyl && tank.eff_length_mm   ? { label: 'Length',     val: `${fmtDim(tank.eff_length_mm)} mm` }   : null,
      tank.eff_width_mm                  ? { label: viewIsCyl ? 'Diameter' : 'Width', val: `${fmtDim(tank.eff_width_mm)} mm` } : null,
      tank.eff_height_mm                 ? { label: 'Height',     val: `${fmtDim(tank.eff_height_mm)} mm` }   : null,
      tank.design_water_level_mm         ? { label: 'Water Level', val: `${fmtDim(tank.design_water_level_mm)} mm` } : null,
    ].filter(Boolean);

    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50/30 p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs bg-stone-100 text-stone-600 px-2 py-0.5 rounded border border-stone-200">{tank.tank_code}</span>
              <ShapeBadge shape={tank.eff_shape} />
            </div>
            <h3 className="text-lg font-semibold text-stone-800">{tank.tank_name}</h3>
            {tank.primary_material && (
              <p className="text-xs text-stone-500 mt-0.5">{tank.primary_material}</p>
            )}
          </div>
          <div className="flex items-start gap-4">
            <div className="text-right">
              <div className="text-2xl font-bold text-blue-700">{fmtVol(tank.gross_volume_m3)}</div>
              <div className="text-xs text-stone-400">m³ gross volume</div>
              {(tank.design_volume_m3 || tank.operating_volume_m3) && (
                <div className="text-sm text-stone-500 mt-0.5">
                  {fmtVol(tank.operating_volume_m3 ?? tank.design_volume_m3)} m³ operating
                </div>
              )}
            </div>
            <button
              onClick={startEdit}
              className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-blue-600 border border-stone-200 hover:border-blue-300 bg-white rounded-lg px-2.5 py-1.5 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          </div>
        </div>
        {dims.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {dims.map((d: any) => (
              <div key={d.label} className="bg-white rounded-lg px-3 py-2 border border-blue-100">
                <div className="text-xs text-stone-400 mb-0.5">{d.label}</div>
                <div className="font-mono text-sm font-semibold text-stone-700">{d.val}</div>
              </div>
            ))}
          </div>
        )}
        {tank.system_code && (
          <div className="mt-3 flex items-center gap-2 text-xs text-stone-500">
            <span>Linked system:</span>
            <span className="font-mono bg-stone-100 px-1.5 py-0.5 rounded text-stone-600">{tank.system_code}</span>
            {tank.system_name && <span>{tank.system_name}</span>}
          </div>
        )}
      </div>
    );
  }

  // ── Edit mode ──
  const inp = (label: string, key: string, opts?: { type?: string; placeholder?: string; required?: boolean; upper?: boolean }) => (
    <div>
      <label className="block text-xs font-medium text-stone-500 mb-1">
        {label}{opts?.required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <input
        type={opts?.type ?? 'text'}
        placeholder={opts?.placeholder}
        value={form[key]}
        onChange={e => setF(key, opts?.upper ? e.target.value.toUpperCase() : e.target.value)}
        className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
      />
    </div>
  );

  return (
    <div className="rounded-xl border border-blue-400 bg-white shadow-sm">
      {/* Edit header */}
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
        {/* Identity */}
        <div className="grid grid-cols-2 gap-4">
          {inp('Tank Code', 'tank_code', { placeholder: 'TK-01', upper: true })}
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Shape</label>
            <select value={form.shape_type} onChange={e => setF('shape_type', e.target.value)}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
              {TANK_SHAPES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
        {inp('Tank Name', 'tank_name', { required: true, placeholder: 'e.g. Main Display Tank' })}

        {/* Dimensions */}
        <div>
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">Dimensions (mm)</p>
          <div className={`grid gap-3 ${isCyl ? 'grid-cols-3' : 'grid-cols-4'}`}>
            {!isCyl && inp('Length', 'length_mm', { type: 'number', placeholder: '0' })}
            {inp(isCyl ? 'Diameter' : 'Width', 'width_mm', { type: 'number', placeholder: '0' })}
            {inp('Height', 'height_mm', { type: 'number', placeholder: '0' })}
            {inp('Water Level', 'design_water_level_mm', { type: 'number', placeholder: '0' })}
          </div>
        </div>

        {/* Volumes — direct input for Custom, calculated preview for others */}
        {isCust ? (
          <div>
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">Volumes (m³) — direct input</p>
            <div className="grid grid-cols-2 gap-4">
              {inp('Gross Volume', 'gross_volume_m3', { type: 'number', placeholder: '0.000' })}
              {inp('Operating Volume', 'operating_volume_m3', { type: 'number', placeholder: '0.000' })}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4 bg-blue-50 rounded-lg px-4 py-3 border border-blue-100">
            <div className="text-xs text-stone-500">Calculated volumes:</div>
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
            <p className="text-xs text-stone-400 ml-auto">Auto-calculated from dimensions</p>
          </div>
        )}

        {/* Material & status */}
        <div className="grid grid-cols-2 gap-4">
          {inp('Material', 'primary_material', { placeholder: 'e.g. Acrylic, FRP, Concrete' })}
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1">Status</label>
            <select value={form.status} onChange={e => setF('status', e.target.value)}
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30">
              {['Design', 'Active', 'Inactive', 'Decommissioned'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
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
    length_mm: '', width_mm: '', height_mm: '', design_water_level_mm: '', primary_material: '',
  });
  const [saving, setSaving] = useState(false);

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
              <input type="text" placeholder="e.g. Acrylic, FRP, Concrete"
                value={newForm.primary_material} onChange={e => setF('primary_material', e.target.value)}
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
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

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ExhibitDetail() {
  const { bookId, exhibitId } = useParams<{ bookId: string; exhibitId: string }>();
  const qc = useQueryClient();

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

  const exhibit = exhibits.find((e: any) => e.id === exhibitId);
  if (!exhibit) return <div className="p-10 text-center text-stone-500">Exhibit not found.</div>;

  const tank = tanks.find((t: any) => t.exhibit_id === exhibitId);
  const species = allSpecies.filter((s: any) => s.exhibit_id === exhibitId);
  const unassigned = tanks.filter((t: any) => !t.exhibit_id);

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
      <div className="bg-white rounded-2xl border border-stone-200 px-6 py-5 mb-6 shadow-sm">
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
                    <ThermometerSun className="w-4 h-4 text-orange-400" />
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

      {/* Content: Tank + Species stacked */}
      <div className="space-y-5">
        {/* Tank Section */}
        <div>
          <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-3 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />
            Display Tank
          </h2>
          {tank ? (
            <TankCard tank={tank} onRefresh={refresh} />
          ) : (
            book.project_id ? (
              <AssignTankPanel
                exhibit={exhibit}
                projectId={book.project_id}
                unassigned={unassigned}
                onRefresh={refresh}
              />
            ) : (
              <div className="bg-white rounded-xl border border-stone-200 py-10 text-center">
                <FolderOpen className="w-8 h-8 text-stone-200 mx-auto mb-2" />
                <p className="text-stone-400 text-sm">No tank assigned. Link a project to this design book to manage tanks.</p>
              </div>
            )
          )}
        </div>

        {/* Species Section */}
        <div>
          <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide mb-3 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
            Species Allocation
          </h2>
          <SpeciesSection
            bookId={book.id}
            exhibitId={exhibitId!}
            species={species}
            onRefresh={refresh}
          />
        </div>
      </div>
    </div>
  );
}
