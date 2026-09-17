import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RotateCcw, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';

export const BIO_CRATE_MEDIA_CAPACITY_M3 = 0.238;
export const BIO_CRATE_LENGTH_MM = 1040;
export const BIO_CRATE_WIDTH_MM = 740;
export const BIO_CRATE_HEIGHT_MM = 530;
export const BIO_CRATE_MAX_STACK = 4;
export const PLENUM_LIMITS = { length: 9000, width: 2250, height: 2500, minWall: 80 };
export const DISPERSION_TRAY = { length: 3405, width: 2005, height: 620 };
export const ACCESS_LENGTH_MM = 800;
export const TRAY_GAP_MM = 100;

export type PlenumLayout = {
  external_length_mm: number;
  external_width_mm: number;
  external_height_mm: number;
  wall_thickness_mm: number;
  rows: number;
  stack_height: number;
  water_level_mm: number;
  source_crate_count: number;
  stacks?: Array<{ row: number; column: number; quantity: number }>;
};

export function calculateBioCrateCount(mediaVolumeM3: unknown) {
  const volume = Number(mediaVolumeM3);
  return Number.isFinite(volume) && volume > 0 ? Math.ceil(volume / BIO_CRATE_MEDIA_CAPACITY_M3) : null;
}

export function createRecommendedPlenumLayout(crateCount: number): PlenumLayout {
  const wall = 80;
  const stack = 3;
  const positions = Math.ceil(crateCount / stack);
  const candidates = [1, 2].map(rows => {
    const columns = Math.ceil(positions / rows);
    const length = Math.max(DISPERSION_TRAY.length, columns * BIO_CRATE_WIDTH_MM + ACCESS_LENGTH_MM + wall * 2);
    const width = Math.max(DISPERSION_TRAY.width, rows * BIO_CRATE_LENGTH_MM + wall * 2);
    return { rows, length, width, area: length * width };
  }).filter(item => item.length <= PLENUM_LIMITS.length && item.width <= PLENUM_LIMITS.width)
    .sort((a, b) => a.area - b.area || a.length - b.length || a.rows - b.rows);
  const selected = candidates[0] || { rows: 2, length: PLENUM_LIMITS.length, width: PLENUM_LIMITS.width };
  const height = Math.min(PLENUM_LIMITS.height, wall + stack * BIO_CRATE_HEIGHT_MM + TRAY_GAP_MM + DISPERSION_TRAY.height);
  const layout: PlenumLayout = {
    external_length_mm: selected.length,
    external_width_mm: selected.width,
    external_height_mm: height,
    wall_thickness_mm: wall,
    rows: selected.rows,
    stack_height: stack,
    water_level_mm: stack * BIO_CRATE_HEIGHT_MM,
    source_crate_count: crateCount,
  };
  layout.stacks = createStackPositions(crateCount, layout.rows, layout.stack_height);
  return layout;
}

function createStackPositions(crateCount: number, rows: number, stackHeight: number) {
  return Array.from({ length: Math.ceil(crateCount / stackHeight) }, (_, index) => ({
    row: index % rows,
    column: Math.floor(index / rows),
    quantity: Math.min(stackHeight, crateCount - index * stackHeight),
  }));
}

export function assessPlenumLayout(layout: PlenumLayout, crateCount: number) {
  const wall = Number(layout.wall_thickness_mm);
  const internalLength = layout.external_length_mm - wall * 2;
  const internalWidth = layout.external_width_mm - wall * 2;
  const internalHeight = layout.external_height_mm - wall;
  const crateLengthCapacity = Math.max(0, Math.floor((internalLength - ACCESS_LENGTH_MM) / BIO_CRATE_WIDTH_MM));
  const crateWidthCapacity = Math.max(0, Math.floor(internalWidth / BIO_CRATE_LENGTH_MM));
  const rows = Math.max(1, Math.min(layout.rows, crateWidthCapacity));
  const positions = crateLengthCapacity * rows;
  const verticalAvailable = internalHeight - DISPERSION_TRAY.height - TRAY_GAP_MM;
  const verticalCapacity = Math.max(0, Math.min(BIO_CRATE_MAX_STACK, Math.floor(verticalAvailable / BIO_CRATE_HEIGHT_MM)));
  const capacity = positions * Math.min(layout.stack_height, verticalCapacity);
  const errors: string[] = [];
  const stacks = layout.stacks || createStackPositions(crateCount, layout.rows, layout.stack_height);
  const duplicatePositions = new Set<string>();
  let hasDuplicate = false;
  stacks.forEach(item => {
    const key = `${item.row}:${item.column}`;
    if (duplicatePositions.has(key)) hasDuplicate = true;
    duplicatePositions.add(key);
  });
  if (wall < PLENUM_LIMITS.minWall) errors.push('Wall thickness must be at least 80 mm.');
  if (layout.external_length_mm > PLENUM_LIMITS.length || layout.external_width_mm > PLENUM_LIMITS.width || layout.external_height_mm > PLENUM_LIMITS.height) errors.push('Tank exceeds the 40 ft transport envelope.');
  if (layout.external_length_mm < DISPERSION_TRAY.length || layout.external_width_mm < DISPERSION_TRAY.width) errors.push('Tank is smaller than the dispersion tray.');
  if (layout.stack_height > verticalCapacity) errors.push(`Only ${verticalCapacity} crate layers fit below the tray with 100 mm clearance.`);
  if (capacity < crateCount) errors.push(`Layout holds ${capacity} of ${crateCount} required crates.`);
  if (stacks.some(item => !Number.isInteger(item.row) || !Number.isInteger(item.column) || item.row < 0 || item.row >= rows
      || item.column < 0 || item.column >= crateLengthCapacity)) errors.push('Every crate stack must remain inside the available tank grid.');
  if (hasDuplicate) errors.push('Two crate stacks cannot occupy the same top-view position.');
  const selectedStackLimit = Math.min(layout.stack_height, verticalCapacity);
  if (stacks.some(item => !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > selectedStackLimit)) errors.push(`Each stack must contain between 1 and ${selectedStackLimit} crates.`);
  const arrangedCrates = stacks.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  if (arrangedCrates !== crateCount) errors.push(`Stack quantities account for ${arrangedCrates} of ${crateCount} required crates.`);
  if (layout.water_level_mm < 0 || layout.water_level_mm > internalHeight) errors.push('Water level must remain inside the tank.');
  return { internalLength, internalWidth, internalHeight, crateLengthCapacity, crateWidthCapacity, rows, positions, verticalCapacity, capacity, verticalAvailable, arrangedCrates, errors };
}

export function calculateBioCrateSpatialBasis(crateCount: unknown) {
  const count = Number(crateCount);
  if (!Number.isInteger(count) || count <= 0) return null;
  const stackPositions = Math.ceil(count / BIO_CRATE_MAX_STACK);
  return {
    stack_positions: stackPositions,
    crate_only_footprint_m2: Number((stackPositions * 1.04 * 0.74).toFixed(6)),
    tallest_stack_crates: Math.min(count, BIO_CRATE_MAX_STACK),
    tallest_stack_height_m: Math.min(count, BIO_CRATE_MAX_STACK) * 0.53,
  };
}

const number = (value: any) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function BioDegasPlenumPanel({ data, systemId, bookId, readOnly = false }: { data: any; systemId?: string; bookId?: string; readOnly?: boolean }) {
  const preview = data?.preview;
  const installedMediaM3 = Number.isFinite(Number(preview?.media?.installed_media_m3)) ? Number(preview.media.installed_media_m3)
    : Number.isFinite(Number(preview?.media?.installed_media_l)) ? Number(preview.media.installed_media_l) / 1000
      : Number.isFinite(Number(preview?.media?.required_media_m3)) ? Number(preview.media.required_media_m3)
        : Number.isFinite(Number(preview?.media?.required_media_l)) ? Number(preview.media.required_media_l) / 1000 : null;
  const crateCount = calculateBioCrateCount(installedMediaM3);
  const { data: saved, refetch } = useQuery({
    queryKey: ['bio-degas-plenum-layout', systemId, bookId],
    queryFn: () => api.get(`/systems/${systemId}/bio-degas-plenum`, { params: { design_book_id: bookId } }).then(r => r.data),
    enabled: Boolean(systemId && bookId && crateCount),
  });
  const recommended = useMemo(() => crateCount ? createRecommendedPlenumLayout(crateCount) : null, [crateCount]);
  const [layout, setLayout] = useState<PlenumLayout | null>(recommended);
  useEffect(() => {
    if (!recommended) return;
    const next = saved?.layout ? { ...recommended, ...saved.layout } : recommended;
    setLayout({ ...next, stacks: next.stacks || createStackPositions(crateCount, next.rows, next.stack_height) });
  }, [saved, recommended]);
  if (!crateCount || !layout) return <div className="rounded-xl border border-dashed border-stone-300 bg-white p-10 text-center"><p className="font-semibold text-stone-700">Calculate Biological Media first</p><p className="mt-1 text-sm text-stone-500">A current media-volume result is required before the plenum can be designed.</p></div>;

  const assessment = assessPlenumLayout(layout, crateCount);
  const positions = (layout.stacks || createStackPositions(crateCount, layout.rows, layout.stack_height))
    .map(item => ({ ...item, crates: item.quantity }));
  const stale = Boolean(preview?.is_stale || saved?.source_crate_count != null && saved.source_crate_count !== crateCount);
  const set = (key: keyof PlenumLayout, value: number) => setLayout(current => {
    if (!current) return current;
    if (key === 'rows' || key === 'stack_height') {
      const rows = key === 'rows' ? value : current.rows;
      const stackHeight = key === 'stack_height' ? value : current.stack_height;
      return { ...current, [key]: value, stacks: createStackPositions(crateCount, rows, stackHeight) };
    }
    return { ...current, [key]: value };
  });
  const updateStack = (index: number, key: 'row' | 'column' | 'quantity', value: number) =>
    setLayout(current => current ? {
      ...current,
      stacks: (current.stacks || []).map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item),
    } : current);
  const save = async () => {
    if (assessment.errors.length) return toast.error('Resolve the layout errors before saving.');
    if (stale) return toast.error('Recalculate Biological Media before saving this layout.');
    try {
      await api.put(`/systems/${systemId}/bio-degas-plenum`, { design_book_id: bookId, layout: { ...layout, source_crate_count: crateCount } });
      await refetch();
      toast.success('Bio/Degas plenum layout saved');
    } catch (error: any) { toast.error(error?.response?.data?.error?.message || 'Could not save plenum layout'); }
  };
  const fields: Array<[Exclude<keyof PlenumLayout, 'stacks'>, string, number, number]> = [
    ['external_length_mm', 'External length', DISPERSION_TRAY.length, PLENUM_LIMITS.length],
    ['external_width_mm', 'External width', DISPERSION_TRAY.width, PLENUM_LIMITS.width],
    ['external_height_mm', 'External height', 1500, PLENUM_LIMITS.height],
    ['wall_thickness_mm', 'Wall thickness', PLENUM_LIMITS.minWall, 250],
    ['water_level_mm', 'Water level', 0, assessment.internalHeight],
  ];

  const topW = 720, topH = 300, pad = 28;
  const sx = (topW - pad * 2) / layout.external_length_mm;
  const sy = (topH - pad * 2) / layout.external_width_mm;
  const scale = Math.min(sx, sy), drawW = layout.external_length_mm * scale, drawH = layout.external_width_mm * scale;
  const ox = (topW - drawW) / 2, oy = (topH - drawH) / 2, wallPx = layout.wall_thickness_mm * scale;
  const sectionW = 720, sectionH = 300, ss = Math.min((sectionW - 56) / layout.external_length_mm, (sectionH - 42) / layout.external_height_mm);
  const sw = layout.external_length_mm * ss, sh = layout.external_height_mm * ss, sox = (sectionW - sw) / 2, soy = sectionH - 22 - sh;
  const tallestArrangedStack = Math.max(0, ...positions.map(position => position.crates));

  return <div id="bio-degas-plenum" className="space-y-5">
    <section className="rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-stone-900">Interactive Bio/Degas plenum designer</h2><p className="mt-1 text-sm text-stone-500">{crateCount} crates required · {number(installedMediaM3).toFixed(3)} m³ media · default three-high arrangement</p></div><div className="flex gap-2"><button type="button" disabled={readOnly} onClick={() => setLayout(recommended)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"><RotateCcw className="h-4 w-4"/> Recommended</button><button type="button" disabled={readOnly || stale || assessment.errors.length > 0} onClick={save} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4"/> Save layout</button></div></div>
      {stale && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">The Biological Media result is stale. Recalculate it before saving; the last saved layout is preserved.</div>}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{fields.map(([key,label,min,max]) => <label key={key} className="text-xs font-semibold text-stone-600">{label} (mm)<input aria-label={`${label} (mm)`} type="number" disabled={readOnly} min={min} max={max} value={layout[key]} onChange={e => set(key, Number(e.target.value))} className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 font-mono text-sm"/></label>)}</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-stone-600">Rows across tank<select aria-label="Rows across tank" disabled={readOnly} value={layout.rows} onChange={e => set('rows', Number(e.target.value))} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"><option value={1}>1 row</option><option value={2}>2 rows</option></select></label><label className="text-xs font-semibold text-stone-600">Crates per stack<select aria-label="Crates per stack" disabled={readOnly} value={layout.stack_height} onChange={e => set('stack_height', Number(e.target.value))} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">{[1,2,3,4].map(v=><option key={v} value={v}>{v}</option>)}</select></label></div>
      <details className="mt-4 rounded-lg border border-stone-200">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-stone-700">Adjust individual stack positions and quantities</summary>
        <div className="max-h-64 overflow-auto border-t p-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{positions.map((position, index) => <fieldset key={index} className="grid grid-cols-3 gap-2 rounded-lg bg-stone-50 p-2">
            <legend className="px-1 text-xs font-semibold text-stone-500">Stack {index + 1}</legend>
            {([['row','Row',position.row],['column','Column',position.column],['quantity','Crates',position.crates]] as const).map(([key,label,value]) => <label key={key} className="text-[11px] text-stone-500">{label}<input aria-label={`${label} for stack ${index + 1}`} type="number" min={key === 'quantity' ? 1 : 0} max={key === 'row' ? layout.rows - 1 : key === 'column' ? Math.max(0, assessment.crateLengthCapacity - 1) : assessment.verticalCapacity} disabled={readOnly} value={value} onChange={event => updateStack(index, key, Number(event.target.value))} className="mt-0.5 w-full rounded border px-2 py-1 font-mono text-xs text-stone-800"/></label>)}
          </fieldset>)}</div>
        </div>
      </details>
      {!!assessment.errors.length && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><ul className="list-disc space-y-1 pl-5">{assessment.errors.map(error=><li key={error}>{error}</li>)}</ul></div>}
    </section>
    <div className="grid gap-5 xl:grid-cols-2">
      <figure className="overflow-hidden rounded-xl border border-stone-200 bg-white"><figcaption className="border-b bg-stone-50 px-4 py-3 font-semibold text-stone-800">Top view</figcaption><svg viewBox={`0 0 ${topW} ${topH}`} role="img" aria-label="Dynamic top view of plenum tank" className="h-auto w-full bg-slate-50">
        <rect x={ox} y={oy} width={drawW} height={drawH} rx="6" fill="#dbeafe" stroke="#1e3a5f" strokeWidth="3"/>
        <rect x={ox+wallPx} y={oy+wallPx} width={drawW-wallPx*2} height={drawH-wallPx*2} fill="#f8fafc" stroke="#64748b"/>
        <rect x={ox+wallPx} y={oy+wallPx} width={ACCESS_LENGTH_MM*scale} height={drawH-wallPx*2} fill="#fef3c7" stroke="#d97706" strokeDasharray="5 4"/>
        <text x={ox+wallPx+ACCESS_LENGTH_MM*scale/2} y={oy+drawH/2} textAnchor="middle" fontSize="10" fill="#92400e" transform={`rotate(-90 ${ox+wallPx+ACCESS_LENGTH_MM*scale/2} ${oy+drawH/2})`}>800 mm access</text>
        {positions.map((p,i) => { const x=ox+wallPx+(ACCESS_LENGTH_MM+p.column*BIO_CRATE_WIDTH_MM)*scale; const y=oy+wallPx+p.row*BIO_CRATE_LENGTH_MM*scale; return <g key={i}><rect x={x+2} y={y+2} width={BIO_CRATE_WIDTH_MM*scale-4} height={BIO_CRATE_LENGTH_MM*scale-4} rx="3" fill="#bfdbfe" stroke="#2563eb"/><text x={x+BIO_CRATE_WIDTH_MM*scale/2} y={y+BIO_CRATE_LENGTH_MM*scale/2+4} textAnchor="middle" fontSize="11" fill="#1e3a8a">×{p.crates}</text></g>; })}
        <rect x={ox+(drawW-DISPERSION_TRAY.length*scale)/2} y={oy+(drawH-DISPERSION_TRAY.width*scale)/2} width={DISPERSION_TRAY.length*scale} height={DISPERSION_TRAY.width*scale} fill="none" stroke="#7c3aed" strokeWidth="2" strokeDasharray="7 4"/>
        <text x={topW/2} y={oy+14} textAnchor="middle" fontSize="10" fill="#6d28d9">Dispersion tray 3405 × 2005</text>
        <text x={topW/2} y={topH-5} textAnchor="middle" fontSize="11" fill="#334155">{layout.external_length_mm} mm external length</text>
      </svg></figure>
      <figure className="overflow-hidden rounded-xl border border-stone-200 bg-white"><figcaption className="border-b bg-stone-50 px-4 py-3 font-semibold text-stone-800">Section view</figcaption><svg viewBox={`0 0 ${sectionW} ${sectionH}`} role="img" aria-label="Dynamic section view of plenum tank" className="h-auto w-full bg-slate-50">
        <rect x={sox} y={soy} width={sw} height={sh} fill="#eff6ff" stroke="#1e3a5f" strokeWidth="3"/>
        <rect x={sox} y={soy} width={sw} height={DISPERSION_TRAY.height*ss} fill="#ddd6fe" stroke="#7c3aed"/><text x={sectionW/2} y={soy+DISPERSION_TRAY.height*ss/2} textAnchor="middle" fontSize="11" fill="#5b21b6">620 mm dispersion tray</text>
        <rect x={sox+layout.wall_thickness_mm*ss} y={soy+sh-layout.wall_thickness_mm*ss-layout.water_level_mm*ss} width={sw-layout.wall_thickness_mm*ss*2} height={layout.water_level_mm*ss} fill="#38bdf8" opacity=".25"/>
        {Array.from({length:tallestArrangedStack},(_,level)=><rect key={level} x={sox+(layout.wall_thickness_mm+ACCESS_LENGTH_MM)*ss} y={soy+sh-layout.wall_thickness_mm*ss-(level+1)*BIO_CRATE_HEIGHT_MM*ss} width={Math.min(assessment.crateLengthCapacity*BIO_CRATE_WIDTH_MM*ss, sw-(layout.wall_thickness_mm*2+ACCESS_LENGTH_MM)*ss)} height={BIO_CRATE_HEIGHT_MM*ss-2} fill="#bfdbfe" stroke="#2563eb"/>)}
        <line x1={sox} y1={soy+DISPERSION_TRAY.height*ss+TRAY_GAP_MM*ss} x2={sox+sw} y2={soy+DISPERSION_TRAY.height*ss+TRAY_GAP_MM*ss} stroke="#dc2626" strokeDasharray="5 4"/><text x={sox+sw-4} y={soy+DISPERSION_TRAY.height*ss+TRAY_GAP_MM*ss-4} textAnchor="end" fontSize="10" fill="#b91c1c">100 mm min gap</text>
        <text x={sectionW/2} y={sectionH-5} textAnchor="middle" fontSize="11" fill="#334155">{layout.external_length_mm} mm linked length · tallest arranged stack {tallestArrangedStack}</text>
      </svg></figure>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['Internal size',`${assessment.internalLength} × ${assessment.internalWidth} × ${assessment.internalHeight} mm`],['Layout capacity',`${assessment.capacity} crates`],['Required crates',crateCount],['Clear height below tray',`${assessment.verticalAvailable} mm`]].map(([label,value])=><div key={String(label)} className="rounded-xl border border-stone-200 bg-white p-4"><div className="text-xs text-stone-500">{label}</div><div className="mt-1 font-mono font-semibold text-stone-900">{value}</div></div>)}</div>
  </div>;
}
