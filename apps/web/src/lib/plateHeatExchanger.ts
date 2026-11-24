// Plate heat exchanger sizing on PHEWORLD (FL-HTEP) plates.
// A faithful port of the "Plate Heat Exchanger Sizer" artifact: same units, formulas, plate data and checks.
// Pure functions only (no DOM), so the page computes live and the tests compare against the artifact's own outputs.

export type FluidKind = 'water' | 'fresh' | 'sea' | 'pg' | 'eg';
export type Fluid = { kind: FluidKind; S?: number; c?: number };
export type Source = 'heatpump' | 'boiler' | 'chiller';
export type FlowMode = 'auto' | 'fixed';
export type PrimaryTempMode = 'both' | 'approach' | 'manual';
export type ConnPref = 'pref50' | 'any' | 'DN40' | 'DN50' | 'DN100' | 'DN150';

export type PheInputs = {
  duty: number; src: Source;
  pFl: Fluid; pTin: number; pTout: number; pOutMode: PrimaryTempMode; appK: number; appRef: 'out' | 'in'; pDT: number;
  pFlowMode: FlowMode; pFlow: number; pDp: number; pRf: number;
  sFl: Fluid; sTin: number; sTout: number; sFlowMode: FlowMode; sFlow: number; sDp: number; sRf: number;
  vTarget: number; margin: number;
  frame: string; passes: string; beta: string; mat: 'auto' | 'ti' | 'ss316' | 'smo';
  thk: number; conn: ConnPref; portDp: number; maxUnits: number;
};

export type NoteLevel = 'bad' | 'warn' | 'info' | 'ok';
export type PheNote = { lvl: NoteLevel; title: string; text: string };
export const notePlain = (n: PheNote) => (n.title ? `${n.title} ${n.text}` : n.text);

/* ---------- Defaults and presets ---------- */
export const DEFAULT_INPUTS: PheInputs = {
  duty: 150, src: 'heatpump',
  pFl: { kind: 'water' }, pTin: 40, pTout: 30, pOutMode: 'both', appK: 3, appRef: 'out', pDT: 5,
  pFlowMode: 'auto', pFlow: 26, pDp: 50, pRf: 0.01,
  sFl: { kind: 'sea', S: 35 }, sTin: 24, sTout: 27, sFlowMode: 'auto', sFlow: 45, sDp: 50, sRf: 0.04,
  vTarget: 0.3, margin: 10,
  frame: 'auto', passes: '1/1', beta: '45', mat: 'auto', thk: 0.5, conn: 'pref50', portDp: 10, maxUnits: 2,
};

export const PRESETS: Record<Source, { pFluid: 'water' | 'pg'; pTin: number; pTout: number; sTin: number; sTout: number; pDT: number }> = {
  heatpump: { pFluid: 'water', pTin: 40, pTout: 35, sTin: 24, sTout: 27, pDT: 5 },
  boiler: { pFluid: 'water', pTin: 70, pTout: 50, sTin: 24, sTout: 27, pDT: 15 },
  chiller: { pFluid: 'pg', pTin: 7, pTout: 12, sTin: 27, sTout: 24, pDT: 5 },
};

/** Applies the source preset the way the artifact does when the source changes. */
export function applyPreset(I: PheInputs, src: Source): PheInputs {
  const p = PRESETS[src];
  return {
    ...I, src, pDT: p.pDT, pTin: p.pTin, pTout: p.pTout, sTin: p.sTin, sTout: p.sTout, pRf: 0.01,
    pFl: p.pFluid === 'water' ? { kind: 'water' } : { kind: 'pg', c: I.pFl.c ?? 30 },
  };
}

/** Sets the primary temperatures from the approach and machine ΔT (artifact applyApproach). */
export function resolveInputs(I: PheInputs): PheInputs {
  const R = { ...I };
  if (R.pOutMode === 'manual') return R;
  const A = R.appK > 0 ? R.appK : 3, hot = R.sTout > R.sTin;
  const ref = R.appRef === 'out' ? R.sTout : R.sTin;
  R.pTout = Math.round((hot ? ref + A : ref - A) * 10) / 10;
  if (R.pOutMode === 'both') {
    const d = R.pDT > 0 ? R.pDT : 5;
    R.pTin = Math.round((hot ? R.pTout + d : R.pTout - d) * 10) / 10;
  }
  return R;
}

export function approachHint(I: PheInputs): string {
  if (I.pOutMode === 'manual') return 'Both primary temperatures typed by you.';
  const A = I.appK > 0 ? I.appK : 3, hot = I.sTout > I.sTin;
  const what = hot ? (I.src === 'boiler' ? 'boiler flow' : 'heat pump supply') : 'chilled water supply';
  return (I.appRef === 'out'
    ? `Primary leaves ${fmt(A, 1)} K ${hot ? 'above' : 'below'} the secondary outlet, so there is no temperature cross. This is the conservative setting.`
    : `Primary leaves ${fmt(A, 1)} K ${hot ? 'above' : 'below'} the secondary inlet. Closest approach, more area, less margin for fouling.`)
    + (I.pOutMode === 'both' ? ` The ${what} is then set ${fmt(I.pDT, 1)} K ${hot ? 'above' : 'below'} that, the ${hot ? 'lowest' : 'highest'} temperature that does the job, which is best for the machine's efficiency.` : '');
}

/* ---------- Formatting ---------- */
export function fmt(x: number, d = 1): string {
  if (!isFinite(x)) return '–';
  if (Math.abs(x) < 0.5 * Math.pow(10, -d)) x = 0;
  return x.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export const kPa = (x: number) => fmt(x / 1000, 1);

/* ---------- Fluid properties ---------- */
export type Props = { rho: number; cp: number; k: number; mu: number; frz: number };

// Seawater / pure water: Sharqawy, Lienhard & Zubair (2010), valid ~0–120 °C, 0–120 g/kg.
export function swProps(T: number, Sg: number): Props {
  const S = Sg / 1000, T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  const rw = 999.9 + 2.034e-2 * T - 6.162e-3 * T2 + 2.261e-5 * T3 - 4.657e-8 * T4;
  const rho = rw + S * (802.0 - 2.001 * T + 1.677e-2 * T2 - 3.060e-5 * T3) - 1.613e-5 * S * S * T2;
  const TK = T + 273.15;
  const A = 5.328 - 9.76e-2 * Sg + 4.04e-4 * Sg * Sg;
  const B = -6.913e-3 + 7.351e-4 * Sg - 3.15e-6 * Sg * Sg;
  const C = 9.6e-6 - 1.927e-6 * Sg + 8.23e-9 * Sg * Sg;
  const D = 2.5e-9 + 1.666e-9 * Sg - 7.125e-12 * Sg * Sg;
  const cp = (A + B * TK + C * TK * TK + D * TK * TK * TK) * 1000;
  const lk = Math.log10(240 + 0.0002 * Sg) + 0.434 * (2.3 - (343.5 + 0.037 * Sg) / TK) * Math.cbrt(1 - TK / (647 + 0.03 * Sg));
  const k = Math.pow(10, lk) / 1000;
  const muw = 4.2844e-5 + 1 / (0.157 * Math.pow(T + 64.993, 2) - 91.296);
  const Am = 1.541 + 1.998e-2 * T - 9.52e-5 * T2, Bm = 7.974 - 7.561e-2 * T + 4.724e-4 * T2;
  const mu = muw * (1 + Am * S + Bm * S * S);
  return { rho, cp, k, mu, frz: -0.0575 * Sg };
}

// Glycol–water: tabulated approximations of ASHRAE Fundamentals data (±10–15 %).
const GT = [-20, -10, 0, 10, 20, 40, 60, 80];
const GLY: Record<'pg' | 'eg', { c: number[]; frz: number[]; mu: number[][]; lin: number[][] }> = {
  pg: {
    c: [20, 30, 40, 50], frz: [-7.1, -12.7, -21.1, -33.5],
    mu: [[12, 5.6, 3.3, 2.35, 1.8, 1.12, 0.77, 0.56], [20, 8.6, 5.0, 3.4, 2.55, 1.5, 1.0, 0.72], [34, 15, 8.2, 5.3, 3.75, 2.05, 1.3, 0.9], [60, 26, 13.5, 8.3, 5.6, 2.9, 1.75, 1.2]],
    lin: [[3.98, .0025, 1017, -.40, .50, .0009], [3.87, .0030, 1026, -.48, .45, .0007], [3.72, .0033, 1034, -.55, .41, .0005], [3.56, .0035, 1041, -.62, .37, .0003]],
  },
  eg: {
    c: [20, 30, 40, 50], frz: [-7.9, -15.3, -24.8, -36.8],
    mu: [[6.5, 3.9, 2.6, 1.95, 1.5, 0.98, 0.7, 0.52], [9, 5.3, 3.5, 2.55, 1.95, 1.25, 0.86, 0.63], [13.5, 7.6, 4.8, 3.4, 2.55, 1.58, 1.07, 0.78], [20, 10.5, 6.6, 4.6, 3.4, 2.0, 1.35, 0.97]],
    lin: [[3.85, .0030, 1026, -.40, .52, .0010], [3.66, .0035, 1040, -.48, .48, .0008], [3.47, .0040, 1054, -.55, .44, .0006], [3.28, .0045, 1067, -.62, .40, .0004]],
  },
};
function lerp(xs: number[], ys: number[], x: number) {
  let i = 0; while (i < xs.length - 2 && x > xs[i + 1]) i++;
  const t = (x - xs[i]) / (xs[i + 1] - xs[i]); return ys[i] + t * (ys[i + 1] - ys[i]);
}
export function glyProps(T: number, type: 'pg' | 'eg', c: number): Props {
  const w = swProps(T, 0);
  if (c <= 0) return w;
  const g = GLY[type], Tc = Math.max(-25, Math.min(95, T));
  const cols: any[] = [{ c: 0, rho: w.rho, cp: w.cp, k: w.k, lmu: Math.log(w.mu), frz: 0 }];
  g.c.forEach((cc, j) => {
    const L = g.lin[j];
    cols.push({
      c: cc, cp: (L[0] + L[1] * (T - 20)) * 1000, rho: L[2] + L[3] * (T - 20), k: L[4] + L[5] * (T - 20),
      lmu: lerp(GT, g.mu[j].map(Math.log), Tc) - Math.log(1000), frz: g.frz[j],
    });
  });
  const cc = Math.min(50, c); let i = 0; while (i < cols.length - 2 && cc > cols[i + 1].c) i++;
  const a = cols[i], b = cols[i + 1], t = (cc - a.c) / (b.c - a.c), L = (p: string) => a[p] + t * (b[p] - a[p]);
  return { rho: L('rho'), cp: L('cp'), k: L('k'), mu: Math.exp(L('lmu')), frz: L('frz') };
}
export function props(fl: Fluid, T: number): Props {
  if (fl.kind === 'sea') return swProps(T, fl.S ?? 35);
  if (fl.kind === 'fresh' || fl.kind === 'water') return swProps(T, 0);
  return glyProps(T, fl.kind, fl.c ?? 0);
}
export function fluidName(fl: Fluid): string {
  if (fl.kind === 'sea') return `Seawater ${fmt(fl.S ?? 35, 1)} g/kg`;
  if (fl.kind === 'fresh') return 'Fresh water';
  if (fl.kind === 'water') return 'Water';
  return `${fl.kind === 'pg' ? 'Propylene' : 'Ethylene'} glycol ${fmt(fl.c ?? 0, 0)} %`;
}

/* ---------- Plate geometry and correlations ---------- */
export type Frame = { name: string; Ap: number; b: number; w: number; Dp: number; conn: string; dn: string; maxFlow: number; max: number; src: 'sheet' | 'est'; note?: string; L: number };
// PHEWORLD / FL-HTEP plates. Ap = vendor area per plate; b, w from data-sheet velocities and equivalent diameters
// (sheet = derived from AAT data sheets, est = scaled from the frame drawing dimensions).
export const FRAMES: Frame[] = [
  { name: 'BR006K', Ap: 0.06, b: 0.0025, w: 0.138, Dp: 0.040, conn: '1½"', dn: 'DN40', maxFlow: 8, max: 41, src: 'sheet' as const, note: 'K series, not in the 2024 spec table' },
  { name: 'BR007M', Ap: 0.07, b: 0.0030, w: 0.152, Dp: 0.040, conn: '1½"', dn: 'DN40', maxFlow: 20.8, max: 38, src: 'sheet' as const },
  { name: 'BR015M', Ap: 0.15, b: 0.0031, w: 0.218, Dp: 0.050, conn: 'DN50', dn: 'DN50', maxFlow: 44, max: 54, src: 'sheet' as const },
  { name: 'BR03M', Ap: 0.30, b: 0.0030, w: 0.330, Dp: 0.100, conn: 'DN100', dn: 'DN100', maxFlow: 140, max: 94, src: 'est' as const },
  { name: 'BR06MB', Ap: 0.60, b: 0.0030, w: 0.430, Dp: 0.150, conn: 'DN150', dn: 'DN150', maxFlow: 165, max: 76, src: 'est' as const },
].map(m => ({ ...m, L: m.Ap / (1.17 * m.w) }));
export const VCH_MAX = 0.8; // ≈ channel velocity at PHEWORLD's rated max flow per model
const PHI = 1.17; // surface enlargement factor
// Kumar (1984) chevron constants, as tabulated in Kakaç & Liu: Nu = Ch Re^n Pr^1/3 (μ/μw)^0.17 ; f = Kp / Re^m
const KUMAR: Record<number, { h: number[][]; f: number[][] }> = {
  30: { h: [[10, .718, .349], [Infinity, .348, .663]], f: [[10, 50, 1], [100, 19.40, .589], [Infinity, 2.990, .183]] },
  45: { h: [[10, .718, .349], [100, .400, .598], [Infinity, .300, .663]], f: [[15, 47, 1], [300, 18.29, .652], [Infinity, 1.441, .206]] },
  60: { h: [[20, .562, .326], [400, .306, .529], [Infinity, .108, .703]], f: [[40, 24, 1], [400, 3.24, .457], [Infinity, .760, .215]] },
};
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
// In these tables the 30° row is the hard (high-turbulence) plate and 60° the soft one.
export const BETA_NAME: Record<number, string> = { 30: 'hard plate pattern', 45: 'mixed plate pattern', 60: 'soft plate pattern' };
const kumar = (beta: number, Re: number) => {
  const K = KUMAR[beta]; const h = K.h.find(r => Re <= r[0])!; const f = K.f.find(r => Re <= r[0])!;
  return { Ch: h[1], n: h[2], Kp: f[1], m: f[2] };
};
export const MATS = { ti: { name: 'Titanium Gr 1', k: 21.9 }, ss316: { name: 'SS 316L', k: 16.3 }, smo: { name: '254 SMO', k: 13.5 } };

export type Hyd = { v: number; Re: number; Pr: number; h: number; dPc: number; dPp: number; dP: number; vp: number };
function sideHyd(sd: any, n: number, p: number, g: any): Hyd {
  const Gc = sd.m / (n * g.b * g.w), pr = sd.pr;
  const v = Gc / pr.rho, Re = Gc * g.De / pr.mu, Pr = pr.cp * pr.mu / pr.k;
  const visc = Math.pow(pr.mu / sd.muw, 0.17);
  const kc = kumar(g.beta, Re);
  const Nu = kc.Ch * Math.pow(Re, kc.n) * Math.cbrt(Pr) * visc;
  const h = Nu * pr.k / g.De;
  const f = kc.Kp / Math.pow(Re, kc.m);
  const dPc = 4 * f * g.L * p / g.De * Gc * Gc / (2 * pr.rho) / visc;
  const Gp = sd.m / (Math.PI * g.Dp * g.Dp / 4);
  const dPp = 1.4 * p * Gp * Gp / (2 * pr.rho);
  return { v, Re, Pr, h, dPc, dPp, dP: dPc + dPp, vp: Gp / pr.rho };
}

export type Side = {
  key: 'p' | 's'; name: 'Primary' | 'Secondary'; fl: Fluid; Tin: number; Tout: number; mode: FlowMode; Vfix: number; dPmax: number; Rf: number;
  role: 'hot' | 'cold'; dT: number; Tm: number; pr: Props; m: number; V: number; Qside: number; bal: number; Tbal: number; theta: number;
  Tmin: number; Tmax: number; muw: number;
};
export type PassOption = {
  key: string; pp: number; ps: number; beta: number; fail?: boolean;
  np?: number; ns?: number; F?: number; plates?: number; Aact?: number; Areq?: number; Adesign?: number; Uc?: number; Us?: number;
  hp?: Hyd; hs?: Hyd; over?: number; gov?: string; vmin?: number;
};
export type FrameEval = {
  fi: number; fr: Frame; nu: number; opts: PassOption[]; rec: PassOption | null; vpP: number; vpS: number;
  dpPortP: number; dpPortS: number; flowOK: boolean; sizeOK: boolean; ok: boolean; autoFail?: boolean;
};
export type PheResult = {
  fatal?: undefined;
  Q: number; P: Side; S: Side; H: Side; C: Side; dT1: number; dT2: number; lmtd: number; approach: number; cross: boolean;
  FR: FrameEval; R: PassOption | null; ALL: FrameEval[]; mat: { name: string; k: number }; matKey: 'ti' | 'ss316' | 'smo'; Tw: number;
  notes: PheNote[]; I: PheInputs;
};
export type PheOutcome = PheResult | { fatal: string };

export const velocityMeetsTarget = (o: PassOption | null, I: PheInputs) => !!o && (o.vmin ?? 0) >= I.vTarget * 0.95;

/* ---------- Main calculation ---------- */
export function computePhe(I: PheInputs): PheOutcome {
  const Q = I.duty * 1000, notes: PheNote[] = [];
  if (!(Q > 0)) return { fatal: 'Enter a heat duty above 0 kW.' };
  const P: any = { key: 'p', name: 'Primary', fl: I.pFl, Tin: I.pTin, Tout: I.pTout, mode: I.pFlowMode, Vfix: I.pFlow, dPmax: I.pDp * 1000, Rf: I.pRf / 1000 };
  const S: any = { key: 's', name: 'Secondary', fl: I.sFl, Tin: I.sTin, Tout: I.sTout, mode: I.sFlowMode, Vfix: I.sFlow, dPmax: I.sDp * 1000, Rf: I.sRf / 1000 };
  for (const sd of [P, S]) {
    if ([sd.Tin, sd.Tout].some((x: number) => !isFinite(x))) return { fatal: `Enter both ${sd.name.toLowerCase()} temperatures.` };
    if (Math.abs(sd.Tin - sd.Tout) < 0.1) return { fatal: `${sd.name} inlet and outlet are the same temperature. Give it a temperature change of at least 0.1 K.` };
  }
  if (I.pOutMode === 'approach' && ((I.sTout > I.sTin) ? P.Tout >= P.Tin : P.Tout <= P.Tin)) {
    return { fatal: `With a ${fmt(I.appK, 1)} K approach the primary outlet would be ${fmt(P.Tout, 1)} °C, which is not ${I.pTin > I.sTin ? 'below' : 'above'} the primary inlet of ${fmt(P.Tin, 1)} °C. Reduce the approach or change the primary inlet.` };
  }
  const pHot = P.Tin > P.Tout, sHot = S.Tin > S.Tout;
  if (pHot === sHot) return { fatal: `Both sides ${pHot ? 'cool down' : 'heat up'}. One side must give up heat and the other must take it. Check the inlet and outlet temperatures.` };
  const H = pHot ? P : S, C = pHot ? S : P;
  H.role = 'hot'; C.role = 'cold';
  const dT1 = H.Tin - C.Tout, dT2 = H.Tout - C.Tin;
  if (dT1 <= 0 || dT2 <= 0) {
    return { fatal: `Not possible even in pure counterflow: the ${dT1 <= 0 ? 'hot inlet (' + fmt(H.Tin, 1) + ' °C) is not above the cold outlet (' + fmt(C.Tout, 1) + ' °C)' : 'hot outlet (' + fmt(H.Tout, 1) + ' °C) is not above the cold inlet (' + fmt(C.Tin, 1) + ' °C)'}. Raise the hot side temperatures or lower the cold side target.` };
  }
  const lmtd = Math.abs(dT1 - dT2) < 1e-6 ? dT1 : (dT1 - dT2) / Math.log(dT1 / dT2);
  const approach = Math.min(dT1, dT2), cross = C.Tout > H.Tout;

  for (const sd of [P, S]) {
    sd.dT = Math.abs(sd.Tin - sd.Tout); sd.Tm = (sd.Tin + sd.Tout) / 2;
    sd.pr = props(sd.fl, sd.Tm);
    if (sd.mode === 'fixed') {
      if (!(sd.Vfix > 0)) return { fatal: `Enter a ${sd.name.toLowerCase()} fixed flow above 0 m³/h.` };
      sd.m = sd.Vfix / 3600 * sd.pr.rho;
    } else sd.m = Q / (sd.pr.cp * sd.dT);
    sd.V = sd.m / sd.pr.rho;
    sd.Qside = sd.m * sd.pr.cp * sd.dT;
    sd.bal = sd.Qside / Q - 1;
    sd.Tbal = sd.Tin + (sd.role === 'hot' ? -1 : 1) * Q / (sd.m * sd.pr.cp);
    sd.theta = sd.dT / lmtd;
    sd.Tmin = Math.min(sd.Tin, sd.Tout); sd.Tmax = Math.max(sd.Tin, sd.Tout);
  }
  const Tw = (H.Tm + C.Tm) / 2;
  for (const sd of [P, S]) sd.muw = props(sd.fl, Tw).mu;

  const matKey: 'ti' | 'ss316' | 'smo' = I.mat === 'auto' ? ((P.fl.kind === 'sea' || S.fl.kind === 'sea') ? 'ti' : 'ss316') : I.mat;
  const mat = MATS[matKey];
  const t = I.thk / 1000;
  const margin = I.margin / 100;
  const vOK = (o: PassOption | null) => velocityMeetsTarget(o, I);
  const Fof = (pp: number, ps: number) => (pp === 1 && ps === 1 ? 1 : pp === ps ? (cross ? 0.90 : 0.95) : (cross ? 0.85 : 0.93));
  const betas = I.beta === 'auto' ? [60, 45, 30] : [+I.beta];

  // Flow one connection can take: limited by the allowable port loss (1.4 velocity heads) and the vendor rating
  const portLimit = (sd: any, Dp: number, rated: number) => Math.min((rated || Infinity) / 3600, Math.PI * Dp * Dp / 4 * Math.sqrt(2 * I.portDp * 1000 / (1.4 * sd.pr.rho)));
  function evalFrame(fi: number): FrameEval {
    const fr = FRAMES[fi];
    const nu = Math.max(1, Math.ceil(Math.max(P.V / portLimit(P, fr.Dp, fr.maxFlow), S.V / portLimit(S, fr.Dp, fr.maxFlow)) - 1e-9));
    const Pu = { ...P, m: P.m / nu }, Su = { ...S, m: S.m / nu }, Qu = Q / nu;
    const vpP = Pu.m / P.pr.rho / (Math.PI * fr.Dp * fr.Dp / 4), vpS = Su.m / S.pr.rho / (Math.PI * fr.Dp * fr.Dp / 4);
    const all: PassOption[] = [];
    for (const beta of betas) {
      const b = fr.b; const g = { b, w: fr.w, L: fr.L, Dp: fr.Dp, De: 2 * b / PHI, Ap: fr.Ap, beta };
      for (let pp = 1; pp <= 4; pp++) for (let ps = 1; ps <= 4; ps++) {
        const F = Fof(pp, ps), lcm = pp * ps / gcd(pp, ps);
        let found: PassOption | null = null, prevFail: string | null = null;
        for (let N = lcm; N <= 3000; N += lcm) { // N = channels per side
          const np = N / pp, ns = N / ps;
          const hp = sideHyd(Pu, np, pp, g), hs = sideHyd(Su, ns, ps, g);
          const dpOK = hp.dP <= P.dPmax && hs.dP <= S.dPmax, velOK = hp.v <= VCH_MAX && hs.v <= VCH_MAX;
          const Uc = 1 / (1 / hp.h + 1 / hs.h + t / mat.k);
          const Us = 1 / (1 / Uc + P.Rf + S.Rf);
          const Areq = Qu / (Us * F * lmtd), Adesign = Areq * (1 + margin);
          const plates = 2 * N + 1, Aact = (plates - 2) * g.Ap;
          if (Aact >= Adesign && dpOK && velOK) {
            found = {
              key: pp + '/' + ps, pp, ps, np, ns, beta, F, plates, Aact, Areq, Adesign, Uc, Us, hp, hs,
              over: Aact / Areq - 1, gov: prevFail || 'Area', vmin: Math.min(hp.v, hs.v),
            };
            break;
          }
          prevFail = !dpOK ? 'Pressure drop' : !velOK ? 'Max velocity' : null;
        }
        all.push(found || { key: pp + '/' + ps, pp, ps, beta, fail: true });
      }
    }
    const valid = all.filter(o => !o.fail);
    const fewest = (arr: PassOption[]) => arr.reduce((a, o) => ((o.plates! < a.plates! || (o.plates === a.plates && o.pp + o.ps < a.pp + a.ps)) ? o : a));
    let rec: PassOption | null = null;
    if (I.passes !== 'auto') { const m = valid.filter(o => o.key === I.passes); rec = m.length ? fewest(m) : null; }
    else if (valid.length) {
      const ones = valid.filter(o => o.key === '1/1' && vOK(o));
      const meets = valid.filter(vOK);
      rec = fewest(ones.length ? ones : meets.length ? meets : valid);
    }
    const opts = rec ? all.filter(o => o.beta === rec!.beta) : all.filter(o => o.beta === betas[0]);
    const flowOK = nu <= I.maxUnits;
    const dpPortP = 1.4 * Math.pow(Pu.m / (Math.PI * fr.Dp * fr.Dp / 4), 2) / (2 * P.pr.rho), dpPortS = 1.4 * Math.pow(Su.m / (Math.PI * fr.Dp * fr.Dp / 4), 2) / (2 * S.pr.rho);
    return { fi, fr, nu, opts, rec, vpP, vpS, dpPortP, dpPortS, flowOK, sizeOK: rec ? rec.plates! <= fr.max : false, ok: flowOK && !!rec && rec.plates! <= fr.max };
  }

  const ALL = FRAMES.map((_, fi) => evalFrame(fi));
  let FR: FrameEval;
  if (I.frame === 'auto') {
    const okAll = ALL.filter(x => x.ok);
    let ok = I.conn === 'any' || I.conn === 'pref50' ? okAll : okAll.filter(x => x.fr.dn === I.conn);
    if (I.conn === 'pref50' && okAll.some(x => x.fr.dn === 'DN50')) ok = okAll.filter(x => x.fr.dn === 'DN50');
    if (ok.length) { const minU = Math.min(...ok.map(x => x.nu)); ok = ok.filter(x => x.nu === minU); }
    const fast = ok.filter(x => vOK(x.rec));
    if (fast.length) FR = fast.reduce((a, x) => (x.rec!.plates! * x.fr.Ap < a.rec!.plates! * a.fr.Ap ? x : a));
    else if (ok.length) FR = ok.reduce((a, x) => (x.rec!.vmin! > a.rec!.vmin! ? x : a));
    else {
      const pool = (I.conn === 'any' || I.conn === 'pref50') ? ALL : ALL.filter(x => x.fr.dn === I.conn);
      FR = pool.filter(x => x.rec).pop() || pool[pool.length - 1] || ALL[ALL.length - 1];
      FR.autoFail = true;
    }
  } else FR = ALL[+I.frame];
  const R = FR.rec;

  /* ---------- Checks ---------- */
  const add = (lvl: NoteLevel, title: string, text = '') => notes.push(title && !text ? { lvl, title: '', text: title } : { lvl, title, text });
  if (!R) add('bad', 'No arrangement found', `with the ${FR.fr.name} plate within the pressure drop limits. Raise the allowable pressure drop, pick a larger plate, or allow multi-pass.`);
  if (approach < 1) add('bad', `Approach of ${fmt(approach, 2)} K.`, 'Below 1 K is not a practical design: area grows without limit and any fouling or flow change loses the duty.');
  else if (approach < 2) add('warn', `Close approach of ${fmt(approach, 1)} K.`, 'Plates can do it, but area is large and the unit is sensitive to fouling and flow balance. Consider widening the temperature program.');
  else add('ok', `Closest approach ${fmt(approach, 1)} K at the ${dT1 < dT2 ? 'hot inlet / cold outlet' : 'hot outlet / cold inlet'} end.`);
  if (cross) add('warn', 'Temperature cross:', `cold outlet ${fmt(C.Tout, 1)} °C is above hot outlet ${fmt(H.Tout, 1)} °C. Fine in a single-pass plate unit (true counterflow), but multi-pass arrangements lose effectiveness. Multi-pass options here use a reduced correction factor.`);
  for (const sd of [P, S]) {
    if (sd.mode === 'fixed' && Math.abs(sd.bal) > 0.02) {
      add('warn', `${sd.name} energy balance off by ${fmt(sd.bal * 100, 1)} %.`, `${fmt(sd.Vfix, 1)} m³/h over ${fmt(sd.dT, 1)} K carries ${fmt(sd.Qside / 1000, 1)} kW, not ${fmt(I.duty, 0)} kW. At this flow the outlet would be ${fmt(sd.Tbal, 1)} °C. Sizing uses the temperatures you entered.`);
    } else if (sd.mode === 'fixed') add('ok', `${sd.name} energy balance within ${fmt(Math.abs(sd.bal * 100), 1)} % of the duty.`);
  }
  if (I.pOutMode === 'both') add('ok', `Primary set to ${fmt(P.Tin, 1)} → ${fmt(P.Tout, 1)} °C: ${fmt(I.appK, 1)} K approach to the secondary ${I.appRef === 'out' ? 'outlet' : 'inlet'} and ${fmt(P.dT, 1)} K machine ΔT.`);
  if (I.pOutMode === 'approach') {
    const lim = ({
      heatpump: [3, 10, 'heat pump condensers usually run 5 K, up to about 10 K'],
      boiler: [5, 25, 'boilers usually run 10 to 20 K'],
      chiller: [3, 8, 'chillers usually run 5 K, up to about 7 K'],
    } as Record<Source, [number, number, string]>)[I.src];
    if (P.dT > lim[1]) add('warn', `Primary ΔT of ${fmt(P.dT, 1)} K`, `from the ${fmt(I.appK, 1)} K approach is wide; ${lim[2]}. Check the ${I.src === 'heatpump' ? 'heat pump' : I.src} can deliver it, or increase the approach.`);
    else if (P.dT < lim[0]) add('warn', `Primary ΔT of only ${fmt(P.dT, 1)} K`, `means a large primary flow (${fmt(P.V * 3600, 1)} m³/h); ${lim[2]}. Reduce the approach or raise the primary inlet.`);
    else add('ok', `Primary outlet ${fmt(P.Tout, 1)} °C set by a ${fmt(I.appK, 1)} K approach to the secondary ${I.appRef === 'out' ? 'outlet' : 'inlet'}; primary ΔT ${fmt(P.dT, 1)} K is within the usual range for a ${I.src === 'heatpump' ? 'heat pump' : I.src}.`);
  }
  if (P.mode === 'auto' && S.mode === 'auto') add('ok', 'Energy balance closes by construction: both flows are derived from the duty.');
  for (const sd of [P, S]) {
    if (sd.fl.kind === 'pg' || sd.fl.kind === 'eg') {
      const frz = props(sd.fl, sd.Tmin).frz;
      if (sd.Tmin - frz < 3) add('bad', `${sd.name} glycol too weak.`, `Freezing point about ${fmt(frz, 1)} °C against a minimum of ${fmt(sd.Tmin, 1)} °C. Keep at least 3–5 K of margin, more for chiller trips and low-load cycling.`);
      else add('ok', `${sd.name} glycol freezes at about ${fmt(frz, 1)} °C, ${fmt(sd.Tmin - frz, 1)} K below the coldest fluid.`);
    } else if (sd.Tmin < 4) add('bad', `${sd.name} reaches ${fmt(sd.Tmin, 1)} °C on ${sd.fl.kind === 'sea' ? 'seawater' : 'water'}.`, 'Freeze risk in the plate pack during low flow or a chiller trip. Use glycol on the chiller loop or raise the supply temperature.');
  }
  if (S.fl.kind === 'sea' && H === P && P.Tin > 55) {
    add('warn', 'Hot surfaces in contact with seawater.', `A ${fmt(P.Tin, 0)} °C primary drives plate wall temperatures well above 50 °C, where calcium carbonate scale forms quickly on the seawater side. Use a lower supply temperature or an intermediate fresh water loop.`);
  }
  if (S.fl.kind === 'sea' && matKey === 'ss316') add('bad', 'SS 316L in seawater.', 'Expect crevice corrosion under the gaskets within months. Use titanium.');
  if (R) {
    for (const [sd, hy] of [[P, R.hp!], [S, R.hs!]] as [any, Hyd][]) {
      if (hy.v < I.vTarget * 0.95) add('warn', `${sd.name} velocity ${fmt(hy.v, 2)} m/s`, `is below your ${fmt(I.vTarget, 2)} m/s target. ${hy.v < 0.2 ? 'Very low; expect poor distribution and fouling. ' : ''}More passes or a smaller frame raise it, at the cost of pressure drop.`);
      if (hy.Re < 100) add('warn', `${sd.name} Reynolds number ${fmt(hy.Re, 0)}.`, 'Flow is near laminar, outside where the correlation is reliable. Treat the U value with caution.');
    }
    if (R.gov === 'Pressure drop') add('info', 'Pressure drop governs.', `Plates were added beyond the thermal need to stay inside the allowable pressure drop, so the unit has ${fmt(R.over! * 100, 0)} % extra surface.`);
    if (R.gov === 'Max velocity') add('info', 'Channel velocity governs.', `Plates were added beyond the thermal need to keep channel velocity under about ${VCH_MAX} m/s, the limit implied by PHEWORLD's rated flows. The unit has ${fmt(R.over! * 100, 0)} % extra surface.`);
    if (R.plates! > FR.fr.max) add('warn', `${R.plates} plates`, `is more than the largest ${FR.fr.name} unit in PHEWORLD's table (about ${FR.fr.max} plates). Use a larger plate or units in parallel.`);
    for (const [sd, hy] of [[P, R.hp!], [S, R.hs!]] as [any, Hyd][]) {
      if (hy.v > VCH_MAX) add('warn', `${sd.name} channel velocity ${fmt(hy.v, 2)} m/s`, `is above the roughly ${VCH_MAX} m/s that PHEWORLD's rated maximum flows imply. Check with the vendor or use the next plate size.`);
    }
  }
  if (!FR.flowOK) add('warn', `${FR.nu} units in parallel needed`, `with ${FR.fr.conn} connections to keep port loss under ${fmt(I.portDp, 0)} kPa and flow within the ${FR.fr.name} rating, more than your limit of ${I.maxUnits}. Raise the allowable port loss, allow more units, or use a larger connection.`);
  else if (FR.nu > 1) add('info', `Split into ${FR.nu} identical units in parallel,`, `each taking ${fmt(100 / FR.nu, 0)} % of the duty and flow, to keep ${FR.fr.conn} port loss under ${fmt(I.portDp, 0)} kPa.`);
  if (I.conn !== 'any' && I.conn !== 'pref50' && FR.fr.dn !== I.conn) add('warn', `No ${I.conn} plate fits this duty; showing ${FR.fr.name} (${FR.fr.conn}).`);
  if (I.conn === 'pref50' && FR.fr.dn !== 'DN50' && I.frame === 'auto') add('info', `DN50 (BR015M) does not fit within ${I.maxUnits} unit${I.maxUnits > 1 ? 's' : ''} at ${fmt(I.portDp, 0)} kPa port loss, so a ${FR.fr.conn} plate is used.`);
  if (P.Tmax > 95 || S.Tmax > 95) add('info', 'Above 95 °C, specify a high-temperature EPDM grade (peroxide cured) and check the frame pressure rating.');

  return { Q, P, S, H, C, dT1, dT2, lmtd, approach, cross, FR, R, ALL, mat, matKey, Tw, notes, I };
}

/* ---------- Derived presentation helpers ---------- */
export type Status = 'feasible' | 'warnings' | 'not_feasible';
export function statusOf(r: PheOutcome): Status {
  if ('fatal' in r && r.fatal) return 'not_feasible';
  const res = r as PheResult;
  if (!res.R || res.notes.some(n => n.lvl === 'bad')) return 'not_feasible';
  return res.notes.some(n => n.lvl === 'warn') ? 'warnings' : 'feasible';
}
export const modelName = (r: PheResult) => (r.R ? `${r.FR.fr.name}-1.0-${fmt(r.R.plates! * r.FR.fr.Ap, 1)}` : r.FR.fr.name);

/** Hot and cold temperature curves along the pack (x = 0 hot inlet end … 1), for the profile chart. */
export function profilePoints(r: PheResult, n = 40) {
  const { H, C, dT1, dT2 } = r;
  const rr = dT2 / dT1, q = (x: number) => (Math.abs(rr - 1) < 1e-6 ? x : (1 - Math.pow(rr, x)) / (1 - rr));
  const pts: { x: number; hot: number; cold: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n, qq = q(x);
    pts.push({ x, hot: H.Tin - (H.Tin - H.Tout) * qq, cold: C.Tout - (C.Tout - C.Tin) * qq });
  }
  return pts;
}

export const CONNECTIONS: [string, string, number][] = [['DN40', '1½"', 0.040], ['DN50', 'DN50', 0.050], ['DN100', 'DN100', 0.100], ['DN150', 'DN150', 0.150]];
/** Port velocity and header loss per connection size if all the flow went through one unit. */
export function connectionRows(r: PheResult) {
  const { P, S, I } = r;
  const area = (D: number) => Math.PI * D * D / 4, pdp = (sd: Side, D: number) => 1.4 * Math.pow(sd.m / area(D), 2) / (2 * sd.pr.rho);
  const vmaxPort = (sd: Side) => Math.sqrt(2 * I.portDp * 1000 / (1.4 * sd.pr.rho));
  return CONNECTIONS.map(([dn, label, D]) => ({
    dn, label, current: r.FR.fr.dn === dn,
    vP: P.V / area(D), dpP: pdp(P, D), vS: S.V / area(D), dpS: pdp(S, D),
    maxPerUnit: area(D) * Math.min(vmaxPort(P), vmaxPort(S)) * 3600,
    unitsNeeded: Math.max(1, Math.ceil(Math.max(P.V / (area(D) * vmaxPort(P)), S.V / (area(D) * vmaxPort(S))) - 1e-9)),
  }));
}

export function materialGuidance(r: PheResult): [string, string][] {
  const sea = r.S.fl.kind === 'sea', gly = ['pg', 'eg'].includes(r.P.fl.kind);
  const hiT = Math.max(r.P.Tmax, r.S.Tmax);
  const out: [string, string][] = [];
  out.push(['Plates', sea
    ? 'Titanium Grade 1, 0.5–0.6 mm. The standard choice for natural and artificial seawater; immune to chloride pitting and crevice attack at aquarium temperatures.'
    : 'SS 316L, 0.4–0.6 mm. Suitable for fresh water with chlorides below roughly 150–300 mg/L at these temperatures. If the system is salted for fish health, or runs above about 300 mg/L chloride, use 254 SMO or titanium.']);
  out.push(['Gaskets', `EPDM, clip-on (glue-free) for easy re-gasketing. EPDM resists ozone and oxidisers well, which matters on ozonated life support loops. ${gly ? 'Compatible with inhibited glycol. ' : ''}Use NBR only where oil or fats may be present; NBR degrades quickly with ozone.${hiT > 95 ? ' Above 95 °C, specify a high-temperature peroxide-cured EPDM.' : ''}`]);
  out.push(['Frame and ports', sea
    ? 'Stainless steel clad frame (PHEWORLD standard). Line the seawater ports with titanium or rubber; no copper, brass or bare carbon steel in wetted parts. Isolate dissimilar metals at the flanges.'
    : 'Stainless steel clad frame (PHEWORLD standard); stainless or rubber-lined port connections.']);
  out.push(['Selected for calc', `${r.mat.name} plates, k = ${fmt(r.mat.k, 1)} W/m·K, ${fmt(r.I.thk, 1)} mm thick.`]);
  if (sea && r.matKey !== 'ti') out.push(['Warning', `${r.mat.name} is not suitable for seawater service.`]);
  return out;
}

/** Compact summary of a result, stored with a saved sizing so lists and the sheet can show it without recomputing. */
export function resultSummary(r: PheOutcome) {
  if ('fatal' in r && r.fatal) return { status: 'not_feasible' as Status, fatal: r.fatal };
  const res = r as PheResult, R = res.R;
  return {
    status: statusOf(res),
    duty_kw: res.Q / 1000, lmtd_k: res.lmtd, approach_k: res.approach,
    plate: res.FR.fr.name, model: modelName(res), connection: res.FR.fr.conn, units: res.FR.nu,
    plates: R?.plates ?? null, passes: R ? `${R.pp}/${R.ps}` : null,
    u_service_w_m2k: R?.Us ?? null, u_clean_w_m2k: R?.Uc ?? null,
    area_required_m2: R ? R.Areq! * res.FR.nu : null,
    area_installed_m2: R ? res.FR.nu * R.plates! * res.FR.fr.Ap : null,
    primary_flow_m3h: res.P.V * 3600, secondary_flow_m3h: res.S.V * 3600,
    primary_dp_kpa: R ? R.hp!.dP / 1000 : null, secondary_dp_kpa: R ? R.hs!.dP / 1000 : null,
    material: res.mat.name,
  };
}
