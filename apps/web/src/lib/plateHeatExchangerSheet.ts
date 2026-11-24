// The PHE selection sheet as plain data: header, numbered rows, notes and the profile curves.
// The print view renders it as HTML; the API renders the same model to PDF when the sheet is
// stored in the project's documents, so both always show the same content.
import { fluidName, fmt, kPa, modelName, notePlain, PheResult, profilePoints, Side } from './plateHeatExchanger';

export type SheetHeader = {
  project?: string; client?: string; tag?: string; doc_no?: string; rev?: string; service?: string;
  prepared?: string; checked?: string; approved?: string;
};
export type SheetRow = { n: number; desc: string; unit: string; a: string; b?: string };
export type SheetSection = { title: string; columns?: [string, string]; rows: SheetRow[] };
export type SheetChart = {
  hotName: string; coldName: string; points: { x: number; hot: number; cold: number }[];
  hotIn: number; hotOut: number; coldIn: number; coldOut: number; dT1: number; dT2: number;
};
export type SheetModel = { header: SheetHeader; date: string; sections: SheetSection[]; notes: string[]; chart: SheetChart };

export function buildSheetModel(r: PheResult, header: SheetHeader, date = new Date()): SheetModel {
  const R = r.R!;
  const { P, S, FR, I } = r, nu = FR.nu;
  const role = (sd: Side) => (sd.role === 'hot' ? 'Hot side' : 'Cold side');
  let n = 0;
  const two = (desc: string, unit: string, a: string, b: string): SheetRow => ({ n: ++n, desc, unit, a, b });
  const one = (desc: string, unit: string, a: string | number): SheetRow => ({ n: ++n, desc, unit, a: String(a) });
  const sections: SheetSection[] = [
    {
      title: 'PERFORMANCE PER UNIT', columns: [`Primary (${role(P)})`, `Secondary (${role(S)})`], rows: [
        two('Fluid', '', fluidName(P.fl), fluidName(S.fl)),
        one('Heat duty per unit', 'kW', `${fmt(r.Q / 1000 / nu, 1)}${nu > 1 ? ` (total ${fmt(r.Q / 1000, 1)} kW, ${nu} units)` : ''}`),
        two('Temperature in / out', '°C', `${fmt(P.Tin, 1)} / ${fmt(P.Tout, 1)}`, `${fmt(S.Tin, 1)} / ${fmt(S.Tout, 1)}`),
        two('Flow rate', 'm³/h', fmt(P.V * 3600 / nu, 2), fmt(S.V * 3600 / nu, 2)),
        two('Flow rate', 'L/s', fmt(P.V * 1000 / nu, 2), fmt(S.V * 1000 / nu, 2)),
        two('Density', 'kg/m³', fmt(P.pr.rho, 1), fmt(S.pr.rho, 1)),
        two('Specific heat', 'kJ/kg·K', fmt(P.pr.cp / 1000, 3), fmt(S.pr.cp / 1000, 3)),
        two('Thermal conductivity', 'W/m·K', fmt(P.pr.k, 3), fmt(S.pr.k, 3)),
        two('Viscosity', 'mPa·s', fmt(P.pr.mu * 1000, 3), fmt(S.pr.mu * 1000, 3)),
        two('Fouling resistance', 'm²K/kW', fmt(P.Rf * 1000, 3), fmt(S.Rf * 1000, 3)),
        two('Passes × channels', '', `${R.pp} × ${R.np}`, `${R.ps} × ${R.ns}`),
        two('Channel velocity', 'm/s', fmt(R.hp!.v, 2), fmt(R.hs!.v, 2)),
        two('Pressure drop, calculated (incl. ports)', 'kPa', kPa(R.hp!.dP), kPa(R.hs!.dP)),
        two('Of which port loss', 'kPa', kPa(R.hp!.dPp), kPa(R.hs!.dPp)),
        two('Pressure drop, allowable', 'kPa', fmt(I.pDp, 0), fmt(I.sDp, 0)),
      ],
    },
    {
      title: 'THERMAL DESIGN', rows: [
        one('LMTD, counter-current', 'K', fmt(r.lmtd, 2)),
        one('Closest approach', 'K', fmt(r.approach, 1)),
        one('Overall U, in service / clean', 'W/m²K', `${fmt(R.Us!, 0)} / ${fmt(R.Uc!, 0)}`),
        one('Heat transfer area required per unit (incl. margin)', 'm²', `${fmt(R.Areq!, 2)} (${fmt(R.Adesign!, 2)} with ${fmt(I.margin, 0)} %)`),
        one('Heat transfer area installed per unit', 'm²', `${fmt(R.plates! * FR.fr.Ap, 2)} (${R.plates} × ${fmt(FR.fr.Ap, 2)})`),
        one('Oversurface (active area)', '%', fmt(R.over! * 100, 0)),
      ],
    },
    {
      title: 'CONSTRUCTION', rows: [
        one('Model', '', `PHEWORLD ${modelName(r)}`),
        one('Number of units', '', `${nu}${nu > 1 ? ' identical, in parallel' : ''}`),
        one('Number of plates per unit', '', R.plates!),
        one('Flow arrangement', '', R.pp === 1 && R.ps === 1 ? 'Single pass, counter-current, common port headers' : `${R.pp} / ${R.ps} pass, counter-current`),
        one('Plate material / thickness', '', `${r.mat.name} / ${fmt(I.thk, 1)} mm`),
        one('Gaskets', '', 'EPDM, clip-on'),
        one('Frame', '', 'Stainless steel clad'),
        one('Connections', '', FR.fr.conn),
        one('Design pressure', 'MPa', '1.0 (10 barg)'),
        one('Highest fluid temperature in this duty', '°C', fmt(Math.max(P.Tmax, S.Tmax), 1)),
        one('Plate unit temperature rating (PHEWORLD)', '°C', '150 max'),
      ],
    },
  ];
  const notes = [
    ...r.notes.filter(x => x.lvl === 'bad' || x.lvl === 'warn').slice(0, 3).map(notePlain),
    'Preliminary selection by AAT on PHEWORLD plate geometry. Final thermal rating, pressure drop and mechanical design to be confirmed by the manufacturer.',
  ];
  const chart: SheetChart = {
    hotName: `${r.H.name} (hot)`, coldName: `${r.C.name} (cold)`, points: profilePoints(r),
    hotIn: r.H.Tin, hotOut: r.H.Tout, coldIn: r.C.Tin, coldOut: r.C.Tout, dT1: r.dT1, dT2: r.dT2,
  };
  return { header, date: date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }), sections, notes, chart };
}
