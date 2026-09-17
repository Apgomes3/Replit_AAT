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
  tray_gap_mm: number;
  tray_count: number;
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
    const length = Math.max(
      DISPERSION_TRAY.length + ACCESS_LENGTH_MM + wall * 2,
      columns * BIO_CRATE_WIDTH_MM + ACCESS_LENGTH_MM + wall * 2,
    );
    const width = Math.max(
      DISPERSION_TRAY.width + wall * 2,
      rows * BIO_CRATE_LENGTH_MM + wall * 2,
    );
    return { rows, length, width, area: length * width };
  }).filter(item => item.length <= PLENUM_LIMITS.length && item.width <= PLENUM_LIMITS.width)
    .sort((a, b) => a.area - b.area || a.length - b.length || a.rows - b.rows);
  const selected = candidates[0] || { rows: 2, length: PLENUM_LIMITS.length, width: PLENUM_LIMITS.width };
  const internalLength = selected.length - wall * 2;
  const internalWidth = selected.width - wall * 2;
  const trayCount = internalWidth >= DISPERSION_TRAY.width
    && internalLength - ACCESS_LENGTH_MM >= DISPERSION_TRAY.length * 2 ? 2 : 1;
  const height = Math.min(PLENUM_LIMITS.height, wall + stack * BIO_CRATE_HEIGHT_MM + TRAY_GAP_MM + DISPERSION_TRAY.height);
  const layout: PlenumLayout = {
    external_length_mm: selected.length,
    external_width_mm: selected.width,
    external_height_mm: height,
    wall_thickness_mm: wall,
    rows: selected.rows,
    stack_height: stack,
    water_level_mm: stack * BIO_CRATE_HEIGHT_MM,
    tray_gap_mm: TRAY_GAP_MM,
    tray_count: trayCount,
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
  const trayGap = Number(layout.tray_gap_mm ?? TRAY_GAP_MM);
  const trayCount = Number(layout.tray_count ?? 1);
  const crateLengthCapacity = Math.max(0, Math.floor((internalLength - ACCESS_LENGTH_MM) / BIO_CRATE_WIDTH_MM));
  const crateWidthCapacity = Math.max(0, Math.floor(internalWidth / BIO_CRATE_LENGTH_MM));
  const rows = Math.max(1, Math.min(layout.rows, crateWidthCapacity));
  const positions = crateLengthCapacity * rows;
  const verticalAvailable = internalHeight - DISPERSION_TRAY.height - trayGap;
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
  if (![1, 2].includes(trayCount) || !Number.isInteger(trayCount)) errors.push('Use one or two dispersion trays.');
  if (internalWidth < DISPERSION_TRAY.width || internalLength - ACCESS_LENGTH_MM < DISPERSION_TRAY.length * trayCount) errors.push(`${trayCount === 2 ? 'Two dispersion trays do' : 'The dispersion tray does'} not fit inside the usable internal tank envelope.`);
  if (trayGap < TRAY_GAP_MM) errors.push('Tray-to-crate gap cannot be below 100 mm.');
  if (layout.stack_height > verticalCapacity) errors.push(`Only ${verticalCapacity} crate layers fit with the selected tray-to-crate gap.`);
  if (capacity < crateCount) errors.push(`Layout holds ${capacity} of ${crateCount} required crates.`);
  if (stacks.some(item => !Number.isInteger(item.row) || !Number.isInteger(item.column) || item.row < 0 || item.row >= rows
      || item.column < 0 || item.column >= crateLengthCapacity)) errors.push('Every crate stack must remain inside the available tank grid.');
  if (hasDuplicate) errors.push('Two crate stacks cannot occupy the same top-view position.');
  const selectedStackLimit = Math.min(layout.stack_height, verticalCapacity);
  if (stacks.some(item => !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > selectedStackLimit)) errors.push(`Each stack must contain between 1 and ${selectedStackLimit} crates.`);
  const arrangedCrates = stacks.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  if (arrangedCrates !== crateCount) errors.push(`Stack quantities account for ${arrangedCrates} of ${crateCount} required crates.`);
  if (layout.water_level_mm < 0 || layout.water_level_mm > internalHeight) errors.push('Water level must remain inside the tank.');
  return { internalLength, internalWidth, internalHeight, trayGap, trayCount, crateLengthCapacity, crateWidthCapacity, rows, positions, verticalCapacity, capacity, verticalAvailable, arrangedCrates, errors };
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
  const [sectionColumn, setSectionColumn] = useState(0);
  const [selectedStackNumber, setSelectedStackNumber] = useState<number | null>(null);
  const [editingDimension, setEditingDimension] = useState<keyof Pick<PlenumLayout, 'external_length_mm' | 'external_width_mm' | 'external_height_mm' | 'water_level_mm' | 'tray_gap_mm'> | null>(null);
  useEffect(() => {
    if (!recommended) return;
    const next = saved?.layout ? { ...recommended, ...saved.layout } : recommended;
    setLayout({ ...next, stacks: next.stacks || createStackPositions(crateCount, next.rows, next.stack_height) });
  }, [saved, recommended]);
  if (!crateCount || !layout) return <div className="rounded-xl border border-dashed border-stone-300 bg-white p-10 text-center"><p className="font-semibold text-stone-700">Calculate Biological Media first</p><p className="mt-1 text-sm text-stone-500">A current media-volume result is required before the plenum can be designed.</p></div>;

  const assessment = assessPlenumLayout(layout, crateCount);
  const positions = (layout.stacks || createStackPositions(crateCount, layout.rows, layout.stack_height))
    .map((item, index) => ({ ...item, crates: item.quantity, stackNumber: index + 1 }));
  const stale = Boolean(preview?.is_stale || saved?.source_crate_count != null && saved.source_crate_count !== crateCount);
  const set = (key: keyof PlenumLayout, value: number) => setLayout(current => {
    if (!current) return current;
    if (key === 'rows' || key === 'stack_height') {
      const rows = key === 'rows' ? value : current.rows;
      const stackHeight = key === 'stack_height' ? value : current.stack_height;
      return { ...current, [key]: value, stacks: createStackPositions(crateCount, rows, stackHeight) };
    }
    const next = { ...current, [key]: value };
    if (key === 'external_length_mm' || key === 'external_width_mm' || key === 'wall_thickness_mm') {
      const nextInternalLength = next.external_length_mm - next.wall_thickness_mm * 2;
      const nextInternalWidth = next.external_width_mm - next.wall_thickness_mm * 2;
      next.tray_count = nextInternalWidth >= DISPERSION_TRAY.width
        && nextInternalLength - ACCESS_LENGTH_MM >= DISPERSION_TRAY.length * 2 ? 2 : 1;
    }
    return next;
  });
  const setTrayGap = (value: number) => setLayout(current => {
    if (!current) return current;
    const currentGap = Number(current.tray_gap_mm ?? TRAY_GAP_MM);
    const nextHeight = Math.min(PLENUM_LIMITS.height, Math.max(1500, current.external_height_mm + value - currentGap));
    return { ...current, tray_gap_mm: value, external_height_mm: nextHeight };
  });
  const updateStack = (index: number, key: 'row' | 'column' | 'quantity', value: number) =>
    setLayout(current => current ? {
      ...current,
      stacks: (current.stacks || []).map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item),
    } : current);
  const selectStack = (stackNumber: number, row: number) => {
    setSelectedStackNumber(stackNumber);
    setSectionColumn(row);
  };
  const dimensionControl = (
    key: 'external_length_mm' | 'external_width_mm' | 'external_height_mm' | 'water_level_mm',
    label: string,
    x: number,
    y: number,
    min: number,
    max: number,
    vertical = false,
  ) => editingDimension === key && !readOnly
    ? <foreignObject x={vertical ? Math.min(580, Math.max(2, x - 68)) : x - 68} y={y - 15} width="136" height="30">
        <input
          autoFocus
          aria-label={`${label} (mm)`}
          type="number"
          min={min}
          max={max}
          value={layout[key]}
          onChange={event => set(key, Number(event.target.value))}
          onBlur={() => setEditingDimension(null)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.preventDefault();
              setEditingDimension(null);
            }
          }}
          className="h-7 w-full rounded-md border border-blue-500 bg-white px-2 text-center font-mono text-[11px] font-semibold text-slate-800 shadow-md outline-none ring-2 ring-blue-200"
        />
      </foreignObject>
    : <g
        role="button"
        tabIndex={readOnly ? -1 : 0}
        aria-label={`Edit ${label.toLowerCase()}, currently ${layout[key]} mm`}
        onClick={() => !readOnly && setEditingDimension(key)}
        onKeyDown={event => {
          if (!readOnly && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            setEditingDimension(key);
          }
        }}
        className={readOnly ? '' : 'cursor-pointer'}
        transform={vertical ? `rotate(-90 ${x} ${y})` : undefined}
      >
        <rect x={x - 68} y={y - 13} width="136" height="26" rx="6" fill="#ffffff" stroke="#94a3b8"/>
        <text x={x} y={y + 4} textAnchor="middle" fontSize="10" fontWeight="600" fill="#334155">
          {label} {layout[key]} mm
        </text>
      </g>;
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

  const topW = 720, topH = 300, pad = 28, topRightGutter = 76;
  const sx = (topW - pad - topRightGutter) / layout.external_length_mm;
  const sy = (topH - pad * 2) / layout.external_width_mm;
  const scale = Math.min(sx, sy), drawW = layout.external_length_mm * scale, drawH = layout.external_width_mm * scale;
  const ox = pad, oy = (topH - drawH) / 2, wallPx = layout.wall_thickness_mm * scale;
  const sectionW = 720, sectionH = 300, sectionLeftGutter = 76, sectionRightGutter = 76;
  const ss = Math.min((sectionW - sectionLeftGutter - sectionRightGutter) / layout.external_length_mm, (sectionH - 42) / layout.external_height_mm);
  const sw = layout.external_length_mm * ss, sh = layout.external_height_mm * ss, sox = sectionLeftGutter, soy = sectionH - 22 - sh;
  const tallestArrangedStack = Math.max(0, ...positions.map(position => position.crates));
  const trayCount = Number(layout.tray_count ?? 1);
  const trayGap = Number(layout.tray_gap_mm ?? TRAY_GAP_MM);
  const usableTrayLength = assessment.internalLength - ACCESS_LENGTH_MM;
  const trayStartMm = layout.wall_thickness_mm + ACCESS_LENGTH_MM
    + Math.max(0, (usableTrayLength - trayCount * DISPERSION_TRAY.length) / 2);
  const trayTopY = oy + wallPx + Math.max(0, (assessment.internalWidth - DISPERSION_TRAY.width) * scale / 2);
  const actualCrateGap = Math.max(0, assessment.internalHeight - DISPERSION_TRAY.height - tallestArrangedStack * BIO_CRATE_HEIGHT_MM);
  const waterBottomY = soy + sh - layout.wall_thickness_mm * ss;
  const waterTopY = waterBottomY - layout.water_level_mm * ss;

  return <div id="bio-degas-plenum" className="space-y-5">
    <section className="rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-stone-900">Interactive Bio/Degas plenum designer</h2><p className="mt-1 text-sm text-stone-500">{crateCount} crates required · {number(installedMediaM3).toFixed(3)} m³ media · default three-high arrangement</p></div><div className="flex gap-2"><button type="button" disabled={readOnly} onClick={() => setLayout(recommended)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"><RotateCcw className="h-4 w-4"/> Recommended</button><button type="button" disabled={readOnly || stale || assessment.errors.length > 0} onClick={save} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4"/> Save layout</button></div></div>
      {stale && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">The Biological Media result is stale. Recalculate it before saving; the last saved layout is preserved.</div>}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{fields.map(([key,label,min,max]) => <label key={key} className="text-xs font-semibold text-stone-600">{label} (mm)<input aria-label={`${label} (mm)`} type="number" disabled={readOnly} min={min} max={max} value={layout[key]} onChange={e => set(key, Number(e.target.value))} className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 font-mono text-sm"/></label>)}</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-stone-600">Rows across tank<select aria-label="Rows across tank" disabled={readOnly} value={layout.rows} onChange={e => set('rows', Number(e.target.value))} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"><option value={1}>1 row</option><option value={2}>2 rows</option></select></label><label className="text-xs font-semibold text-stone-600">Crates per stack<select aria-label="Crates per stack" disabled={readOnly} value={layout.stack_height} onChange={e => set('stack_height', Number(e.target.value))} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">{[1,2,3,4].map(v=><option key={v} value={v}>{v}</option>)}</select></label></div>
      <details className="mt-4 rounded-lg border border-stone-200">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-stone-700">Adjust individual stack positions and quantities</summary>
        <div className="max-h-64 overflow-auto border-t p-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{positions.map((position, index) => <fieldset key={index} onClick={() => selectStack(position.stackNumber, position.row)} className={`grid grid-cols-3 gap-2 rounded-lg p-2 transition ${selectedStackNumber === position.stackNumber ? 'bg-blue-50 ring-2 ring-blue-500' : 'bg-stone-50'}`}>
            <legend className="px-1 text-xs font-semibold text-stone-500">S{String(position.stackNumber).padStart(2, '0')} · Column {position.row + 1}</legend>
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
        {positions.map((p,i) => { const x=ox+wallPx+(ACCESS_LENGTH_MM+p.column*BIO_CRATE_WIDTH_MM)*scale; const y=oy+wallPx+p.row*BIO_CRATE_LENGTH_MM*scale; const selected=selectedStackNumber===p.stackNumber; return <g key={i} role="button" tabIndex={0} aria-label={`Select stack S${String(p.stackNumber).padStart(2, '0')}`} onClick={() => selectStack(p.stackNumber,p.row)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') selectStack(p.stackNumber,p.row); }}><rect x={x+2} y={y+2} width={BIO_CRATE_WIDTH_MM*scale-4} height={BIO_CRATE_LENGTH_MM*scale-4} rx="3" fill={selected?'#93c5fd':'#bfdbfe'} stroke={selected?'#1d4ed8':'#2563eb'} strokeWidth={selected?3:1}/><text x={x+BIO_CRATE_WIDTH_MM*scale/2} y={y+BIO_CRATE_LENGTH_MM*scale/2+4} textAnchor="middle" fontSize="10" fontWeight="600" fill="#1e3a8a">S{String(p.stackNumber).padStart(2,'0')} ×{p.crates}</text></g>; })}
        {Array.from({length:trayCount},(_,index)=><g key={index}>
          <rect x={ox+(trayStartMm+index*DISPERSION_TRAY.length)*scale} y={trayTopY} width={DISPERSION_TRAY.length*scale} height={DISPERSION_TRAY.width*scale} fill="none" stroke="#7c3aed" strokeWidth="2" strokeDasharray="7 4"/>
          <text x={ox+(trayStartMm+(index+.5)*DISPERSION_TRAY.length)*scale} y={trayTopY+13} textAnchor="middle" fontSize="9" fill="#6d28d9">Tray {index+1} · 3405 × 2005</text>
        </g>)}
        <line x1={ox} y1={topH-25} x2={ox+drawW} y2={topH-25} stroke="#64748b"/>
        <line x1={ox} y1={topH-30} x2={ox} y2={topH-20} stroke="#64748b"/>
        <line x1={ox+drawW} y1={topH-30} x2={ox+drawW} y2={topH-20} stroke="#64748b"/>
        {dimensionControl('external_length_mm', 'Length', topW/2, topH-25, DISPERSION_TRAY.length, PLENUM_LIMITS.length)}
        <line x1={ox+drawW+18} y1={oy} x2={ox+drawW+18} y2={oy+drawH} stroke="#64748b"/>
        <line x1={ox+drawW+13} y1={oy} x2={ox+drawW+23} y2={oy} stroke="#64748b"/>
        <line x1={ox+drawW+13} y1={oy+drawH} x2={ox+drawW+23} y2={oy+drawH} stroke="#64748b"/>
        {dimensionControl('external_width_mm', 'Width', ox+drawW+46, oy+drawH/2, DISPERSION_TRAY.width, PLENUM_LIMITS.width, true)}
      </svg></figure>
      <figure className="overflow-hidden rounded-xl border border-stone-200 bg-white"><figcaption className="flex flex-wrap items-center justify-between gap-2 border-b bg-stone-50 px-4 py-2"><span className="font-semibold text-stone-800">Section view</span><span className="inline-flex rounded-lg border border-stone-200 bg-white p-1" aria-label="Section column">{Array.from({length:layout.rows},(_,row)=><button key={row} type="button" onClick={()=>setSectionColumn(row)} className={`rounded-md px-3 py-1 text-xs font-semibold transition ${sectionColumn===row?'bg-blue-600 text-white shadow-sm':'text-stone-600 hover:bg-stone-100'}`}>Column {row+1}</button>)}</span></figcaption><svg viewBox={`0 0 ${sectionW} ${sectionH}`} role="img" aria-label={`Dynamic section view of plenum tank, column ${sectionColumn + 1}`} className="h-auto w-full bg-slate-50">
        <rect x={sox} y={soy} width={sw} height={sh} fill="#eff6ff" stroke="#1e3a5f" strokeWidth="3"/>
        {Array.from({length:trayCount},(_,index)=><g key={index}>
          <rect x={sox+(trayStartMm+index*DISPERSION_TRAY.length)*ss} y={soy} width={DISPERSION_TRAY.length*ss} height={DISPERSION_TRAY.height*ss} fill="#ddd6fe" stroke="#7c3aed"/>
          <text x={sox+(trayStartMm+(index+.5)*DISPERSION_TRAY.length)*ss} y={soy+DISPERSION_TRAY.height*ss/2} textAnchor="middle" fontSize="9" fill="#5b21b6">Tray {index+1}</text>
        </g>)}
        <rect x={sox+layout.wall_thickness_mm*ss} y={soy+sh-layout.wall_thickness_mm*ss-layout.water_level_mm*ss} width={sw-layout.wall_thickness_mm*ss*2} height={layout.water_level_mm*ss} fill="#38bdf8" opacity=".25"/>
        <line x1={sox-18} y1={waterTopY} x2={sox-18} y2={waterBottomY} stroke="#0284c7"/>
        <line x1={sox-23} y1={waterTopY} x2={sox-13} y2={waterTopY} stroke="#0284c7"/>
        <line x1={sox-23} y1={waterBottomY} x2={sox-13} y2={waterBottomY} stroke="#0284c7"/>
        {dimensionControl('water_level_mm', 'Water level', sox-46, soy+sh/2, 0, assessment.internalHeight, true)}
        {positions
          .filter(position => position.row === sectionColumn)
          .sort((a, b) => a.column - b.column)
          .map(position => {
            const stackX = sox + (layout.wall_thickness_mm + ACCESS_LENGTH_MM + position.column * BIO_CRATE_WIDTH_MM) * ss;
            const crateWidth = Math.max(4, BIO_CRATE_WIDTH_MM * ss - 3);
            const selected = selectedStackNumber === position.stackNumber;
            return <g key={`${position.row}:${position.column}`} role="button" tabIndex={0} aria-label={`Stack S${String(position.stackNumber).padStart(2, '0')}, column ${position.row + 1}, position ${position.column + 1}, ${position.crates} crates`} onClick={()=>selectStack(position.stackNumber,position.row)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' ')selectStack(position.stackNumber,position.row);}}>
              {Array.from({ length: position.crates }, (_, level) => <rect
                key={level}
                data-testid="section-crate"
                x={stackX}
                y={soy + sh - layout.wall_thickness_mm * ss - (level + 1) * BIO_CRATE_HEIGHT_MM * ss}
                width={crateWidth}
                height={Math.max(3, BIO_CRATE_HEIGHT_MM * ss - 2)}
                rx="1.5"
                fill={selected ? '#93c5fd' : '#bfdbfe'}
                stroke={selected ? '#1d4ed8' : '#2563eb'}
                strokeWidth={selected ? 2.5 : 1.25}
              />)}
              {Array.from({ length: position.crates }, (_, level) => <text
                key={`label-${level}`}
                x={stackX + crateWidth / 2}
                y={soy + sh - layout.wall_thickness_mm * ss - level * BIO_CRATE_HEIGHT_MM * ss - BIO_CRATE_HEIGHT_MM * ss / 2 + 3}
                textAnchor="middle"
                fontSize="7"
                fontWeight="600"
                fill="#1e3a8a"
              >S{String(position.stackNumber).padStart(2,'0')}</text>)}
              <text
                x={stackX + crateWidth / 2}
                y={soy + sh - layout.wall_thickness_mm * ss - position.crates * BIO_CRATE_HEIGHT_MM * ss - 4}
                textAnchor="middle"
                fontSize="8"
                fill="#334155"
              >S{String(position.stackNumber).padStart(2,'0')} · {position.crates}</text>
            </g>;
          })}
        <line x1={sox+sw-46} y1={soy+DISPERSION_TRAY.height*ss} x2={sox+sw-46} y2={soy+DISPERSION_TRAY.height*ss+actualCrateGap*ss} stroke="#dc2626"/>
        <line x1={sox+sw-51} y1={soy+DISPERSION_TRAY.height*ss} x2={sox+sw-41} y2={soy+DISPERSION_TRAY.height*ss} stroke="#dc2626"/>
        <line x1={sox+sw-51} y1={soy+DISPERSION_TRAY.height*ss+actualCrateGap*ss} x2={sox+sw-41} y2={soy+DISPERSION_TRAY.height*ss+actualCrateGap*ss} stroke="#dc2626"/>
        {editingDimension === 'tray_gap_mm' && !readOnly ? <foreignObject x={sox+sw-238} y={soy+DISPERSION_TRAY.height*ss+8} width="122" height="30">
          <input autoFocus aria-label="Tray-to-crate gap (mm)" type="number" min={TRAY_GAP_MM} max={PLENUM_LIMITS.height} value={trayGap} onChange={event=>setTrayGap(Number(event.target.value))} onBlur={()=>setEditingDimension(null)} onKeyDown={event=>{if(event.key==='Enter'||event.key==='Escape')setEditingDimension(null);}} className="h-7 w-full rounded-md border border-red-500 bg-white px-2 text-center font-mono text-[11px] font-semibold shadow-md outline-none ring-2 ring-red-100"/>
        </foreignObject> : <g role="button" tabIndex={readOnly?-1:0} aria-label={`Edit tray-to-crate gap, currently ${trayGap} mm`} onClick={()=>!readOnly&&setEditingDimension('tray_gap_mm')} onKeyDown={event=>{if(!readOnly&&(event.key==='Enter'||event.key===' '))setEditingDimension('tray_gap_mm');}} className={readOnly?'':'cursor-pointer'}>
          <rect x={sox+sw-238} y={soy+DISPERSION_TRAY.height*ss+10} width="122" height="24" rx="6" fill="#fff" stroke="#dc2626"/>
          <text x={sox+sw-177} y={soy+DISPERSION_TRAY.height*ss+26} textAnchor="middle" fontSize="9" fontWeight="600" fill="#b91c1c">Tray-to-crate gap {trayGap} mm</text>
        </g>}
        <line x1={sox+sw+18} y1={soy} x2={sox+sw+18} y2={soy+sh} stroke="#64748b"/>
        <line x1={sox+sw+13} y1={soy} x2={sox+sw+23} y2={soy} stroke="#64748b"/>
        <line x1={sox+sw+13} y1={soy+sh} x2={sox+sw+23} y2={soy+sh} stroke="#64748b"/>
        {dimensionControl('external_height_mm', 'Height', sox+sw+46, soy+sh/2, 1500, PLENUM_LIMITS.height, true)}
        <text x={sectionW/2} y={sectionH-5} textAnchor="middle" fontSize="11" fill="#334155">{layout.external_length_mm} mm linked length · tallest arranged stack {tallestArrangedStack}</text>
      </svg></figure>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['Internal size',`${assessment.internalLength} × ${assessment.internalWidth} × ${assessment.internalHeight} mm`],['Layout capacity',`${assessment.capacity} crates`],['Required crates',crateCount],['Clear height below tray',`${assessment.verticalAvailable} mm`]].map(([label,value])=><div key={String(label)} className="rounded-xl border border-stone-200 bg-white p-4"><div className="text-xs text-stone-500">{label}</div><div className="mt-1 font-mono font-semibold text-stone-900">{value}</div></div>)}</div>
  </div>;
}
