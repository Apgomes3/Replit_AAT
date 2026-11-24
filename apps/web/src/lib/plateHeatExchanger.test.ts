import { describe, expect, it } from 'vitest';
import { computePhe, DEFAULT_INPUTS, notePlain, PheInputs, PheResult, resolveInputs, applyPreset, swProps } from './plateHeatExchanger';
// Outputs of the original "Plate Heat Exchanger Sizer" artifact's own compute(), run on the same inputs.
import reference from './plateHeatExchanger.reference.json';
import { buildSheetModel } from './plateHeatExchangerSheet';

const base: PheInputs = { ...DEFAULT_INPUTS, pTin: 35, pTout: 30, passes: '1/1', beta: '45' };
const cases: Record<string, PheInputs> = {
  heatpump: base,
  boiler: { ...base, src: 'boiler', pOutMode: 'manual', pTin: 70, pTout: 50 },
  chiller: { ...base, src: 'chiller', pOutMode: 'manual', pFl: { kind: 'pg', c: 30 }, pTin: 7, pTout: 12, sTin: 27, sTout: 24, duty: 80, sFl: { kind: 'fresh' }, sRf: 0.03 },
  big: { ...base, duty: 600, conn: 'any', maxUnits: 3, passes: 'auto', beta: 'auto' },
  fixed: { ...base, pOutMode: 'manual', pTin: 40, pTout: 34, sFlowMode: 'fixed', sFlow: 40, frame: '2' },
  fatal: { ...base, pOutMode: 'manual', pTin: 20, pTout: 25 },
};

const close = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 9);

describe('plate heat exchanger sizing matches the artifact', () => {
  for (const [name, I] of Object.entries(cases)) {
    it(name, () => {
      const ref: any = (reference as any)[name];
      const r = computePhe(I);
      if (ref.fatal) { expect(r).toEqual({ fatal: ref.fatal }); return; }
      const res = r as PheResult;
      close(res.lmtd, ref.lmtd);
      close(res.approach, ref.approach);
      expect(res.FR.fr.name).toBe(ref.frame);
      expect(res.FR.nu).toBe(ref.nu);
      close(res.P.V * 3600, ref.pV);
      close(res.S.V * 3600, ref.sV);
      close(res.P.pr.rho, ref.pRho);
      close(res.S.pr.rho, ref.sRho);
      close(res.S.pr.cp, ref.sCp);
      close(res.P.pr.mu * 1e3, ref.pMu * 1e3);
      expect(res.R!.plates).toBe(ref.plates);
      expect([res.R!.pp, res.R!.ps, res.R!.beta]).toEqual([ref.pp, ref.ps, ref.beta]);
      close(res.R!.Us!, ref.Us);
      close(res.R!.Uc!, ref.Uc);
      close(res.R!.Areq!, ref.Areq);
      close(res.R!.Aact!, ref.Aact);
      close(res.R!.hp!.v, ref.vp);
      close(res.R!.hs!.v, ref.vs);
      close(res.R!.hp!.dP / 1000, ref.dPp / 1000);
      close(res.R!.hs!.dP / 1000, ref.dPs / 1000);
      expect(res.R!.gov).toBe(ref.gov);
      expect(res.matKey).toBe(ref.mat);
      expect(res.notes.map(n => `${n.lvl}: ${notePlain(n)}`)).toEqual(ref.notes);
    });
  }
});

describe('inputs', () => {
  it('sets the primary from approach and machine ΔT', () => {
    const I = resolveInputs({ ...DEFAULT_INPUTS, pOutMode: 'both', appK: 3, appRef: 'out', pDT: 5, sTin: 24, sTout: 27 });
    expect([I.pTin, I.pTout]).toEqual([35, 30]);
  });

  it('sets only the primary outlet in approach mode, below the secondary for a chiller', () => {
    const I = resolveInputs({ ...DEFAULT_INPUTS, pOutMode: 'approach', appK: 3, appRef: 'out', pTin: 7, sTin: 27, sTout: 24 });
    expect([I.pTin, I.pTout]).toEqual([7, 21]);
  });

  it('loads source presets', () => {
    const I = applyPreset(DEFAULT_INPUTS, 'chiller');
    expect(I.pFl.kind).toBe('pg');
    expect([I.pTin, I.pTout, I.sTin, I.sTout]).toEqual([7, 12, 27, 24]);
  });

  it('seawater properties follow Sharqawy et al. at 25 °C, 35 g/kg', () => {
    const p = swProps(25, 35);
    expect(p.rho).toBeCloseTo(1023.3, 0);
    expect(p.cp).toBeCloseTo(4001, -1);
  });
});

describe('selection sheet model', () => {
  it('numbers the rows 1–32 across the three sections and carries the header', () => {
    const r = computePhe(base) as PheResult;
    const m = buildSheetModel(r, { tag: 'HX-01', rev: 'A' }, new Date('2026-11-24T00:00:00Z'));
    const rows = m.sections.flatMap(s => s.rows);
    expect(m.sections.map(s => s.title)).toEqual(['PERFORMANCE PER UNIT', 'THERMAL DESIGN', 'CONSTRUCTION']);
    expect(rows.map(x => x.n)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
    expect(rows.find(x => x.desc === 'Model')!.a).toBe('PHEWORLD BR015M-1.0-3.8');
    expect(m.header.tag).toBe('HX-01');
    expect(m.chart.points).toHaveLength(41);
  });
});
