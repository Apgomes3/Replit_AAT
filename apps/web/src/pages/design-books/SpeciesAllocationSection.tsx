import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, Fish, Link2, Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

type AllocationForm = {
  catalog_species_id: string;
  species_name: string;
  common_name: string;
  quantity: string;
  avg_size_cm: string;
  reference_average_mass_kg: string;
  biomass_kg: string;
  avg_size_override_cm: string;
  reference_mass_override_kg: string;
  biomass_override_kg: string;
  notes: string;
};

const EMPTY: AllocationForm = {
  catalog_species_id: '', species_name: '', common_name: '', quantity: '',
  avg_size_cm: '', reference_average_mass_kg: '', biomass_kg: '',
  avg_size_override_cm: '', reference_mass_override_kg: '', biomass_override_kg: '', notes: '',
};

const inputCls = 'w-full rounded-md border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-800 focus:border-emerald-400 focus:outline-none';

function n(value: string) {
  return value === '' ? null : Number(value);
}

function SourceTag({ source }: { source?: string | null }) {
  if (!source) return null;
  const override = source === 'override';
  const catalog = source === 'catalog_snapshot';
  return (
    <span className={`ml-1 inline-flex rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
      override ? 'bg-amber-100 text-amber-700' : catalog ? 'bg-blue-100 text-blue-700' : 'bg-stone-100 text-stone-500'
    }`}>
      {override ? 'Override' : catalog ? 'Catalog' : source}
    </span>
  );
}

function CatalogPicker({ form, setForm, customMode, setCustomMode }: {
  form: AllocationForm;
  setForm: React.Dispatch<React.SetStateAction<AllocationForm>>;
  customMode: boolean;
  setCustomMode: (value: boolean) => void;
}) {
  const [search, setSearch] = useState(form.species_name);
  const [open, setOpen] = useState(false);
  const { data, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['species-catalog-picker', search],
    queryFn: () => api.get(`/species-catalog?q=${encodeURIComponent(search)}&limit=12`).then(result => result.data),
    enabled: !customMode && open && search.trim().length >= 2,
  });
  const items: any[] = data?.items || [];
  const errorMessage = (error as any)?.response?.data?.error?.message
    || 'The species catalog is temporarily unavailable. You can retry or use a custom species.';

  if (customMode) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">Custom species</span>
          <button type="button" onClick={() => { setCustomMode(false); setSearch(''); setForm({ ...EMPTY }); }}
            className="text-[10px] font-medium text-emerald-700 hover:text-emerald-900">
            Search catalog
          </button>
        </div>
        <input autoFocus className={inputCls} value={form.species_name}
          placeholder="Scientific name"
          onChange={event => setForm(current => ({ ...current, catalog_species_id: '', species_name: event.target.value }))} />
      </div>
    );
  }

  return (
    <div className="relative space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">Catalog species</span>
        <button type="button" onClick={() => { setCustomMode(true); setSearch(''); setForm({ ...EMPTY }); }}
          className="text-[10px] font-medium text-stone-500 hover:text-stone-800">
          Use custom species
        </button>
      </div>
      <div className="relative">
        <Search className="absolute left-2 top-2 h-3 w-3 text-stone-400" />
        <input autoFocus className={`${inputCls} pl-7`} value={search}
          placeholder="Search scientific, common, or family name"
          onFocus={() => setOpen(true)}
          onChange={event => { setSearch(event.target.value); setOpen(true); }} />
      </div>
      {open && search.trim().length >= 2 && (
        <div className="absolute z-30 mt-1 max-h-60 w-[26rem] max-w-[75vw] overflow-auto rounded-lg border border-stone-200 bg-white shadow-xl">
          {isFetching && <div className="px-3 py-2 text-xs text-stone-400">Searching catalog…</div>}
          {!isFetching && isError && (
            <div role="alert" className="flex items-start gap-2 px-3 py-3 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <div>
                <p>{errorMessage}</p>
                <button type="button" onClick={() => refetch()} className="mt-1 inline-flex items-center gap-1 font-semibold underline">
                  <RefreshCw className="h-3 w-3" /> Retry catalog search
                </button>
              </div>
            </div>
          )}
          {!isFetching && !isError && items.length === 0 && <div className="px-3 py-2 text-xs text-stone-400">No active catalog match.</div>}
          {!isError && items.map(item => (
            <button key={item.id} type="button"
              onClick={() => {
                setForm(current => ({
                  ...current,
                  catalog_species_id: item.id,
                  species_name: item.scientific_name,
                  common_name: item.common_name || '',
                  avg_size_cm: item.average_size_cm != null ? String(item.average_size_cm) : '',
                  reference_average_mass_kg: item.reference_average_mass_kg != null ? String(item.reference_average_mass_kg) : '',
                  avg_size_override_cm: '',
                  reference_mass_override_kg: '',
                  biomass_override_kg: '',
                }));
                setSearch(item.scientific_name);
                setOpen(false);
              }}
              className="block w-full border-b border-stone-100 px-3 py-2 text-left last:border-0 hover:bg-emerald-50">
              <div className="text-xs font-medium italic text-stone-800">{item.scientific_name}</div>
              <div className="text-[10px] text-stone-500">{item.common_name || 'No common name'} · Planning water type: {item.water_type} · {item.family}</div>
            </button>
          ))}
        </div>
      )}
      {form.catalog_species_id && (
        <div className="flex items-center gap-1 text-[10px] font-medium text-blue-700">
          <Link2 className="h-3 w-3" /> Linked catalog reference selected
        </div>
      )}
    </div>
  );
}

export default function SpeciesAllocationSection({ bookId, exhibitId, species, allSpecies, onRefresh }: {
  bookId: string;
  exhibitId: string;
  species?: any[];
  allSpecies?: any[];
  onRefresh: () => void;
}) {
  const rows = (species || allSpecies || []).filter(item => item.exhibit_id === exhibitId);
  const user = useAuthStore(state => state.user);
  const canManage = (user?.role === 'admin' || user?.role === 'engineer')
    && user?.moduleAccess?.design_books !== 'view'
    && user?.moduleAccess?.design_books !== 'hidden';
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AllocationForm>({ ...EMPTY });
  const [customMode, setCustomMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshCatalog, setRefreshCatalog] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const resolvedMass = n(form.reference_mass_override_kg) ?? n(form.reference_average_mass_kg);
  const previewBiomass = n(form.biomass_override_kg)
    ?? (n(form.quantity) != null && resolvedMass != null ? n(form.quantity)! * resolvedMass : n(form.biomass_kg));

  const reset = () => {
    setShowEditor(false);
    setEditingId(null);
    setCustomMode(false);
    setRefreshCatalog(false);
    setForm({ ...EMPTY });
  };

  const startAdd = () => {
    setEditingId(null);
    setForm({ ...EMPTY });
    setCustomMode(false);
    setRefreshCatalog(false);
    setShowEditor(true);
  };

  const startEdit = (row: any) => {
    setEditingId(row.id);
    setRefreshCatalog(false);
    setCustomMode(!row.catalog_species_id);
    setForm({
      catalog_species_id: row.catalog_species_id || '',
      species_name: row.species_name || '',
      common_name: row.common_name || '',
      quantity: row.quantity != null ? String(row.quantity) : '',
      avg_size_cm: row.avg_size_cm != null ? String(row.avg_size_cm) : '',
      reference_average_mass_kg: row.reference_average_mass_kg != null ? String(row.reference_average_mass_kg) : '',
      biomass_kg: row.biomass_kg != null ? String(row.biomass_kg) : '',
      avg_size_override_cm: row.avg_size_override_cm != null ? String(row.avg_size_override_cm) : '',
      reference_mass_override_kg: row.reference_mass_override_kg != null ? String(row.reference_mass_override_kg) : '',
      biomass_override_kg: row.biomass_override_kg != null ? String(row.biomass_override_kg) : '',
      notes: row.notes || '',
    });
    setShowEditor(true);
  };

  const save = async () => {
    if (!form.species_name.trim()) return toast.error('Select a catalog species or enter a custom scientific name.');
    if (!customMode && !form.catalog_species_id) return toast.error('Choose a catalog result or use the custom species path.');
    setSaving(true);
    const payload: any = {
      exhibit_id: exhibitId,
      catalog_species_id: form.catalog_species_id || null,
      species_name: form.species_name.trim(),
      common_name: form.common_name.trim() || null,
      quantity: n(form.quantity),
      notes: form.notes.trim() || null,
    };
    if (form.catalog_species_id) {
      payload.avg_size_override_cm = n(form.avg_size_override_cm);
      payload.reference_mass_override_kg = n(form.reference_mass_override_kg);
      payload.biomass_override_kg = n(form.biomass_override_kg);
      if (editingId && refreshCatalog) payload.refresh_catalog = true;
    } else {
      payload.avg_size_cm = n(form.avg_size_cm);
      payload.reference_average_mass_kg = n(form.reference_average_mass_kg);
      payload.biomass_kg = n(form.biomass_kg);
    }
    try {
      if (editingId) await api.put(`/design-books/${bookId}/species/${editingId}`, payload);
      else await api.post(`/design-books/${bookId}/species`, payload);
      toast.success(editingId ? 'Species allocation updated' : 'Species added');
      reset();
      onRefresh();
    } catch (error: any) {
      toast.error(error.response?.data?.error?.message || 'Failed to save species allocation');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Remove this species allocation?')) return;
    setDeletingId(id);
    try {
      await api.delete(`/design-books/${bookId}/species/${id}`);
      onRefresh();
    } catch {
      toast.error('Failed to remove species allocation');
    } finally {
      setDeletingId(null);
    }
  };

  const totalBiomass = useMemo(
    () => rows.reduce((sum, row) => sum + (Number(row.biomass_kg) || 0), 0),
    [rows],
  );

  return (
    <div className="border-t border-stone-100 bg-emerald-50/20">
      <div className="flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-2">
          <Fish className="h-4 w-4 text-emerald-600" />
          <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Species Allocation</span>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700">{rows.length}</span>
        </div>
        {canManage && !showEditor && (
          <button type="button" onClick={startAdd}
            className="flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50">
            <Plus className="h-3 w-3" /> Add species
          </button>
        )}
      </div>

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-y border-stone-100 text-stone-400">
              <tr>
                <th className="px-5 py-2 text-left font-medium">Species</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Avg size</th>
                <th className="px-3 py-2 text-right font-medium">Ref mass</th>
                <th className="px-3 py-2 text-right font-medium">Biomass</th>
                <th className="w-16 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="group border-b border-stone-100 bg-white/60">
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="italic text-stone-800">{row.species_name}</span>
                      {row.catalog_species_id
                        ? <span className="rounded bg-blue-50 px-1 py-0.5 text-[9px] font-semibold uppercase text-blue-700">Catalog</span>
                        : <span className="rounded bg-stone-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-stone-500">Custom</span>}
                      {row.catalog_active === false && <span className="text-[9px] font-semibold text-amber-700">Inactive ref</span>}
                    </div>
                    <div className="text-[10px] text-stone-400">{row.common_name || 'No common name'}{row.catalog_family ? ` · ${row.catalog_family}` : ''}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{row.quantity ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {row.avg_size_cm != null ? `${Number(row.avg_size_cm).toFixed(1)} cm` : '—'}
                    <SourceTag source={row.avg_size_source} />
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {row.reference_average_mass_kg != null ? `${Number(row.reference_average_mass_kg).toFixed(3)} kg` : '—'}
                    <SourceTag source={row.reference_mass_source} />
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-800">
                    {row.biomass_kg != null ? `${Number(row.biomass_kg).toFixed(2)} kg` : '—'}
                    <SourceTag source={row.biomass_source} />
                  </td>
                  <td className="px-3 py-2">
                    {canManage && <div className="flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <button type="button" onClick={() => startEdit(row)} title="Edit allocation" className="p-1 text-stone-400 hover:text-blue-700">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => remove(row.id)} disabled={deletingId === row.id}
                        title="Remove allocation" className="p-1 text-stone-400 hover:text-red-600 disabled:opacity-40">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>}
                  </td>
                </tr>
              ))}
              <tr className="bg-emerald-50/50">
                <td colSpan={4} className="px-5 py-2 text-right font-semibold text-emerald-700">Total biomass</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-emerald-800">{totalBiomass.toFixed(2)} kg</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {showEditor && (
        <div className="border-t border-emerald-200 bg-white px-5 py-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <div className="md:col-span-2 xl:col-span-2">
              <CatalogPicker form={form} setForm={setForm} customMode={customMode} setCustomMode={setCustomMode} />
            </div>
            {customMode && (
              <label className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                Common name
                <input className={`${inputCls} mt-1`} value={form.common_name}
                  onChange={event => setForm(current => ({ ...current, common_name: event.target.value }))} />
              </label>
            )}
            <label className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
              Quantity
              <input type="number" min="0" step="1" className={`${inputCls} mt-1`} value={form.quantity}
                onChange={event => setForm(current => ({ ...current, quantity: event.target.value }))} />
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
              {form.catalog_species_id ? 'Size override (cm)' : 'Average size (cm)'}
              <input type="number" min="0" step="any" className={`${inputCls} mt-1`}
                value={form.catalog_species_id ? form.avg_size_override_cm : form.avg_size_cm}
                placeholder={form.catalog_species_id ? form.avg_size_cm || 'Catalog default' : ''}
                onChange={event => setForm(current => ({ ...current, [form.catalog_species_id ? 'avg_size_override_cm' : 'avg_size_cm']: event.target.value }))} />
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
              {form.catalog_species_id ? 'Mass override (kg)' : 'Reference mass (kg)'}
              <input type="number" min="0" step="any" className={`${inputCls} mt-1`}
                value={form.catalog_species_id ? form.reference_mass_override_kg : form.reference_average_mass_kg}
                placeholder={form.catalog_species_id ? form.reference_average_mass_kg || 'Catalog default' : ''}
                onChange={event => setForm(current => ({ ...current, [form.catalog_species_id ? 'reference_mass_override_kg' : 'reference_average_mass_kg']: event.target.value }))} />
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
              {form.catalog_species_id ? 'Biomass override (kg)' : 'Biomass (kg)'}
              <input type="number" min="0" step="any" className={`${inputCls} mt-1`}
                value={form.catalog_species_id ? form.biomass_override_kg : form.biomass_kg}
                placeholder={previewBiomass != null ? `Auto ${previewBiomass.toFixed(2)}` : ''}
                onChange={event => setForm(current => ({ ...current, [form.catalog_species_id ? 'biomass_override_kg' : 'biomass_kg']: event.target.value }))} />
            </label>
          </div>
          {editingId && form.catalog_species_id && (
            <label className="mt-3 flex items-start gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              <input type="checkbox" className="mt-0.5" checked={refreshCatalog}
                onChange={event => setRefreshCatalog(event.target.checked)} />
              <span>
                <span className="font-semibold">Use latest catalog reference values</span>
                <span className="block text-[10px] text-blue-600">Updates the captured name, size, and reference mass; existing overrides remain explicit.</span>
              </span>
            </label>
          )}
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-[10px] text-stone-400">
              Blank catalog override fields retain the captured catalog defaults. Default biomass = quantity × reference mass.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={reset} className="flex items-center gap-1 rounded-md border border-stone-200 px-3 py-1.5 text-xs text-stone-600">
                <X className="h-3 w-3" /> Cancel
              </button>
              <button type="button" onClick={save} disabled={saving}
                className="flex items-center gap-1 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                <Check className="h-3 w-3" /> {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add allocation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {rows.length === 0 && !showEditor && (
        <div className="px-5 pb-4 text-xs italic text-stone-400">No species allocated — add from the shared catalog or use a custom species.</div>
      )}
    </div>
  );
}