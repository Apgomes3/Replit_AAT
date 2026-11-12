// Builds the reviewable import plan: one decision per price-list row (pure; unit-tested).
import {
  CATEGORY_RULES, codeSlug, MAX_CODE_LENGTH, norm, normalizeCurrency, parseOzoneGh, toUsd,
} from './rules';
import type { PlanRow, SourceRow } from './workbook';

export type ExistingProduct = {
  code: string; name: string; model: string | null; familyCode: string | null;
  powerKw: number | null; ozoneGh: number | null; manufacturer?: string | null;
};

/**
 * A specification match is only plausible when the makers agree. "AAT / BNP" accepts AAT or BNP;
 * an existing product without a recorded manufacturer accepts any maker (the match is still flagged).
 */
export function manufacturerCompatible(existing: string | null | undefined, source: string | null | undefined): boolean {
  if (!existing || !source) return true;
  const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 2));
  const a = tokens(existing);
  return [...tokens(source)].some(t => a.has(t));
}
export type ExistingComponent = { code: string; name: string; model: string | null };

export type PlanContext = {
  products: ExistingProduct[];
  components: ExistingComponent[];
  ratesPerUsd: Record<string, number>;
  priceListDate: string; // e.g. 2024-06-24, recorded in notes
};

// ---------- matching ----------

/** Codes like PM-FF-160 / AAT-SF-1200 also match a bare model "FF-160" / "SF-1200". */
function exactKeys(p: { code: string; model: string | null }): string[] {
  const stripped = p.code.replace(/^(PM|AAT)-/i, '');
  return [norm(p.model), norm(p.code), norm(stripped)].filter(k => k.length >= 3);
}

const material = (s: string) => /\bti(tanium)?\b|-ti\b/i.test(s) ? 'ti' : /ss\s*-?316/i.test(s) ? 'ss316' : /u?pvc/i.test(s) ? 'pvc' : '';
const firstNumber = (s: string | null | undefined) => { const m = String(s ?? '').match(/(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : null; };
const pumpSize = (s: string | null | undefined) => { const m = String(s ?? '').match(/(\d{2,3})\s*[-‐–]\s*(\d{2,3})\s*[-‐–]\s*(\d{3})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };

/** Engineering signature used to suggest a match within a family when codes differ. */
export function signature(family: string | null, item: { model?: string | null; name?: string | null; description?: string | null; size?: string | null; powerKw?: number | null; ozoneGh?: number | null }): string | null {
  const textAll = [item.model, item.name, item.description].filter(Boolean).join(' ');
  switch (family) {
    case 'PFM-UV': {
      const kw = item.powerKw ?? firstNumber(textAll.match(/(\d+(?:\.\d+)?)\s*kw/i)?.[1]);
      const mat = material(textAll);
      return kw && mat ? `uv:${kw}:${mat}` : null;
    }
    case 'PFM-OZ': return item.ozoneGh ? `oz:${item.ozoneGh}` : null;
    case 'PFM-HX': { const kw = firstNumber(item.size) ?? firstNumber(textAll.match(/(\d+)\s*kw/i)?.[1]); return kw ? `hx:${kw}` : null; }
    case 'PFM-SF': case 'PFM-FF': { const d = textAll.match(/(?:SF|FF)\s*-?\s*(\d{3,4})/i)?.[1]; return d ? `${family}:${Number(d)}` : null; }
    case 'PFM-PUMP': { const s = pumpSize(textAll); return s ? `pump:${s}` : null; }
    default: return null;
  }
}

// ---------- plan ----------

export function buildPlan(source: SourceRow[], ctx: PlanContext): PlanRow[] {
  const takenCodes = new Set([...ctx.products.map(p => p.code.toUpperCase()), ...ctx.components.map(c => c.code.toUpperCase())]);
  // Several existing products can share a model text (e.g. a sand filter and the medium unit built on it).
  const productByExact = new Map<string, ExistingProduct[]>();
  ctx.products.forEach(p => exactKeys(p).forEach(k => {
    const list = productByExact.get(k) ?? [];
    if (!list.includes(p)) productByExact.set(k, [...list, p]);
  }));
  /** Exact model/code match only within the target family, and only when it is unambiguous. */
  const pickExact = (key: string, family: string | null) => {
    const sameFamily = (productByExact.get(key) ?? []).filter(p => p.familyCode === family);
    return sameFamily.length === 1 ? sameFamily[0]! : null;
  };
  const productBySig = new Map<string, ExistingProduct[]>();
  ctx.products.forEach(p => {
    const sig = signature(p.familyCode, { model: p.model, name: p.name, powerKw: p.powerKw, ozoneGh: p.ozoneGh });
    if (sig) productBySig.set(sig, [...(productBySig.get(sig) ?? []), p]);
  });
  const componentByExact = new Map<string, ExistingComponent>();
  ctx.components.forEach(c => exactKeys(c).forEach(k => componentByExact.set(k, c)));

  // Models used by several rows with different descriptions need the description in their name/code.
  const modelUse = new Map<string, number>();
  source.forEach(r => modelUse.set(norm(r.model), (modelUse.get(norm(r.model)) ?? 0) + 1));

  const seenRows = new Map<string, number>();
  const rows: PlanRow[] = source.map(src => draftRow(src, ctx, seenRows));

  // First pass: find candidate matches; count how many rows point at each existing product.
  const candidate = new Map<number, { product: ExistingProduct; basis: 'exact' | 'signature' }>();
  const claims = new Map<string, number[]>();
  rows.forEach((row, i) => {
    if (row.decision === 'SKIP' || !row.familyCode) return;
    const exact = pickExact(norm(row.model), row.familyCode);
    let hit: { product: ExistingProduct; basis: 'exact' | 'signature' } | null = exact ? { product: exact, basis: 'exact' } : null;
    if (!hit) {
      const sig = signature(row.familyCode, { model: row.model, description: row.description, size: row.size, powerKw: row.powerKw, ozoneGh: row.ozoneGh });
      const options = sig ? (productBySig.get(sig) ?? []).filter(p =>
        p.familyCode === row.familyCode && manufacturerCompatible(p.manufacturer, row.brand ?? row.supplier)) : [];
      if (options.length === 1) hit = { product: options[0]!, basis: 'signature' };
    }
    if (hit) { candidate.set(i, hit); claims.set(hit.product.code, [...(claims.get(hit.product.code) ?? []), row.sheetRow]); }
  });

  rows.forEach((row, i) => {
    if (row.decision === 'SKIP') return;
    const warnings = row.warnings ? [row.warnings] : [];
    if ((modelUse.get(norm(row.model)) ?? 0) > 1 && row.description && norm(row.description) !== norm(row.model)) {
      row.name = `${row.name} – ${row.description}`.slice(0, 250);
    }
    if (row.decision === 'CREATE_PRODUCT') {
      const hit = candidate.get(i);
      const sharers = hit ? claims.get(hit.product.code)! : [];
      if (hit && sharers.length === 1) {
        row.decision = 'UPDATE_PRODUCT';
        row.code = hit.product.code;
        row.matchInfo = `${hit.product.code} · ${hit.product.name} (${hit.basis === 'exact' ? 'same model/code' : 'same specification — please confirm'})`;
        if (hit.basis === 'signature') warnings.push('Suggested match — confirm, or change Decision to CREATE_PRODUCT.');
      } else {
        if (hit) {
          row.matchInfo = `Possible: ${hit.product.code} · ${hit.product.name}`;
          warnings.push(`Several rows (${sharers.join(', ')}) resemble ${hit.product.code}; created as new — set UPDATE_PRODUCT on one row if it is the same item.`);
        }
        row.code = uniqueCode(codeFor(row, modelUse), takenCodes);
      }
    } else if (row.decision === 'CREATE_COMPONENT') {
      const existing = componentByExact.get(norm(row.model));
      if (existing) {
        row.decision = 'UPDATE_COMPONENT';
        row.code = existing.code;
        row.matchInfo = `${existing.code} · ${existing.name} (same model/code)`;
      } else {
        row.code = uniqueCode(`COMP-${codeFor(row, modelUse)}`, takenCodes);
      }
    }
    row.warnings = warnings.length ? warnings.join(' ') : null;
  });
  return rows;
}

function draftRow(src: SourceRow, ctx: PlanContext, seen: Map<string, number>): PlanRow {
  const rule = CATEGORY_RULES[src.category];
  const currency = normalizeCurrency(src.currency);
  const costUsd = toUsd(src.cost, currency, ctx.ratesPerUsd);
  const warnings: string[] = [];
  const family = rule?.kind === 'product' ? rule.family : null;

  let decision: PlanRow['decision'] = rule?.kind === 'product' ? 'CREATE_PRODUCT' : rule?.kind === 'component' ? 'CREATE_COMPONENT' : 'SKIP';
  if (!rule) warnings.push(`Unknown price-list category "${src.category}" — not imported.`);
  if (rule?.kind === 'skip') warnings.push(rule.reason);

  const dupKey = [src.category, src.model, src.description, src.currency, src.cost].map(norm).join('|');
  if (seen.has(dupKey)) { decision = 'SKIP'; warnings.push(`Duplicate of price list row ${seen.get(dupKey)}.`); }
  else seen.set(dupKey, src.sheetRow);

  if (decision !== 'SKIP' && src.cost == null) { decision = 'SKIP'; warnings.push('No supplier cost in the price list (e.g. "not available").'); }
  if (decision !== 'SKIP' && src.cost != null && costUsd == null) {
    warnings.push(currency ? `No ${currency} rate in Admin › Exchange Rates — add it and re-run the dry run.` : 'No currency in the price list.');
  }
  if (decision !== 'SKIP' && src.rrp == null) warnings.push('No RRP (sell price) in the price list.');
  if (src.sizeRestoredFromDate) warnings.push(`Size was stored as a date in Excel; restored to "${src.size}".`);

  const name = rule?.kind === 'component' ? `${rule.componentType} ${src.model}` : src.model;
  const mm = (m: number | null) => (m == null ? null : Math.round(m * 1000));
  const notes = [`ASW price list ${ctx.priceListDate}, row ${src.sheetRow}${src.lastUpdate ? `; supplier price dated ${src.lastUpdate}` : ''}.`, src.notes].filter(Boolean).join(' ');

  return {
    sheetRow: src.sheetRow,
    decision,
    code: null,
    familyCode: family,
    componentType: rule?.kind === 'component' ? rule.componentType : null,
    componentCategory: rule?.kind === 'component' ? rule.componentCategory : null,
    name,
    description: src.description,
    model: src.model,
    size: src.size,
    supplier: src.supplier,
    brand: src.brand,
    supplierCurrency: currency,
    supplierCost: src.cost,
    costUsd,
    sellPriceUsd: src.rrp == null ? null : Math.round(src.rrp * 100) / 100,
    powerKw: src.powerKw,
    ozoneGh: family === 'PFM-OZ' ? parseOzoneGh(src.size, src.description) : null,
    lengthMm: mm(src.lengthM),
    widthMm: mm(src.widthM),
    heightMm: mm(src.heightM),
    sandKg: src.sandKg,
    notes,
    sourceCategory: src.category,
    matchInfo: null,
    warnings: warnings.length ? warnings.join(' ') : null,
  };
}

/** Code from the model; generic models shared by several rows also get the size/description. */
function codeFor(row: PlanRow, modelUse: Map<string, number>): string {
  const base = codeSlug(row.model, 28);
  if ((modelUse.get(norm(row.model)) ?? 0) > 1) {
    const extra = codeSlug(row.size ?? row.description?.split(/\s+/).slice(0, 4).join(' ') ?? '', 12);
    return extra ? `${base}-${extra}` : base;
  }
  return base;
}

/** Make a code unique; always stays within the database's 50-character limit. */
function uniqueCode(base: string, taken: Set<string>): string {
  const root = (base || 'ITEM').slice(0, MAX_CODE_LENGTH - 4).replace(/-$/, '');
  let code = root;
  for (let n = 2; taken.has(code.toUpperCase()); n++) code = `${root}-${n}`;
  taken.add(code.toUpperCase());
  return code;
}
