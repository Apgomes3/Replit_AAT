import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Fish, Pencil, Plus, RefreshCw, Search, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';
import { useAuthStore } from '../../store/authStore';

const WATER_TYPES = ['Marine', 'Freshwater', 'Brackish', 'Universal'];
const EMPTY = {
  scientific_name: '', common_name: '', family: '', water_type: 'Marine',
  average_size_cm: '', reference_average_mass_kg: '', source: '', active: true,
};
const inputCls = 'w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 focus:border-blue-400 focus:outline-none';

export default function SpeciesCatalog() {
  const qc = useQueryClient();
  const user = useAuthStore(state => state.user);
  const canManage = (user?.role === 'admin' || user?.role === 'engineer')
    && user?.moduleAccess?.design_books !== 'view'
    && user?.moduleAccess?.design_books !== 'hidden';
  const [search, setSearch] = useState('');
  const [waterType, setWaterType] = useState('');
  const [family, setFamily] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);

  const params = new URLSearchParams({ limit: '1000' });
  if (search) params.set('q', search);
  if (waterType) params.set('water_type', waterType);
  if (family) params.set('family', family);
  if (showInactive) params.set('include_inactive', 'true');

  const {
    data,
    isLoading,
    isError: catalogError,
    error: catalogQueryError,
    refetch: refetchCatalog,
  } = useQuery({
    queryKey: ['species-catalog', search, waterType, family, showInactive],
    queryFn: () => api.get(`/species-catalog?${params}`).then(result => result.data),
  });
  const {
    data: facets,
    isError: facetsError,
    refetch: refetchFacets,
  } = useQuery({
    queryKey: ['species-catalog-facets'],
    queryFn: () => api.get('/species-catalog/facets').then(result => result.data),
  });
  const items: any[] = data?.items || [];
  const queryErrorMessage = (error: any) => error?.response?.data?.error?.message || 'The species catalog is temporarily unavailable. Please retry.';
  const retryCatalog = async () => {
    await Promise.all([refetchCatalog(), refetchFacets()]);
    qc.invalidateQueries({ queryKey: ['species-catalog-picker'] });
  };

  const openNew = () => {
    setEditing({ id: null });
    setForm({ ...EMPTY });
  };
  const openEdit = (item: any) => {
    setEditing(item);
    setForm({
      scientific_name: item.scientific_name || '',
      common_name: item.common_name || '',
      family: item.family || '',
      water_type: item.water_type || 'Marine',
      average_size_cm: item.average_size_cm ?? '',
      reference_average_mass_kg: item.reference_average_mass_kg ?? '',
      source: item.source || '',
      active: item.active !== false,
    });
  };
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['species-catalog'] });
    qc.invalidateQueries({ queryKey: ['species-catalog-facets'] });
    qc.invalidateQueries({ queryKey: ['species-catalog-picker'] });
  };
  const save = async () => {
    if (!form.scientific_name.trim() || !form.family.trim() || !form.source.trim()) {
      return toast.error('Scientific name, family, and source / provenance are required.');
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        scientific_name: form.scientific_name.trim(),
        common_name: form.common_name.trim() || null,
        family: form.family.trim(),
        average_size_cm: form.average_size_cm === '' ? null : Number(form.average_size_cm),
        reference_average_mass_kg: form.reference_average_mass_kg === '' ? null : Number(form.reference_average_mass_kg),
      };
      if (editing?.id) await api.put(`/species-catalog/${editing.id}`, payload);
      else await api.post('/species-catalog', payload);
      toast.success(editing?.id ? 'Catalog record updated' : 'Catalog species created');
      setEditing(null);
      invalidate();
    } catch (error: any) {
      toast.error(error.response?.data?.error?.message || 'Failed to save catalog species');
    } finally {
      setSaving(false);
    }
  };
  const importRecords = async () => {
    setImporting(true);
    try {
      const parsed = JSON.parse(importText);
      const records = Array.isArray(parsed) ? parsed : parsed.records;
      const result = await api.post('/species-catalog/import', { records });
      toast.success(`Imported ${result.data.inserted}; skipped ${result.data.skipped} duplicates.`);
      setShowImport(false);
      setImportText('');
      invalidate();
    } catch (error: any) {
      toast.error(error.response?.data?.error?.message || error.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Aquarium Species Catalog"
        subtitle="Shared planning references grouped by water type and family. Exhibit allocations keep captured values and explicit overrides."
        actions={canManage ? (
          <div className="flex gap-2">
            <button onClick={() => setShowImport(true)} className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 hover:bg-stone-50">
              <Upload className="h-4 w-4" /> Staged import
            </button>
            <button onClick={openNew} className="flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800">
              <Plus className="h-4 w-4" /> Add species
            </button>
          </div>
        ) : undefined}
      />

      <div className="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 md:grid-cols-4">
        <label className="relative md:col-span-2">
          <Search className="absolute left-3 top-3 h-4 w-4 text-stone-400" />
          <input className={`${inputCls} pl-9`} value={search} onChange={event => setSearch(event.target.value)}
            placeholder="Search scientific name, common name, or family" />
        </label>
        <select className={inputCls} value={waterType} onChange={event => setWaterType(event.target.value)}>
          <option value="">All water types</option>
          {(facets?.water_types || []).map((item: any) => <option key={item.water_type} value={item.water_type}>{item.water_type} ({item.count})</option>)}
        </select>
        <select className={inputCls} value={family} onChange={event => setFamily(event.target.value)}>
          <option value="">All families</option>
          {(facets?.families || []).map((item: any) => <option key={item.family} value={item.family}>{item.family} ({item.count})</option>)}
        </select>
        <label className="flex items-center gap-2 text-xs text-stone-600 md:col-span-4">
          <input type="checkbox" checked={showInactive} onChange={event => setShowInactive(event.target.checked)} />
          Include inactive records
          <span className="ml-auto text-stone-400">{data?.total || 0} matching records</span>
        </label>
        {facetsError && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 md:col-span-4">
            <span>Filters could not load. You can still search the catalog.</span>
            <button type="button" onClick={() => refetchFacets()} className="font-semibold underline">Retry filters</button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        {isLoading ? <div className="p-10 text-center text-sm text-stone-400">Loading species catalog…</div> : catalogError ? (
          <div role="alert" className="flex flex-col items-center gap-3 p-12 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-600" />
            <div>
              <p className="font-medium text-stone-800">The species catalog could not be loaded</p>
              <p className="mt-1 max-w-md text-sm text-stone-500">{queryErrorMessage(catalogQueryError)}</p>
            </div>
            <button type="button" onClick={retryCatalog} className="flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800">
              <RefreshCw className="h-4 w-4" /> Retry catalog
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-400">
                <tr>
                  <th className="px-4 py-3 text-left">Scientific / common name</th>
                  <th className="px-4 py-3 text-left">Planning water type</th>
                  <th className="px-4 py-3 text-left">Family</th>
                  <th className="px-4 py-3 text-right">Avg size</th>
                  <th className="px-4 py-3 text-right">Ref mass</th>
                  <th className="px-4 py-3 text-left">Source / status</th>
                  {canManage && <th className="w-12" />}
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className={`border-b border-stone-100 last:border-0 ${item.active ? '' : 'bg-stone-50 opacity-65'}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium italic text-stone-800">{item.scientific_name}</div>
                      <div className="text-xs text-stone-400">{item.common_name || 'No common name'}</div>
                    </td>
                    <td className="px-4 py-3"><span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">{item.water_type}</span></td>
                    <td className="px-4 py-3 text-stone-600">{item.family}</td>
                    <td className="px-4 py-3 text-right font-mono text-stone-600">{item.average_size_cm != null ? `${Number(item.average_size_cm).toFixed(1)} cm` : '—'}</td>
                    <td className="px-4 py-3 text-right font-mono text-stone-600">{item.reference_average_mass_kg != null ? `${Number(item.reference_average_mass_kg).toFixed(3)} kg` : '—'}</td>
                    <td className="max-w-xs px-4 py-3">
                      <div className="truncate text-xs text-stone-500" title={item.source}>{item.source}</div>
                      <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${item.active ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-200 text-stone-500'}`}>
                        {item.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-3 py-3">
                        <button onClick={() => openEdit(item)} title="Edit catalog record" className="rounded p-1.5 text-stone-400 hover:bg-blue-50 hover:text-blue-700">
                          <Pencil className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={canManage ? 7 : 6} className="p-12 text-center text-sm text-stone-400">
                    {data?.total === 0 && !search && !waterType && !family && !showInactive
                      ? 'The catalog is empty. Add or import a reviewed species set.'
                      : 'No catalog species match these filters.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/35 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold text-stone-800"><Fish className="h-5 w-5 text-blue-700" /> {editing.id ? 'Edit catalog species' : 'Add catalog species'}</h2>
                <p className="text-xs text-stone-400">Corrections do not rewrite saved exhibit allocations.</p>
              </div>
              <button onClick={() => setEditing(null)} className="p-1 text-stone-400"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ['scientific_name', 'Scientific name'],
                ['common_name', 'Common name'],
                ['family', 'Family'],
              ].map(([key, label]) => (
                <label key={key} className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  {label}<input className={`${inputCls} mt-1`} value={form[key]} onChange={event => setForm((current: any) => ({ ...current, [key]: event.target.value }))} />
                </label>
              ))}
              <label className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                Water type
                <select className={`${inputCls} mt-1`} value={form.water_type} onChange={event => setForm((current: any) => ({ ...current, water_type: event.target.value }))}>
                  {WATER_TYPES.map(value => <option key={value}>{value}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                Average size (cm)
                <input type="number" min="0" step="any" className={`${inputCls} mt-1`} value={form.average_size_cm}
                  onChange={event => setForm((current: any) => ({ ...current, average_size_cm: event.target.value }))} />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                Reference average mass (kg)
                <input type="number" min="0" step="any" className={`${inputCls} mt-1`} value={form.reference_average_mass_kg}
                  onChange={event => setForm((current: any) => ({ ...current, reference_average_mass_kg: event.target.value }))} />
              </label>
              <label className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                Source / provenance
                <textarea className={`${inputCls} mt-1 min-h-20`} value={form.source}
                  onChange={event => setForm((current: any) => ({ ...current, source: event.target.value }))} />
              </label>
              <label className="flex items-center gap-2 text-sm text-stone-600 sm:col-span-2">
                <input type="checkbox" checked={form.active} onChange={event => setForm((current: any) => ({ ...current, active: event.target.checked }))} />
                Active and available for new exhibit allocations
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded-lg border border-stone-200 px-4 py-2 text-sm text-stone-600">Cancel</button>
              <button onClick={save} disabled={saving} className="flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                <Check className="h-4 w-4" /> {saving ? 'Saving…' : 'Save catalog record'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/35 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-stone-800">Staged JSON import</h2>
              <button onClick={() => setShowImport(false)}><X className="h-5 w-5 text-stone-400" /></button>
            </div>
            <p className="mb-3 text-xs text-stone-500">
              Paste an array of records with scientific_name, common_name, family, water_type, average_size_cm,
              reference_average_mass_kg, source, and optional active. The whole batch is validated before import.
            </p>
            <textarea className={`${inputCls} min-h-64 font-mono text-xs`} value={importText} onChange={event => setImportText(event.target.value)}
              placeholder={'[{"scientific_name":"Example species","family":"Exampleidae","water_type":"Marine","average_size_cm":20,"reference_average_mass_kg":0.4,"source":"Institutional reference"}]'} />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowImport(false)} className="rounded-lg border border-stone-200 px-4 py-2 text-sm">Cancel</button>
              <button onClick={importRecords} disabled={importing || !importText.trim()} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {importing ? 'Importing…' : 'Validate and import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}