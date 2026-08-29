import { useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, GitBranch, MousePointer2, PenLine, Redo2, RotateCcw, Undo2, X } from 'lucide-react';

export type FootprintPoint = { x: number; y: number };
export type FootprintSegment =
  | { type: 'line'; start: FootprintPoint; end: FootprintPoint }
  | { type: 'quadratic'; start: FootprintPoint; control: FootprintPoint; end: FootprintPoint }
  | { type: 'freehand'; points: FootprintPoint[] };
export type CustomFootprintDocument = {
  schema_version: 1;
  units: 'mm';
  calibration: { model_unit: 'mm'; mm_per_unit: 1 };
  closed: boolean;
  segments: FootprintSegment[];
  sampling: { quadratic_steps: number; freehand_step_mm: number };
};

const defaultSampling = { quadratic_steps: 24, freehand_step_mm: 25 };
const blankDocument = (): CustomFootprintDocument => ({
  schema_version: 1,
  units: 'mm',
  calibration: { model_unit: 'mm', mm_per_unit: 1 },
  closed: false,
  segments: [],
  sampling: defaultSampling,
});

function same(a: FootprintPoint, b: FootprintPoint) {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
}
function distance(a: FootprintPoint, b: FootprintPoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
function lerp(a: FootprintPoint, b: FootprintPoint, t: number): FootprintPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
function sampleFreehand(points: FootprintPoint[], step: number) {
  if (points.length < 2) return points;
  const result = [points[0]];
  let carry = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const length = distance(from, to);
    if (!length) continue;
    let travelled = step - carry;
    while (travelled < length) {
      result.push(lerp(from, to, travelled / length));
      travelled += step;
    }
    carry = length - (travelled - step);
  }
  const last = points[points.length - 1];
  if (!same(result[result.length - 1], last)) result.push(last);
  return result;
}
function sample(document: CustomFootprintDocument) {
  const result: FootprintPoint[] = [];
  document.segments.forEach(segment => {
    if (segment.type === 'line') {
      if (!result.length) result.push(segment.start);
      result.push(segment.end);
    } else if (segment.type === 'quadratic') {
      if (!result.length) result.push(segment.start);
      for (let i = 1; i <= document.sampling.quadratic_steps; i += 1) {
        const t = i / document.sampling.quadratic_steps;
        result.push(lerp(lerp(segment.start, segment.control, t), lerp(segment.control, segment.end, t), t));
      }
    } else {
      const sampled = sampleFreehand(segment.points, document.sampling.freehand_step_mm);
      if (!result.length) result.push(...sampled);
      else result.push(...sampled.slice(1));
    }
  });
  return result;
}
function orientation(a: FootprintPoint, b: FootprintPoint, c: FootprintPoint) {
  const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(value) < 0.0001 ? 0 : value > 0 ? 1 : -1;
}
function onSegment(a: FootprintPoint, b: FootprintPoint, c: FootprintPoint) {
  return Math.min(a.x, c.x) - 0.01 <= b.x && b.x <= Math.max(a.x, c.x) + 0.01
    && Math.min(a.y, c.y) - 0.01 <= b.y && b.y <= Math.max(a.y, c.y) + 0.01;
}
function intersects(a: FootprintPoint, b: FootprintPoint, c: FootprintPoint, d: FootprintPoint) {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return (abC !== abD && cdA !== cdB)
    || (abC === 0 && onSegment(a, c, b))
    || (abD === 0 && onSegment(a, d, b))
    || (cdA === 0 && onSegment(c, a, d))
    || (cdB === 0 && onSegment(c, b, d));
}
function segmentStart(segment: FootprintSegment) {
  return segment.type === 'freehand' ? segment.points[0] : segment.start;
}
function segmentEnd(segment: FootprintSegment) {
  return segment.type === 'freehand' ? segment.points[segment.points.length - 1] : segment.end;
}
function validateEditorDocument(document: CustomFootprintDocument) {
  if (!document.closed) return { valid: false, label: 'Open outline', message: 'Add the final connection, then use Close outline.' };
  if (document.segments.length < 3) return { valid: false, label: 'Too few segments', message: 'A footprint needs at least three connected segments.' };
  for (let index = 0; index < document.segments.length; index += 1) {
    const segment = document.segments[index];
    const points = segment.type === 'freehand' ? segment.points : [segment.start, segment.end];
    if (points.some((point, pointIndex) => pointIndex > 0 && distance(points[pointIndex - 1], point) < 0.01)) {
      return { valid: false, label: 'Zero-length segment', message: 'Move or remove coincident points before saving.' };
    }
    if (index > 0 && !same(segmentEnd(document.segments[index - 1]), segmentStart(segment))) {
      return { valid: false, label: 'Disconnected outline', message: 'Every segment must connect to the next.' };
    }
  }
  if (!same(segmentStart(document.segments[0]), segmentEnd(document.segments[document.segments.length - 1]))) {
    return { valid: false, label: 'Open outline', message: 'The final segment must return to the first point.' };
  }
  const points = sample(document);
  const polygon = points.length > 1 && same(points[0], points[points.length - 1]) ? points.slice(0, -1) : points;
  for (let i = 0; i < polygon.length; i += 1) {
    for (let j = i + 1; j < polygon.length; j += 1) {
      if (j === i + 1 || (i === 0 && j === polygon.length - 1)) continue;
      if (intersects(polygon[i], polygon[(i + 1) % polygon.length], polygon[j], polygon[(j + 1) % polygon.length])) {
        return { valid: false, label: 'Self-intersecting outline', message: 'The footprint edges cross. Edit the outline before saving.' };
      }
    }
  }
  const measurement = measure(document);
  if (measurement.area < 0.000001) return { valid: false, label: 'Degenerate / too small', message: 'Add more area; zero-area outlines cannot be saved.' };
  return { valid: true, label: 'Closed and measurable', message: 'The server will validate the same model-space geometry again.' };
}
function measure(document: CustomFootprintDocument) {
  const points = sample(document);
  const polygon = points.length > 1 && same(points[0], points[points.length - 1]) ? points.slice(0, -1) : points;
  let area = 0;
  let perimeter = 0;
  polygon.forEach((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    if (!next) return;
    area += point.x * next.y - next.x * point.y;
    perimeter += distance(point, next);
  });
  return {
    area: Math.abs(area) / 2 / 1e6,
    perimeter,
    points,
    approximate: document.segments.some(segment => segment.type !== 'line'),
  };
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
function documentFrom(value?: any | null): CustomFootprintDocument {
  if (!value?.segments) return blankDocument();
  return {
    schema_version: 1,
    units: 'mm',
    calibration: { model_unit: 'mm', mm_per_unit: 1 },
    closed: value.closed === true,
    segments: clone(value.segments),
    sampling: {
      quadratic_steps: value.sampling?.quadratic_steps || defaultSampling.quadratic_steps,
      freehand_step_mm: value.sampling?.freehand_step_mm || defaultSampling.freehand_step_mm,
    },
  };
}
function viewBox(document: CustomFootprintDocument) {
  const points = sample(document);
  const all = points.length ? points : [{ x: 0, y: 0 }, { x: 600, y: 400 }];
  const minX = Math.min(...all.map(point => point.x));
  const maxX = Math.max(...all.map(point => point.x));
  const minY = Math.min(...all.map(point => point.y));
  const maxY = Math.max(...all.map(point => point.y));
  const pad = Math.max(80, Math.max(maxX - minX, maxY - minY) * 0.12);
  return { x: minX - pad, y: minY - pad, width: Math.max(500, maxX - minX + pad * 2), height: Math.max(360, maxY - minY + pad * 2) };
}
function pathFor(document: CustomFootprintDocument) {
  return document.segments.map((segment, index) => {
    const start = index === 0 ? `M ${segment.type === 'freehand' ? segment.points[0].x : segment.start.x} ${segment.type === 'freehand' ? segment.points[0].y : segment.start.y}` : '';
    if (segment.type === 'line') return `${start} L ${segment.end.x} ${segment.end.y}`;
    if (segment.type === 'quadratic') return `${start} Q ${segment.control.x} ${segment.control.y} ${segment.end.x} ${segment.end.y}`;
    return `${start} ${segment.points.slice(1).map(point => `L ${point.x} ${point.y}`).join(' ')}`;
  }).join(' ') + (document.closed ? ' Z' : '');
}

export function FootprintPreview({ document, className = '' }: { document?: any | null; className?: string }) {
  if (!document?.segments?.length) return null;
  const normalized = documentFrom(document);
  const box = viewBox(normalized);
  return (
    <svg viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`} className={`w-full h-28 rounded-lg bg-sky-50 border border-sky-100 ${className}`} role="img" aria-label="Saved custom tank footprint preview">
      <path d={pathFor(normalized)} fill="#bae6fd" fillOpacity=".65" stroke="#0369a1" strokeWidth={Math.max(3, box.width / 180)} strokeLinejoin="round" />
    </svg>
  );
}

export function footprintMeasurement(document?: any | null) {
  if (!document?.segments?.length) return null;
  return measure(documentFrom(document));
}

type Props = {
  initialValue?: any | null;
  onAccept: (document: CustomFootprintDocument) => void;
  onCancel: () => void;
};

export default function CustomFootprintEditor({ initialValue, onAccept, onCancel }: Props) {
  const [document, setDocument] = useState<CustomFootprintDocument>(() => documentFrom(initialValue));
  const initialDocument = useRef(documentFrom(initialValue));
  const [mode, setMode] = useState<'select' | 'line' | 'curve' | 'freehand'>('line');
  const [pendingStart, setPendingStart] = useState<FootprintPoint | null>(null);
  const [activeFreehand, setActiveFreehand] = useState<FootprintPoint[] | null>(null);
  const [drag, setDrag] = useState<{ kind: 'vertex' | 'control'; segment: number } | null>(null);
  const [past, setPast] = useState<CustomFootprintDocument[]>([]);
  const [future, setFuture] = useState<CustomFootprintDocument[]>([]);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [keyboardPoint, setKeyboardPoint] = useState<FootprintPoint>({ x: 300, y: 200 });
  const svgRef = useRef<SVGSVGElement>(null);
  const dragOrigin = useRef<CustomFootprintDocument | null>(null);
  const box = useMemo(() => viewBox(document), [document]);
  const measurement = useMemo(() => measure(document), [document]);
  const validation = useMemo(() => validateEditorDocument(document), [document]);
  const sampled = measurement.points;
  const first = document.segments[0];
  const firstPoint = first ? (first.type === 'freehand' ? first.points[0] : first.start) : null;
  const last = document.segments[document.segments.length - 1];
  const lastPoint = last ? (last.type === 'freehand' ? last.points[last.points.length - 1] : last.end) : null;
  const canClose = !!firstPoint && !!lastPoint && document.segments.length >= 2 && !document.closed;

  const commit = (next: CustomFootprintDocument) => {
    setPast(previous => [...previous.slice(-49), clone(document)]);
    setFuture([]);
    setDocument(next);
  };
  const pointFromEvent = (event: React.PointerEvent<SVGSVGElement>): FootprintPoint => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: box.x + ((event.clientX - rect.left) / rect.width) * box.width,
      y: box.y + ((event.clientY - rect.top) / rect.height) * box.height,
    };
  };
  const updateVertex = (nextPoint: FootprintPoint, segmentIndex: number) => {
    const segments = document.segments.map((segment, index) => {
      const updatesStart = index === segmentIndex || (document.closed && segmentIndex === document.segments.length && index === 0);
      const updatesEnd = index === segmentIndex - 1 || (document.closed && segmentIndex === 0 && index === document.segments.length - 1);
      if (segment.type === 'freehand') {
        return {
          ...segment,
          points: segment.points.map((point, pointIndex) =>
            (updatesStart && pointIndex === 0) || (updatesEnd && pointIndex === segment.points.length - 1)
              ? nextPoint
              : point),
        };
      }
      const next: any = { ...segment };
      if (updatesStart) next.start = nextPoint;
      if (updatesEnd) next.end = nextPoint;
      return next;
    });
    return { ...document, segments };
  };
  const updateControl = (nextPoint: FootprintPoint, segmentIndex: number) => ({
    ...document,
    segments: document.segments.map((segment, index) => index === segmentIndex && segment.type === 'quadratic' ? { ...segment, control: nextPoint } : segment),
  });
  const addPoint = (point: FootprintPoint) => {
    if (document.closed || mode === 'select') return;
    if (mode === 'freehand') setActiveFreehand(lastPoint ? [lastPoint, point] : [point]);
    else if (!pendingStart) setPendingStart(point);
    else {
      if (mode === 'line') commit({ ...document, segments: [...document.segments, { type: 'line', start: pendingStart, end: point }] });
      if (mode === 'curve') {
        const middle = lerp(pendingStart, point, 0.5);
        commit({ ...document, segments: [...document.segments, { type: 'quadratic', start: pendingStart, control: { x: middle.x, y: middle.y - Math.max(50, distance(pendingStart, point) * 0.2) }, end: point }] });
      }
      setPendingStart(point);
    }
  };
  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (document.closed || mode === 'select') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    addPoint(pointFromEvent(event));
  };
  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = pointFromEvent(event);
    if (activeFreehand) setActiveFreehand(points => points ? [...points, point] : points);
    if (drag) setDocument(drag.kind === 'control' ? updateControl(point, drag.segment) : updateVertex(point, drag.segment));
  };
  const onPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if (activeFreehand) {
      if (activeFreehand.length > 1) commit({ ...document, segments: [...document.segments, { type: 'freehand', points: activeFreehand }] });
      setActiveFreehand(null);
      setPendingStart(null);
    }
    if (drag) {
      if (dragOrigin.current) {
        setPast(previous => [...previous.slice(-49), dragOrigin.current!]);
        setFuture([]);
      }
      dragOrigin.current = null;
      setDrag(null);
    }
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
  };
  const startDrag = (event: React.PointerEvent<SVGCircleElement>, kind: 'vertex' | 'control', segment: number) => {
    event.stopPropagation();
    if (document.closed && mode !== 'select') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOrigin.current = clone(document);
    setDrag({ kind, segment });
  };
  const close = () => {
    if (!canClose || !firstPoint || !lastPoint) return;
    const segments = same(lastPoint, firstPoint)
      ? document.segments
      : [...document.segments, { type: 'line' as const, start: lastPoint, end: firstPoint }];
    commit({ ...document, segments, closed: true });
    setPendingStart(null);
  };
  const reset = () => {
    if (!resetConfirm) { setResetConfirm(true); return; }
    commit(blankDocument());
    setPendingStart(null);
    setResetConfirm(false);
  };
  const undo = () => {
    const previous = past[past.length - 1];
    if (!previous) return;
    setFuture(next => [clone(document), ...next]);
    setPast(next => next.slice(0, -1));
    setDocument(previous);
    setPendingStart(null);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setPast(previous => [...previous.slice(-49), clone(document)]);
    setFuture(previous => previous.slice(1));
    setDocument(next);
    setPendingStart(null);
  };
  const accept = () => {
    if (!validation.valid) return;
    onAccept(document);
  };
  const requestCancel = () => {
    const changed = JSON.stringify(document) !== JSON.stringify(initialDocument.current);
    if (changed && !window.confirm('Discard the footprint changes you have not accepted?')) return;
    onCancel();
  };
  const onCanvasKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      requestCancel();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (event.key.toLowerCase() === 'c') {
      event.preventDefault();
      close();
      return;
    }
    const delta: Record<string, FootprintPoint> = {
      ArrowLeft: { x: -25, y: 0 },
      ArrowRight: { x: 25, y: 0 },
      ArrowUp: { x: 0, y: -25 },
      ArrowDown: { x: 0, y: 25 },
    };
    if (delta[event.key]) {
      event.preventDefault();
      setKeyboardPoint(point => ({ x: point.x + delta[event.key].x, y: point.y + delta[event.key].y }));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (mode === 'freehand') {
        const from = lastPoint || keyboardPoint;
        commit({ ...document, segments: [...document.segments, { type: 'freehand', points: [from, keyboardPoint] }] });
      } else {
        addPoint(keyboardPoint);
      }
    }
  };
  const nudgeGeometry = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    kind: 'vertex' | 'control',
    index: number,
    current: FootprintPoint,
  ) => {
    const delta: Record<string, FootprintPoint> = {
      ArrowLeft: { x: -25, y: 0 },
      ArrowRight: { x: 25, y: 0 },
      ArrowUp: { x: 0, y: -25 },
      ArrowDown: { x: 0, y: 25 },
    };
    if (!delta[event.key]) return;
    event.preventDefault();
    const next = { x: current.x + delta[event.key].x, y: current.y + delta[event.key].y };
    commit(kind === 'control' ? updateControl(next, index) : updateVertex(next, index));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="footprint-editor-title">
      <div className="w-full max-w-5xl max-h-[95vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-sky-700"><GitBranch className="h-5 w-5" /><h2 id="footprint-editor-title" className="text-lg font-bold text-stone-800">Custom Footprint Tool</h2></div>
            <p className="mt-1 text-xs text-stone-500">Draw a connected outline in model-space millimetres. Close the loop before accepting.</p>
          </div>
          <button type="button" onClick={requestCancel} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100" aria-label="Close footprint editor"><X className="h-5 w-5" /></button>
        </div>
        <div className="grid gap-4 p-5 lg:grid-cols-[1fr_280px]">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2" role="toolbar" aria-label="Footprint drawing tools">
              {([
                ['line', PenLine, 'Straight segment'],
                ['curve', GitBranch, 'Quadratic curve'],
                ['freehand', PenLine, 'Freehand segment'],
                ['select', MousePointer2, 'Select and edit'],
              ] as const).map(([value, Icon, label]) => (
                <button key={value} type="button" aria-pressed={mode === value} onClick={() => { setMode(value); setPendingStart(value === 'freehand' || value === 'select' ? null : lastPoint); }} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium ${mode === value ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-stone-200 text-stone-600 hover:bg-stone-50'}`}><Icon className="h-3.5 w-3.5" />{label}</button>
              ))}
              <span className="ml-auto flex items-center gap-1">
                <button type="button" onClick={undo} disabled={!past.length} className="rounded-lg border border-stone-200 p-2 text-stone-600 disabled:opacity-30" aria-label="Undo"><Undo2 className="h-4 w-4" /></button>
                <button type="button" onClick={redo} disabled={!future.length} className="rounded-lg border border-stone-200 p-2 text-stone-600 disabled:opacity-30" aria-label="Redo"><Redo2 className="h-4 w-4" /></button>
                <button type="button" onClick={reset} className={`rounded-lg border px-2 py-2 text-xs ${resetConfirm ? 'border-red-300 bg-red-50 text-red-700' : 'border-stone-200 text-stone-600'}`} aria-label="Reset footprint">{resetConfirm ? 'Confirm reset' : <RotateCcw className="h-4 w-4" />}</button>
                {resetConfirm && <button type="button" onClick={() => setResetConfirm(false)} className="text-xs text-stone-500">Keep drawing</button>}
              </span>
            </div>
            <div className="relative overflow-hidden rounded-xl border border-sky-200 bg-[linear-gradient( to right,rgba(14,116,144,.08)_1px,transparent_1px),linear-gradient(to bottom,rgba(14,116,144,.08)_1px,transparent_1px)] bg-[size:32px_32px]">
              <svg ref={svgRef} viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`} className={`h-[min(58vh,520px)] w-full touch-none focus:outline-none focus:ring-2 focus:ring-inset focus:ring-sky-500 ${mode === 'select' ? 'cursor-default' : 'cursor-crosshair'}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onCanvasKeyDown} tabIndex={0} aria-label="Footprint drawing surface" aria-describedby="footprint-keyboard-help">
                <path d={pathFor(document)} fill={document.closed ? '#bae6fd' : 'none'} fillOpacity=".65" stroke="#0369a1" strokeWidth={Math.max(3, box.width / 180)} strokeLinejoin="round" strokeLinecap="round" />
                {activeFreehand && <polyline points={activeFreehand.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#0284c7" strokeWidth={Math.max(3, box.width / 180)} />}
                {document.segments.map((segment, index) => {
                  const start = segment.type === 'freehand' ? segment.points[0] : segment.start;
                  const end = segment.type === 'freehand' ? segment.points[segment.points.length - 1] : segment.end;
                  return <g key={`${segment.type}-${index}`}>
                    {mode === 'select' && <><circle cx={start.x} cy={start.y} r={Math.max(9, box.width / 70)} fill="#fff" stroke="#0369a1" strokeWidth="3" onPointerDown={event => startDrag(event, 'vertex', index)} /><circle cx={end.x} cy={end.y} r={Math.max(7, box.width / 85)} fill="#fff" stroke="#0e7490" strokeWidth="2" onPointerDown={event => startDrag(event, 'vertex', index + 1)} /></>}
                    {mode === 'select' && segment.type === 'quadratic' && <><line x1={segment.start.x} y1={segment.start.y} x2={segment.control.x} y2={segment.control.y} stroke="#38bdf8" strokeDasharray="5 4" /><line x1={segment.control.x} y1={segment.control.y} x2={segment.end.x} y2={segment.end.y} stroke="#38bdf8" strokeDasharray="5 4" /><circle cx={segment.control.x} cy={segment.control.y} r={Math.max(8, box.width / 78)} fill="#fef08a" stroke="#a16207" strokeWidth="3" onPointerDown={event => startDrag(event, 'control', index)} /></>}
                  </g>;
                })}
                {pendingStart && <circle cx={pendingStart.x} cy={pendingStart.y} r={Math.max(7, box.width / 85)} fill="#fef08a" stroke="#a16207" strokeWidth="3" />}
                <circle cx={keyboardPoint.x} cy={keyboardPoint.y} r={Math.max(5, box.width / 110)} fill="#f97316" stroke="#fff" strokeWidth="2" pointerEvents="none" />
              </svg>
              {!document.segments.length && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-xs text-stone-500">Choose Straight, Curve, or Freehand, then draw connected segments here.</div>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={close} disabled={!canClose} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-40"><Check className="h-3.5 w-3.5" />Close outline</button>
              {mode !== 'select' && <span className="self-center text-xs text-stone-500">{pendingStart ? 'Click the next point to add a segment.' : 'Click or drag to start the next segment.'}</span>}
              {mode === 'select' && <span className="self-center text-xs text-stone-500">Drag blue vertices or yellow curve handles to edit.</span>}
            </div>
            <p id="footprint-keyboard-help" className="mt-2 text-xs text-stone-500">Keyboard: focus the drawing surface, move the orange cursor with Arrow keys, press Enter to add, C to close, and Ctrl/Cmd+Z or Y to undo/redo.</p>
          </div>
          <aside className="space-y-3">
            <div className={`rounded-xl border p-4 ${validation.valid ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
              <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Validation</div>
              <div className={`mt-1 text-sm font-bold ${validation.valid ? 'text-emerald-700' : 'text-amber-800'}`}>{validation.label}</div>
              <p className="mt-1 text-xs text-stone-600">{validation.message}</p>
            </div>
            <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 space-y-3">
              <div><div className="text-xs text-stone-500">Water-surface area</div><div className="font-mono text-xl font-bold text-sky-700">{document.closed && measurement.area >= 0.000001 ? measurement.area.toFixed(3) : '—'} <span className="text-xs font-normal">m²</span></div></div>
              <div><div className="text-xs text-stone-500">Perimeter</div><div className="font-mono text-base font-semibold text-stone-700">{document.closed ? measurement.perimeter.toFixed(1) : '—'} <span className="text-xs font-normal">mm</span></div></div>
              <div><div className="text-xs text-stone-500">Segments</div><div className="font-mono text-base font-semibold text-stone-700">{document.segments.length}</div></div>
              {measurement.approximate && <p className="border-t border-stone-200 pt-2 text-xs text-amber-700">Approximation: curves and/or freehand samples are deterministically sampled.</p>}
            </div>
            {document.segments.length > 0 && (
              <div className="rounded-xl border border-stone-200 bg-white p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Keyboard geometry editing</div>
                <p className="mt-1 text-xs text-stone-500">Focus a point and use Arrow keys to move it by 25 mm.</p>
                <div className="mt-2 max-h-36 space-y-1 overflow-y-auto">
                  {document.segments.map((segment, index) => {
                    const vertex = segmentStart(segment);
                    return (
                      <div key={`edit-point-${index}`}>
                        <button
                          type="button"
                          onKeyDown={event => nudgeGeometry(event, 'vertex', index, vertex)}
                          className="w-full rounded-md border border-stone-200 px-2 py-1 text-left font-mono text-xs text-stone-600 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                          aria-label={`Vertex ${index + 1}, ${vertex.x.toFixed(1)} millimetres x, ${vertex.y.toFixed(1)} millimetres y`}
                        >
                          Vertex {index + 1}: {vertex.x.toFixed(1)}, {vertex.y.toFixed(1)} mm
                        </button>
                        {segment.type === 'quadratic' && (
                          <button
                            type="button"
                            onKeyDown={event => nudgeGeometry(event, 'control', index, segment.control)}
                            className="mt-1 w-full rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-left font-mono text-xs text-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-300"
                            aria-label={`Curve handle ${index + 1}, ${segment.control.x.toFixed(1)} millimetres x, ${segment.control.y.toFixed(1)} millimetres y`}
                          >
                            Curve handle {index + 1}: {segment.control.x.toFixed(1)}, {segment.control.y.toFixed(1)} mm
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-xs text-sky-800"><strong>Units:</strong> all saved coordinates use millimetres with a 1:1 model calibration. Screen pixels are never stored.</div>
          </aside>
        </div>
        <div className="flex justify-end gap-2 border-t border-stone-200 px-5 py-4">
          <button type="button" onClick={requestCancel} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50"><ChevronLeft className="h-4 w-4" />Cancel</button>
          <button type="button" onClick={accept} disabled={!validation.valid} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"><Check className="h-4 w-4" />Use this footprint</button>
        </div>
      </div>
    </div>
  );
}

export function FootprintPrompt({ onLaunch, onContinue }: { onLaunch: () => void; onContinue: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-stone-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="footprint-prompt-title">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 id="footprint-prompt-title" className="text-lg font-bold text-stone-800">Add a custom footprint?</h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">Custom tanks can use a measurable outline instead of a rectangular approximation. You can draw it now or continue and add one later.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onContinue} className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50">Not now</button>
          <button type="button" onClick={onLaunch} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800">Open footprint tool</button>
        </div>
      </div>
    </div>
  );
}