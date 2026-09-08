import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronLeft, Crosshair, GitBranch, Image as ImageIcon, MousePointer2, PenLine, Redo2, Ruler, RotateCcw, Scissors, Trash2, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react';

export type FootprintPoint = { x: number; y: number };
export type FootprintSegment =
  | { type: 'line'; start: FootprintPoint; end: FootprintPoint }
  | { type: 'quadratic'; start: FootprintPoint; control: FootprintPoint; end: FootprintPoint }
  | { type: 'freehand'; points: FootprintPoint[] };
export type CustomFootprintDocument = {
  schema_version: 1;
  units: 'mm';
  calibration: {
    model_unit: 'mm';
    mm_per_unit: number;
    method?: 'ratio' | 'two_point';
    ratio?: number;
    reference_distance_units?: number;
    known_distance_mm?: number;
  };
  closed: boolean;
  segments: FootprintSegment[];
  sampling: { quadratic_steps: number; freehand_step_mm: number };
};

const defaultSampling = { quadratic_steps: 24, freehand_step_mm: 25 };
const maxAbsCoordinateMm = 10_000_000;
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
    const points = segment.type === 'freehand'
      ? segment.points
      : segment.type === 'quadratic'
        ? [segment.start, segment.control, segment.end]
        : [segment.start, segment.end];
    if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y)
      || Math.abs(point.x) > maxAbsCoordinateMm || Math.abs(point.y) > maxAbsCoordinateMm)) {
      return { valid: false, label: 'Coordinate out of range', message: 'Keep every point within the supported model-space range.' };
    }
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
  const mmPerUnit = Number(value.calibration?.mm_per_unit);
  const normalizedMmPerUnit = Number.isFinite(mmPerUnit) && mmPerUnit > 0 ? mmPerUnit : 1;
  const method = value.calibration?.method === 'two_point' ? 'two_point' : 'ratio';
  return {
    schema_version: 1,
    units: 'mm',
    calibration: {
      model_unit: 'mm',
      mm_per_unit: normalizedMmPerUnit,
      method,
      ...(method === 'ratio' ? { ratio: Number(value.calibration?.ratio) > 0 ? Number(value.calibration.ratio) : normalizedMmPerUnit } : {}),
      ...(method === 'two_point' && Number(value.calibration?.reference_distance_units) > 0 && Number(value.calibration?.known_distance_mm) > 0
        ? {
            reference_distance_units: Number(value.calibration.reference_distance_units),
            known_distance_mm: Number(value.calibration.known_distance_mm),
          }
        : {}),
    },
    closed: value.closed === true,
    segments: clone(value.segments),
    sampling: {
      quadratic_steps: value.sampling?.quadratic_steps || defaultSampling.quadratic_steps,
      freehand_step_mm: value.sampling?.freehand_step_mm || defaultSampling.freehand_step_mm,
    },
  };
}
function mapPoint(point: FootprintPoint, factor: number): FootprintPoint {
  return { x: point.x * factor, y: point.y * factor };
}
function mapDocumentPoints(document: CustomFootprintDocument, factor: number): CustomFootprintDocument {
  return {
    ...document,
    segments: document.segments.map(segment => {
      if (segment.type === 'freehand') return { ...segment, points: segment.points.map(point => mapPoint(point, factor)) };
      if (segment.type === 'quadratic') return {
        ...segment,
        start: mapPoint(segment.start, factor),
        control: mapPoint(segment.control, factor),
        end: mapPoint(segment.end, factor),
      };
      return { ...segment, start: mapPoint(segment.start, factor), end: mapPoint(segment.end, factor) };
    }),
  };
}
function segmentSamples(segment: FootprintSegment, steps = 24): FootprintPoint[] {
  if (segment.type === 'line') return [segment.start, segment.end];
  if (segment.type === 'freehand') return segment.points;
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    return lerp(lerp(segment.start, segment.control, t), lerp(segment.control, segment.end, t), t);
  });
}
function segmentLength(segment: FootprintSegment, steps = 24) {
  const points = segmentSamples(segment, steps);
  return points.slice(1).reduce((total, point, index) => total + distance(points[index], point), 0);
}
function curveMetrics(segment: Extract<FootprintSegment, { type: 'quadratic' }>) {
  const middle = lerp(segment.start, segment.end, 0.5);
  const vector = { x: segment.control.x - middle.x, y: segment.control.y - middle.y };
  const chord = { x: segment.end.x - segment.start.x, y: segment.end.y - segment.start.y };
  const chordLength = Math.max(distance(segment.start, segment.end), 0.0001);
  const tangent = { x: chord.x / chordLength, y: chord.y / chordLength };
  const normal = { x: -tangent.y, y: tangent.x };
  const tangentOffset = vector.x * tangent.x + vector.y * tangent.y;
  const curvature = vector.x * normal.x + vector.y * normal.y;
  return {
    middle,
    tangent,
    normal,
    tangentOffset,
    curvature,
    angle: distance(middle, segment.control) < 0.0001
      ? 90
      : Math.atan2(curvature, tangentOffset) * 180 / Math.PI,
  };
}
function controlFromMetrics(
  segment: Extract<FootprintSegment, { type: 'quadratic' }>,
  curvature: number,
  angle: number,
) {
  const metrics = curveMetrics(segment);
  const radians = angle * Math.PI / 180;
  const tangentOffset = Math.abs(curvature) < 0.0001
    ? 0
    : curvature / Math.tan(radians);
  return {
    x: metrics.middle.x + metrics.tangent.x * tangentOffset + metrics.normal.x * curvature,
    y: metrics.middle.y + metrics.tangent.y * tangentOffset + metrics.normal.y * curvature,
  };
}
function viewBox(document: CustomFootprintDocument) {
  const points = sample(document);
  if (!points.length) return { x: -1000, y: -1000, width: 22000, height: 14000 };
  const all = points;
  const minX = Math.min(...all.map(point => point.x));
  const maxX = Math.max(...all.map(point => point.x));
  const minY = Math.min(...all.map(point => point.y));
  const maxY = Math.max(...all.map(point => point.y));
  const pad = Math.max(80, Math.max(maxX - minX, maxY - minY) * 0.12);
  return { x: minX - pad, y: minY - pad, width: Math.max(500, maxX - minX + pad * 2), height: Math.max(360, maxY - minY + pad * 2) };
}
function pointOnQuadratic(segment: Extract<FootprintSegment, { type: 'quadratic' }>, t: number) {
  return lerp(lerp(segment.start, segment.control, t), lerp(segment.control, segment.end, t), t);
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

function staticGifFrame(probe: HTMLImageElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = probe.naturalWidth;
    canvas.height = probe.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context || !canvas.width || !canvas.height) {
      reject(new Error('GIF frame could not be drawn'));
      return;
    }
    context.drawImage(probe, 0, 0);
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('GIF frame could not be encoded'));
    }, 'image/png');
  });
}

export default function CustomFootprintEditor({ initialValue, onAccept, onCancel }: Props) {
  const [document, setDocument] = useState<CustomFootprintDocument>(() => documentFrom(initialValue));
  const initialDocument = useRef(documentFrom(initialValue));
  const [mode, setMode] = useState<'select' | 'line' | 'curve' | 'freehand'>('line');
  const [pendingStart, setPendingStart] = useState<FootprintPoint | null>(() => {
    const last = document.segments[document.segments.length - 1];
    return document.closed || !last ? null : segmentEnd(last);
  });
  const [activeFreehand, setActiveFreehand] = useState<FootprintPoint[] | null>(null);
  const [drag, setDrag] = useState<{ kind: 'vertex' | 'control'; segment: number } | null>(null);
  const [past, setPast] = useState<CustomFootprintDocument[]>([]);
  const [future, setFuture] = useState<CustomFootprintDocument[]>([]);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [keyboardPoint, setKeyboardPoint] = useState<FootprintPoint>({ x: 300, y: 200 });
  const [snapTarget, setSnapTarget] = useState(false);
  const [calibrationMode, setCalibrationMode] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState<FootprintPoint[]>([]);
  const [calibrationRatio, setCalibrationRatio] = useState(() => String(documentFrom(initialValue).calibration.ratio || documentFrom(initialValue).calibration.mm_per_unit));
  const [knownDistance, setKnownDistance] = useState('');
  const [calibrationError, setCalibrationError] = useState('');
  const [segmentEditNotice, setSegmentEditNotice] = useState('');
  const [referenceImage, setReferenceImage] = useState<{ url: string; name: string } | null>(null);
  const [pendingReference, setPendingReference] = useState<{ url: string; name: string } | null>(null);
  const [referenceOpacity, setReferenceOpacity] = useState(35);
  const [referenceError, setReferenceError] = useState('');
  const [measurementMode, setMeasurementMode] = useState(false);
  const [measurementPoints, setMeasurementPoints] = useState<FootprintPoint[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<number | null>(null);
  const [pointerPoint, setPointerPoint] = useState<FootprintPoint | null>(null);
  const [keyboardPlacement, setKeyboardPlacement] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const referenceImageRef = useRef<{ url: string; name: string } | null>(null);
  const pendingReferenceRef = useRef<{ url: string; name: string } | null>(null);
  const referenceRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const dragOrigin = useRef<CustomFootprintDocument | null>(null);
  const mmPerUnit = Math.max(0.000001, document.calibration.mm_per_unit || 1);
  const displayDocument = useMemo(() => mapDocumentPoints(document, 1 / mmPerUnit), [document, mmPerUnit]);
  const [box] = useState(() => viewBox(mapDocumentPoints(documentFrom(initialValue), 1 / Math.max(0.000001, documentFrom(initialValue).calibration.mm_per_unit || 1))));
  const [viewport, setViewport] = useState(box);
  const zoomLevel = box.width / viewport.width;
  const measurement = useMemo(() => measure(document), [document]);
  const validation = useMemo(() => validateEditorDocument(document), [document]);
  const sampled = measurement.points;
  const first = document.segments[0];
  const firstPoint = first ? (first.type === 'freehand' ? first.points[0] : first.start) : null;
  const last = document.segments[document.segments.length - 1];
  const lastPoint = last ? (last.type === 'freehand' ? last.points[last.points.length - 1] : last.end) : null;
  const canClose = !!firstPoint && !!lastPoint && document.segments.length >= 2 && !document.closed;
  const displayFirstPoint = firstPoint ? mapPoint(firstPoint, 1 / mmPerUnit) : null;
  const displayLastPoint = lastPoint ? mapPoint(lastPoint, 1 / mmPerUnit) : null;
  const snapTolerance = Math.max(18 / zoomLevel, viewport.width / 55);
  const temporaryDistanceMm = measurementPoints.length === 2
    ? distance(measurementPoints[0], measurementPoints[1]) * mmPerUnit
    : null;

  useEffect(() => {
    referenceImageRef.current = referenceImage;
  }, [referenceImage]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      referenceRequestRef.current += 1;
      if (referenceImageRef.current) URL.revokeObjectURL(referenceImageRef.current.url);
      if (pendingReferenceRef.current) URL.revokeObjectURL(pendingReferenceRef.current.url);
    };
  }, []);

  const commit = (next: CustomFootprintDocument) => {
    setPast(previous => [...previous.slice(-49), clone(document)]);
    setFuture([]);
    setDocument(next);
  };
  const pointFromClient = (clientX: number, clientY: number): FootprintPoint | null => {
    const rect = svgRef.current!.getBoundingClientRect();
    const scale = Math.min(rect.width / viewport.width, rect.height / viewport.height);
    const renderedWidth = viewport.width * scale;
    const renderedHeight = viewport.height * scale;
    const left = rect.left + (rect.width - renderedWidth) / 2;
    const top = rect.top + (rect.height - renderedHeight) / 2;
    if (clientX < left || clientX > left + renderedWidth
      || clientY < top || clientY > top + renderedHeight) return null;
    return {
      x: viewport.x + (clientX - left) / scale,
      y: viewport.y + (clientY - top) / scale,
    };
  };
  const pointFromEvent = (event: React.PointerEvent<SVGSVGElement>): FootprintPoint | null =>
    pointFromClient(event.clientX, event.clientY);
  const setZoom = (nextZoom: number, anchor?: FootprintPoint) => {
    const clampedZoom = Math.min(8, Math.max(1, nextZoom));
    if (clampedZoom === 1) {
      setViewport(box);
      setPointerPoint(null);
      return;
    }
    const focus = anchor ?? {
      x: viewport.x + viewport.width / 2,
      y: viewport.y + viewport.height / 2,
    };
    const focusX = (focus.x - viewport.x) / viewport.width;
    const focusY = (focus.y - viewport.y) / viewport.height;
    const width = box.width / clampedZoom;
    const height = box.height / clampedZoom;
    setViewport({
      x: focus.x - focusX * width,
      y: focus.y - focusY * height,
      width,
      height,
    });
    setPointerPoint(null);
  };
  const onWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const anchor = pointFromClient(event.clientX, event.clientY);
    setZoom(zoomLevel * (event.deltaY < 0 ? 1.25 : 0.8), anchor ?? undefined);
  };
  const modelPointFromDisplay = (point: FootprintPoint) => mapPoint(point, mmPerUnit);
  const setCalibration = (
    nextMmPerUnit: number,
    metadata: Omit<CustomFootprintDocument['calibration'], 'model_unit' | 'mm_per_unit'>,
  ) => {
    if (!(nextMmPerUnit > 0) || !Number.isFinite(nextMmPerUnit)) {
      setCalibrationError('Enter a positive real-world distance or scale ratio.');
      return;
    }
    const factor = nextMmPerUnit / mmPerUnit;
    commit({
      ...mapDocumentPoints(document, factor),
      calibration: { model_unit: 'mm', mm_per_unit: nextMmPerUnit, ...metadata },
    });
    setCalibrationError('');
    setCalibrationPoints([]);
    setCalibrationMode(false);
  };
  const applyNumericScale = () => {
    const ratio = Number(calibrationRatio);
    if (!(ratio > 0) || !Number.isFinite(ratio)) {
      setCalibrationError('Scale must be a positive number, for example 50 for 1:50.');
      return;
    }
    setCalibration(ratio, { method: 'ratio', ratio });
  };
  const applyTwoPointCalibration = () => {
    const distanceUnits = calibrationPoints.length === 2 ? distance(calibrationPoints[0], calibrationPoints[1]) : 0;
    const realDistance = Number(knownDistance);
    if (!(distanceUnits > 0) || !(realDistance > 0) || !Number.isFinite(realDistance)) {
      setCalibrationError('Select two distinct points and enter their known distance in millimetres.');
      return;
    }
    setCalibration(realDistance / distanceUnits, {
      method: 'two_point',
      reference_distance_units: distanceUnits,
      known_distance_mm: realDistance,
    });
    setCalibrationRatio(String(realDistance / distanceUnits));
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
  const replaceSegmentStart = (segment: FootprintSegment, point: FootprintPoint): FootprintSegment => {
    if (segment.type === 'freehand') return { ...segment, points: [point, ...segment.points.slice(1)] };
    return { ...segment, start: point };
  };
  const replaceSegmentEnd = (segment: FootprintSegment, point: FootprintPoint): FootprintSegment => {
    if (segment.type === 'freehand') return { ...segment, points: [...segment.points.slice(0, -1), point] };
    return { ...segment, end: point };
  };
  const resizeSegment = (segmentIndex: number, targetLength: number) => {
    const segment = document.segments[segmentIndex];
    if (!segment || !(targetLength > 0) || !Number.isFinite(targetLength)) return null;
    const currentLength = segmentLength(segment, document.sampling.quadratic_steps);
    if (!(currentLength > 0.01)) return null;
    const preserveEnd = document.closed && segmentIndex === document.segments.length - 1;
    const anchor = preserveEnd ? segmentEnd(segment) : segmentStart(segment);
    const factor = targetLength / currentLength;
    const scale = (point: FootprintPoint) => ({
      x: anchor.x + (point.x - anchor.x) * factor,
      y: anchor.y + (point.y - anchor.y) * factor,
    });
    const resized: FootprintSegment = segment.type === 'freehand'
      ? { ...segment, points: segment.points.map(scale) }
      : segment.type === 'quadratic'
        ? { ...segment, start: scale(segment.start), control: scale(segment.control), end: scale(segment.end) }
        : { ...segment, start: scale(segment.start), end: scale(segment.end) };
    const segments = document.segments.map((item, index) => index === segmentIndex ? resized : item);
    if (preserveEnd && segmentIndex > 0) {
      segments[segmentIndex - 1] = replaceSegmentEnd(segments[segmentIndex - 1], segmentStart(resized));
      if (document.closed) segments[0] = replaceSegmentStart(segments[0], segmentEnd(resized));
    } else if (segmentIndex < segments.length - 1) {
      segments[segmentIndex + 1] = replaceSegmentStart(segments[segmentIndex + 1], segmentEnd(resized));
    }
    return { ...document, segments };
  };
  const editSegmentLength = (segmentIndex: number, value: string) => {
    const target = Number(value);
    const next = resizeSegment(segmentIndex, target);
    if (!next) {
      setSegmentEditNotice(`Segment ${segmentIndex + 1} needs a positive numeric length.`);
      return;
    }
    commit(next);
    const nextValidation = validateEditorDocument(next);
    setSegmentEditNotice(nextValidation.valid
      ? `Segment ${segmentIndex + 1} updated and connections preserved.`
      : `Segment ${segmentIndex + 1} updated, but validation needs attention: ${nextValidation.message}`);
  };
  const selectSegment = (event: React.PointerEvent<SVGPathElement>, index: number) => {
    event.stopPropagation();
    if (mode !== 'select' || calibrationMode || measurementMode) return;
    setSelectedSegment(index);
    setSegmentEditNotice(`Segment ${index + 1} selected.`);
  };
  const insertPointOnSelected = () => {
    if (selectedSegment === null) return;
    const segment = document.segments[selectedSegment];
    if (!segment) return;
    let replacements: FootprintSegment[];
    if (segment.type === 'line') {
      const middle = lerp(segment.start, segment.end, 0.5);
      replacements = [
        { type: 'line', start: segment.start, end: middle },
        { type: 'line', start: middle, end: segment.end },
      ];
    } else if (segment.type === 'quadratic') {
      const leftControl = lerp(segment.start, segment.control, 0.5);
      const rightControl = lerp(segment.control, segment.end, 0.5);
      const middle = pointOnQuadratic(segment, 0.5);
      replacements = [
        { type: 'quadratic', start: segment.start, control: leftControl, end: middle },
        { type: 'quadratic', start: middle, control: rightControl, end: segment.end },
      ];
    } else {
      const middleIndex = Math.max(1, Math.min(segment.points.length - 2, Math.floor(segment.points.length / 2)));
      if (segment.points.length < 3) return;
      replacements = [
        { type: 'freehand', points: segment.points.slice(0, middleIndex + 1) },
        { type: 'freehand', points: segment.points.slice(middleIndex) },
      ];
    }
    commit({ ...document, segments: [...document.segments.slice(0, selectedSegment), ...replacements, ...document.segments.slice(selectedSegment + 1)] });
    setSegmentEditNotice(`Point inserted on segment ${selectedSegment + 1}; the outline shape was preserved.`);
  };
  const convertSelectedToCurve = () => {
    if (selectedSegment === null) return;
    const segment = document.segments[selectedSegment];
    if (segment?.type !== 'line') return;
    const middle = lerp(segment.start, segment.end, 0.5);
    const chord = distance(segment.start, segment.end);
    const dx = segment.end.x - segment.start.x;
    const dy = segment.end.y - segment.start.y;
    const control = chord > 0
      ? { x: middle.x - dy * 0.15, y: middle.y + dx * 0.15 }
      : middle;
    commit({
      ...document,
      segments: document.segments.map((item, index) => index === selectedSegment
        ? { type: 'quadratic', start: segment.start, control, end: segment.end }
        : item),
    });
    setSegmentEditNotice(`Segment ${selectedSegment + 1} converted to a quadratic curve with its endpoints preserved.`);
  };
  const deleteSelected = () => {
    if (selectedSegment === null) return;
    const selectedBordersOpenGap = selectedSegment === 0 || selectedSegment === document.segments.length - 1;
    if (!document.closed && !selectedBordersOpenGap) {
      setSegmentEditNotice('Only a segment beside the open gap can be deleted. Delete from either end, or close the outline first.');
      return;
    }
    const removedIndex = selectedSegment;
    let segments = document.segments.filter((_, index) => index !== removedIndex);
    if (document.closed && segments.length) {
      segments = [
        ...document.segments.slice(removedIndex + 1),
        ...document.segments.slice(0, removedIndex),
      ];
    }
    const next = { ...document, closed: false, segments };
    commit(next);
    setPendingStart(null);
    setMode('select');
    setSelectedSegment(null);
    setSegmentEditNotice(`Segment ${removedIndex + 1} deleted. You can delete another segment beside the gap, or choose a drawing tool to rebuild the span.`);
  };
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
    const displayPoint = pointFromEvent(event);
    setKeyboardPlacement(false);
    setPointerPoint(displayPoint);
    if (!displayPoint) return;
    if (measurementMode) {
      event.preventDefault();
      setMeasurementPoints(points => {
        if (points.length >= 2) return [displayPoint];
        if (points.length === 1 && distance(points[0], displayPoint) < 0.0001) return points;
        return [...points, displayPoint];
      });
      return;
    }
    if (calibrationMode) {
      event.preventDefault();
      setCalibrationPoints(points => points.length >= 2 ? [displayPoint] : [...points, displayPoint]);
      setCalibrationError('');
      return;
    }
    if (document.closed || mode === 'select') return;
    if (pendingStart && displayFirstPoint && canClose && distance(displayPoint, displayFirstPoint) <= snapTolerance) {
      event.preventDefault();
      setSnapTarget(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    addPoint(modelPointFromDisplay(displayPoint));
  };
  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const displayPoint = pointFromEvent(event);
    if (!calibrationMode && !measurementMode) setPointerPoint(displayPoint);
    if (!displayPoint) {
      setSnapTarget(false);
      return;
    }
    if (pendingStart && displayFirstPoint && canClose) setSnapTarget(distance(displayPoint, displayFirstPoint) <= snapTolerance);
    if (activeFreehand) setActiveFreehand(points => points ? [...points, modelPointFromDisplay(displayPoint)] : points);
    if (drag) {
      const point = modelPointFromDisplay(displayPoint);
      setDocument(drag.kind === 'control' ? updateControl(point, drag.segment) : updateVertex(point, drag.segment));
    }
  };
  const onPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if (snapTarget && !activeFreehand && !drag) close();
    if (activeFreehand) {
      if (activeFreehand.length > 1) commit({ ...document, segments: [...document.segments, { type: 'freehand', points: activeFreehand }] });
      setActiveFreehand(null);
      setPendingStart(null);
    }
    setSnapTarget(false);
    if (drag) {
      const origin = dragOrigin.current;
      if (origin) {
        setPast(previous => [...previous.slice(-49), origin]);
        setFuture([]);
      }
      dragOrigin.current = null;
      setDrag(null);
    }
    if (svgRef.current?.hasPointerCapture?.(event.pointerId)) svgRef.current.releasePointerCapture?.(event.pointerId);
  };
  const startDrag = (event: React.PointerEvent<SVGCircleElement>, kind: 'vertex' | 'control', segment: number) => {
    event.stopPropagation();
    if (measurementMode || calibrationMode || (document.closed && mode !== 'select')) return;
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
    setSnapTarget(false);
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
    setSelectedSegment(null);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setPast(previous => [...previous.slice(-49), clone(document)]);
    setFuture(previous => previous.slice(1));
    setDocument(next);
    setPendingStart(null);
    setSelectedSegment(null);
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
  const selectReferenceImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      setReferenceError(`“${file.name}” was not accepted. Choose a readable PNG, JPEG, WebP, or GIF image.`);
      return;
    }
    const url = URL.createObjectURL(file);
    const request = referenceRequestRef.current + 1;
    referenceRequestRef.current = request;
    if (pendingReferenceRef.current) URL.revokeObjectURL(pendingReferenceRef.current.url);
    const pending = { url, name: file.name };
    pendingReferenceRef.current = pending;
    setPendingReference(pending);
    setReferenceError('');
    const probe = new Image();
    probe.onload = () => {
      if (!mountedRef.current || referenceRequestRef.current !== request) {
        URL.revokeObjectURL(url);
        return;
      }
      if (file.type === 'image/gif') {
        staticGifFrame(probe).then(frame => {
          const readyUrl = URL.createObjectURL(frame);
          URL.revokeObjectURL(url);
          if (!mountedRef.current || referenceRequestRef.current !== request) {
            URL.revokeObjectURL(readyUrl);
            return;
          }
          pendingReferenceRef.current = null;
          setPendingReference(null);
          setReferenceImage(previous => {
            if (previous) URL.revokeObjectURL(previous.url);
            const ready = { url: readyUrl, name: file.name };
            referenceImageRef.current = ready;
            return ready;
          });
          setReferenceError('');
        }).catch(() => {
          URL.revokeObjectURL(url);
          if (!mountedRef.current || referenceRequestRef.current !== request) return;
          pendingReferenceRef.current = null;
          setPendingReference(null);
          setReferenceError(`“${file.name}” could not be read. Choose another supported image. The current reference image was kept.`);
        });
        return;
      }
      pendingReferenceRef.current = null;
      setPendingReference(null);
      setReferenceImage(previous => {
        if (previous) URL.revokeObjectURL(previous.url);
        const ready = { url, name: file.name };
        referenceImageRef.current = ready;
        return ready;
      });
      setReferenceError('');
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      if (!mountedRef.current || referenceRequestRef.current !== request) return;
      pendingReferenceRef.current = null;
      setPendingReference(null);
      setReferenceError(`“${file.name}” could not be read. Choose another supported image. The current reference image was kept.`);
    };
    probe.src = url;
  };
  const removeReferenceImage = () => {
    referenceRequestRef.current += 1;
    if (pendingReferenceRef.current) URL.revokeObjectURL(pendingReferenceRef.current.url);
    pendingReferenceRef.current = null;
    setPendingReference(null);
    setReferenceImage(previous => {
      if (previous) URL.revokeObjectURL(previous.url);
      referenceImageRef.current = null;
      return null;
    });
    setReferenceError('');
  };
  const toggleMeasurementMode = () => {
    setMeasurementMode(active => {
      const next = !active;
      if (next) {
        setCalibrationMode(false);
        setCalibrationPoints([]);
        setCalibrationError('');
        setActiveFreehand(null);
        setSnapTarget(false);
      }
      return next;
    });
  };
  const onCanvasKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (measurementMode) {
        setMeasurementMode(false);
        return;
      }
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
      setKeyboardPlacement(true);
      setPointerPoint(null);
      setKeyboardPoint(point => ({ x: point.x + delta[event.key].x, y: point.y + delta[event.key].y }));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setKeyboardPlacement(true);
      if (measurementMode) {
        setMeasurementPoints(points => {
          if (points.length >= 2) return [keyboardPoint];
          if (points.length === 1 && distance(points[0], keyboardPoint) < 0.0001) return points;
          return [...points, keyboardPoint];
        });
        return;
      }
      if (mode === 'freehand') {
        const keyboardModelPoint = modelPointFromDisplay(keyboardPoint);
        const from = lastPoint || keyboardModelPoint;
        commit({ ...document, segments: [...document.segments, { type: 'freehand', points: [from, keyboardModelPoint] }] });
      } else {
        addPoint(modelPointFromDisplay(keyboardPoint));
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
  const editCurve = (index: number, field: 'curvature' | 'angle', value: string) => {
    const segment = document.segments[index];
    if (segment?.type !== 'quadratic') return;
    const metrics = curveMetrics(segment);
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) return;
    if (field === 'angle' && (Math.abs(Math.sin(nextValue * Math.PI / 180)) < 0.1)) {
      setSegmentEditNotice(`Curve ${index + 1} angle must stay away from 0° and 180° so its curvature is defined.`);
      return;
    }
    const nextControl = controlFromMetrics(
      segment,
      field === 'curvature' ? nextValue : metrics.curvature,
      field === 'angle' ? nextValue : metrics.angle,
    );
    if (!Number.isFinite(nextControl.x) || !Number.isFinite(nextControl.y)
      || Math.abs(nextControl.x) > maxAbsCoordinateMm || Math.abs(nextControl.y) > maxAbsCoordinateMm) {
      setSegmentEditNotice(`Curve ${index + 1} would place its handle outside the supported model-space range. Use a steeper angle or smaller curvature.`);
      return;
    }
    const next = updateControl(nextControl, index);
    commit(next);
    const nextValidation = validateEditorDocument(next);
    setSegmentEditNotice(nextValidation.valid
      ? `Curve ${index + 1} updated and connected.`
      : `Curve ${index + 1} updated, but validation needs attention: ${nextValidation.message}`);
  };
  const activeQuadraticIndex = displayDocument.segments.reduce(
    (latest, segment, index) => segment.type === 'quadratic' ? index : latest,
    -1,
  );

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
                <button key={value} type="button" aria-pressed={!measurementMode && mode === value} onClick={() => { setMeasurementMode(false); setCalibrationMode(false); setCalibrationPoints([]); setMode(value); setSelectedSegment(null); setPendingStart(value === 'freehand' || value === 'select' ? null : lastPoint); }} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium ${!measurementMode && mode === value ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-stone-200 text-stone-600 hover:bg-stone-50'}`}><Icon className="h-3.5 w-3.5" />{label}</button>
              ))}
              <button type="button" aria-pressed={measurementMode} onClick={toggleMeasurementMode} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium ${measurementMode ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-stone-200 text-stone-600 hover:bg-stone-50'}`}><Ruler className="h-3.5 w-3.5" />Measure</button>
              <span className="ml-auto flex items-center gap-1">
                <button type="button" onClick={() => setZoom(zoomLevel / 2)} disabled={zoomLevel <= 1} className="rounded-lg border border-stone-200 p-2 text-stone-600 disabled:opacity-30" aria-label="Zoom out"><ZoomOut className="h-4 w-4" /></button>
                <button type="button" onClick={() => setZoom(1)} disabled={zoomLevel <= 1} className="min-w-12 rounded-lg border border-stone-200 px-2 py-2 text-xs font-semibold text-stone-600 disabled:opacity-50" aria-label="Reset zoom">{Math.round(zoomLevel * 100)}%</button>
                <button type="button" onClick={() => setZoom(zoomLevel * 2)} disabled={zoomLevel >= 8} className="rounded-lg border border-stone-200 p-2 text-stone-600 disabled:opacity-30" aria-label="Zoom in"><ZoomIn className="h-4 w-4" /></button>
                <button type="button" onClick={undo} disabled={!past.length} className="rounded-lg border border-stone-200 p-2 text-stone-600 disabled:opacity-30" aria-label="Undo"><Undo2 className="h-4 w-4" /></button>
                <button type="button" onClick={redo} disabled={!future.length} className="rounded-lg border border-stone-200 p-2 text-stone-600 disabled:opacity-30" aria-label="Redo"><Redo2 className="h-4 w-4" /></button>
                <button type="button" onClick={reset} className={`rounded-lg border px-2 py-2 text-xs ${resetConfirm ? 'border-red-300 bg-red-50 text-red-700' : 'border-stone-200 text-stone-600'}`} aria-label="Reset footprint">{resetConfirm ? 'Confirm reset' : <RotateCcw className="h-4 w-4" />}</button>
                {resetConfirm && <button type="button" onClick={() => setResetConfirm(false)} className="text-xs text-stone-500">Keep drawing</button>}
              </span>
            </div>
            <div className="relative overflow-hidden rounded-xl border border-sky-200 bg-[linear-gradient( to right,rgba(14,116,144,.08)_1px,transparent_1px),linear-gradient(to bottom,rgba(14,116,144,.08)_1px,transparent_1px)] bg-[size:32px_32px]">
              <svg ref={svgRef} viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`} preserveAspectRatio="xMidYMid meet" data-testid="footprint-drawing-surface" className={`h-[min(58vh,520px)] w-full touch-none focus:outline-none focus:ring-2 focus:ring-inset focus:ring-sky-500 ${calibrationMode || measurementMode ? 'cursor-crosshair' : mode === 'select' ? 'cursor-default' : 'cursor-crosshair'}`} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onPointerLeave={() => { if (!drag && !activeFreehand) setPointerPoint(null); setSnapTarget(false); }} onKeyDown={onCanvasKeyDown} tabIndex={0} role="img" aria-label="Footprint drawing surface" aria-describedby="footprint-keyboard-help">
                {referenceImage && <image data-testid="footprint-reference-image" href={referenceImage.url} x={box.x} y={box.y} width={box.width} height={box.height} preserveAspectRatio="xMidYMid meet" opacity={referenceOpacity / 100} pointerEvents="none" aria-hidden="true" />}
                {pointerPoint && !calibrationMode && !measurementMode && <>
                  <line data-testid="pointer-guide-horizontal" x1={viewport.x} y1={pointerPoint.y} x2={viewport.x + viewport.width} y2={pointerPoint.y} stroke="#64748b" strokeOpacity=".35" strokeWidth={Math.max(1, viewport.width / 700)} strokeDasharray="5 6" pointerEvents="none" aria-hidden="true" />
                  <line data-testid="pointer-guide-vertical" x1={pointerPoint.x} y1={viewport.y} x2={pointerPoint.x} y2={viewport.y + viewport.height} stroke="#64748b" strokeOpacity=".35" strokeWidth={Math.max(1, viewport.width / 700)} strokeDasharray="5 6" pointerEvents="none" aria-hidden="true" />
                </>}
                <path d={pathFor(displayDocument)} fill={document.closed ? '#bae6fd' : 'none'} fillOpacity=".65" stroke="#0369a1" strokeWidth={Math.max(3, box.width / 180)} strokeLinejoin="round" strokeLinecap="round" />
                {activeFreehand && <polyline points={activeFreehand.map(point => mapPoint(point, 1 / mmPerUnit)).map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#0284c7" strokeWidth={Math.max(3, box.width / 180)} />}
                {displayDocument.segments.map((segment, index) => {
                  const start = segmentStart(segment);
                  const end = segmentEnd(segment);
                  const segmentPath = pathFor({ ...displayDocument, closed: false, segments: [segment] });
                  return <g key={`${segment.type}-${index}`}>
                    {mode === 'select' && !calibrationMode && !measurementMode && <path
                      d={segmentPath}
                      fill="none"
                      stroke={selectedSegment === index ? '#f59e0b' : 'transparent'}
                      strokeWidth={selectedSegment === index ? Math.max(7, box.width / 100) : Math.max(22, box.width / 28)}
                      strokeOpacity={selectedSegment === index ? 0.9 : 1}
                      strokeLinecap="round"
                      pointerEvents="stroke"
                      onPointerDown={event => selectSegment(event, index)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          event.stopPropagation();
                          setSelectedSegment(index);
                          setSegmentEditNotice(`Segment ${index + 1} selected.`);
                        }
                      }}
                      aria-label={`Select segment ${index + 1}, ${segment.type}`}
                      aria-pressed={selectedSegment === index}
                      tabIndex={0}
                      role="button"
                    />}
                    {mode === 'select' && !calibrationMode && !measurementMode && <>
                      <circle cx={start.x} cy={start.y} r={Math.max(14, box.width / 34)} fill="transparent" onPointerDown={event => startDrag(event, 'vertex', index)} />
                      <circle cx={start.x} cy={start.y} r={Math.max(8, box.width / 72)} fill="#fff" stroke="#0369a1" strokeWidth="3" pointerEvents="none" />
                      <circle cx={end.x} cy={end.y} r={Math.max(14, box.width / 34)} fill="transparent" onPointerDown={event => startDrag(event, 'vertex', index + 1)} />
                      <circle cx={end.x} cy={end.y} r={Math.max(7, box.width / 82)} fill="#fff" stroke="#0e7490" strokeWidth="2" pointerEvents="none" />
                    </>}
                    {(mode === 'select' || (mode === 'curve' && index === activeQuadraticIndex))
                      && !calibrationMode && !measurementMode && segment.type === 'quadratic' && <>
                      <line x1={segment.start.x} y1={segment.start.y} x2={segment.control.x} y2={segment.control.y} stroke="#38bdf8" strokeDasharray="5 4" pointerEvents="none" />
                      <line x1={segment.control.x} y1={segment.control.y} x2={segment.end.x} y2={segment.end.y} stroke="#38bdf8" strokeDasharray="5 4" pointerEvents="none" />
                      <circle cx={segment.control.x} cy={segment.control.y} r={Math.max(16, box.width / 32)} fill="transparent" onPointerDown={event => startDrag(event, 'control', index)} aria-label={`Drag yellow curve handle ${index + 1} to adjust the curve`} />
                      <circle cx={segment.control.x} cy={segment.control.y} r={Math.max(9, box.width / 68)} fill="#fef08a" stroke="#a16207" strokeWidth="3" pointerEvents="none" />
                    </>}
                  </g>;
                })}
                {pendingStart && (() => {
                  const point = mapPoint(pendingStart, 1 / mmPerUnit);
                  return <circle cx={point.x} cy={point.y} r={Math.max(7, box.width / 85)} fill="#fef08a" stroke="#a16207" strokeWidth="3" />;
                })()}
                {displayFirstPoint && canClose && <>
                  <circle cx={displayFirstPoint.x} cy={displayFirstPoint.y} r={snapTarget ? Math.max(22, box.width / 28) : Math.max(16, box.width / 38)} fill={snapTarget ? '#bbf7d0' : '#e0f2fe'} fillOpacity=".8" stroke={snapTarget ? '#15803d' : '#0284c7'} strokeWidth="3" strokeDasharray={snapTarget ? undefined : '5 4'} pointerEvents="none" />
                  {snapTarget && <text x={displayFirstPoint.x} y={displayFirstPoint.y - Math.max(26, box.width / 25)} textAnchor="middle" fill="#166534" fontSize={Math.max(13, box.width / 55)} fontWeight="700" pointerEvents="none">Release to close</text>}
                </>}
                {calibrationPoints.map((point, index) => <g key={`calibration-${index}`} pointerEvents="none">
                  <circle cx={point.x} cy={point.y} r={Math.max(10, box.width / 60)} fill="#fb923c" stroke="#fff" strokeWidth="3" />
                  <text x={point.x} y={point.y - Math.max(14, box.width / 72)} textAnchor="middle" fill="#9a3412" fontSize={Math.max(12, box.width / 65)} fontWeight="700">{index + 1}</text>
                </g>)}
                {measurementPoints.length === 2 && <line x1={measurementPoints[0].x} y1={measurementPoints[0].y} x2={measurementPoints[1].x} y2={measurementPoints[1].y} stroke="#7c3aed" strokeWidth={Math.max(3, box.width / 180)} strokeDasharray="8 5" pointerEvents="none" />}
                {measurementPoints.map((point, index) => <circle key={`measurement-${index}`} cx={point.x} cy={point.y} r={Math.max(9, box.width / 65)} fill="#8b5cf6" stroke="#fff" strokeWidth="3" pointerEvents="none" />)}
                {keyboardPlacement && <circle data-testid="keyboard-position-marker" cx={keyboardPoint.x} cy={keyboardPoint.y} r={Math.max(5, box.width / 110)} fill="#f97316" stroke="#fff" strokeWidth="2" pointerEvents="none" />}
              </svg>
              {!document.segments.length && !calibrationMode && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-xs text-stone-500">Choose Straight, Curve, or Freehand, then draw connected segments here.</div>}
              {calibrationMode && <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-orange-50/95 px-3 py-2 text-xs font-semibold text-orange-800 shadow-sm">{calibrationPoints.length === 0 ? 'Select calibration point 1' : calibrationPoints.length === 1 ? 'Select calibration point 2' : 'Two points selected — enter the known distance'}</div>}
              {measurementMode && <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-violet-50/95 px-3 py-2 text-xs font-semibold text-violet-800 shadow-sm">{measurementPoints.length === 0 ? 'Select measurement point 1' : measurementPoints.length === 1 ? 'Select measurement point 2' : `${temporaryDistanceMm!.toFixed(1)} mm`}</div>}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" onClick={close} disabled={!canClose} className="inline-flex min-h-11 min-w-44 items-center justify-center gap-2 rounded-xl bg-sky-700 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-40" title={canClose ? 'Connect the last point exactly to the first point' : 'Draw at least two connected segments first'}><Check className="h-4 w-4" />Close outline</button>
              <span className="self-center text-xs text-stone-500">
                {document.closed ? 'Outline closed. Use Select and edit to refine it.' : canClose ? 'Click near the highlighted start point to snap closed, or use Close outline.' : mode === 'select' ? 'Drag blue vertices or yellow curve handles to edit.' : pendingStart ? 'Click the next point to add a segment.' : 'Click or drag to start the next segment.'}
              </span>
            </div>
            <p id="footprint-keyboard-help" className="mt-2 text-xs text-stone-500">Zoom with the controls or mouse wheel over the detail you want to inspect. Keyboard placement: focus the drawing surface and press an Arrow key to show and move the orange position marker; press Enter to place at that exact drawing coordinate, C to close, and Ctrl/Cmd+Z or Y to undo/redo. With Quadratic curve active, drag the yellow handle to adjust the latest curve.</p>
          </div>
          <aside className="space-y-3">
            {mode === 'select' && document.segments.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-900">Selected segment</div>
              <p className="mt-1 text-xs text-stone-600">{selectedSegment === null ? 'Select a segment directly on the outline.' : `Segment ${selectedSegment + 1} · ${document.segments[selectedSegment]?.type}`}</p>
              <div className="mt-2 grid gap-2">
                <button type="button" disabled={selectedSegment === null || document.segments[selectedSegment]?.type === 'freehand' && (document.segments[selectedSegment] as Extract<FootprintSegment, { type: 'freehand' }>).points.length < 3} onClick={insertPointOnSelected} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-900 disabled:opacity-40" aria-label="Insert point on selected segment"><Scissors className="h-4 w-4" />Insert point</button>
                <button type="button" disabled={selectedSegment === null || document.segments[selectedSegment]?.type !== 'line'} onClick={convertSelectedToCurve} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-900 disabled:opacity-40" aria-label="Convert selected segment to quadratic curve"><GitBranch className="h-4 w-4" />Convert to curve</button>
                <button type="button"
                  disabled={selectedSegment === null || (!document.closed && selectedSegment !== 0 && selectedSegment !== document.segments.length - 1)}
                  onClick={deleteSelected}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-40"
                  aria-label="Delete selected segment"
                  title={!document.closed && selectedSegment !== null && selectedSegment !== 0 && selectedSegment !== document.segments.length - 1
                    ? 'Only segments beside the open gap can be deleted'
                    : undefined}>
                  <Trash2 className="h-4 w-4" />Delete segment
                </button>
              </div>
            </div>}
            <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-700"><ImageIcon className="h-4 w-4" />Reference image</div>
              <p className="mt-1 text-xs text-stone-500">Session-only tracing aid. It is never saved with the footprint.</p>
              <label className={`mt-2 inline-flex min-h-10 items-center justify-center rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 ${pendingReference ? 'cursor-wait opacity-60' : 'cursor-pointer'}`}>
                {pendingReference ? 'Loading image…' : referenceImage ? 'Replace image' : 'Choose image'}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" aria-label={referenceImage ? 'Replace reference image' : 'Choose reference image'} onChange={selectReferenceImage} disabled={!!pendingReference} />
              </label>
              {pendingReference && <p className="mt-2 text-xs font-medium text-sky-700" role="status" aria-live="polite">Loading “{pendingReference.name}”…</p>}
              {referenceImage && <>
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-stone-600"><span className="truncate" title={referenceImage.name}>{referenceImage.name}</span><button type="button" onClick={removeReferenceImage} className="font-semibold text-red-700">Remove</button></div>
                <p className="mt-1 text-xs font-medium text-emerald-700" role="status">“{referenceImage.name}” is ready to trace.</p>
                <label className="mt-2 block text-xs font-medium text-stone-600" htmlFor="reference-opacity">Reference image opacity: {referenceOpacity}%</label>
                <input id="reference-opacity" aria-label="Reference image opacity" type="range" min="10" max="80" value={referenceOpacity} onChange={event => setReferenceOpacity(Number(event.target.value))} className="mt-1 w-full" />
              </>}
              {referenceError && <p className="mt-2 text-xs font-medium text-red-700" role="alert">{referenceError}</p>}
            </div>
            <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-800"><Ruler className="h-4 w-4" />Temporary measurement</div>
              <button type="button" aria-pressed={measurementMode} onClick={toggleMeasurementMode} className="mt-2 min-h-10 w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-800">{measurementMode ? 'Leave measurement mode' : 'Measure two points'}</button>
              {temporaryDistanceMm !== null && <p className="mt-2 text-sm font-bold text-violet-900" role="status">{temporaryDistanceMm.toFixed(1)} mm</p>}
              {measurementPoints.length > 0 && <button type="button" onClick={() => setMeasurementPoints([])} className="mt-2 text-xs font-semibold text-violet-700">Clear measurement</button>}
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sky-800"><Ruler className="h-4 w-4" />Drawing scale</div>
              <div className="mt-2 rounded-lg bg-white px-3 py-2 text-sm font-bold text-sky-800" aria-label="Active drawing scale">Active: 1 : {Number(mmPerUnit.toFixed(6))} <span className="text-xs font-normal text-stone-500">({Number(mmPerUnit.toFixed(6))} mm per drawing unit)</span></div>
              <label className="mt-3 block text-xs font-medium text-stone-600" htmlFor="footprint-scale-ratio">Numeric scale ratio</label>
              <div className="mt-1 flex gap-2">
                <span className="self-center text-sm font-semibold text-stone-500">1 :</span>
                <input id="footprint-scale-ratio" type="number" min="0.000001" step="any" value={calibrationRatio} onChange={event => setCalibrationRatio(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-stone-200 px-2 py-1.5 text-sm" />
                <button type="button" onClick={applyNumericScale} className="rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white">Apply</button>
              </div>
              <button type="button" aria-pressed={calibrationMode} onClick={() => { setMeasurementMode(false); setCalibrationMode(value => !value); setCalibrationPoints([]); setCalibrationError(''); }} className={`mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${calibrationMode ? 'border-orange-400 bg-orange-50 text-orange-800' : 'border-stone-200 bg-white text-stone-700'}`}><Crosshair className="h-4 w-4" />{calibrationMode ? 'Stop selecting points' : 'Calibrate from two points'}</button>
              {calibrationPoints.length === 2 && (
                <div className="mt-2 rounded-lg border border-orange-200 bg-orange-50 p-2">
                  <label className="block text-xs font-medium text-orange-900" htmlFor="known-calibration-distance">Known distance (mm)</label>
                  <div className="mt-1 flex gap-2">
                    <input id="known-calibration-distance" type="number" min="0.01" step="any" value={knownDistance} onChange={event => setKnownDistance(event.target.value)} className="min-w-0 flex-1 rounded-md border border-orange-200 px-2 py-1.5 text-sm" />
                    <button type="button" onClick={applyTwoPointCalibration} className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white">Calibrate</button>
                  </div>
                  <p className="mt-1 text-[11px] text-orange-800">Selected span: {distance(calibrationPoints[0], calibrationPoints[1]).toFixed(2)} drawing units.</p>
                </div>
              )}
              {calibrationError && <p className="mt-2 text-xs font-medium text-red-700" role="alert">{calibrationError}</p>}
            </div>
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
                <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Segments & dimensions</div>
                <p className="mt-1 text-xs text-stone-500">Edit a real-world length, or focus a point and use Arrow keys to move it by 25 mm.</p>
                {segmentEditNotice && <div className={`mt-2 flex gap-1.5 rounded-md px-2 py-1.5 text-xs ${validation.valid ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`} role="status">{!validation.valid && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}{segmentEditNotice}</div>}
                <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
                  {document.segments.map((segment, index) => {
                    const vertex = segmentStart(segment);
                    const length = segmentLength(segment, document.sampling.quadratic_steps);
                    const metrics = segment.type === 'quadratic' ? curveMetrics(segment) : null;
                    return (
                      <div key={`edit-point-${index}`} className={`rounded-lg border p-2 ${mode === 'select' && selectedSegment === index ? 'border-amber-400 bg-amber-50/50' : 'border-stone-200'}`}>
                        <div className="flex items-center justify-between gap-2">
                          {mode === 'select'
                            ? <button type="button" aria-pressed={selectedSegment === index} onClick={() => { setSelectedSegment(index); setSegmentEditNotice(`Segment ${index + 1} selected.`); }} className="rounded px-1 text-left text-xs font-semibold text-stone-700 focus:outline-none focus:ring-2 focus:ring-amber-400" aria-label={`Select segment ${index + 1} from segment list`}>Segment {index + 1} · {segment.type}</button>
                            : <span className="text-xs font-semibold text-stone-700">Segment {index + 1} · {segment.type}</span>}
                          <span className="font-mono text-xs text-stone-500">{length.toFixed(1)} mm</span>
                        </div>
                        <label className="mt-1.5 block text-[11px] font-medium text-stone-500" htmlFor={`segment-length-${index}`}>Real-world length (mm)</label>
                        <input id={`segment-length-${index}`} aria-label={`Segment ${index + 1} real-world length in millimetres`} type="number" min="0.01" step="0.1" defaultValue={length.toFixed(1)} key={`${index}-${length.toFixed(3)}`} onBlur={event => editSegmentLength(index, event.target.value)} className="mt-1 w-full rounded-md border border-stone-200 px-2 py-1 font-mono text-xs focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200" />
                        <button
                          type="button"
                          onKeyDown={event => nudgeGeometry(event, 'vertex', index, vertex)}
                          className="w-full rounded-md border border-stone-200 px-2 py-1 text-left font-mono text-xs text-stone-600 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                          aria-label={`Vertex ${index + 1}, ${vertex.x.toFixed(1)} millimetres x, ${vertex.y.toFixed(1)} millimetres y`}
                        >
                          Vertex {index + 1}: {vertex.x.toFixed(1)}, {vertex.y.toFixed(1)} mm
                        </button>
                        {segment.type === 'quadratic' && metrics && <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2">
                          <button type="button" onKeyDown={event => nudgeGeometry(event, 'control', index, segment.control)} className="w-full rounded-md px-1 py-1 text-left font-mono text-xs text-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-300" aria-label={`Curve handle ${index + 1}, ${segment.control.x.toFixed(1)} millimetres x, ${segment.control.y.toFixed(1)} millimetres y`}>Curve handle: {segment.control.x.toFixed(1)}, {segment.control.y.toFixed(1)} mm</button>
                          <div className="mt-1.5 grid grid-cols-2 gap-2">
                            <label className="text-[11px] text-amber-900">Curvature (mm)<input aria-label={`Curve ${index + 1} curvature in millimetres`} type="number" step="1" defaultValue={metrics.curvature.toFixed(1)} onBlur={event => editCurve(index, 'curvature', event.target.value)} className="mt-0.5 w-full rounded border border-amber-200 bg-white px-1.5 py-1 font-mono text-xs" /></label>
                            <label className="text-[11px] text-amber-900">Handle angle (°)<input aria-label={`Curve ${index + 1} handle angle in degrees`} type="number" step="1" min="-180" max="180" defaultValue={metrics.angle.toFixed(1)} onBlur={event => editCurve(index, 'angle', event.target.value)} className="mt-0.5 w-full rounded border border-amber-200 bg-white px-1.5 py-1 font-mono text-xs" /></label>
                          </div>
                        </div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-xs text-sky-800"><strong>Canonical units:</strong> all saved coordinates remain model-space millimetres. Drawing scale metadata reopens with this footprint; screen pixels are never stored.</div>
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