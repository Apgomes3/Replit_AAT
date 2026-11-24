// Counterflow temperature profile along the plate pack (same drawing as the sizer artifact).
import { fmt, PheResult, profilePoints } from '../../lib/plateHeatExchanger';

const SCREEN = { hot: '#c4512b', cold: '#2370b3', line: '#e7e5e4', muted: '#78716c' };

function niceStep(s: number) { const p = Math.pow(10, Math.floor(Math.log10(s))), m = s / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; }

export function ProfileChart({ r, print = false }: { r: PheResult; print?: boolean }) {
  const { H, C, dT1, dT2 } = r;
  const col = SCREEN;
  const W = 640, Ht = 230, ml = 46, mr = 88, mt = 16, mb = 34, pw = W - ml - mr, ph = Ht - mt - mb;
  const lo = Math.min(C.Tin, C.Tout, H.Tout), hi = Math.max(H.Tin, H.Tout, C.Tout);
  const pad = Math.max(1, (hi - lo) * 0.08), y0 = Math.floor(lo - pad), y1 = Math.ceil(hi + pad);
  const X = (x: number) => ml + x * pw, Y = (T: number) => mt + (1 - (T - y0) / (y1 - y0)) * ph;
  const pts = profilePoints(r);
  const path = (k: 'hot' | 'cold') => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p[k]).toFixed(1)}`).join('');
  const step = niceStep((y1 - y0) / 5);
  const grid: number[] = [];
  for (let v = Math.ceil(y0 / step) * step; v <= y1 + 1e-9; v += step) grid.push(v);
  return (
    <svg viewBox={`0 0 ${W} ${Ht}`} width="100%" role="img" aria-label="Counterflow temperature profile along the plate pack"
      style={{ fontFamily: print ? 'Arial, Helvetica, sans-serif' : 'ui-monospace, Menlo, Consolas, monospace', fontSize: 11 }}>
      {grid.map(v => <g key={v}>
        <line x1={ml} x2={ml + pw} y1={Y(v)} y2={Y(v)} stroke={col.line} />
        <text x={ml - 6} y={Y(v) + 4} textAnchor="end" fill={col.muted}>{fmt(v, step < 1 ? 1 : 0)}</text>
      </g>)}
      <line x1={ml} x2={ml} y1={mt} y2={mt + ph} stroke={col.muted} />
      <line x1={ml} x2={ml + pw} y1={mt + ph} y2={mt + ph} stroke={col.muted} />
      <line x1={X(0)} x2={X(0)} y1={Y(H.Tin)} y2={Y(C.Tout)} stroke={col.muted} strokeDasharray="3 3" />
      <line x1={X(1)} x2={X(1)} y1={Y(H.Tout)} y2={Y(C.Tin)} stroke={col.muted} strokeDasharray="3 3" />
      <path d={path('hot')} fill="none" stroke={col.hot} strokeWidth={2.5} />
      <path d={path('cold')} fill="none" stroke={col.cold} strokeWidth={2.5} />
      <circle cx={X(0)} cy={Y(H.Tin)} r={3.5} fill={col.hot} /><circle cx={X(1)} cy={Y(H.Tout)} r={3.5} fill={col.hot} />
      <circle cx={X(0)} cy={Y(C.Tout)} r={3.5} fill={col.cold} /><circle cx={X(1)} cy={Y(C.Tin)} r={3.5} fill={col.cold} />
      <text x={X(1) + 8} y={Y(H.Tout) + 4} fill={col.hot}>{fmt(H.Tout, 1)} °C out</text>
      <text x={X(1) + 8} y={Y(C.Tin) + 4} fill={col.cold}>{fmt(C.Tin, 1)} °C in</text>
      <text x={X(0) + 8} y={Y(H.Tin + (y1 - y0) * 0.06) + 4} fill={col.hot}>{fmt(H.Tin, 1)} °C in</text>
      <text x={X(0) + 8} y={Y(C.Tout - (y1 - y0) * 0.07) + 4} fill={col.cold}>{fmt(C.Tout, 1)} °C out</text>
      <text x={X(0.02)} y={Ht - 14} fill={col.hot}>{H.name} (hot) →</text>
      <text x={X(0.98)} y={Ht - 14} textAnchor="end" fill={col.cold}>← {C.name} (cold)</text>
      <text x={X(0) + 4} y={(Y(H.Tin) + Y(C.Tout)) / 2 + 4} fill={col.muted}>ΔT {fmt(dT1, 1)}</text>
      <text x={X(1) - 4} y={(Y(H.Tout) + Y(C.Tin)) / 2 + 4} textAnchor="end" fill={col.muted}>ΔT {fmt(dT2, 1)}</text>
    </svg>
  );
}
